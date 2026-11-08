import { readCommerceAddressFunds } from './address-funds-read'
import { commerceCheck, commerceId } from './economics-read'
import { readNativePaidContentHistory } from './native-paid-content-history'
import { readCommerceOwnedCoinInventory } from './owned-coin-inventory'
import { readCommercePayoutCoins } from './payout-coins'

type History = Parameters<typeof readNativePaidContentHistory>[0]
type OriginalInput = History & { serviceContext: NonNullable<History['serviceContext']> }
type Viewer = { viewerAddress: string; getViewerAddress: () => string | null }
type OriginalProceeds = { owner: string; amount: string; coinId: string; coinType: string; serviceId: string }

function observation<T>(result: PromiseSettledResult<T>) {
  if (result.status === 'fulfilled') return { status: 'OBSERVED' as const, value: result.value }
  const error: unknown = result.reason
  const code = error && typeof error === 'object' && 'code' in error
    && (typeof error.code === 'string' || typeof error.code === 'number') ? error.code : 'CURRENT_READBACK_FAILED'
  return { status: 'UNAVAILABLE' as const, code }
}

export async function readNativePaidServiceOriginalProceeds(input: OriginalInput) {
  commerceCheck(input.serviceContext, 'PAID_SERVICE_FUNDS_CONTEXT')
  const original = await readNativePaidContentHistory({ ...input, proveMoney: true, proveOfferHistory: true })
  if (original.status !== 'SUBSCRIPTION_RECORDED') {
    return { status: 'ORIGINAL_PROCEEDS_NOT_CONFIRMED' as const, original, notPermissionToRetryPayment: true as const }
  }
  const { money, service, offerHistory } = original.receipt
  commerceCheck(money && service && offerHistory && service.owner === money.payout.owner, 'PAID_SERVICE_FUNDS_ORIGINAL_BINDING')
  const originalProceeds: OriginalProceeds = { ...money.payout, coinType: money.coinType, serviceId: service.serviceId }
  return { status: 'ORIGINAL_SERVICE_BACKED_PROCEEDS' as const, original, originalProceeds }
}

export async function readNativePaidServiceCurrentFunds(input: Pick<History, 'client' | 'signal'> & Viewer & {
  originalProceeds: OriginalProceeds
}) {
  const { client, viewerAddress: owner, getViewerAddress, signal, originalProceeds } = input
  const guard = () => {
    signal.throwIfAborted()
    commerceCheck(commerceId(owner) && getViewerAddress() === owner && originalProceeds.owner === owner,
      'PAID_SERVICE_FUNDS_WALLET_CHANGED')
  }
  guard()
  const scope = { client, owner, coinType: originalProceeds.coinType, getViewerAddress, signal }
  const [payout, inventory, balance] = await Promise.allSettled([
    readCommercePayoutCoins({ ...scope, payouts: [{ coinId: originalProceeds.coinId, amount: originalProceeds.amount }] }),
    readCommerceOwnedCoinInventory(scope),
    readCommerceAddressFunds({ ...scope, getObservedAddress: getViewerAddress }),
  ])
  guard()
  return { payout: observation(payout), inventory: observation(inventory), balance: observation(balance) }
}

/** Combined reader for callers that already capture a beneficiary scope. */
export async function readNativePaidServiceBeneficiaryFunds(input: OriginalInput & Viewer) {
  const { client: source, viewerAddress: viewer, getViewerAddress, signal } = input
  const ledger = source.ledgerService
  const state = source.stateService
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
    stateService: state && { getBalance: state.getBalance?.bind(state) },
  } as unknown as typeof source
  const guard = () => {
    signal.throwIfAborted()
    commerceCheck(commerceId(viewer) && getViewerAddress() === viewer, 'PAID_SERVICE_FUNDS_WALLET_CHANGED')
  }
  guard()
  const result = await readNativePaidServiceOriginalProceeds({ ...input, client })
  guard()
  if (result.status !== 'ORIGINAL_SERVICE_BACKED_PROCEEDS') return result
  const { original, originalProceeds } = result
  if (originalProceeds.owner !== viewer) {
    return { status: 'OTHER_BENEFICIARY' as const, original, originalProceeds, notPermissionToRetryPayment: true as const }
  }
  const current = await readNativePaidServiceCurrentFunds({ client, signal, viewerAddress: viewer, getViewerAddress, originalProceeds })
  return {
    status: 'ORIGINAL_SERVICE_BACKED_PROCEEDS_WITH_CURRENT_OBSERVATIONS' as const,
    original, originalProceeds, ...current,
    notSeparateServiceFee: true as const, notCurrentRevenueAttribution: true as const,
    notProtocolIncomeWithdrawalAuthority: true as const, notPermissionToRetryPayment: true as const,
    notCompleteContentDelivery: true as const,
  }
}
