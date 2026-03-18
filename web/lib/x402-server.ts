import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { extractPaymentIdentifier } from '@x402/extensions/payment-identifier'
import { registerExactSvmScheme } from '@x402/svm/exact/server'

import { prisma } from '@web/lib/prisma'
import { isUniqueConstraintError } from '@shared/prisma-errors'

const facilitatorUrl = process.env.X402_FACILITATOR_URL || 'https://facilitator.x402.org'

const globalForX402 = globalThis as typeof globalThis & {
  x402Server?: x402ResourceServer
  x402HookRegistered?: boolean
}

function createServer(): x402ResourceServer {
  const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl })
  const server = new x402ResourceServer(facilitatorClient)

  registerExactSvmScheme(server)

  return server
}

export const x402Server = globalForX402.x402Server ?? createServer()

if (process.env.NODE_ENV !== 'production') {
  globalForX402.x402Server = x402Server
}

if (!globalForX402.x402HookRegistered) {
  x402Server.onAfterSettle(async (context) => {
    const paymentRequestId = extractPaymentIdentifier(context.paymentPayload)
    if (!paymentRequestId) {
      return
    }

    const existingOrder = await prisma.order.findUnique({
      where: { paymentRequestId },
      select: { id: true },
    })
    if (existingOrder) {
      return
    }

    const purchaseIntent = await prisma.purchaseIntent.findUnique({
      where: { paymentRequestId },
      include: {
        listing: { select: { bundleId: true } },
      },
    })
    if (!purchaseIntent) {
      return
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.purchaseIntent.update({
          where: { id: purchaseIntent.id },
          data: {
            status: 'confirmed',
            txDigest: context.result.transaction,
          },
        })

        const order = await tx.order.create({
          data: {
            listingId: purchaseIntent.listingId,
            buyerId: purchaseIntent.memberId,
            agentMemberId: purchaseIntent.agentMemberId,
            walletBindingId: purchaseIntent.walletBindingId,
            purchaseIntentId: purchaseIntent.id,
            priceMist: purchaseIntent.expectedPriceMist,
            chain: purchaseIntent.chain,
            currency: purchaseIntent.currency,
            paymentRequestId,
            txDigest: context.result.transaction,
          },
        })

        await tx.entitlement.create({
          data: {
            bundleId: purchaseIntent.listing.bundleId,
            orderId: order.id,
            memberId: purchaseIntent.memberId,
            walletBindingId: purchaseIntent.walletBindingId,
          },
        })
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return
      }
      throw error
    }
  })

  globalForX402.x402HookRegistered = true
}
