import { NextRequest, NextResponse } from 'next/server'
import { resolveIdentity } from '@web/lib/auth/identity'
import { getCoingeckoUsdPrice } from '@web/lib/coingecko'
import { prisma } from '@web/lib/prisma'

async function resolvePriceUsdCents(priceMist: bigint): Promise<number> {
  const suiPriceUsd = await getCoingeckoUsdPrice('sui')
  const suiAmount = Number(priceMist) / 1_000_000_000
  return Math.max(1, Math.ceil(suiAmount * suiPriceUsd * 100))
}

export async function POST(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  // Seller must have a primary Sui wallet bound
  const wallet = await prisma.walletBinding.findFirst({
    where: { memberId: identity.memberId, chain: 'sui', isPrimary: true },
  })
  if (!wallet) {
    return NextResponse.json({ error: 'No Sui wallet bound. Please bind your wallet first.' }, { status: 400 })
  }

  const body = await request.json()
  const { name, description, category, tags, storagePath, contentHash, previewImages, readme, priceMist } = body

  if (!name || !description || !category || !storagePath || !contentHash || !priceMist) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Validate storagePath belongs to authenticated user
  if (!storagePath.startsWith(`${identity.memberId}/`)) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 403 })
  }

  let priceBigInt: bigint
  try {
    priceBigInt = BigInt(priceMist)
  } catch {
    return NextResponse.json({ error: 'priceMist must be a valid integer string' }, { status: 400 })
  }
  if (priceBigInt <= BigInt(0)) {
    return NextResponse.json({ error: 'Price must be positive' }, { status: 400 })
  }

  let priceUsdCents: number
  try {
    priceUsdCents = await resolvePriceUsdCents(priceBigInt)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to price listing in USD' },
      { status: 502 },
    )
  }

  const result = await prisma.$transaction(async (tx) => {
    const bundle = await tx.agentBundle.create({
      data: {
        sellerId: identity.memberId,
        name,
        description,
        category,
        tags: tags || [],
        storagePath,
        contentHash,
        previewImages: previewImages || [],
        readme: readme || null,
        status: 'active',
      },
    })

    const listing = await tx.listing.create({
      data: {
        bundleId: bundle.id,
        sellerWalletAddress: wallet.address,
        priceMist: priceBigInt,
        priceUsdCents,
        status: 'active',
      },
    })

    return { bundle, listing }
  })

  return NextResponse.json({
    bundle: result.bundle,
    listing: { ...result.listing, priceMist: result.listing.priceMist.toString() },
  }, { status: 201 })
}
