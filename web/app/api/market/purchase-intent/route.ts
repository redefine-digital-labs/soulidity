import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { PublicKey } from '@solana/web3.js'
import { resolveIdentity } from '@web/lib/auth/identity'
import { getCoingeckoUsdPrice } from '@web/lib/coingecko'
import { prisma } from '@web/lib/prisma'
import {
  getUsdcMint,
  solanaConnection,
  usdCentsToUsdcAtomicUnits,
} from '@web/lib/solana'
import { getAssociatedTokenAddress } from '@web/lib/solana-spl'

async function resolveListingUsdCents(listing: {
  priceUsdCents: number | null
  priceMist: bigint
}): Promise<number> {
  if (listing.priceUsdCents !== null) {
    return listing.priceUsdCents
  }

  const suiPriceUsd = await getCoingeckoUsdPrice('sui')
  const suiAmount = Number(listing.priceMist) / 1_000_000_000
  return Math.max(1, Math.ceil(suiAmount * suiPriceUsd * 100))
}

export async function POST(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const { listingId, chain = 'sui' } = await request.json()
  if (!listingId) {
    return NextResponse.json({ error: 'Missing listingId' }, { status: 400 })
  }

  const beneficiaryMemberId = identity.kind === 'agent'
    ? identity.ownerMemberId ?? identity.memberId
    : identity.memberId
  const paymentChain = chain === 'solana' ? 'solana' : 'sui'

  const wallet = await prisma.walletBinding.findFirst({
    where: { memberId: identity.memberId, chain: paymentChain, isPrimary: true },
  })
  if (!wallet) {
    return NextResponse.json(
      { error: paymentChain === 'solana' ? 'No Solana wallet bound' : 'No Sui wallet bound' },
      { status: 400 },
    )
  }

  const listing = await prisma.listing.findFirst({
    where: { id: listingId, status: 'active', bundle: { status: 'active' } },
    include: { bundle: { select: { sellerId: true } } },
  })
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found or inactive' }, { status: 404 })
  }

  if (listing.bundle.sellerId === identity.memberId || listing.bundle.sellerId === beneficiaryMemberId) {
    return NextResponse.json({ error: 'Cannot purchase your own bundle' }, { status: 400 })
  }

  const existingEntitlement = await prisma.entitlement.findFirst({
    where: { memberId: beneficiaryMemberId, bundleId: listing.bundleId, status: 'active' },
  })
  if (existingEntitlement) {
    return NextResponse.json({ error: 'You already own this bundle' }, { status: 400 })
  }

  const nonce = randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
  let recipientAddress = listing.sellerWalletAddress
  let recipientTokenAccount: string | null = null
  let expectedAmount: bigint | null = null

  if (paymentChain === 'solana') {
    const sellerWallet = await prisma.walletBinding.findFirst({
      where: { memberId: listing.bundle.sellerId, chain: 'solana', isPrimary: true },
    })

    if (!sellerWallet) {
      return NextResponse.json({ error: 'Seller does not have a Solana wallet bound' }, { status: 400 })
    }

    recipientAddress = sellerWallet.address

    const listingUsdCents = await resolveListingUsdCents(listing)
    const tokenAccount = await getAssociatedTokenAddress(
      getUsdcMint(),
      new PublicKey(sellerWallet.address),
    )
    const tokenAccountInfo = await solanaConnection.getAccountInfo(tokenAccount, 'confirmed')
    if (!tokenAccountInfo) {
      return NextResponse.json({ error: 'Seller USDC token account not found' }, { status: 400 })
    }
    recipientTokenAccount = tokenAccount.toBase58()
    expectedAmount = usdCentsToUsdcAtomicUnits(listingUsdCents)
  }

  const intent = await prisma.purchaseIntent.create({
    data: {
      listingId,
      memberId: beneficiaryMemberId,
      agentMemberId: identity.kind === 'agent' ? identity.memberId : null,
      walletBindingId: wallet.id,
      chain: paymentChain,
      currency: paymentChain === 'solana' ? 'USDC' : 'SUI',
      expectedPriceMist: listing.priceMist,
      expectedAmount,
      recipientAddress,
      recipientTokenAccount,
      nonce,
      expiresAt,
    },
  })

  if (paymentChain === 'solana') {
    return NextResponse.json({
      intentId: intent.id,
      nonce: intent.nonce,
      chain: intent.chain,
      currency: intent.currency,
      amount: intent.expectedAmount?.toString(),
      recipientAddress: intent.recipientAddress,
      recipientTokenAccount: intent.recipientTokenAccount,
      mint: getUsdcMint().toBase58(),
      expiresAt: intent.expiresAt.toISOString(),
    })
  }

  return NextResponse.json({
    intentId: intent.id,
    nonce: intent.nonce,
    priceMist: intent.expectedPriceMist.toString(),
    recipientAddress: intent.recipientAddress,
    expiresAt: intent.expiresAt.toISOString(),
  })
}
