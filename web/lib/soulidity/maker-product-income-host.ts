import { EMPTY_INCOME_EXECUTION_REGISTRY_V1, type IncomeExecutionRegistryV1 } from './commerce/income-execution-source-v1'
import { captureMakerProductIncomeClient } from './commerce/maker-product-income-client'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { publicMutationCanonical } from '../sui/public-mutation-journal'
import { commerceCheck } from './commerce/economics-read'
import { preflightMakerProductIncomeWithdrawal } from './commerce/maker-product-income-preflight'
import { exportMakerProductIncomeRecoveryRecord, importMakerProductIncomeRecoveryRecord } from './commerce/maker-product-income-recovery-record'
import { browserMakerProductIncomeJournal, captureMakerProductIncomeJournal, makerProductIncomeFundKey, makerProductIncomeHeadCanClear,
  makerProductIncomeOperationFromOriginal, parseMakerProductIncomeOperation, persistMakerProductIncomeHead, queryMakerProductIncomeOriginal,
  type MakerProductIncomeJournal } from './maker-product-income-journal'

export type MakerProductIncomeHostRequest = Omit<Parameters<typeof preflightMakerProductIncomeWithdrawal>[0], 'onPreparedOriginal' | 'executionRegistry'>
export interface MakerProductIncomeRecovery { text: string; digest: string; headPhase: string; durability: 'CONFIRMED' | 'UNCONFIRMED' }
export class MakerProductIncomeRecoveryError extends Error {
  constructor(message: string, readonly recovery: MakerProductIncomeRecovery, options?: ErrorOptions) { super(message, options) }
}
export { captureMakerProductIncomeClient } from './commerce/maker-product-income-client'
function snapshot(input: MakerProductIncomeHostRequest): MakerProductIncomeHostRequest {
  const { client, signal, getActorAddress, ...values } = input
  return { ...structuredClone(values), client: captureMakerProductIncomeClient(client), signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]), getActorAddress }
}
/** Root's single existing factory exclusion is the Product fund AND head lock.
 * Invoked before first await. No new lock map/backend; all initial methods are
 * captured and durable writes/readbacks settle under exclusion after abort.
 */
export function createMakerProductIncomeHost(options: { executionRegistry?: IncomeExecutionRegistryV1; journal?: MakerProductIncomeJournal; beforePrepare: (request: MakerProductIncomeHostRequest) => Promise<void> }) {
  const executionRegistry = options.executionRegistry ?? EMPTY_INCOME_EXECUTION_REGISTRY_V1
  const configured = options.journal ? captureMakerProductIncomeJournal(options.journal) : null, beforePrepare = options.beforePrepare.bind(options)
  return (input: MakerProductIncomeHostRequest) => {
    const request = snapshot(input), key = makerProductIncomeFundKey(request.target)
    const journal = configured ?? captureMakerProductIncomeJournal(browserMakerProductIncomeJournal())
    const guard = () => { request.signal.throwIfAborted(); commerceCheck(request.getActorAddress() === request.actor, 'MAKER_INCOME_HOST_WALLET_CHANGED') }
    return journal.exclusive(key, async () => {
      request.signal.throwIfAborted()
      let previous = (await journal.heads(name => name === key))[0] ?? null
      if (previous) {
        const recovery: MakerProductIncomeRecovery = { text: previous.plan.originalText, digest: previous.packet.digest, headPhase: previous.packet.phase, durability: 'CONFIRMED' }
        try {
          const result = await queryMakerProductIncomeOriginal({ record: previous, client: request.client, signal: request.signal, executionRegistry }); request.signal.throwIfAborted()
          commerceCheck(makerProductIncomeHeadCanClear(previous, result), 'MAKER_INCOME_ORIGINAL_RECOVERY_REQUIRED')
          const phase = result.status === 'FAILED' ? 'FAILED' : result.status === 'WITHDRAWAL_EVIDENCE_CONFIRMED' ? 'SUCCEEDED' : null
          if (phase && previous.packet.phase !== phase) {
            const reconciled = await parseMakerProductIncomeOperation({ ...previous, packet: { ...previous.packet, phase } })
            await persistMakerProductIncomeHead(journal, key, reconciled, () => { recovery.headPhase = phase }); previous = reconciled
          }
        } catch (error) { throw new MakerProductIncomeRecoveryError(error instanceof Error ? error.message : 'MAKER_INCOME_ORIGINAL_QUERY_FAILED', recovery, { cause: error }) }
      }
      let heldHead = previous
      const checkHead = async () => {
        const current = await journal.read(key)
        if (publicMutationCanonical(current) !== publicMutationCanonical(heldHead)) {
          if (current) throw new MakerProductIncomeRecoveryError('MAKER_INCOME_HOST_HEAD_CHANGED', { text: current.plan.originalText, digest: current.packet.digest, headPhase: current.packet.phase, durability: 'CONFIRMED' })
          commerceCheck(false, 'MAKER_INCOME_HOST_HEAD_CHANGED')
        }
      }
      guard(); await checkHead(); guard()
      // Root source/fresh review checks stay after old-original query, under
      // this same exclusion; callback cannot replace the private request.
      await beforePrepare(snapshot(request)); guard(); await checkHead(); guard()
      const retained: { current: MakerProductIncomeRecovery | null } = { current: null }
      try {
        const preflight = await preflightMakerProductIncomeWithdrawal({ ...request, executionRegistry, onPreparedOriginal: async original => {
          await checkHead(); guard()
          const text = exportMakerProductIncomeRecoveryRecord(original), record = await makerProductIncomeOperationFromOriginal(text)
          commerceCheck(makerProductIncomeFundKey(record.plan) === key, 'MAKER_INCOME_HOST_PREPARATION_SCOPE')
          retained.current = { text, digest: record.packet.digest, headPhase: 'PREPARED', durability: 'UNCONFIRMED' }
          if (previous) {
            const old = importMakerProductIncomeRecoveryRecord(previous.plan.originalText)
            commerceCheck(previous.packet.digest !== record.packet.digest && (old.intent.actor !== original.intent.actor || old.intent.attemptHex !== original.intent.attemptHex), 'MAKER_INCOME_PREVIOUS_ATTEMPT_REUSE')
          }
          guard()
          await persistMakerProductIncomeHead(journal, key, record, () => { heldHead = record; retained.current = { ...retained.current!, durability: 'CONFIRMED' } }); guard()
        } })
        guard(); await checkHead(); guard(); commerceCheck(retained.current, 'MAKER_INCOME_ORIGINAL_NOT_RETAINED')
        return { preflight, retainedText: retained.current!.text }
      } catch (error) {
        if (error instanceof MakerProductIncomeRecoveryError) throw error
        if (retained.current) throw new MakerProductIncomeRecoveryError(error instanceof Error ? error.message : 'MAKER_INCOME_PREFLIGHT_FAILED', retained.current, { cause: error })
        throw error
      }
    })
  }
}
export type MakerProductIncomeHost = ReturnType<typeof createMakerProductIncomeHost>
export type MakerProductIncomeHostResult = Awaited<ReturnType<MakerProductIncomeHost>>
