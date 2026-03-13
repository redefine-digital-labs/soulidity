import { NextRequest, NextResponse } from 'next/server'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { resolveIdentity } from '@web/lib/auth/identity'
import { prisma } from '@web/lib/prisma'

export async function POST(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const { nonce, signature } = await request.json()
  if (!nonce || !signature) {
    return NextResponse.json({ error: 'Missing nonce or signature' }, { status: 400 })
  }

  // Verify nonce matches the one set by challenge endpoint
  const storedNonce = request.cookies.get('wallet-bind-nonce')?.value
  if (!storedNonce || storedNonce !== nonce) {
    return NextResponse.json({ error: 'Invalid or expired challenge' }, { status: 400 })
  }

  // Re-derive the expected message
  const message = `Sign this message to bind your Sui wallet to CryptoOpenClaw.\n\nAccount: ${identity.memberId}\nNonce: ${nonce}`
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
  if (existing && existing.memberId !== identity.memberId) {
    return NextResponse.json({ error: 'Wallet already bound to another account' }, { status: 409 })
  }
  if (existing && existing.memberId === identity.memberId) {
    const response = NextResponse.json({ walletBinding: existing })
    response.cookies.delete({ name: 'wallet-bind-nonce', path: '/api/wallet/bind' })
    return response
  }

  // Set all existing bindings for this member+chain to non-primary
  await prisma.walletBinding.updateMany({
    where: { memberId: identity.memberId, chain: 'sui' },
    data: { isPrimary: false },
  })

  const walletBinding = await prisma.walletBinding.create({
    data: {
      memberId: identity.memberId,
      chain: 'sui',
      address: signerAddress,
      isPrimary: true,
    },
  })

  const response = NextResponse.json({ walletBinding })
  response.cookies.delete({ name: 'wallet-bind-nonce', path: '/api/wallet/bind' })
  return response
}
