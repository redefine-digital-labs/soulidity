import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toBase64 } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readFinalizedMutation } from '../../sui/finalized-mutation'
import { sameSoulMutationScope } from '../same-soul-mutation-coordination'
import { importOriginalSoulEnhancementOriginal } from './original-soul-enhancement-original'

/** Actual original ledger query, independent of current Product/Config/source
 * selection, wallet, storage and WebLocks. Its success proves execution only:
 * full original business output/source/signature proof is still required.
 * The trusted ledger is an explicit boundary; no validator quorum is inferred.
 */
export async function queryOriginalSoulEnhancementOriginal(input: {
  text: string; chainIdentifier: string; soulId: string; author: string; client: SuiGrpcClient; signal: AbortSignal
}) {
  const text = input.text, scope = sameSoulMutationScope(input), signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  // Capture only these readonly leaves and their receivers before the offline
  // parser's first await. Never keep a mutable client or its execution service.
  const ledger = input.client.ledgerService
  const info = ledger.getServiceInfo, transaction = ledger.getTransaction, checkpoint = ledger.getCheckpoint
  if (![info, transaction, checkpoint].every(method => typeof method === 'function')) throw Error('SOUL_ENHANCEMENT_RESULT_LEDGER_CAPABILITY_REQUIRED')
  const client = Object.freeze({ ledgerService: Object.freeze({ getServiceInfo: info.bind(ledger),
    getTransaction: transaction.bind(ledger), getCheckpoint: checkpoint.bind(ledger) }) }) as unknown as SuiGrpcClient
  signal.throwIfAborted()
  const { record } = await importOriginalSoulEnhancementOriginal(text)
  if (record.plan.chainIdentifier !== scope.chainIdentifier || record.plan.soulId !== scope.soulId || record.plan.author !== scope.author)
    throw Error('SOUL_ENHANCEMENT_RESULT_SCOPE')
  signal.throwIfAborted()
  const result = await readFinalizedMutation({ client, signal, packet: record.packet,
    chainIdentifier: scope.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, errorPrefix: 'SOUL_ENHANCEMENT_RESULT',
    proveSuccess: async context => ({ effectsBytes: toBase64(bcs.TransactionEffects.serialize(context.effects).toBytes()),
      eventsBytes: toBase64(context.events), executedEpoch: context.effects.V2!.executedEpoch }) })
  const execution = result.status === 'SUCCEEDED'
    ? { status: 'FINALIZED_EXECUTION' as const, checkpoint: result.checkpoint, evidence: result.receipt } : result
  return { originalText: text, record, execution, completeBusinessOutputVerified: false as const,
    sourceQualification: 'UNQUALIFIED' as const, originalSignatureVerified: false as const,
    signingQualified: false as const, requiresOriginalBusinessOutputProof: true as const,
    notDeliveryProof: true as const, notSettlementProof: true as const, notCurrentAuthority: true as const }
}
