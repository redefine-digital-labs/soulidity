import { captureOptionalIncomeEpoch } from './commerce/income-original-ledger'
import { EMPTY_INCOME_EXECUTION_REGISTRY_V1, type IncomeExecutionRegistryV1 } from './commerce/income-execution-source-v1'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { withIncomeWithdrawalFundLock } from './income-withdrawal-fund-lock'
import { browserIncomeWithdrawalJournalV1, incomeWithdrawalFundKeyV1, incomeWithdrawalFundScope,
  incomeWithdrawalHeadCanClearV1, incomeWithdrawalJournalRecordFromOriginalV1, parseIncomeWithdrawalJournalRecordV1,
  queryIncomeWithdrawalJournalOriginalV1, persistIncomeWithdrawalHeadV1, captureIncomeWithdrawalJournalV1, type IncomeWithdrawalJournalV1 } from './income-withdrawal-journal-v1'
import { preflightNewIncomeWithdrawal } from './commerce/income-withdrawal-preflight'
import { exportIncomeWithdrawalRecoveryRecord, importIncomeWithdrawalRecoveryRecord } from './commerce/income-withdrawal-recovery-record'
import { IncomeWithdrawalHostRecoveryError, type IncomeWithdrawalHostPreflight, type IncomeWithdrawalHostRecovery, type IncomeWithdrawalHostRequest } from './commerce/income-withdrawal-host-preflight'
import { commerceCheck } from './commerce/economics-read'
import { readEconomicsIncome, type EconomicsTarget } from './commerce/economics-read'
import { Transaction } from '@mysten/sui/transactions'
import { publicMutationCanonical } from '../sui/public-mutation-journal'
import { recheckSelectedIncomeWithdrawalOriginalV1 } from './income-withdrawal-original-recovery'
import type { IncomeWithdrawalResumeHost } from './commerce/income-withdrawal-host-resume'

function snapshotClient(source: SuiGrpcClient): SuiGrpcClient {
  const ledger = source.ledgerService, core = source.core, execution = source.transactionExecutionService
  const { getObject, getServiceInfo, getTransaction, getCheckpoint } = ledger
  const getChainIdentifier = core?.getChainIdentifier, getMoveFunction = core?.getMoveFunction, listOwnedObjects = core?.listOwnedObjects
  const simulateTransaction = execution?.simulateTransaction
  return { core: { getChainIdentifier: getChainIdentifier?.bind(core), getMoveFunction: getMoveFunction?.bind(core), listOwnedObjects: listOwnedObjects?.bind(core) },
    ledgerService: { getObject: getObject.bind(ledger), getServiceInfo: getServiceInfo?.bind(ledger), getTransaction: getTransaction?.bind(ledger),
      getCheckpoint: getCheckpoint?.bind(ledger), getEpoch: captureOptionalIncomeEpoch(ledger) },
    transactionExecutionService: { simulateTransaction: simulateTransaction?.bind(execution) } } as unknown as SuiGrpcClient
}
function snapshot(input: IncomeWithdrawalHostRequest) {
  const { client, signal, getActorAddress, ...values } = input
  return { ...structuredClone(values), client: snapshotClient(client), signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]), getActorAddress }
}
/** Root fund lock -> same funds head -> original query/exclusion -> prepare ->
 * exact original persistence/readback -> original-byte enabled simulation.
 * No signer, submitter, implicit Gas/attempt selection or new storage backend.
 */
export function createIncomeWithdrawalHostPreflight(options: { executionRegistry?: IncomeExecutionRegistryV1; journal?: IncomeWithdrawalJournalV1;
  beforePrepare?: (request: IncomeWithdrawalHostRequest) => Promise<void>
} = {}): IncomeWithdrawalHostPreflight {
  const executionRegistry = options.executionRegistry ?? EMPTY_INCOME_EXECUTION_REGISTRY_V1
  const providedJournal = options.journal, configuredJournal = providedJournal ? captureIncomeWithdrawalJournalV1(providedJournal) : undefined
  const beforePrepare = options.beforePrepare?.bind(options)
  return input => {
    const request = snapshot(input), scope = incomeWithdrawalFundScope(request.target), key = incomeWithdrawalFundKeyV1(scope)
    const guard = () => { request.signal.throwIfAborted(); commerceCheck(request.getActorAddress() === request.actor, 'WITHDRAW_HOST_WALLET_CHANGED') }
    return withIncomeWithdrawalFundLock(scope, async () => {
      request.signal.throwIfAborted()
      const journal = configuredJournal ?? captureIncomeWithdrawalJournalV1(browserIncomeWithdrawalJournalV1())
      return journal.exclusive(key, async () => {
        request.signal.throwIfAborted()
        let previous = (await journal.heads(head => head === key))[0] ?? null
        if (previous) {
          const recovery: IncomeWithdrawalHostRecovery = { text: previous.plan.originalText, digest: previous.packet.digest,
            headPhase: previous.packet.phase, durability: 'CONFIRMED' }
          try {
            const original = await queryIncomeWithdrawalJournalOriginalV1({ record: previous, client: request.client, signal: request.signal, executionRegistry })
            request.signal.throwIfAborted()
            commerceCheck(incomeWithdrawalHeadCanClearV1(previous, original), 'WITHDRAW_HOST_ORIGINAL_RECOVERY_REQUIRED')
            const phase = original.status === 'FAILED' ? 'FAILED' : original.status === 'WITHDRAWAL_EVIDENCE_CONFIRMED' ? 'SUCCEEDED' : null
            if (phase && previous.packet.phase !== phase) {
              const reconciled = await parseIncomeWithdrawalJournalRecordV1({ ...previous, packet: { ...previous.packet, phase } })
              await persistIncomeWithdrawalHeadV1(journal, key, reconciled, () => { recovery.headPhase = phase })
              previous = reconciled
            }
          } catch (error) { throw new IncomeWithdrawalHostRecoveryError(error instanceof Error ? error.message : 'ORIGINAL_QUERY_FAILED', recovery, { cause: error }) }
        }
        let heldHead = previous
        const checkHead = async () => {
          const current = await journal.read(key)
          if (publicMutationCanonical(current) !== publicMutationCanonical(heldHead)) {
            if (current) throw new IncomeWithdrawalHostRecoveryError('WITHDRAW_HOST_HEAD_CHANGED', { text: current.plan.originalText,
              digest: current.packet.digest, headPhase: current.packet.phase, durability: 'CONFIRMED' })
            commerceCheck(false, 'WITHDRAW_HOST_HEAD_CHANGED')
          }
        }
        guard(); await checkHead(); guard()
        // Qualification/fresh review runs only after original exclusion, under
        // these same locks. The callback cannot mutate this private request.
        if (beforePrepare) { await beforePrepare(snapshot(request)); guard(); await checkHead(); guard() }
        const retained: { current: IncomeWithdrawalHostRecovery | null } = { current: null }
        try {
          const preflight = await preflightNewIncomeWithdrawal({ ...request, executionRegistry, onPreparedOriginal: async original => {
            await checkHead(); guard()
            const text = exportIncomeWithdrawalRecoveryRecord(original), record = await incomeWithdrawalJournalRecordFromOriginalV1(text)
            commerceCheck(incomeWithdrawalFundKeyV1(record.plan) === key, 'WITHDRAW_HOST_PREPARATION_SCOPE')
            retained.current = { text, digest: record.packet.digest, headPhase: 'PREPARED', durability: 'UNCONFIRMED' }
            if (previous) {
              const before = importIncomeWithdrawalRecoveryRecord(previous.plan.originalText)
              commerceCheck(previous.packet.digest !== record.packet.digest
                && (before.intent.actor !== original.intent.actor || before.intent.attemptHex !== original.intent.attemptHex), 'WITHDRAW_HOST_PREVIOUS_ATTEMPT_REUSE')
            }
            guard()
            // Even failed/aborted ACKs are followed by a settled readback under
            // both locks. A failed ACK never permits simulation or another write.
            await persistIncomeWithdrawalHeadV1(journal, key, record, () => { heldHead = record; retained.current = { ...retained.current!, durability: 'CONFIRMED' } }); guard()
          } })
          guard(); await checkHead(); guard(); commerceCheck(retained.current, 'WITHDRAW_HOST_ORIGINAL_NOT_RETAINED')
          return { preflight, retainedText: retained.current!.text }
        } catch (error) {
          if (error instanceof IncomeWithdrawalHostRecoveryError) throw error
          if (retained.current) throw new IncomeWithdrawalHostRecoveryError(error instanceof Error ? error.message : 'PREFLIGHT_FAILED', retained.current, { cause: error })
          throw error
        }
      })
    })
  }
}

/** The same Root journal/funds Host, continuing an existing original only.
 * Source qualification is a Root capability, never inferred from the file,
 * recipient, current Config enabled flag, or a nonempty UI token.
 */
export function createIncomeWithdrawalHostResume(options: {
  activationKey: string; sourceId: string; isActive: () => boolean; journal?: IncomeWithdrawalJournalV1; executionRegistry?: IncomeExecutionRegistryV1
  authorizeOriginalSource: (input: { original: ReturnType<typeof importIncomeWithdrawalRecoveryRecord>; client: SuiGrpcClient; signal: AbortSignal }) => Promise<{ sourceId: string; target: EconomicsTarget }>
}): IncomeWithdrawalResumeHost {
  const { activationKey, sourceId, isActive, authorizeOriginalSource, executionRegistry = EMPTY_INCOME_EXECUTION_REGISTRY_V1 } = options
  commerceCheck(Boolean(activationKey) && Boolean(sourceId) && typeof isActive === 'function' && typeof authorizeOriginalSource === 'function', 'WITHDRAW_RESUME_ROOT_CAPABILITY_REQUIRED')
  const configuredJournal = options.journal ? captureIncomeWithdrawalJournalV1(options.journal) : undefined
  return input => {
    const selected = structuredClone(input.selected), client = snapshotClient(input.client), signal = input.signal,
      getActorAddress = input.getActorAddress, isCurrent = input.isCurrent,
      requestActivation = input.activationKey, requestSource = input.sourceId
    const active = () => requestActivation === activationKey && requestSource === sourceId && isActive() && isCurrent()
    return recheckSelectedIncomeWithdrawalOriginalV1({ selected, client, signal, getActorAddress, isCurrent: active, journal: configuredJournal, executionRegistry,
      readCurrentReview: async (original, reader, abort) => {
        const source = structuredClone(await authorizeOriginalSource({ original: structuredClone(original), client: reader, signal: abort }))
        commerceCheck(active() && source.sourceId === sourceId && publicMutationCanonical(source.target) === publicMutationCanonical(original.target), 'WITHDRAW_RESUME_SOURCE_NOT_QUALIFIED')
        const reviewed = await readEconomicsIncome({ client: reader, target: original.target, admin: { actor: original.intent.actor, objectId: original.intent.adminId }, signal: abort })
        const gas = Transaction.from(original.packet.bytes).getData().gasData
        commerceCheck(gas.owner === original.intent.actor && typeof gas.budget === 'string' && typeof gas.price === 'string'
          && Boolean(gas.payment?.length) && gas.payment!.every(ref => typeof ref.version === 'string'), 'WITHDRAW_RESUME_ORIGINAL_GAS_REQUIRED')
        return { reviewed, reviewedGas: { budget: String(gas.budget), price: String(gas.price),
          coins: gas.payment!.map(ref => ({ objectId: ref.objectId, version: String(ref.version), digest: ref.digest })) } }
      } })
  }
}
