import { bcs } from '@mysten/sui/bcs'
import { toBase64 } from '@mysten/sui/utils'
import { queryEquipmentOriginalOperation } from './equipment-recovery'
import { parseEquipmentManagementRecord } from './equipment-record'
import { captureAccountOriginalReadClientV155 } from './account-original-readers-v155'
import { createManagementHistoricalRpcSession } from './application-historical-rpc-session'
import { discoverEquipmentOriginalInventoryV154 } from './equipment-original-discovery-v154'
import { readEquipmentHistoricalConservationV154 } from './equipment-historical-conservation-v154'
import { matchConfiguredManagementOriginalSource } from '../configured-management-original-source'
/** Actual first-party query consumer. Compiled Root acceptance is the only
 * source registry used here. Unknown sources still retain original finality,
 * downloads and optional Item facts. No record/journal/lock/backend is written. */
export async function queryEquipmentOriginalResultV154(input: Omit<Parameters<typeof queryEquipmentOriginalOperation>[0], 'historicalContext'>) {
  const text = input.text, soulId = input.soulId, chainIdentifier = input.chainIdentifier, includeItemEvidence = input.includeItemEvidence
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(180000)]), captured = captureAccountOriginalReadClientV155(input.client, signal)
  // The existing RPC coalescer proxies its target, so give it a PRIVATE mutable
  // port object with already-bound capabilities. Proxying the frozen155 ledger
  // itself would violate JavaScript non-configurable-property invariants.
  const ledger = captured.ledgerService
  const ports = { ledgerService: { getServiceInfo: ledger.getServiceInfo.bind(ledger), getObject: ledger.getObject.bind(ledger),
    getTransaction: ledger.getTransaction.bind(ledger), getCheckpoint: ledger.getCheckpoint.bind(ledger) }, core: captured.core } as typeof captured
  const session = createManagementHistoricalRpcSession({ client: ports, signal })
  try {
    const original = await queryEquipmentOriginalOperation({ client: session.client, text, soulId, chainIdentifier, includeItemEvidence, signal: session.signal })
    const unchanged = { ...original, completeBusinessOutputVerified: false as const }
    if (original.execution.status !== 'FINALIZED_EXECUTION') return { ...unchanged, business: { status: 'NOT_CHECKED' as const }, sourceQualification: 'NOT_CHECKED' as const }
    const record = parseEquipmentManagementRecord(JSON.parse(text))
    try {
      const source = await matchConfiguredManagementOriginalSource({ client: session.client, record, checkpoint: original.execution.checkpoint, signal: session.signal })
      if (!source) return { ...unchanged, business: { status: 'SOURCE_UNAVAILABLE' as const }, sourceQualification: 'UNAVAILABLE' as const }
      if (!original.originalSignatureVerified) throw Error('MANAGEMENT_ORIGINAL_RESULT_V154_ORIGINAL_SIGNATURE_REQUIRED')
      const bounds = source.qualifiedCheckpointRange
      if (!bounds || !/^(0|[1-9][0-9]{0,19})$/.test(bounds.first) || !/^(0|[1-9][0-9]{0,19})$/.test(bounds.last) || BigInt(bounds.first) > BigInt(bounds.last)) throw Error('MANAGEMENT_ORIGINAL_RESULT_V154_HISTORY_QUALIFICATION_REQUIRED')
      const ledger = session.client.ledgerService, getTransaction = ledger.getTransaction.bind(ledger)
      // Every actual ancestor fetched by any nested proof must lie inside the
      // Root audit's historical-version/parent-commit coverage. Original target
      // qualification cannot silently qualify earlier code outside that scope.
      // Narrow awaited-read facade, intentionally not a full executor client.
      const historyClient = { core: session.client.core, ledgerService: { getServiceInfo: ledger.getServiceInfo.bind(ledger), getObject: ledger.getObject.bind(ledger),
        getCheckpoint: ledger.getCheckpoint.bind(ledger), getTransaction: async (...args: Parameters<typeof getTransaction>) => {
          const result = await getTransaction(...args), checkpoint = result.response.transaction?.checkpoint
          if (typeof checkpoint !== 'bigint' || checkpoint < BigInt(bounds.first) || checkpoint > BigInt(bounds.last)) throw Error('MANAGEMENT_ORIGINAL_RESULT_V154_UNQUALIFIED_HISTORY_CHECKPOINT')
          return result
        } } } as unknown as typeof session.client
      const discovery = await discoverEquipmentOriginalInventoryV154({ client: historyClient, record, standardTypeOrigin: source.context.standardTypeOrigin, signal: session.signal })
      const proof = await readEquipmentHistoricalConservationV154({ client: historyClient, record, ...source.context, ...discovery, signal: session.signal })
      if (!proof.conservation || !proof.nestedSemantic || proof.execution.status !== 'FINALIZED_EXECUTION') throw Error('MANAGEMENT_ORIGINAL_RESULT_V154_INCOMPLETE_PROOF')
      if (proof.execution.checkpoint !== original.execution.checkpoint || toBase64(bcs.TransactionEffects.serialize(proof.execution.effects).toBytes()) !== toBase64(bcs.TransactionEffects.serialize(original.execution.effects).toBytes()) || toBase64(proof.execution.events) !== toBase64(original.execution.events)) throw Error('MANAGEMENT_ORIGINAL_RESULT_V154_OBSERVATIONS_DIFFER')
      session.signal.throwIfAborted()
      return { ...original, businessOutputVerified: true as const, completeBusinessOutputVerified: true as const, sourceQualification: 'COMPILED_ROOT_MATCHED' as const,
        business: { status: 'SUCCEEDED' as const, digest: original.digest, checkpoint: original.execution.checkpoint, soulId: record.plan.soulId,
          originalAction: record.plan.action.kind, source, proof, display: { renderPlanAvailable: proof.nestedSemantic.after.renderPlanAvailable,
            missingRequiredParts: proof.nestedSemantic.after.missingRequiredParts, failureCode: proof.nestedSemantic.after.renderFailureCode,
            renderPlanHash: proof.nestedSemantic.after.renderPlanHash, assetContentsVerified: false as const, rendererQualification: 'NOT_INCLUDED' as const } } }
    } catch (error) {
      session.signal.throwIfAborted()
      return { ...unchanged, business: { status: 'VERIFICATION_UNAVAILABLE' as const, error: error instanceof Error ? error.message : 'Original result verification unavailable.' }, sourceQualification: 'UNAVAILABLE_OR_INCOMPLETE' as const }
    }
  } finally { session.dispose() }
}
