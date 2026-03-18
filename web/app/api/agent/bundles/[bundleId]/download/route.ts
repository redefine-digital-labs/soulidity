import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { declarePaymentIdentifierExtension, PAYMENT_IDENTIFIER } from '@x402/extensions/payment-identifier'
import { extractPaymentIdentifier } from '@x402/extensions/payment-identifier'
import type { PaymentPayload } from '@x402/core/types'

import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { getCoingeckoUsdPrice } from '@web/lib/coingecko'
import { buildDownloadFileName } from '@web/lib/download-filename'
import { prisma } from '@web/lib/prisma'
import { getX402SolanaNetwork, usdCentsToUsdcAtomicUnits } from '@web/lib/solana'
import { createSupabaseAdmin } from '@web/lib/supabase/server'
import { withX402 } from '@web/lib/x402-next'
import { x402Server } from '@web/lib/x402-server'
import { isUniqueConstraintError } from '@shared/prisma-errors'

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

function decodePaymentPayload(header: string): PaymentPayload | null {
  try {
    const normalized = header
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(header.length / 4) * 4, '=')
    const payload = Buffer.from(normalized, 'base64').toString('utf8')
    return JSON.parse(payload) as PaymentPayload
  } catch {
    return null
  }
}

async function createDownloadResponse(bundle: {
  storageBucket: string
  storagePath: string
  name: string
}) {
  const supabase = createSupabaseAdmin()
  const { data, error } = await supabase.storage
    .from(bundle.storageBucket)
    .createSignedUrl(bundle.storagePath, 300)

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
  }

  return NextResponse.json({
    downloadUrl: data.signedUrl,
    fileName: buildDownloadFileName(bundle.name),
    expiresIn: 300,
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bundleId: string }> },
) {
  const { bundleId } = await params
  const auth = await requireAgentApiKey(request)
  if (auth.response) {
    return auth.response
  }
  const { agent } = auth

  const entitlement = await prisma.entitlement.findFirst({
    where: {
      memberId: agent.ownerMemberId,
      bundleId,
      status: 'active',
    },
    include: {
      bundle: {
        select: {
          storageBucket: true,
          storagePath: true,
          name: true,
        },
      },
    },
  })

  if (entitlement) {
    return createDownloadResponse(entitlement.bundle)
  }

  const agentWalletBinding = await prisma.walletBinding.findFirst({
    where: {
      memberId: agent.agentMemberId,
      chain: 'solana',
      isPrimary: true,
    },
    select: {
      id: true,
      address: true,
    },
  })

  if (!agentWalletBinding) {
    return NextResponse.json({ error: 'Agent does not have a Solana wallet bound' }, { status: 400 })
  }

  const listing = await prisma.listing.findFirst({
    where: {
      bundleId,
      status: 'active',
      bundle: { status: 'active' },
    },
    include: {
      bundle: {
        select: {
          sellerId: true,
          storageBucket: true,
          storagePath: true,
          name: true,
        },
      },
    },
  })

  if (!listing) {
    return NextResponse.json({ error: 'Bundle not found' }, { status: 404 })
  }

  const sellerWallet = await prisma.walletBinding.findFirst({
    where: {
      memberId: listing.bundle.sellerId,
      chain: 'solana',
      isPrimary: true,
    },
    select: {
      address: true,
    },
  })

  if (!sellerWallet) {
    return NextResponse.json({ error: 'Seller Solana wallet not found' }, { status: 400 })
  }

  const priceUsdCents = await resolveListingUsdCents(listing)
  const paymentPayloadHeader = request.headers.get('PAYMENT-SIGNATURE')
  if (paymentPayloadHeader) {
    const paymentPayload = decodePaymentPayload(paymentPayloadHeader)
    const paymentRequestId = paymentPayload ? extractPaymentIdentifier(paymentPayload) : null

    if (paymentRequestId) {
      const existingIntent = await prisma.purchaseIntent.findUnique({
        where: { paymentRequestId },
        select: { id: true },
      })

      if (!existingIntent) {
        try {
          await prisma.purchaseIntent.create({
            data: {
              listingId: listing.id,
              memberId: agent.ownerMemberId,
              agentMemberId: agent.agentMemberId,
              walletBindingId: agentWalletBinding.id,
              chain: 'solana',
              currency: 'USDC',
              expectedPriceMist: listing.priceMist,
              expectedAmount: usdCentsToUsdcAtomicUnits(priceUsdCents),
              recipientAddress: sellerWallet.address,
              paymentRequestId,
              nonce: randomBytes(16).toString('hex'),
              expiresAt: new Date(Date.now() + 15 * 60 * 1000),
              status: 'settling',
            },
          })
        } catch (error) {
          if (!isUniqueConstraintError(error)) {
            throw error
          }
        }
      }

      await prisma.purchaseIntent.updateMany({
        where: { paymentRequestId, status: 'pending' },
        data: { status: 'settling' },
      })
    }
  }

  const routeHandler = withX402<Record<string, unknown>>(
    async () => createDownloadResponse(listing.bundle),
    {
      accepts: {
        scheme: 'exact',
        price: `$${(priceUsdCents / 100).toFixed(2)}`,
        network: getX402SolanaNetwork(),
        payTo: sellerWallet.address,
      },
      description: `Download ${listing.bundle.name}`,
      mimeType: 'application/json',
      extensions: {
        [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
      },
    },
    x402Server,
  )

  return routeHandler(request)
}
