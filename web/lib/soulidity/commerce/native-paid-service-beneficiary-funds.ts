import { commerceCheck, commerceId } from './economics-read'
import { readNativePaidContentHistory } from './native-paid-content-history'
import { readCommerceOwnedCoinInventory } from './owned-coin-inventory'
import { readCommercePayoutCoins } from './payout-coins'

type History = Parameters<typeof readNativePaidContentHistory>[0]

function observation<T>(result: PromiseSettledResult<T>) {
  if (result.status === 'fulfilled') return { status: 'OBSERVED' as const, value: result.value }
  const error: unknown = result.reason
  const code = error && typeof error === 'object' && 'code' in error
    && (typeof error.code === 'string' || typeof error.code === 'number') ? error.code : 'CURRENT_READBACK_FAILED'
  return { status: 'UNAVAILABLE' as const, code }
}

/** Original Native V1 SourceService settlement and current Coin observations.
 * The original Offer issuer receives the payout and protocol income stays in
 * the ledger. Coin observations are independent of historical settlement.
 */
export async function readNativePaidServiceBeneficiaryFunds(input: History & {
  serviceContext: NonNullable<History['serviceContext']>
  viewerAddress: string
  getViewerAddress: () => string | null
}) {
  const { client: source, viewerAddress: viewer, getViewerAddress, signal } = input
  const ledger = source.ledgerService
  const client = {
    core: {
      getChainIdentifier: source.core.getChainIdentifier.bind(source.core),
      listOwnedObjects: source.core.listOwnedObjects.bind(source.core),
    },
    ledgerService: {
      getObject: ledger.getObject.bind(ledger),
      getServiceInfo: ledger.getServiceInfo.bind(ledger),
      getTransaction: ledger.getTransaction.bind(ledger),
      getCheckpoint: ledger.getCheckpoint.bind(ledger),
    },
  } as unknown as typeof source
  const guard = () => {
    signal.throwIfAborted()
    commerceCheck(commerceId(viewer) && getViewerAddress() === viewer, 'PAID_SERVICE_FUNDS_WALLET_CHANGED')
  }
  guard()
  commerceCheck(input.serviceContext, 'PAID_SERVICE_FUNDS_CONTEXT')
  const original = await readNativePaidContentHistory({ ...input, client, proveMoney: true, proveOfferHistory: true })
  guard()
  if (original.status !== 'SUBSCRIPTION_RECORDED') {
    return { status: 'ORIGINAL_PROCEEDS_NOT_CONFIRMED' as const, original, notPermissionToRetryPayment: true as const }
  }
  const { money, service, offerHistory } = original.receipt
  commerceCheck(money && service && offerHistory && service.owner === money.payout.owner, 'PAID_SERVICE_FUNDS_ORIGINAL_BINDING')
  const originalProceeds = { ...money.payout, coinType: money.coinType, serviceId: service.serviceId }
  if (originalProceeds.owner !== viewer) {
    return { status: 'OTHER_BENEFICIARY' as const, original, originalProceeds, notPermissionToRetryPayment: true as const }
  }

  const scope = { client, owner: viewer, coinType: money.coinType, getViewerAddress, signal }
  const [payout, inventory] = await Promise.allSettled([
    readCommercePayoutCoins({ ...scope, payouts: [money.payout] }),
    readCommerceOwnedCoinInventory(scope),
  ])
  guard()
  return {
    status: 'ORIGINAL_SERVICE_BACKED_PROCEEDS_WITH_CURRENT_OBSERVATIONS' as const,
    original, originalProceeds, payout: observation(payout), inventory: observation(inventory),
    notSeparateServiceFee: true as const, notCurrentRevenueAttribution: true as const,
    notProtocolIncomeWithdrawalAuthority: true as const, notPermissionToRetryPayment: true as const,
    notCompleteContentDelivery: true as const,
  }
}
