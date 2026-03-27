import { NextRequest, NextResponse } from 'next/server'
import { resolveIdentity } from '@web/lib/auth/identity'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { verifyPersonalMessageSignature } from '@web/lib/sui-verify'
import { buildWalletBindMessage } from '../challenge/route'

const MULTIPLE_SUI_WALLETS_ERROR = 'Multiple Sui wallets are not supported for this account'

export async function POST(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const rateLimit = await takeRateLimitToken(`wallet-bind-confirm:${identity.memberId}`, {
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

  const { nonce, signature } = await request.json()
  if (!nonce || !signature) {
    return NextResponse.json({ error: 'Missing nonce or signature' }, { status: 400 })
  }

  // Verify nonce matches the one set by challenge endpoint
  const storedNonce = request.cookies.get('wallet-bind-nonce')?.value
  if (!storedNonce || storedNonce !== nonce) {
    return NextResponse.json({ error: 'Invalid or expired challenge' }, { status: 400 })
  }

  const message = buildWalletBindMessage(identity.memberId, nonce)
  const messageBytes = new TextEncoder().encode(message)

  let signerAddress: string
  try {
    const publicKey = await verifyPersonalMessageSignature(messageBytes, signature)
    signerAddress = publicKey.toSuiAddress()
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const chain = 'sui'

  // Check if this wallet is already bound to another account
  const existing = await prisma.walletBinding.findUnique({
    where: { chain_address: { chain, address: signerAddress } },
  })
  if (existing && existing.memberId !== identity.memberId) {
    return NextResponse.json({ error: 'Wallet already bound to another account' }, { status: 409 })
  }
  if (existing && existing.memberId === identity.memberId) {
    // Re-promote this wallet to primary (clear others first)
    if (!existing.isPrimary) {
      const promoted = await prisma.$transaction(async (tx) => {
        await tx.walletBinding.updateMany({
          where: { memberId: identity.memberId, chain, isPrimary: true },
          data: { isPrimary: false },
        })
        return tx.walletBinding.update({
          where: { id: existing.id },
          data: { isPrimary: true },
        })
      })
      const response = NextResponse.json({ walletBinding: promoted })
      response.cookies.delete({ name: 'wallet-bind-nonce', path: '/api/wallet/bind' })
      return response
    }
    const response = NextResponse.json({ walletBinding: existing })
    response.cookies.delete({ name: 'wallet-bind-nonce', path: '/api/wallet/bind' })
    return response
  }

  const existingMemberBinding = await prisma.walletBinding.findFirst({
    where: {
      memberId: identity.memberId,
      chain,
      NOT: {
        address: signerAddress,
      },
    },
  })
  if (existingMemberBinding) {
    return NextResponse.json({ error: MULTIPLE_SUI_WALLETS_ERROR }, { status: 409 })
  }

  // Create the single allowed Sui binding for this member.
  const walletBinding = await prisma.$transaction(async (tx) => {
    const binding = await tx.walletBinding.create({
      data: {
        memberId: identity.memberId,
        chain,
        address: signerAddress,
        isPrimary: true,
      },
    })

    await tx.soulAsset.updateMany({
      where: { currentOwnerAddress: signerAddress, currentOwnerMemberId: null },
      data: { currentOwnerMemberId: identity.memberId },
    })

    await tx.soulAsset.updateMany({
      where: { creatorAddress: signerAddress, creatorMemberId: null },
      data: { creatorMemberId: identity.memberId },
    })

    return binding
  })

  const response = NextResponse.json({ walletBinding })
  response.cookies.delete({ name: 'wallet-bind-nonce', path: '/api/wallet/bind' })
  return response
}
