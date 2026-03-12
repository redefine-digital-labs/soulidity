import { NextRequest, NextResponse } from 'next/server'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { getSession } from '@web/lib/auth/session'
import { prisma } from '@web/lib/prisma'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { nonce, signature } = await request.json()
  if (!nonce || !signature) {
    return NextResponse.json({ error: 'Missing nonce or signature' }, { status: 400 })
  }

  // Re-derive the expected message
  const message = `Sign this message to bind your Sui wallet to CryptoOpenClaw.\n\nAccount: ${session.memberId}\nNonce: ${nonce}`
  const messageBytes = new TextEncoder().encode(message)

  let signerAddress: string
  try {
    const publicKey = await verifyPersonalMessageSignature(messageBytes, signature)
    signerAddress = publicKey.toSuiAddress()
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Check if this wallet is already bound to another account
  const existing = await prisma.walletBinding.findUnique({
    where: { chain_address: { chain: 'sui', address: signerAddress } },
  })
  if (existing && existing.memberId !== session.memberId) {
    return NextResponse.json({ error: 'Wallet already bound to another account' }, { status: 409 })
  }
  if (existing && existing.memberId === session.memberId) {
    return NextResponse.json({ walletBinding: existing })
  }

  // Set all existing bindings for this member+chain to non-primary
  await prisma.walletBinding.updateMany({
    where: { memberId: session.memberId, chain: 'sui' },
    data: { isPrimary: false },
  })

  const walletBinding = await prisma.walletBinding.create({
    data: {
      memberId: session.memberId,
      chain: 'sui',
      address: signerAddress,
      isPrimary: true,
    },
  })

  return NextResponse.json({ walletBinding })
}
