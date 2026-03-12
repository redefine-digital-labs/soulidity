import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@web/lib/auth/session'
import { prisma } from '@web/lib/prisma'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Seller must have a primary Sui wallet bound
  const wallet = await prisma.walletBinding.findFirst({
    where: { memberId: session.memberId, chain: 'sui', isPrimary: true },
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
  if (!storagePath.startsWith(`${session.memberId}/`)) {
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

  const result = await prisma.$transaction(async (tx) => {
    const bundle = await tx.agentBundle.create({
      data: {
        sellerId: session.memberId,
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
