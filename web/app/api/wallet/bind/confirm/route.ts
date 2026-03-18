import { NextRequest, NextResponse } from 'next/server'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import { resolveIdentity } from '@web/lib/auth/identity'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { buildWalletBindMessage } from '../challenge/route'

export async function POST(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const rateLimit = takeRateLimitToken(`wallet-bind-confirm:${identity.memberId}`, {
    max: 10,
    windowMs: 60 * 60 * 1000,
  })
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      },
    )
  }

  const { nonce, signature, chain = 'sui', address } = await request.json()
  if (!nonce || !signature) {
    return NextResponse.json({ error: 'Missing nonce or signature' }, { status: 400 })
  }

  // Verify nonce matches the one set by challenge endpoint
  const storedNonce = request.cookies.get('wallet-bind-nonce')?.value
  if (!storedNonce || storedNonce !== nonce) {
    return NextResponse.json({ error: 'Invalid or expired challenge' }, { status: 400 })
  }
  const storedChain = request.cookies.get('wallet-bind-chain')?.value
  const walletChain = chain === 'solana' ? 'solana' : 'sui'
  if (storedChain && storedChain !== walletChain) {
    return NextResponse.json({ error: 'Challenge chain mismatch' }, { status: 400 })
  }

  const message = buildWalletBindMessage(identity.memberId, nonce, walletChain)
  const messageBytes = new TextEncoder().encode(message)

  let signerAddress: string
  if (walletChain === 'solana') {
    if (!address || typeof address !== 'string') {
      return NextResponse.json({ error: 'Missing address' }, { status: 400 })
    }

    try {
      const publicKeyBytes = bs58.decode(address)
      const signatureBytes = bs58.decode(signature)
      const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes)
      if (!valid) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
      }
      signerAddress = address
    } catch {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }
  } else {
    try {
      const publicKey = await verifyPersonalMessageSignature(messageBytes, signature)
      signerAddress = publicKey.toSuiAddress()
    } catch {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }
  }

  // Check if this wallet is already bound to another account
  const existing = await prisma.walletBinding.findUnique({
    where: { chain_address: { chain: walletChain, address: signerAddress } },
  })
  if (existing && existing.memberId !== identity.memberId) {
    return NextResponse.json({ error: 'Wallet already bound to another account' }, { status: 409 })
  }
  if (existing && existing.memberId === identity.memberId) {
    const response = NextResponse.json({ walletBinding: existing })
    response.cookies.delete({ name: 'wallet-bind-nonce', path: '/api/wallet/bind' })
    response.cookies.delete({ name: 'wallet-bind-chain', path: '/api/wallet/bind' })
    return response
  }

  // Set all existing bindings for this member+chain to non-primary
  await prisma.walletBinding.updateMany({
    where: { memberId: identity.memberId, chain: walletChain },
    data: { isPrimary: false },
  })

  const walletBinding = await prisma.walletBinding.create({
    data: {
      memberId: identity.memberId,
      chain: walletChain,
      address: signerAddress,
      isPrimary: true,
    },
  })

  const response = NextResponse.json({ walletBinding })
  response.cookies.delete({ name: 'wallet-bind-nonce', path: '/api/wallet/bind' })
  response.cookies.delete({ name: 'wallet-bind-chain', path: '/api/wallet/bind' })
  return response
}
