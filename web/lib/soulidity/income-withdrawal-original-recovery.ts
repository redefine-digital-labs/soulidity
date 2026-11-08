import { captureOptionalIncomeEpoch } from './commerce/income-original-ledger'
import type { IncomeExecutionRegistryV1 } from './commerce/income-execution-source-v1'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { publicMutationCanonical } from '../sui/public-mutation-journal'
import { commerceCheck } from './commerce/economics-read'
import { withIncomeWithdrawalFundLock } from './income-withdrawal-fund-lock'
import { recheckPreparedIncomeWithdrawal } from './commerce/income-withdrawal-resume-preflight'
import { captureIncomeWithdrawalRetirementClient, verifyIncomeWithdrawalRetirement } from './commerce/income-withdrawal-retirement'
import { exportIncomeWithdrawalRecoveryRecord, importIncomeWithdrawalRecoveryRecord, parseIncomeWithdrawalRecoveryRecord } from './commerce/income-withdrawal-recovery-record'
import { IncomeWithdrawalHostRecoveryError, type IncomeWithdrawalHostRecovery } from './commerce/income-withdrawal-host-preflight'
import { browserIncomeWithdrawalOriginalReaderV1, browserIncomeWithdrawalJournalV1, incomeWithdrawalFundKeyV1,
  incomeWithdrawalFundScope, parseIncomeWithdrawalJournalRecordV1, queryIncomeWithdrawalJournalOriginalV1, persistIncomeWithdrawalHeadV1, captureIncomeWithdrawalJournalV1,
  type IncomeWithdrawalFundScope, type IncomeWithdrawalOriginalReaderV1, type IncomeWithdrawalJournalRecordV1, type IncomeWithdrawalJournalV1 } from './income-withdrawal-journal-v1'

export function discoverIncomeWithdrawalOriginalsV1(scope: IncomeWithdrawalFundScope | null = null,
  reader: IncomeWithdrawalOriginalReaderV1 = browserIncomeWithdrawalOriginalReaderV1()) {
  if (!scope) return reader.heads()
  const key = incomeWithdrawalFundKeyV1(scope)
  return reader.read(key).then(record => record ? [record] : [])
}
/** Explicit local cancellation of the exact unsigned original; never an
 * on-chain revocation or a new-withdrawal authority. Preserve original text.
 */
export function cancelIncomeWithdrawalOriginalV1(input: { record: IncomeWithdrawalJournalRecordV1; client: SuiGrpcClient; signal: AbortSignal; journal?: IncomeWithdrawalJournalV1; executionRegistry?: IncomeExecutionRegistryV1 }) {
  const executionRegistry = input.executionRegistry
  const selected = structuredClone(input.record), scope = incomeWithdrawalFundScope(selected.plan), key = incomeWithdrawalFundKeyV1(scope)
  const ledger = input.client.ledgerService, { getObject, getServiceInfo, getTransaction, getCheckpoint } = ledger
  const client = { ledgerService: { getObject: getObject.bind(ledger), getServiceInfo: getServiceInfo.bind(ledger),
    getTransaction: getTransaction.bind(ledger), getCheckpoint: getCheckpoint.bind(ledger), getEpoch: captureOptionalIncomeEpoch(ledger) } } as unknown as SuiGrpcClient
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)]), providedJournal = input.journal
  const configuredJournal = providedJournal ? captureIncomeWithdrawalJournalV1(providedJournal) : undefined
  return withIncomeWithdrawalFundLock(scope, async () => {
    signal.throwIfAborted()
    const expected = await parseIncomeWithdrawalJournalRecordV1(selected), journal = configuredJournal ?? captureIncomeWithdrawalJournalV1(browserIncomeWithdrawalJournalV1())
    return journal.exclusive(key, async () => {
      const current = await journal.read(key)
      commerceCheck(current && publicMutationCanonical(current) === publicMutationCanonical(expected), 'WITHDRAW_CANCEL_SELECTED_CHANGED')
      commerceCheck(current.packet.phase === 'PREPARED' && current.packet.signature === null, 'WITHDRAW_CANCEL_PREPARED_ONLY')
      const original = await queryIncomeWithdrawalJournalOriginalV1({ record: current, client, signal, executionRegistry })
      signal.throwIfAborted(); commerceCheck(original.status === 'MISSING', 'WITHDRAW_CANCEL_ORIGINAL_NOT_MISSING')
      const cancelled = await parseIncomeWithdrawalJournalRecordV1({ ...current, packet: { ...current.packet, phase: 'CANCELLED' } })
      signal.throwIfAborted(); const retained = await persistIncomeWithdrawalHeadV1(journal, key, cancelled)
      signal.throwIfAborted()
      return { record: retained, original, notOnChainCancellation: true as const, notNewWithdrawalAuthority: true as const }
    })
  })
}

/** Continue only the exact retained PREPARED original under both funds locks.
 * Current state/Gas/ABI and actor are rechecked; no rebuild, reselection, phase
 * promotion, signer or broadcast. Root still owns source activation/signing.
 */
export function recheckIncomeWithdrawalJournalOriginalV1(input: Parameters<typeof recheckPreparedIncomeWithdrawal>[0] & { journal?: IncomeWithdrawalJournalV1; executionRegistry?: IncomeExecutionRegistryV1 }) {
  const { client: source, signal: parent, getActorAddress, journal: providedJournal, executionRegistry, ...values } = input
  const saved = structuredClone(values), original = parseIncomeWithdrawalRecoveryRecord(saved.record), text = exportIncomeWithdrawalRecoveryRecord(original)
  const scope = incomeWithdrawalFundScope(original.target), key = incomeWithdrawalFundKeyV1(scope)
  const ledger = source.ledgerService, core = source.core, execution = source.transactionExecutionService
  const { getObject, getServiceInfo, getTransaction, getCheckpoint } = ledger
  const getChainIdentifier = core?.getChainIdentifier, getMoveFunction = core?.getMoveFunction, simulateTransaction = execution?.simulateTransaction
  const client = { core: { getChainIdentifier: getChainIdentifier?.bind(core), getMoveFunction: getMoveFunction?.bind(core) },
    ledgerService: { getObject: getObject.bind(ledger), getServiceInfo: getServiceInfo?.bind(ledger), getTransaction: getTransaction?.bind(ledger),
      getCheckpoint: getCheckpoint?.bind(ledger), getEpoch: captureOptionalIncomeEpoch(ledger) }, transactionExecutionService: { simulateTransaction: simulateTransaction?.bind(execution) } } as unknown as SuiGrpcClient
  const signal = AbortSignal.any([parent, AbortSignal.timeout(90000)]), configuredJournal = providedJournal ? captureIncomeWithdrawalJournalV1(providedJournal) : undefined
  return withIncomeWithdrawalFundLock(scope, async () => {
    signal.throwIfAborted()
    const journal = configuredJournal ?? captureIncomeWithdrawalJournalV1(browserIncomeWithdrawalJournalV1())
    return journal.exclusive(key, async () => {
      const current = await journal.read(key)
      commerceCheck(current, 'WITHDRAW_RECHECK_ORIGINAL_NOT_RETAINED')
      const recovery = { text: current.plan.originalText, digest: current.packet.digest, headPhase: current.packet.phase, durability: 'CONFIRMED' as const }
      try {
        commerceCheck(current.plan.originalText === text && current.packet.phase === 'PREPARED' && current.packet.signature === null, 'WITHDRAW_RECHECK_EXACT_PREPARED_REQUIRED')
        const result = await queryIncomeWithdrawalJournalOriginalV1({ record: current, client, signal, executionRegistry })
        signal.throwIfAborted(); commerceCheck(result.status === 'MISSING', 'WITHDRAW_RECHECK_ORIGINAL_NOT_MISSING')
        commerceCheck(getActorAddress() === original.intent.actor, 'WITHDRAW_RECHECK_WALLET_CHANGED')
        return await recheckPreparedIncomeWithdrawal({ ...saved, record: original, client, signal, getActorAddress, executionRegistry })
      } catch (error) { throw new IncomeWithdrawalHostRecoveryError(error instanceof Error ? error.message : 'ORIGINAL_RECHECK_FAILED', recovery, { cause: error }) }
    })
  })
}

/** Root-only deferred resume boundary. Current source/review is deliberately
 * obtained after the exact retained head and original MISSING check. All
 * initiated reads settle inside both locks, including the final readback.
 */
export function recheckSelectedIncomeWithdrawalOriginalV1(input: {
  selected: IncomeWithdrawalJournalRecordV1; client: SuiGrpcClient; signal: AbortSignal
  getActorAddress: () => string | null; isCurrent: () => boolean; journal?: IncomeWithdrawalJournalV1; executionRegistry?: IncomeExecutionRegistryV1
  readCurrentReview: (original: ReturnType<typeof parseIncomeWithdrawalRecoveryRecord>, client: SuiGrpcClient, signal: AbortSignal) => Promise<Pick<Parameters<typeof recheckPreparedIncomeWithdrawal>[0], 'reviewed' | 'reviewedGas'>>
}) {
  const executionRegistry = input.executionRegistry
  const selected = structuredClone(input.selected), original = parseIncomeWithdrawalRecoveryRecord(JSON.parse(selected.plan.originalText))
  const scope = incomeWithdrawalFundScope(original.target), key = incomeWithdrawalFundKeyV1(scope)
  const source = input.client, ledger = source.ledgerService, core = source.core, execution = source.transactionExecutionService
  const client = { core: { getChainIdentifier: core?.getChainIdentifier?.bind(core), getMoveFunction: core?.getMoveFunction?.bind(core) },
    ledgerService: { ...Object.fromEntries(['getObject', 'getServiceInfo', 'getTransaction', 'getCheckpoint'].map(name => [name, (ledger as any)[name]?.bind(ledger)])), getEpoch: captureOptionalIncomeEpoch(ledger) },
    transactionExecutionService: { simulateTransaction: execution?.simulateTransaction?.bind(execution) } } as unknown as SuiGrpcClient
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(90000)]), getActorAddress = input.getActorAddress,
    isCurrent = input.isCurrent, readCurrentReview = input.readCurrentReview
  const journal = input.journal ? captureIncomeWithdrawalJournalV1(input.journal) : null
  const guard = () => { signal.throwIfAborted(); commerceCheck(isCurrent(), 'WITHDRAW_RESUME_SOURCE_CHANGED'); commerceCheck(getActorAddress() === original.intent.actor, 'WITHDRAW_RESUME_WALLET_CHANGED') }
  return withIncomeWithdrawalFundLock(scope, async () => {
    signal.throwIfAborted()
    const expected = await parseIncomeWithdrawalJournalRecordV1(selected), store = journal ?? captureIncomeWithdrawalJournalV1(browserIncomeWithdrawalJournalV1())
    return store.exclusive(key, async () => {
      const recovery: IncomeWithdrawalHostRecovery = { text: expected.plan.originalText, digest: expected.packet.digest, headPhase: expected.packet.phase, durability: 'UNCONFIRMED' }
      try {
        signal.throwIfAborted()
        const current = await store.read(key)
        commerceCheck(current && publicMutationCanonical(current) === publicMutationCanonical(expected), 'WITHDRAW_RESUME_SELECTED_CHANGED')
        recovery.durability = 'CONFIRMED'
        commerceCheck(current.packet.phase === 'PREPARED' && current.packet.signature === null, 'WITHDRAW_RESUME_EXACT_PREPARED_REQUIRED')
        const result = await queryIncomeWithdrawalJournalOriginalV1({ record: current, client, signal, executionRegistry })
        signal.throwIfAborted(); commerceCheck(result.status === 'MISSING', 'WITHDRAW_RESUME_ORIGINAL_NOT_MISSING')
        guard()
        const review = structuredClone(await readCurrentReview(structuredClone(original), client, signal)); guard()
        const recheck = await recheckPreparedIncomeWithdrawal({ ...review, client, record: original, signal, getActorAddress, executionRegistry }); guard()
        const after = await store.read(key)
        guard(); commerceCheck(after && publicMutationCanonical(after) === publicMutationCanonical(expected), 'WITHDRAW_RESUME_HEAD_CHANGED')
        return { selected: expected, recheck, reviewed: review.reviewed, originalText: expected.plan.originalText }
      } catch (error) { throw new IncomeWithdrawalHostRecoveryError(error instanceof Error ? error.message : 'ORIGINAL_RESUME_FAILED', recovery, { cause: error }) }
    })
  })
}

/** Retire an unresolved expired original under the same funds and head locks. */
export function retireIncomeWithdrawalOriginalV1(input: {
  selected: IncomeWithdrawalJournalRecordV1; client: SuiGrpcClient; signal: AbortSignal; executionRegistry: IncomeExecutionRegistryV1
  isCurrent: (target: ReturnType<typeof importIncomeWithdrawalRecoveryRecord>['target']) => boolean
  journal?: IncomeWithdrawalJournalV1; conflictDigest?: string
}) {
  const selected = structuredClone(input.selected), key = incomeWithdrawalFundKeyV1(selected.plan)
  const client = captureIncomeWithdrawalRetirementClient(input.client), { executionRegistry, isCurrent, conflictDigest } = input
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(90000)])
  const journal = captureIncomeWithdrawalJournalV1(input.journal ?? browserIncomeWithdrawalJournalV1())
  return withIncomeWithdrawalFundLock(selected.plan, () => journal.exclusive(key, async () => {
    const expected = await parseIncomeWithdrawalJournalRecordV1(selected)
    const original = importIncomeWithdrawalRecoveryRecord(expected.plan.originalText)
    const recovery: IncomeWithdrawalHostRecovery = { text: expected.plan.originalText, digest: expected.packet.digest,
      headPhase: expected.packet.phase, durability: 'UNCONFIRMED' }
    const guard = () => { signal.throwIfAborted(); commerceCheck(isCurrent(original.target), 'WITHDRAW_RETIREMENT_NOT_ENABLED') }
    try {
      guard()
      const head = await journal.read(key)
      commerceCheck(head && publicMutationCanonical(head) === publicMutationCanonical(expected), 'WITHDRAW_RETIREMENT_SELECTED_CHANGED')
      recovery.durability = 'CONFIRMED'
      commerceCheck(['SIGNING', 'SIGNED'].includes(head.packet.phase), 'WITHDRAW_RETIREMENT_PHASE')
      const queryOriginal = () => queryIncomeWithdrawalJournalOriginalV1({ record: head, client, signal, executionRegistry })
      const first = await queryOriginal()
      commerceCheck(first.status === 'MISSING', 'WITHDRAW_RETIREMENT_ORIGINAL_FOUND')
      guard()
      const { evidence, observed } = await verifyIncomeWithdrawalRetirement({ client, original, signal, executionRegistry, queryOriginal, conflictDigest })
      const after = await journal.read(key)
      guard()
      commerceCheck(publicMutationCanonical(after) === publicMutationCanonical(head), 'WITHDRAW_RETIREMENT_HEAD_CHANGED')
      const record = { ...head, packet: { ...head.packet, phase: 'RETIRED' as const }, retirement: evidence }
      recovery.durability = 'UNCONFIRMED'
      const retained = await persistIncomeWithdrawalHeadV1(journal, key, record, () => {
        recovery.headPhase = 'RETIRED'
        recovery.durability = 'CONFIRMED'
      })
      signal.throwIfAborted()
      return { record: retained, original: observed }
    } catch (error) {
      throw new IncomeWithdrawalHostRecoveryError(error instanceof Error ? error.message : 'WITHDRAW_RETIREMENT_FAILED', recovery, { cause: error })
    }
  }))
}
