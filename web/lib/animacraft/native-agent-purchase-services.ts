import { createNativeReceiveClient, readNativeReceiveTarget } from './native-receive'
import { readNativeMarketBuySnapshot, readNativeMarketBuyTarget } from './native-market-buy-snapshot'
import { createMarketBuyOperationAdapter } from './market-buy-operation-adapter'
import { marketBuyCheck, validateMarketBuySnapshot, type MarketBuyOperationRecord,
  type MarketBuySnapshot } from './market-buy-operation'

/** Same reader/transaction/evidence authority as the human checkout. The server
 * never signs; historical queries do not require the currently enabled target. */
export function createNativeAgentPurchaseServices(
  input: { soulId: string; stateId: string; listingId?: string | null; buyer: string },
  signal?: AbortSignal,
  observed?: MarketBuySnapshot,
  sync?: (record: MarketBuyOperationRecord) => Promise<'COMPLETE' | 'SUPERSEDED'>,
) {
  const scope = structuredClone(input)
  const client = createNativeReceiveClient(signal)
  const read = async (listingId?: string): Promise<MarketBuySnapshot> => {
    signal?.throwIfAborted()
    const target = readNativeReceiveTarget()
    const snapshot = validateMarketBuySnapshot(await readNativeMarketBuySnapshot(client,
      target, readNativeMarketBuyTarget(target), { ...scope, listingId: listingId ?? scope.listingId }, signal))
    marketBuyCheck(snapshot.soulId === scope.soulId && snapshot.stateId === scope.stateId
      && snapshot.buyer === scope.buyer, 'Native agent purchase scope mismatch')
    signal?.throwIfAborted()
    return snapshot
  }
  const adapter = createMarketBuyOperationAdapter({ client, read, observed,
    getAddress: () => signal?.aborted ? null : scope.buyer,
    sign: async () => { throw new Error('Agent purchases must be signed by the bound external wallet') },
    sync: sync ?? (async () => { throw new Error('Native agent purchase sync is not configured') }),
  })
  return { read, adapter }
}
