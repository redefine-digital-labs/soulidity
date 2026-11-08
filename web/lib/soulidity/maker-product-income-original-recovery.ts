import type { IncomeExecutionRegistryV1 } from './commerce/income-execution-source-v1'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { publicMutationCanonical } from '../sui/public-mutation-journal'
import { commerceCheck } from './commerce/economics-read'
import { captureMakerProductIncomeClient, MakerProductIncomeRecoveryError, type MakerProductIncomeRecovery } from './maker-product-income-host'
import { importMakerProductIncomeRecoveryRecord } from './commerce/maker-product-income-recovery-record'
import { verifyMakerProductRetirement } from './commerce/maker-product-income-retirement'
import { recheckMakerProductIncomePrepared } from './commerce/maker-product-income-resume'
import { browserMakerProductIncomeOriginalReader, browserMakerProductIncomeJournal, captureMakerProductIncomeJournal,
  makerProductIncomeFundKey, parseMakerProductIncomeOperation, persistMakerProductIncomeHead, queryMakerProductIncomeOriginal,
  type MakerProductIncomeScope, type MakerProductIncomeOriginalReader, type MakerProductIncomeJournal, type MakerProductIncomeOperation } from './maker-product-income-journal'

export function discoverMakerProductIncomeOriginals(scope: MakerProductIncomeScope | null = null, reader: MakerProductIncomeOriginalReader = browserMakerProductIncomeOriginalReader()) {
  if (!scope) return reader.heads()
  return reader.read(makerProductIncomeFundKey(scope)).then(record => record ? [record] : [])
}
/** Local unsigned cancellation only. Same Root exclusion, exact head, actual
 * original MISSING. Source/wallet qualification is irrelevant to querying an
 * existing original. No deletion, on-chain revocation or signing authority.
 */
export function cancelMakerProductIncomeOriginal(input: { selected: MakerProductIncomeOperation; client: SuiGrpcClient; signal: AbortSignal; journal?: MakerProductIncomeJournal; executionRegistry?: IncomeExecutionRegistryV1 }) {
  const executionRegistry = input.executionRegistry
  const selected = structuredClone(input.selected), key = makerProductIncomeFundKey(selected.plan), client = captureMakerProductIncomeClient(input.client)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)]), store = captureMakerProductIncomeJournal(input.journal ?? browserMakerProductIncomeJournal())
  return store.exclusive(key, async () => {
    const expected = await parseMakerProductIncomeOperation(selected); signal.throwIfAborted()
    const current = await store.read(key)
    commerceCheck(current && publicMutationCanonical(current) === publicMutationCanonical(expected), 'MAKER_INCOME_CANCEL_SELECTED_CHANGED')
    commerceCheck(current.packet.phase === 'PREPARED' && current.packet.signature === null, 'MAKER_INCOME_CANCEL_PREPARED_ONLY')
    const result = await queryMakerProductIncomeOriginal({ record: current, client, signal, executionRegistry }); signal.throwIfAborted()
    commerceCheck(result.status === 'MISSING', 'MAKER_INCOME_CANCEL_ORIGINAL_NOT_MISSING')
    const after = await store.read(key); signal.throwIfAborted()
    commerceCheck(publicMutationCanonical(after) === publicMutationCanonical(current), 'MAKER_INCOME_CANCEL_HEAD_CHANGED')
    const cancelled = await parseMakerProductIncomeOperation({ ...current, packet: { ...current.packet, phase: 'CANCELLED' } }); signal.throwIfAborted()
    const retained = await persistMakerProductIncomeHead(store, key, cancelled); signal.throwIfAborted()
    return { record: retained, original: result, notOnChainCancellation: true as const, notNewWithdrawalAuthority: true as const }
  })
}
/** Exact selected original, same single Product fund=head exclusion. Source
 * and current Control/Gas review are deferred until original query. Never
 * rebuilds, reselects, changes phase, signs or submits the original packet.
 */
export function recheckMakerProductIncomeOriginal(input: {
  selected: MakerProductIncomeOperation; client: SuiGrpcClient; signal: AbortSignal; getActorAddress: () => string | null; isCurrent: () => boolean; journal?: MakerProductIncomeJournal; executionRegistry?: IncomeExecutionRegistryV1
  readCurrentReview: (original: ReturnType<typeof importMakerProductIncomeRecoveryRecord>, client: SuiGrpcClient, signal: AbortSignal) => Promise<Pick<Parameters<typeof recheckMakerProductIncomePrepared>[0], 'reviewed' | 'reviewedGas'>>
}) {
  const executionRegistry = input.executionRegistry
  const selected = structuredClone(input.selected), key = makerProductIncomeFundKey(selected.plan), client = captureMakerProductIncomeClient(input.client)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(90000)]), getActorAddress = input.getActorAddress, isCurrent = input.isCurrent, readCurrentReview = input.readCurrentReview
  const store = captureMakerProductIncomeJournal(input.journal ?? browserMakerProductIncomeJournal())
  return store.exclusive(key, async () => {
    const expected = await parseMakerProductIncomeOperation(selected), original = importMakerProductIncomeRecoveryRecord(expected.plan.originalText)
    const recovery: MakerProductIncomeRecovery = { text: expected.plan.originalText, digest: expected.packet.digest, headPhase: expected.packet.phase, durability: 'UNCONFIRMED' }
    const guard = () => { signal.throwIfAborted(); commerceCheck(isCurrent(), 'MAKER_INCOME_RESUME_SOURCE_CHANGED'); commerceCheck(getActorAddress() === original.intent.actor, 'MAKER_INCOME_RESUME_WALLET_CHANGED') }
    try {
      signal.throwIfAborted(); const current = await store.read(key)
      commerceCheck(current && publicMutationCanonical(current) === publicMutationCanonical(expected), 'MAKER_INCOME_RESUME_SELECTED_CHANGED'); recovery.durability = 'CONFIRMED'
      commerceCheck(current.packet.phase === 'PREPARED' && current.packet.signature === null, 'MAKER_INCOME_RESUME_PREPARED_ONLY')
      const result = await queryMakerProductIncomeOriginal({ record: current, client, signal, executionRegistry }); signal.throwIfAborted()
      commerceCheck(result.status === 'MISSING', 'MAKER_INCOME_RESUME_ORIGINAL_NOT_MISSING'); guard()
      const review = structuredClone(await readCurrentReview(structuredClone(original), client, signal)); guard()
      const recheck = await recheckMakerProductIncomePrepared({ ...review, record: original, client, signal, getActorAddress, executionRegistry }); guard()
      const after = await store.read(key); guard()
      commerceCheck(publicMutationCanonical(after) === publicMutationCanonical(expected), 'MAKER_INCOME_RESUME_HEAD_CHANGED')
      return { selected: expected, recheck, reviewed: review.reviewed, originalText: expected.plan.originalText }
    } catch (error) { throw new MakerProductIncomeRecoveryError(error instanceof Error ? error.message : 'MAKER_INCOME_RESUME_FAILED', recovery, { cause: error }) }
  })
}

/** Archive one expired unresolved head under the same Product fund exclusion. */
export function retireMakerProductIncomeOriginal(input: {
  selected: MakerProductIncomeOperation; client: SuiGrpcClient; signal: AbortSignal; executionRegistry: IncomeExecutionRegistryV1
  isCurrent: (target: ReturnType<typeof importMakerProductIncomeRecoveryRecord>['target']) => boolean
  journal?: MakerProductIncomeJournal
}) {
  const selected = structuredClone(input.selected), key = makerProductIncomeFundKey(selected.plan)
  const client = captureMakerProductIncomeClient(input.client), executionRegistry = input.executionRegistry
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(90000)]), isCurrent = input.isCurrent
  const journal = captureMakerProductIncomeJournal(input.journal ?? browserMakerProductIncomeJournal())
  return journal.exclusive(key, async () => {
    const expected = await parseMakerProductIncomeOperation(selected)
    const original = importMakerProductIncomeRecoveryRecord(expected.plan.originalText)
    const recovery: MakerProductIncomeRecovery = { text: expected.plan.originalText, digest: expected.packet.digest,
      headPhase: expected.packet.phase, durability: 'UNCONFIRMED' }
    const guard = () => { signal.throwIfAborted(); commerceCheck(isCurrent(original.target), 'MAKER_INCOME_RETIREMENT_NOT_ENABLED') }
    try {
      signal.throwIfAborted()
      const head = await journal.read(key)
      commerceCheck(head && publicMutationCanonical(head) === publicMutationCanonical(expected), 'MAKER_INCOME_RETIREMENT_SELECTED_CHANGED')
      recovery.durability = 'CONFIRMED'
      commerceCheck(['SIGNING','SIGNED'].includes(head.packet.phase), 'MAKER_INCOME_RETIREMENT_PHASE')
      const queryOriginal = () => queryMakerProductIncomeOriginal({ record: head, client, signal, executionRegistry })
      const first = await queryOriginal()
      commerceCheck(first.status === 'MISSING', 'MAKER_INCOME_RETIREMENT_ORIGINAL_FOUND')
      guard()
      const { evidence, observed } = await verifyMakerProductRetirement({ client, original, signal, executionRegistry, queryOriginal })
      const after = await journal.read(key)
      guard()
      commerceCheck(publicMutationCanonical(after) === publicMutationCanonical(head), 'MAKER_INCOME_RETIREMENT_HEAD_CHANGED')
      const record = { ...head, packet: { ...head.packet, phase: 'RETIRED' as const }, retirement: evidence }
      recovery.durability = 'UNCONFIRMED'
      const retained = await persistMakerProductIncomeHead(journal, key, record, () => {
        recovery.headPhase = 'RETIRED'; recovery.durability = 'CONFIRMED'
      })
      signal.throwIfAborted()
      return { record: retained, original: observed }
    } catch (error) {
      throw new MakerProductIncomeRecoveryError(error instanceof Error ? error.message : 'MAKER_INCOME_RETIREMENT_FAILED', recovery, { cause: error })
    }
  })
}
