import { NextRequest, NextResponse } from 'next/server'
import { resolveIdentity } from '@web/lib/auth/identity'
import { privy } from '@web/lib/auth/privy'
import { prisma } from '@web/lib/prisma'
import { usdCentsToUsdcAtomicUnits } from '@web/lib/solana'

export async function POST(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  // Get seller's Privy embedded Solana address
  const account = await prisma.account.findFirst({
    where: { members: { some: { id: identity.memberId } } },
    select: { privyDid: true },
  })
  if (!account?.privyDid) {
    return NextResponse.json({ error: 'Account not linked to Privy' }, { status: 400 })
  }

  const privyUser = await privy.getUser(account.privyDid)
  const solanaWallet = privyUser.linkedAccounts.find(
    (a): a is Extract<typeof a, { type: 'wallet' }> =>
      a.type === 'wallet' && 'chainType' in a && a.chainType === 'solana' && 'walletClient' in a && a.walletClient === 'privy',
  )
  if (!solanaWallet) {
    return NextResponse.json({ error: 'No Privy Solana embedded wallet found. Please re-login.' }, { status: 400 })
  }
  const sellerSolanaAddress = solanaWallet.address

  const body = await request.json()
  const { name, description, category, tags, storagePath, contentHash, previewImages, readme, priceUsdCents } = body

  if (!name || !description || !category || !storagePath || !contentHash || !priceUsdCents) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Validate storagePath belongs to authenticated user
  if (!storagePath.startsWith(`${identity.memberId}/`)) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 403 })
  }

  const priceUsdCentsInt = parseInt(priceUsdCents, 10)
  if (!Number.isFinite(priceUsdCentsInt) || priceUsdCentsInt <= 0) {
    return NextResponse.json({ error: 'Price must be a positive integer (cents)' }, { status: 400 })
  }

  const priceMist = usdCentsToUsdcAtomicUnits(priceUsdCentsInt)

  const result = await prisma.$transaction(async (tx) => {
    // Upsert WalletBinding for solana so purchase flow can find it
    await tx.walletBinding.upsert({
      where: { chain_address: { chain: 'solana', address: sellerSolanaAddress } },
      update: { isPrimary: true },
      create: {
        memberId: identity.memberId,
        chain: 'solana',
        address: sellerSolanaAddress,
        isPrimary: true,
      },
    })

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
        sellerWalletAddress: sellerSolanaAddress,
        priceMist,
        priceUsdCents: priceUsdCentsInt,
        currency: 'USDC',
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
