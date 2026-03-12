import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@web/lib/auth/session'
import { prisma } from '@web/lib/prisma'
import { suiClient } from '@web/lib/sui'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { intentId, txDigest } = await request.json()
  if (!intentId || !txDigest) {
    return NextResponse.json({ error: 'Missing intentId or txDigest' }, { status: 400 })
  }

  // Load intent and validate ownership
  const intent = await prisma.purchaseIntent.findUnique({
    where: { id: intentId },
    include: {
      listing: { select: { bundleId: true } },
      walletBinding: { select: { address: true } },
    },
  })
  if (!intent) {
    return NextResponse.json({ error: 'Intent not found' }, { status: 404 })
  }
  if (intent.memberId !== session.memberId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (intent.status !== 'pending') {
    return NextResponse.json({ error: `Intent already ${intent.status}` }, { status: 400 })
  }
  if (new Date() > intent.expiresAt) {
    await prisma.purchaseIntent.update({ where: { id: intentId }, data: { status: 'expired' } })
    return NextResponse.json({ error: 'Intent expired' }, { status: 400 })
  }

  // Check txDigest uniqueness
  const existingOrder = await prisma.order.findUnique({ where: { txDigest } })
  if (existingOrder) {
    return NextResponse.json({ error: 'Transaction already used' }, { status: 409 })
  }

  // Verify on-chain transaction
  let txBlock
  try {
    txBlock = await suiClient.getTransactionBlock({
      digest: txDigest,
      options: { showEffects: true, showBalanceChanges: true, showInput: true },
    })
  } catch {
    return NextResponse.json({ error: 'Transaction not found on chain' }, { status: 400 })
  }

  // 1. Transaction must have succeeded
  const status = txBlock.effects?.status?.status
  if (status !== 'success') {
    return NextResponse.json({ error: `Transaction failed: ${status}` }, { status: 400 })
  }

  // 2. Sender must match bound wallet
  const sender = txBlock.transaction?.data?.sender
  if (sender !== intent.walletBinding.address) {
    return NextResponse.json({ error: 'Transaction sender does not match bound wallet' }, { status: 400 })
  }

  // 3. Verify balance changes — recipient received expected amount
  const balanceChanges = txBlock.balanceChanges || []
  const recipientChange = balanceChanges.find(
    (bc) =>
      bc.owner &&
      typeof bc.owner === 'object' &&
      'AddressOwner' in bc.owner &&
      bc.owner.AddressOwner === intent.recipientAddress &&
      bc.coinType === '0x2::sui::SUI',
  )
  if (!recipientChange || BigInt(recipientChange.amount) < intent.expectedPriceMist) {
    return NextResponse.json({ error: 'Payment amount insufficient or recipient mismatch' }, { status: 400 })
  }

  // 4. Transaction must post-date the intent creation (prevent replay of old transfers)
  // Allow 60s clock skew between Postgres and Sui checkpoint timestamps
  const CLOCK_SKEW_MS = 60_000
  const txTimestamp = txBlock.timestampMs
  if (!txTimestamp || Number(txTimestamp) < intent.createdAt.getTime() - CLOCK_SKEW_MS) {
    return NextResponse.json({ error: 'Transaction predates purchase intent' }, { status: 400 })
  }

  // All checks passed — atomically create Order + Entitlement
  const result = await prisma.$transaction(async (tx) => {
    await tx.purchaseIntent.update({
      where: { id: intentId },
      data: { status: 'confirmed', txDigest },
    })

    const order = await tx.order.create({
      data: {
        listingId: intent.listingId,
        buyerId: session.memberId,
        walletBindingId: intent.walletBindingId,
        purchaseIntentId: intentId,
        priceMist: intent.expectedPriceMist,
        txDigest,
      },
    })

    const entitlement = await tx.entitlement.create({
      data: {
        bundleId: intent.listing.bundleId,
        orderId: order.id,
        memberId: session.memberId,
        walletBindingId: intent.walletBindingId,
      },
    })

    return { order, entitlement }
  })

  return NextResponse.json({
    order: { ...result.order, priceMist: result.order.priceMist.toString() },
    entitlement: result.entitlement,
  })
}
