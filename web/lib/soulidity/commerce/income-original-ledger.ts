import type { SuiGrpcClient } from '@mysten/sui/grpc'

type EpochReader = SuiGrpcClient['ledgerService']['getEpoch']
const applyEpoch = Reflect.apply
/** Only this optional capability may be unavailable. Capture the initial
 * callable and receiver without consulting its own mutable .bind property.
 * Required original ledger reads and actual method failures are not swallowed. */
export function captureOptionalIncomeEpoch(ledger: SuiGrpcClient['ledgerService']): EpochReader | undefined {
  let method: unknown
  try { method = ledger.getEpoch } catch { return undefined }
  if (typeof method !== 'function') return undefined
  return ((...args: Parameters<EpochReader>) => applyEpoch(method, ledger, args)) as EpochReader
}

/** Capture the original read leaves before journal/storage/network awaits.
 * An absent epoch reader stays absent; no current client or transport fallback.
 */
export function captureIncomeOriginalLedger(source: SuiGrpcClient): SuiGrpcClient {
  const ledger = source.ledgerService
  return { ledgerService: {
    getObject: ledger.getObject?.bind(ledger),
    getServiceInfo: ledger.getServiceInfo?.bind(ledger),
    getTransaction: ledger.getTransaction?.bind(ledger),
    getCheckpoint: ledger.getCheckpoint?.bind(ledger),
    getEpoch: captureOptionalIncomeEpoch(ledger),
  } } as unknown as SuiGrpcClient
}
