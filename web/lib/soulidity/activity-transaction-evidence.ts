import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { profileReadStep } from '@soulidity/sdk'
import { MarketCancelCheckpointSummaryBcs, marketCancelCheckpointDigest } from '../animacraft/market-cancel-checkpoint'

export interface ActivityDeployment {
  readonly originalPackageId: string
  readonly callablePackageId: string
  readonly callableDigest: string
  readonly chainIdentifier: string
}
interface ActivityTrust {
  readonly trust: 'TRUSTED_LEDGER_CANONICAL_EVIDENCE'
  readonly notAuthorization: true
}
export interface ActivityCheckpointEvidence extends ActivityTrust {
  readonly chainIdentifier: string
  readonly checkpoint: string
  readonly epoch: string
  readonly timestampMs: string
  readonly digest: string
  readonly summaryBytes: string
  readonly contentsBytes: string
  readonly transactions: readonly Readonly<{ transactionDigest: string; effectsDigest: string }>[]
}
export interface ActivityEventEvidence {
  readonly eventSequence: number
  /** Top-level execution context (MoveCall or Publish/Upgrade initializer), NOT necessarily the event-defining package/module. */
  readonly packageId: string
  readonly transactionModule: string
  readonly sender: string
  readonly type: string
  readonly contentsBytes: string
}
export interface ActivityTransactionEvidence extends ActivityTrust {
  readonly deployment: ActivityDeployment
  readonly transactionDigest: string
  readonly sender: string
  readonly checkpoint: string
  readonly checkpointTimestampMs: string
  readonly epoch: string
  readonly transactionIndex: number
  readonly transactionBytes: string
  readonly effectsBytes: string
  readonly events: readonly ActivityEventEvidence[]
  /** Applies to selected original-package event types only; unrelated events are structural evidence. */
  readonly eventAuthority: 'TYPE_ORIGIN_VERIFIED_HISTORY'
  readonly executionPackageVersion: 'NOT_ATTESTED'
}
export type ActivityEvidenceErrorCode = 'CONFIG_INVALID' | 'ABORTED' | 'TIMEOUT' | 'UNAVAILABLE' | 'TRANSPORT'
  | 'WRONG_CHAIN' | 'BCS_INVALID' | 'EVIDENCE_MISMATCH' | 'BOUNDS_EXCEEDED' | 'FAILED_TRANSACTION' | 'UNCONFIRMED'
export class ActivityEvidenceError extends Error {
  readonly name = 'ActivityEvidenceError'
  constructor(readonly code: ActivityEvidenceErrorCode, detail: string) { super(`ACTIVITY_${code}: ${detail}`) }
}
function check(value: unknown, code: ActivityEvidenceErrorCode, detail: string): asserts value {
  if (!value) throw new ActivityEvidenceError(code, detail)
}
const TIMEOUT_MS = 25_000
const U64_MAX = 18446744073709551615n
const MAX_TX_BYTES = 256 * 1024, MAX_EFFECTS_BYTES = 1024 * 1024, MAX_EVENTS_BYTES = 1024 * 1024
const MAX_CONTENTS_BYTES = 8 * 1024 * 1024, MAX_PACKAGE_BYTES = 4 * 1024 * 1024, MAX_SUMMARY_BYTES = 128 * 1024
const MAX_EVENTS = 1024, MAX_CHECKPOINT_TRANSACTIONS = 10_000
const TRUST = Object.freeze({ trust: 'TRUSTED_LEDGER_CANONICAL_EVIDENCE' as const, notAuthorization: true as const })
const id = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v)
const uint = (v: unknown): v is bigint => typeof v === 'bigint' && v >= 0n && v <= U64_MAX
const decimal = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= U64_MAX
const IDENTIFIER = /^(?:[A-Za-z][A-Za-z0-9_]*|_[A-Za-z0-9_]+)$/
const identifier = (v: string) => v.length <= 128 && IDENTIFIER.exec(v)?.[0] === v
function digest(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 44) return false
  try { const bytes = fromBase58(v); return bytes.length === 32 && toBase58(bytes) === v } catch { return false }
}
function equal(a: Uint8Array, b: Uint8Array) { return a.length === b.length && a.every((byte, i) => byte === b[i]) }
function bytes(value: unknown, max: number, label: string): Uint8Array {
  check(value instanceof Uint8Array && value.length > 0, 'UNAVAILABLE', `${label} bytes unavailable`)
  check(value.length <= max, 'BOUNDS_EXCEEDED', `${label} byte bound exceeded`)
  return value.slice()
}
function typedDigest(domain: string, value: Uint8Array) {
  const prefix = new TextEncoder().encode(`${domain}::`), input = new Uint8Array(prefix.length + value.length)
  input.set(prefix); input.set(value, prefix.length)
  return toBase58(blake2b(input, { dkLen: 32 }))
}
function canonical<Output, Input>(codec: { parse(value: Uint8Array): Output; serialize(value: Input): { toBytes(): Uint8Array } }, value: Uint8Array, label: string): Output {
  try {
    const parsed = codec.parse(value)
    check(equal(codec.serialize(parsed as unknown as Input).toBytes(), value), 'BCS_INVALID', `Noncanonical ${label}`)
    return parsed
  } catch (error) {
    if (error instanceof ActivityEvidenceError) throw error
    throw new ActivityEvidenceError('BCS_INVALID', `Invalid ${label}`)
  }
}
const DigestBcs = bcs.byteVector().transform({
  input(value: string) { check(digest(value), 'BCS_INVALID', 'Invalid digest'); return fromBase58(value) },
  output(value: Uint8Array) { check(value.length === 32, 'BCS_INVALID', 'Invalid digest size'); return toBase58(value) },
})
const ExecutionDigestsBcs = bcs.struct('ExecutionDigests', { transaction: DigestBcs, effects: DigestBcs })
// sui-types/messages_checkpoint.rs at the approved 722ac4fcf484 source.
// GenericSignature is a byte vector, NOT an enum discriminant or fixed array.
const SignatureBcs = bcs.byteVector()
const ContentsBcs = bcs.enum('CheckpointContents', {
  V1: bcs.struct('CheckpointContentsV1', {
    transactions: bcs.vector(ExecutionDigestsBcs), user_signatures: bcs.vector(bcs.vector(SignatureBcs)),
  }),
  V2: bcs.struct('CheckpointContentsV2', {
    transactions: bcs.vector(bcs.struct('CheckpointTransactionContents', {
      digest: ExecutionDigestsBcs, user_signatures: bcs.vector(bcs.tuple([SignatureBcs, bcs.option(bcs.u64())])),
    })),
  }),
})
const EventBcs = bcs.struct('Event', {
  package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
  type_: bcs.StructTag, contents: bcs.byteVector(),
})
const EventsBcs = bcs.struct('TransactionEvents', { data: bcs.vector(EventBcs) })

async function bounded<T>(parent: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const cancel = () => controller.abort(new ActivityEvidenceError('ABORTED', 'Read cancelled'))
  parent?.addEventListener('abort', cancel, { once: true })
  if (parent?.aborted) cancel()
  const timer = setTimeout(() => controller.abort(new ActivityEvidenceError('TIMEOUT', 'Read deadline exceeded')), TIMEOUT_MS)
  try { return await profileReadStep(controller.signal, () => run(controller.signal)) }
  catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason
    if (error instanceof ActivityEvidenceError) throw error
    if (error && typeof error === 'object' && 'code' in error && ['NOT_FOUND', 'UNAVAILABLE'].includes(String(error.code))) {
      throw new ActivityEvidenceError('UNAVAILABLE', 'Historical ledger evidence unavailable')
    }
    throw new ActivityEvidenceError('TRANSPORT', 'Ledger read failed')
  } finally { clearTimeout(timer); parent?.removeEventListener('abort', cancel) }
}
async function chain(client: SuiGrpcClient, expected: string, signal: AbortSignal) {
  check(/^[0-9a-f]{8}$/.test(expected), 'CONFIG_INVALID', 'Invalid release chain identifier')
  const { response } = await profileReadStep(signal, () => client.ledgerService.getServiceInfo({}, { abort: signal, timeout: TIMEOUT_MS }))
  check(digest(response.chainId) && toHex(fromBase58(response.chainId).slice(0, 4)) === expected,
    'WRONG_CHAIN', 'Ledger does not match selected release')
}
function timestamp(value: { seconds?: bigint; nanos?: number } | undefined, expected: string) {
  check(value && uint(value.seconds) && Number.isInteger(value.nanos) && value.nanos! >= 0 && value.nanos! < 1_000_000_000
    && value.nanos! % 1_000_000 === 0 && value.seconds * 1000n + BigInt(value.nanos! / 1_000_000) === BigInt(expected),
  'EVIDENCE_MISMATCH', 'Checkpoint timestamp projection mismatch')
}
async function checkpointEvidence(client: SuiGrpcClient, chainIdentifier: string, sequence: string, signal: AbortSignal): Promise<ActivityCheckpointEvidence> {
  check(decimal(sequence), 'CONFIG_INVALID', 'Invalid checkpoint sequence')
  const { response } = await profileReadStep(signal, () => client.ledgerService.getCheckpoint({
    checkpointId: { oneofKind: 'sequenceNumber', sequenceNumber: BigInt(sequence) },
    readMask: { paths: ['sequence_number', 'digest', 'summary', 'contents.bcs', 'contents.digest', 'contents.version'] },
  }, { abort: signal, timeout: TIMEOUT_MS }))
  const row = response.checkpoint
  check(row && row.sequenceNumber === BigInt(sequence) && digest(row.digest), 'EVIDENCE_MISMATCH', 'Checkpoint reference mismatch')
  const summaryBytes = bytes(row.summary?.bcs?.value, MAX_SUMMARY_BYTES, 'Checkpoint summary')
  const summary = canonical(MarketCancelCheckpointSummaryBcs, summaryBytes, 'checkpoint summary')
  check(marketCancelCheckpointDigest(summaryBytes) === row.digest && row.summary?.digest === row.digest
    && summary.sequence_number === sequence && row.summary.sequenceNumber === BigInt(sequence)
    && row.summary.epoch === BigInt(summary.epoch) && row.summary.totalNetworkTransactions === BigInt(summary.network_total_transactions),
  'EVIDENCE_MISMATCH', 'Checkpoint summary digest or scalar mismatch')
  timestamp(row.summary.timestamp, summary.timestamp_ms)
  const previous = summary.previous_digest === null ? undefined : toBase58(Uint8Array.from(summary.previous_digest))
  check(row.summary.previousDigest === previous && (sequence === '0' ? previous === undefined : digest(previous)),
    'EVIDENCE_MISMATCH', 'Checkpoint predecessor mismatch')
  const contentsBytes = bytes(row.contents?.bcs?.value, MAX_CONTENTS_BYTES, 'Checkpoint contents')
  const contents = canonical(ContentsBcs, contentsBytes, 'checkpoint contents')
  const contentDigest = typedDigest('CheckpointContents', contentsBytes)
  check(row.contents?.digest === contentDigest && row.summary.contentDigest === contentDigest
    && toBase58(Uint8Array.from(summary.content_digest)) === contentDigest
    && row.contents.version === (contents.V1 ? 1 : 2), 'EVIDENCE_MISMATCH', 'Checkpoint contents digest or version mismatch')
  const entries = contents.V1?.transactions ?? contents.V2!.transactions.map(row => row.digest)
  check(entries.length <= MAX_CHECKPOINT_TRANSACTIONS, 'BOUNDS_EXCEEDED', 'Checkpoint transaction bound exceeded')
  check(BigInt(entries.length) <= BigInt(summary.network_total_transactions)
    && (!contents.V1 || contents.V1.user_signatures.length === entries.length),
  'EVIDENCE_MISMATCH', 'Checkpoint transaction/signature count mismatch')
  const seen = new Set<string>()
  const transactions = entries.map(entry => {
    check(!seen.has(entry.transaction), 'EVIDENCE_MISMATCH', 'Duplicate checkpoint transaction')
    seen.add(entry.transaction)
    return Object.freeze({ transactionDigest: entry.transaction, effectsDigest: entry.effects })
  })
  signal.throwIfAborted()
  return Object.freeze({ ...TRUST, chainIdentifier, checkpoint: sequence, epoch: summary.epoch, timestampMs: summary.timestamp_ms,
    digest: row.digest, summaryBytes: toBase64(summaryBytes), contentsBytes: toBase64(contentsBytes), transactions: Object.freeze(transactions) })
}
/** Exact as-of time even when an event-family scan is empty. The trusted ledger
 * supplies the checkpoint; hashes/canonical membership are checked here. This
 * does NOT verify validator BLS signatures, a quorum or the checkpoint chain. */
export function readActivityCheckpointEvidence(params: {
  client: SuiGrpcClient; chainIdentifier: string; checkpoint: string; signal?: AbortSignal
}): Promise<ActivityCheckpointEvidence> {
  const { client, chainIdentifier, checkpoint, signal } = params
  return bounded(signal, async abort => {
    check(decimal(checkpoint), 'CONFIG_INVALID', 'Invalid checkpoint sequence')
    await chain(client, chainIdentifier, abort)
    return checkpointEvidence(client, chainIdentifier, checkpoint, abort)
  })
}

type Struct = ReturnType<typeof bcs.StructTag.parse>
function validateStruct(tag: Struct, depth = 0, budget = { remaining: 256 }) {
  check(depth <= 16 && --budget.remaining >= 0, 'BOUNDS_EXCEEDED', 'Event type complexity exceeded')
  check(id(tag.address) && identifier(tag.module) && identifier(tag.name), 'BCS_INVALID', 'Invalid Move event type identifier')
  function parameter(value: Struct['typeParams'][number], level: number) {
    check(level <= 16 && --budget.remaining >= 0, 'BOUNDS_EXCEEDED', 'Event type complexity exceeded')
    if ('struct' in value) validateStruct(value.struct, level + 1, budget)
    else if ('vector' in value) parameter(value.vector, level + 1)
  }
  for (const value of tag.typeParams) parameter(value, depth + 1)
}
function deployment(value: ActivityDeployment): ActivityDeployment {
  let captured: ActivityDeployment
  try { captured = structuredClone(value) } catch { throw new ActivityEvidenceError('CONFIG_INVALID', 'Invalid release tuple') }
  check(captured && id(captured.originalPackageId) && id(captured.callablePackageId) && digest(captured.callableDigest)
    && /^[0-9a-f]{8}$/.test(captured.chainIdentifier), 'CONFIG_INVALID', 'Invalid release tuple')
  return Object.freeze({ originalPackageId: captured.originalPackageId, callablePackageId: captured.callablePackageId,
    callableDigest: captured.callableDigest, chainIdentifier: captured.chainIdentifier })
}
async function packageOrigins(client: SuiGrpcClient, release: ActivityDeployment, signal: AbortSignal) {
  const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId: release.callablePackageId,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'bcs', 'package.storage_id', 'package.original_id', 'package.version'] },
  }, { abort: signal, timeout: TIMEOUT_MS }))
  const row = response.object
  check(row?.objectId === release.callablePackageId && row.digest === release.callableDigest && row.owner?.kind === 4
    && uint(row.version) && row.version > 0n, 'EVIDENCE_MISMATCH', 'Release package reference mismatch')
  const raw = bytes(row.bcs?.value, MAX_PACKAGE_BYTES, 'Release package')
  const parsed = canonical(bcs.Object, raw, 'release package object'), pkg = parsed.data.Package
  check(typedDigest('Object', raw) === release.callableDigest && parsed.owner.$kind === 'Immutable'
    && pkg?.id === release.callablePackageId && pkg.version === String(row.version),
  'EVIDENCE_MISMATCH', 'Release package BCS mismatch')
  // Ledger implementations may omit these redundant Package projections even
  // when requested. The configured Object digest, canonical full Object BCS,
  // Immutable owner and raw type origins remain the authority. A projection
  // that is supplied must agree; its absence does not weaken those checks.
  check((row.package?.storageId === undefined || row.package.storageId === pkg.id)
    && (row.package?.originalId === undefined || row.package.originalId === release.originalPackageId)
    && (row.package?.version === undefined || row.package.version === row.version),
  'EVIDENCE_MISMATCH', 'Release package projection mismatch')
  check(pkg.moduleMap.size > 0 && pkg.moduleMap.size <= 512 && pkg.typeOriginTable.length <= 4096 && pkg.linkageTable.size <= 1024,
    'BOUNDS_EXCEEDED', 'Release package table bound exceeded')
  // bcs.map canonical ordering is serialized-key byte order (including the
  // string length prefix), not JavaScript lexical ordering. Roundtrip above
  // already verifies ordering and duplicate keys with the installed SDK codec.
  for (const [name, module] of pkg.moduleMap) {
    check(identifier(name) && module.length > 0, 'BCS_INVALID', 'Invalid package module map')
  }
  for (const [name, link] of pkg.linkageTable) {
    // System packages legitimately commit zero linkage versions (Sui 722
    // move_package.rs::new_system). This reader checks structure, not linking.
    check(id(name) && id(link.upgradedId) && decimal(link.upgradedVersion),
      'BCS_INVALID', 'Invalid package linkage map')
  }
  const origins = new Map<string, string>()
  for (const origin of pkg.typeOriginTable) {
    const key = `${origin.moduleName}::${origin.datatypeName}`
    check(identifier(origin.moduleName) && identifier(origin.datatypeName) && id(origin.package)
      && pkg.moduleMap.has(origin.moduleName) && !origins.has(key), 'BCS_INVALID', 'Invalid or duplicate package type origin')
    origins.set(key, origin.package)
  }
  return origins
}

/** Read-only event history, NOT exact signed-operation certification. The
 * configured immutable package establishes the selected type-origin schema.
 * Sui 722ac4fcf484 execution/context.rs attaches the top-level version_mid to
 * internally emitted events. Third-party wrappers and Publish/Upgrade
 * initializer events are therefore retained;
 * their header is not an emitter identity. Actual historical callable version
 * and VM linkage are NOT attested here. No WAL, current ownership, signatures,
 * validator quorum or authorizing decision is inferred from this evidence. */
export function readActivityTransactionEvidence(params: {
  client: SuiGrpcClient; deployment: ActivityDeployment; transactionDigest: string; signal?: AbortSignal
}): Promise<ActivityTransactionEvidence> {
  const { client, transactionDigest, signal } = params
  let release: ActivityDeployment
  try { release = deployment(params.deployment) } catch (error) { return Promise.reject(error) }
  return bounded(signal, async abort => {
    check(digest(transactionDigest), 'CONFIG_INVALID', 'Invalid transaction digest')
    await chain(client, release.chainIdentifier, abort)
    const { response } = await profileReadStep(abort, () => client.ledgerService.getTransaction({ digest: transactionDigest,
      readMask: { paths: ['digest', 'transaction.bcs', 'transaction.digest', 'transaction.sender', 'effects.bcs', 'effects.digest',
        'effects.version', 'effects.epoch', 'effects.transaction_digest', 'effects.status', 'effects.events_digest', 'checkpoint',
        'timestamp', 'events.bcs', 'events.digest'] },
    }, { abort, timeout: TIMEOUT_MS }))
    const row = response.transaction
    check(row?.digest === transactionDigest && row.transaction?.digest === transactionDigest, 'EVIDENCE_MISMATCH', 'Transaction reference mismatch')
    const transactionBytes = bytes(row.transaction.bcs?.value, MAX_TX_BYTES, 'Transaction')
    const tx = canonical(bcs.TransactionData, transactionBytes, 'transaction data').V1
    const ptb = tx.kind.ProgrammableTransaction
    check(TransactionDataBuilder.getDigestFromBytes(transactionBytes) === transactionDigest && id(tx.sender)
      && row.transaction.sender === tx.sender && ptb, 'EVIDENCE_MISMATCH', 'Transaction bytes, sender or kind mismatch')
    const calls = ptb.commands.flatMap(command => command.MoveCall ? [command.MoveCall] : [])
    check(ptb.commands.length <= 1024 && ptb.inputs.length <= 2048, 'BOUNDS_EXCEEDED', 'Transaction complexity exceeded')
    for (const call of calls) check(id(call.package) && identifier(call.module) && identifier(call.function), 'BCS_INVALID', 'Invalid MoveCall context')
    const effectsBytes = bytes(row.effects?.bcs?.value, MAX_EFFECTS_BYTES, 'Transaction effects')
    const effects = canonical(bcs.TransactionEffects, effectsBytes, 'transaction effects'), e = effects.V2 ?? effects.V1!
    const effectsDigest = typedDigest('TransactionEffects', effectsBytes)
    check(row.effects?.digest === effectsDigest && e.transactionDigest === transactionDigest && row.effects.transactionDigest === transactionDigest
      && row.effects.epoch === BigInt(e.executedEpoch) && row.effects.version === (effects.V2 ? 2 : 1)
      && row.effects.status?.success === (e.status.$kind === 'Success'), 'EVIDENCE_MISMATCH', 'Effects digest, epoch or status mismatch')
    check(e.status.$kind === 'Success', 'FAILED_TRANSACTION', 'Transaction did not succeed')
    check(row.effects.status?.error === undefined, 'EVIDENCE_MISMATCH', 'Successful effects contain an error')
    check(row.checkpoint !== undefined, 'UNCONFIRMED', 'Transaction has no executed checkpoint')
    check(uint(row.checkpoint), 'EVIDENCE_MISMATCH', 'Invalid transaction checkpoint')
    const checkpoint = await checkpointEvidence(client, release.chainIdentifier, String(row.checkpoint), abort)
    check(checkpoint.epoch === e.executedEpoch, 'EVIDENCE_MISMATCH', 'Effects and checkpoint epoch mismatch')
    timestamp(row.timestamp, checkpoint.timestampMs)
    const transactionIndex = checkpoint.transactions.findIndex(entry => entry.transactionDigest === transactionDigest)
    check(transactionIndex >= 0 && checkpoint.transactions[transactionIndex].effectsDigest === effectsDigest,
      'EVIDENCE_MISMATCH', 'Transaction/effects not committed by checkpoint')
    check(row.effects.eventsDigest === (e.eventsDigest ?? undefined), 'EVIDENCE_MISMATCH', 'Effects event digest projection mismatch')
    let emitted: ReturnType<typeof EventsBcs.parse>['data'] = []
    if (e.eventsDigest !== null) {
      const rawEvents = bytes(row.events?.bcs?.value, MAX_EVENTS_BYTES, 'Transaction events')
      emitted = canonical(EventsBcs, rawEvents, 'transaction events').data
      const hash = typedDigest('TransactionEvents', rawEvents)
      check(emitted.length > 0 && row.events?.digest === hash && e.eventsDigest === hash, 'EVIDENCE_MISMATCH', 'Event digest mismatch')
    } else {
      check(row.events === undefined, 'EVIDENCE_MISMATCH', 'Uncommitted transaction events')
    }
    check(emitted.length <= MAX_EVENTS, 'BOUNDS_EXCEEDED', 'Event count bound exceeded')
    const origins = await packageOrigins(client, release, abort)
    const events = emitted.map((event, eventSequence): ActivityEventEvidence => {
      validateStruct(event.type_)
      check(id(event.package_id) && identifier(event.transaction_module) && event.sender === tx.sender,
        'EVIDENCE_MISMATCH', 'Invalid event header or transaction sender')
      if (event.type_.address === release.originalPackageId) {
        check(origins.get(`${event.type_.module}::${event.type_.name}`) === release.originalPackageId,
          'EVIDENCE_MISMATCH', 'Selected event type origin mismatch')
      }
      // No static command attribution: Publish/Upgrade init can call public
      // functions and emit selected events without any MoveCall command. Header
      // bytes are committed history, not an independently proven VM call trace.
      // Unrelated event types remain structural evidence only.
      return Object.freeze({ eventSequence, packageId: event.package_id, transactionModule: event.transaction_module,
        sender: event.sender, type: TypeTagSerializer.tagToString({ struct: event.type_ }), contentsBytes: toBase64(event.contents) })
    })
    abort.throwIfAborted()
    return Object.freeze({ ...TRUST, deployment: release, transactionDigest, sender: tx.sender, checkpoint: checkpoint.checkpoint,
      checkpointTimestampMs: checkpoint.timestampMs, epoch: checkpoint.epoch, transactionIndex,
      transactionBytes: toBase64(transactionBytes), effectsBytes: toBase64(effectsBytes), events: Object.freeze(events),
      eventAuthority: 'TYPE_ORIGIN_VERIFIED_HISTORY', executionPackageVersion: 'NOT_ATTESTED' })
  })
}
