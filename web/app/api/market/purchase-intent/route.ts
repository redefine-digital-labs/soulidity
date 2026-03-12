import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getSession } from '@web/lib/auth/session'
import { prisma } from '@web/lib/prisma'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { listingId } = await request.json()
  if (!listingId) {
    return NextResponse.json({ error: 'Missing listingId' }, { status: 400 })
  }

  const wallet = await prisma.walletBinding.findFirst({
    where: { memberId: session.memberId, chain: 'sui', isPrimary: true },
  })
  if (!wallet) {
    return NextResponse.json({ error: 'No Sui wallet bound' }, { status: 400 })
  }

  const listing = await prisma.listing.findFirst({
    where: { id: listingId, status: 'active', bundle: { status: 'active' } },
    include: { bundle: { select: { sellerId: true } } },
  })
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found or inactive' }, { status: 404 })
  }

  if (listing.bundle.sellerId === session.memberId) {
    return NextResponse.json({ error: 'Cannot purchase your own bundle' }, { status: 400 })
  }

  const existingEntitlement = await prisma.entitlement.findFirst({
    where: { memberId: session.memberId, bundleId: listing.bundleId, status: 'active' },
  })
  if (existingEntitlement) {
    return NextResponse.json({ error: 'You already own this bundle' }, { status: 400 })
  }

  const nonce = randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
  const recipientAddress = listing.sellerWalletAddress

  const intent = await prisma.purchaseIntent.create({
    data: {
      listingId,
      memberId: session.memberId,
      walletBindingId: wallet.id,
      expectedPriceMist: listing.priceMist,
      recipientAddress,
      nonce,
      expiresAt,
    },
  })

  return NextResponse.json({
    intentId: intent.id,
    nonce: intent.nonce,
    priceMist: intent.expectedPriceMist.toString(),
    recipientAddress: intent.recipientAddress,
    expiresAt: intent.expiresAt.toISOString(),
  })
}
