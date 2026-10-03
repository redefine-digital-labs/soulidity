import { MAX_GRANT_CAPACITY, profileReadStep } from '@soulidity/sdk'
import { toHex } from '@mysten/sui/utils'
import { inspectPreparedSoulPayload } from '../upload/client-upload'
import { readWalrusSingleRecord, writeWalrusSingleRecord, withWalrusSingleLock, walrusSingleKey,
  type WalrusSingleExecution, type WalrusSingleRecord } from '../upload/walrus-single-operation'
import { getBrowserContentSealConfig } from './browser-content-open'
import { readBrowserContentWriteState, type BrowserContentWriteConfig } from './browser-content-write-state'
import { assertContentAppendAuthority, assertContentAppendWalrusRecord, contentAppendAttachment, contentAppendWalrusIntent,
  parseContentAppendIntent, type ContentAppendIntent } from './content-append-operation'
import { contentAppendPreparationFingerprint, rewrapContentAppendPreparation, verifyContentAppendPreparation,
  type ContentAppendCryptoWallet, type ContentAppendPreparation } from './content-append-preparation'
import { browserContentAppendStore, contentAppendStoreKey } from './content-append-store'
import { browserContentAppendRebaseStore } from './content-append-rebase-store'
import { compactContentAppendPreparation, contentAppendStorageRootHash, seedContentAppendRebasePayment,
  MAX_CONTENT_APPEND_REBASE_DEPTH, verifyContentAppendRebaseHistory, verifyContentAppendRebaseLink, type ContentAppendRebaseLink } from './content-append-rebase-evidence'

function check(v: unknown, code: string): asserts v { if (!v) throw new Error(`CONTENT_APPEND_REBASE_${code}`) }
const json = (v: unknown) => JSON.stringify(v)
type Dependencies = { inspect?: typeof inspectPreparedSoulPayload; read?: typeof readBrowserContentWriteState;
  rewrap?: typeof rewrapContentAppendPreparation; readPayment?: typeof readWalrusSingleRecord;
  writePayment?: typeof writeWalrusSingleRecord; paymentLock?: typeof withWalrusSingleLock;
  stageStore?: ReturnType<typeof browserContentAppendStore>; transitionStore?: ReturnType<typeof browserContentAppendRebaseStore> }
export class ContentAppendPredecessorCompleted extends Error {
  constructor(readonly record: ContentAppendPreparation, readonly result: Extract<Awaited<ReturnType<typeof inspectPreparedSoulPayload>>, { status: 'COMPLETED' }>['result']) {
    super('CONTENT_APPEND_REBASE_ORIGINAL_ATTEMPT_COMPLETED_QUERY_ITS_RECEIPT')
  }
}
function paymentFor(record: ContentAppendPreparation, read: typeof readWalrusSingleRecord) {
  const payment = read(walrusSingleKey(contentAppendWalrusIntent(record)))
  check(payment, 'PAID_WAL_MISSING_QUERY_ONLY')
  return assertContentAppendWalrusRecord(record, payment)
}
async function inspect(record: ContentAppendPreparation, payment: WalrusSingleRecord, execution: WalrusSingleExecution,
  signal: AbortSignal, deps: Dependencies) {
  const result = await profileReadStep(signal, () => (deps.inspect ?? inspectPreparedSoulPayload)({ record: payment,
    attachment: contentAppendAttachment(record), execution }))
  assertContentAppendWalrusRecord(record, result.record)
  if (result.status === 'COMPLETED') throw new ContentAppendPredecessorCompleted(record, result.result)
  check(contentAppendStorageRootHash(payment) === contentAppendStorageRootHash(result.record), 'INSPECTED_ROOT_CHANGED')
  return result
}
async function predecessors(record: ContentAppendPreparation, history: ContentAppendRebaseLink[], execution: WalrusSingleExecution,
  signal: AbortSignal, deps: Dependencies) {
  const verified = await verifyContentAppendRebaseHistory(record, history, execution.client)
  for (const link of verified) {
    const old = (await verifyContentAppendRebaseLink(link, record.ciphertext, execution.client)).previous
    // The transition retains known packets even if the local payment key is
    // lost. A conflicting locally-known packet is NOT silently discarded.
    const local = (deps.readPayment ?? readWalrusSingleRecord)(walrusSingleKey(contentAppendWalrusIntent(old)))
    const candidates = [link.previousPayment]
    if (local) {
      assertContentAppendWalrusRecord(old, local)
      check(contentAppendStorageRootHash(local) === contentAppendStorageRootHash(link.previousPayment), 'LOCAL_HISTORY_ROOT_CHANGED')
      if (local.certify?.digest !== link.previousPayment.certify?.digest) candidates.push(local)
    }
    for (const payment of candidates) await inspect(old, payment, execution, signal, deps)
  }
}
function assertInstalledPayment(record: ContentAppendPreparation, input: WalrusSingleRecord, seed?: WalrusSingleRecord) {
  const payment = assertContentAppendWalrusRecord(record, input), meta = parseContentAppendIntent(record).rebase
  check(meta && contentAppendStorageRootHash(payment) === meta.storageRootHash && payment.approved
    && payment.approved.gasBudget === String(BigInt(meta.certifyGasBudgetMist) * 2n), 'INSTALLED_PAYMENT_MISMATCH')
  if (seed) check(payment.register?.bytes === seed.register?.bytes && payment.register?.digest === seed.register?.digest
    && json(payment.encoding) === json(seed.encoding) && json(payment.approved) === json(seed.approved), 'INSTALLED_PAYMENT_MISMATCH')
  return payment
}
function assertOriginalGrantTargets(record: ContentAppendPreparation,
  proof: Awaited<ReturnType<typeof readBrowserContentWriteState>>, predecessor?: ContentAppendPreparation) {
  const intent = parseContentAppendIntent(record), original = predecessor ? parseContentAppendIntent(predecessor) : intent
  // History validation binds this one immutable requirement list to the first
  // preparation; historical executable plans are not a second requirement source.
  const required = intent.rebase?.autoGrantTargets ?? original.rebase?.autoGrantTargets ?? original.autoGrantPlan?.targets ?? []
  const descriptor = proof.snapshot.kindDescriptors.find(d => d.kind === record.scope.kind)
  for (const { address, scopeMask } of required) {
    const mask = scopeMask | Number(descriptor?.default_grant_scope_mask ?? 0)
    const planned = intent.autoGrantPlan?.targets.find(t => t.address === address)
    const granted = proof.snapshot.grants.find(g => g.currentEpoch && g.unexpiredAtObservation && g.slot.grantee === address)
    check(planned && (planned.scopeMask & mask) === mask || granted && (BigInt(granted.slot.scope_mask) & BigInt(mask)) === BigInt(mask),
      'ORIGINAL_AUTO_GRANT_NO_LONGER_COVERED')
  }
}
/** Obtain the only admissible continuation for an activated rebase. Missing
 * ancestry or payment evidence cannot fall through to the initial upload path. */
export async function contentAppendRebaseContinuation(input: ContentAppendPreparation, executionInput: WalrusSingleExecution,
  signal: AbortSignal, deps: Dependencies = {}) {
  const execution = { ...executionInput }, record = await verifyContentAppendPreparation(input, execution.client)
  check(parseContentAppendIntent(record).rebase, 'INTENT_REQUIRED')
  const store = deps.stageStore ?? browserContentAppendStore(execution.client), transitions = deps.transitionStore ?? browserContentAppendRebaseStore(execution.client)
  const history = await transitions.history(record)
  await verifyContentAppendRebaseHistory(record, history, execution.client)
  const payment = assertInstalledPayment(record, paymentFor(record, deps.readPayment ?? readWalrusSingleRecord), history.at(-1)?.nextPayment)
  return { payment, assertAuthority: (proof: Awaited<ReturnType<typeof readBrowserContentWriteState>>) => assertOriginalGrantTargets(record, proof),
    verify: async () => {
    signal.throwIfAborted()
    const active = await store.read(contentAppendStoreKey(record.scope))
    check(active && contentAppendPreparationFingerprint(active) === contentAppendPreparationFingerprint(record), 'ACTIVE_ATTEMPT_CHANGED')
    assertInstalledPayment(record, paymentFor(record, deps.readPayment ?? readWalrusSingleRecord), history.at(-1)?.nextPayment)
    await predecessors(record, await transitions.history(record), execution, signal, deps)
    signal.throwIfAborted()
  } }
}
export interface ContentAppendRebaseApproval {
  previousVersion: string; nextVersion: string; blobObjectId: string; remainingWalrusEpochs: number
  suggestedGasBudgetMist: string; alreadyPrepared: boolean
}
/** Caller holds the slot lock throughout preparation/activation and subsequent
 * execution. This function itself does not sign or broadcast a chain packet. */
export async function prepareContentAppendRebase(params: {
  record: ContentAppendPreparation; config: BrowserContentWriteConfig; execution: WalrusSingleExecution
  wallet: ContentAppendCryptoWallet; signal: AbortSignal
  approveGas: (request: ContentAppendRebaseApproval) => Promise<string | null>
}, deps: Dependencies = {}) {
  const execution = { ...params.execution }, wallet = { ...params.wallet }, config = structuredClone(params.config)
  const signal = params.signal, approveGas = params.approveGas
  const record = await verifyContentAppendPreparation(params.record, execution.client), intent = parseContentAppendIntent(record)
  const store = deps.stageStore ?? browserContentAppendStore(execution.client), transitions = deps.transitionStore ?? browserContentAppendRebaseStore(execution.client)
  const readPayment = deps.readPayment ?? readWalrusSingleRecord, writePayment = deps.writePayment ?? writeWalrusSingleRecord
  const lock = deps.paymentLock ?? withWalrusSingleLock, key = contentAppendStoreKey(record.scope)
  const guard = () => { signal.throwIfAborted(); check(execution.getAddress() === record.scope.author && wallet.getAddress() === record.scope.author, 'WALLET_CHANGED') }
  const step = async <T>(fn: () => Promise<T>) => { guard(); const result = await profileReadStep(signal, fn); guard(); return result }
  const read = () => step(() => (deps.read ?? readBrowserContentWriteState)({ config, soulId: intent.soulId, stateId: intent.stateId,
    contentId: record.scope.contentObjectId, kind: record.scope.kind, viewerAddress: record.scope.author, signal }, { client: () => execution.client }))
  return lock(walrusSingleKey(contentAppendWalrusIntent(record)), async () => {
    guard()
    const active = await step(() => store.read(key))
    check(active && contentAppendPreparationFingerprint(active) === contentAppendPreparationFingerprint(record), 'ACTIVE_ATTEMPT_CHANGED')
    const history = await step(() => transitions.history(record))
    check(history.length < MAX_CONTENT_APPEND_REBASE_DEPTH, 'HISTORY_LIMIT_EXPORT_REQUIRED')
    await step(() => predecessors(record, history, execution, signal, deps))
    const payment = paymentFor(record, readPayment), eligibility = await step(() => inspect(record, payment, execution, signal, deps))
    let link = await step(() => transitions.pending(record))
    const alreadyPrepared = Boolean(link)
    if (link) {
      check(contentAppendStorageRootHash(payment) === contentAppendStorageRootHash(link.previousPayment), 'PENDING_STORAGE_ROOT_CHANGED')
      await step(() => inspect(record, assertContentAppendWalrusRecord(record, link!.previousPayment), execution, signal, deps))
    }
    const observed = await read(), state = observed.snapshot
    let next: ContentAppendPreparation
    if (link) next = (await step(() => verifyContentAppendRebaseLink(link!, record.ciphertext, execution.client))).next
    else {
      const nextIntent = structuredClone(intent), descriptor = state.kindDescriptors.find(d => d.kind === record.scope.kind)
      check(descriptor, 'KIND_UNAVAILABLE')
      nextIntent.ownershipEpoch = state.ownershipEpoch
      if (intent.grantId !== null) {
        const grant = state.grants.find(g => g.slot.grantee === record.scope.author && g.currentEpoch && g.unexpiredAtObservation
          && g.grant && (BigInt(g.slot.scope_mask) & BigInt(descriptor.default_grant_scope_mask)) === BigInt(descriptor.default_grant_scope_mask))
        check(grant, 'CURRENT_GRANT_UNAVAILABLE'); nextIntent.grantId = grant.slot.grant_id
      }
      const targets = (intent.rebase?.autoGrantTargets ?? intent.autoGrantPlan?.targets ?? []).flatMap(target => {
        const current = state.grants.find(g => g.currentEpoch && g.slot.grantee === target.address)
        const mask = BigInt(current?.slot.scope_mask ?? 0), required = BigInt(target.scopeMask) | BigInt(descriptor.default_grant_scope_mask)
        return current?.unexpiredAtObservation && (mask & required) === required ? [] : [{ address: target.address, scopeMask: Number(mask | required) }]
      })
      let autoGrantPlan: ContentAppendIntent['autoGrantPlan'] = null
      if (targets.length) {
        const fresh = targets.filter(t => !state.grants.some(g => g.currentEpoch && g.slot.grantee === t.address)).length
        const required = BigInt(state.activeGrantCount) + BigInt(fresh)
        check(required <= BigInt(MAX_GRANT_CAPACITY), 'GRANT_CAPACITY_EXCEEDED')
        autoGrantPlan = { capacityBefore: state.grantCapacity,
          capacityAfter: String(required > BigInt(state.grantCapacity) ? required : BigInt(state.grantCapacity)), targets }
      }
      nextIntent.autoGrantPlan = autoGrantPlan
      const version = String(state.contentVersions.filter(v => v.kind === record.scope.kind && v.name === record.scope.name).length)
      // A temporary public shape is used ONLY for live authority checks before
      // requesting the explicit personal signatures; it is never persisted.
      next = { ...record, scope: { ...record.scope, versionIndex: version, intentJson: json(nextIntent) } }
    }
    if (!alreadyPrepared) {
      assertContentAppendAuthority(next, observed)
      assertOriginalGrantTargets(next, observed, record)
    }
    const budget = await step(() => approveGas({ previousVersion: record.scope.versionIndex, nextVersion: next.scope.versionIndex,
      blobObjectId: eligibility.blobObjectId, remainingWalrusEpochs: eligibility.storageEndEpoch - eligibility.observedWalrusEpoch,
      suggestedGasBudgetMist: link ? parseContentAppendIntent(next).rebase!.certifyGasBudgetMist : String(BigInt(payment.approved!.gasBudget) / 2n),
      alreadyPrepared: Boolean(link) }))
    if (budget === null) return null
    check(/^[1-9][0-9]{0,18}$/.test(budget) && BigInt(budget) <= 9223372036854775807n, 'GAS_BUDGET_INVALID')
    if (link) check(budget === parseContentAppendIntent(next).rebase!.certifyGasBudgetMist, 'PREPARED_GAS_CANNOT_CHANGE')
    else {
      const nextIntent = parseContentAppendIntent(next)
      nextIntent.rebase = { nonce: toHex(crypto.getRandomValues(new Uint8Array(16))), predecessor: contentAppendPreparationFingerprint(record),
        storageRootHash: contentAppendStorageRootHash(payment), certifyGasBudgetMist: budget,
        autoGrantTargets: structuredClone(intent.rebase?.autoGrantTargets ?? intent.autoGrantPlan?.targets ?? []) }
      next = await step(() => (deps.rewrap ?? rewrapContentAppendPreparation)({ record,
        nextScope: { ...next.scope, intentJson: json(nextIntent) }, sealConfig: getBrowserContentSealConfig(), wallet }))
      link = { schema: 'soulidity.content-append-rebase.v1', previous: compactContentAppendPreparation(record), previousPayment: payment,
        next: compactContentAppendPreparation(next), nextPayment: seedContentAppendRebasePayment(next, payment),
        inspection: { blobObjectId: eligibility.blobObjectId, blobVersion: eligibility.blobVersion, blobDigest: eligibility.blobDigest,
          observedWalrusEpoch: eligibility.observedWalrusEpoch, storageEndEpoch: eligibility.storageEndEpoch, retirement: eligibility.retirement } }
    }
    const prepared = await step(() => verifyContentAppendRebaseLink(link!, record.ciphertext, execution.client))
    if (!alreadyPrepared) {
      const currentProof = await read()
      assertContentAppendAuthority(prepared.next, currentProof); assertOriginalGrantTargets(prepared.next, currentProof, record)
    }
    await step(() => predecessors(record, history, execution, signal, deps))
    const latest = paymentFor(record, readPayment)
    check(json(latest) === json(payment), 'PREDECESSOR_PAYMENT_CHANGED')
    await step(() => inspect(record, latest, execution, signal, deps))
    // Commit first, install/read back payment second, CAS activation third.
    // A previously committed transition must remain finishable if Soul state
    // changed during the interruption. This local-only activation is NOT write
    // authority: continuation rechecks the current state before relay/sign/send.
    // Once activated, a stale attempt can itself be explicitly rebased.
    await step(() => transitions.prepare(prepared.link, record.ciphertext))
    const nextKey = walrusSingleKey(prepared.link.nextPayment.intent)
    await lock(nextKey, async () => {
      guard()
      const installed = readPayment(nextKey)
      if (installed) assertInstalledPayment(prepared.next, installed, prepared.link.nextPayment)
      else writePayment(nextKey, prepared.link.nextPayment)
      const readback = readPayment(nextKey)
      check(readback, 'PAYMENT_READBACK_MISSING'); assertInstalledPayment(prepared.next, readback, prepared.link.nextPayment)
      await step(() => transitions.activate(prepared.link, record.ciphertext))
      const activated = await step(() => store.read(key))
      check(activated && contentAppendPreparationFingerprint(activated) === contentAppendPreparationFingerprint(prepared.next), 'ACTIVATION_READBACK_MISMATCH')
    })
    return prepared.next
  })
}
