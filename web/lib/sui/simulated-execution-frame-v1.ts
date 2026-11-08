import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, fromBase58, toBase64, toBase58, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { profileReadStep } from '@soulidity/sdk'
import { publicMutationCanonical } from './public-mutation-journal'
import { EpochCheckpointSummaryBcs, epochCheckpointDigest } from './epoch-checkpoint'
import { readMoveModuleIdentity } from './move-module-identity'
import { createHistoricalExecutionModelRegistryV1, type HistoricalExecutionModelInstallationV1, type HistoricalExecutionModelRegistryV1, type HistoricalTopMoveCallV1 } from './historical-execution-frame-v1'

type Effects = ReturnType<typeof bcs.TransactionEffects.parse>
type Ledger = SuiGrpcClient['ledgerService']
const hash = (bytes: Uint8Array) => toHex(sha256(bytes))
const effectsHash = (effects: Effects) => hash(bcs.TransactionEffects.serialize(effects).toBytes())
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`SIMULATED_EXECUTION_FRAME_V1_${code}`) }
const u64 = (v: unknown): v is bigint => typeof v === 'bigint' && v >= 0n && v <= 18446744073709551615n
const inside = (value: string, range: { first: string; last: string }) => BigInt(value) >= BigInt(range.first) && BigInt(value) <= BigInt(range.last)
const address = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v)
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,254}$/.test(v)
const registries = new WeakMap<object, HistoricalExecutionModelRegistryV1>()
export interface SimulatedExecutionModelRegistryV1 { readonly modelCount: number }
/** Same public execution-model documents, independently branded for simulation.
 * This factory does not install a first-party or mainnet source qualification. */
export function createSimulatedExecutionModelRegistryV1(entries: readonly HistoricalExecutionModelInstallationV1[]): SimulatedExecutionModelRegistryV1 {
  const models = createHistoricalExecutionModelRegistryV1(entries), registry = Object.freeze({ modelCount: models.length })
  registries.set(registry, models); return registry
}
interface Reader { readonly available: boolean }
const readers = new WeakMap<object, { getInfo?: Ledger['getServiceInfo']; getEpoch?: Ledger['getEpoch']; getCheckpoint?: Ledger['getCheckpoint']; signal: AbortSignal }>()
/** Invoke synchronously at the original operation boundary, before any await. */
export function captureSimulatedExecutionFrameReaderV1(input: { client: SuiGrpcClient; signal: AbortSignal }): Reader {
  const ledger = input.client.ledgerService
  let getInfo: Ledger['getServiceInfo'] | undefined, getEpoch: Ledger['getEpoch'] | undefined, getCheckpoint: Ledger['getCheckpoint'] | undefined
  try { const method = ledger.getServiceInfo; if (typeof method === 'function') getInfo = method.bind(ledger) } catch { /* unavailable optional capability */ }
  try { const method = ledger.getEpoch; if (typeof method === 'function') getEpoch = method.bind(ledger) } catch { /* unavailable optional capability */ }
  try { const method = ledger.getCheckpoint; if (typeof method === 'function') getCheckpoint = method.bind(ledger) } catch { /* unavailable optional capability */ }
  const port = { getInfo, getEpoch, getCheckpoint, signal: input.signal }
  const reader = Object.freeze({ available: Boolean(port.getInfo && port.getEpoch && port.getCheckpoint) })
  readers.set(reader, port); return reader
}
export interface SimulatedExecutionContextV1 { kind: 'SIMULATED'; genesisDigest: string; transactionBytes: string; transactionDigest: string }
export interface SimulationProtocolAnchorV1 {
  readonly epoch: string; readonly checkpoint: string; readonly checkpointDigest: string; readonly checkpointSummaryBytes: string
  readonly protocolVersion: string; readonly protocolConfigurationSha256: string
}
export interface QualifiedSimulatedEventFrameV1 {
  readonly status: 'QUALIFIED_SIMULATED_EVENT_FRAME'; readonly kind: 'SIMULATED'; readonly genesisDigest: string
  readonly transactionBytes: string; readonly transactionDigest: string; readonly effectsSha256: string
  readonly before: SimulationProtocolAnchorV1; readonly after: SimulationProtocolAnchorV1
  readonly commandIndex: number; readonly storagePackageId: string; readonly runtimePackageId: string | null
  readonly packageId: string; readonly module: string; readonly function: string; readonly sender: string
  readonly model: 'STORAGE_TOP_LEVEL_MOVE_CALL' | 'RUNTIME_TOP_LEVEL_MOVE_CALL'
  readonly modelManifestSha256: string; readonly modelAuditDocumentSha256: string
  readonly requiresQualifiedOriginalSource: true; readonly notFinalizedEvidence: true; readonly notSigningAuthority: true
}
export type SimulatedExecutionFrameObservationV1 = QualifiedSimulatedEventFrameV1 | {
  status: 'SIMULATION_MODEL_UNAVAILABLE'; reason: 'EXECUTION_MODEL_NOT_INSTALLED' | 'ANCHOR_READER_UNAVAILABLE' | 'ANCHOR_METADATA_UNAVAILABLE' | 'ANCHOR_READ_UNAVAILABLE' | 'UNSUPPORTED_EXECUTION_MODEL'
  transactionDigest: string; completeBusinessOutputVerified: false; notFinalizedEvidence: true; notSigningAuthority: true
}
const frames = new WeakSet<object>()
type Anchor = { public: SimulationProtocolAnchorV1; relocateEventModule?: boolean; explicit: boolean }
function configText(value: unknown): string {
  // SDK protocol attributes contain scalar oneofs; preserve every supplied field
  // while representing bigint values without JSON precision loss.
  return publicMutationCanonical(JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? { u64: String(entry) } : entry)))
}
/** Readonly simulation is bracketed by authenticated ledger metadata. The
 * checkpoints anchor the protocol model only: the simulated tx is NOT a member.
 * Existing raw transaction, gas, events and all-effects checks remain the caller's
 * responsibility and must run even when the model cannot be qualified. */
export async function observeSimulatedExecutionFrameV1<T>(input: {
  reader: Reader; registry: SimulatedExecutionModelRegistryV1; context: SimulatedExecutionContextV1; topCall: HistoricalTopMoveCallV1
  simulate: (signal: AbortSignal) => Promise<{ value: T; effects: Effects }>; scopedSignal?: AbortSignal
}): Promise<{ value: T; observation: SimulatedExecutionFrameObservationV1 }> {
  const port = readers.get(input.reader), models = registries.get(input.registry)
  check(port && models, 'READER_OR_MODEL_CAPABILITY')
  const context = structuredClone(input.context), top = structuredClone(input.topCall), simulate = input.simulate, scopedSignal = input.scopedSignal
  const signal = scopedSignal ? AbortSignal.any([port.signal, scopedSignal]) : port.signal
  check(context.kind === 'SIMULATED', 'SIMULATED_CONTEXT_REQUIRED'); signal.throwIfAborted()
  let genesisBytes: Uint8Array
  try { genesisBytes = fromBase58(context.genesisDigest) } catch { throw Error('SIMULATED_EXECUTION_FRAME_V1_GENESIS') }
  check(genesisBytes.length === 32 && toBase58(genesisBytes) === context.genesisDigest, 'GENESIS')
  check(context.transactionBytes.length > 0 && context.transactionBytes.length <= 2 * 1024 * 1024, 'TRANSACTION_BOUND')
  const bytes = fromBase64(context.transactionBytes)
  check(toBase64(bytes) === context.transactionBytes && TransactionDataBuilder.getDigestFromBytes(bytes) === context.transactionDigest, 'ORIGINAL_TRANSACTION')
  const data = Transaction.from(bytes).getData(), command = data.commands[top.commandIndex]?.MoveCall
  check(Number.isSafeInteger(top.commandIndex) && top.commandIndex >= 0 && address(data.sender) && address(top.packagePin.callablePackageId)
    && address(top.packagePin.originalPackageId) && identifier(top.module) && identifier(top.function)
    && command?.package === top.packagePin.callablePackageId && command.module === top.module && command.function === top.function, 'TOP_CALL_BINDING')
  const unavailable = (reason: Extract<SimulatedExecutionFrameObservationV1, { status: 'SIMULATION_MODEL_UNAVAILABLE' }>['reason']): SimulatedExecutionFrameObservationV1 =>
    ({ status: 'SIMULATION_MODEL_UNAVAILABLE', reason, transactionDigest: context.transactionDigest, completeBusinessOutputVerified: false, notFinalizedEvidence: true, notSigningAuthority: true })
  let reason: Extract<SimulatedExecutionFrameObservationV1, { status: 'SIMULATION_MODEL_UNAVAILABLE' }>['reason'] | undefined
  async function anchor(): Promise<Anchor | undefined> {
    if (!port!.getInfo || !port!.getEpoch || !port!.getCheckpoint) { reason = 'ANCHOR_READER_UNAVAILABLE'; return }
    let info: Awaited<ReturnType<Ledger['getServiceInfo']>>['response']
    try { info = (await profileReadStep(signal, () => port!.getInfo!({}, { abort: signal }))).response; info = structuredClone(info) }
    catch { signal.throwIfAborted(); reason = 'ANCHOR_READ_UNAVAILABLE'; return }
    check(info.chainId === context.genesisDigest, 'GENESIS')
    if (!u64(info.epoch) || !u64(info.checkpointHeight)) { reason = 'ANCHOR_METADATA_UNAVAILABLE'; return }
    let epoch: Awaited<ReturnType<Ledger['getEpoch']>>['response']['epoch'], checkpoint: Awaited<ReturnType<Ledger['getCheckpoint']>>['response']['checkpoint']
    try {
      epoch = (await profileReadStep(signal, () => port!.getEpoch!({ epoch: info.epoch, readMask: { paths: ['epoch', 'protocol_config'] } }, { abort: signal }))).response.epoch; epoch = structuredClone(epoch)
      checkpoint = (await profileReadStep(signal, () => port!.getCheckpoint!({ checkpointId: { oneofKind: 'sequenceNumber', sequenceNumber: info.checkpointHeight! }, readMask: { paths: ['sequence_number', 'digest', 'summary', 'signature'] } }, { abort: signal }))).response.checkpoint; checkpoint = structuredClone(checkpoint)
    } catch { signal.throwIfAborted(); reason = 'ANCHOR_READ_UNAVAILABLE'; return }
    signal.throwIfAborted()
    if (typeof epoch?.epoch !== 'bigint') { reason = 'ANCHOR_METADATA_UNAVAILABLE'; return }
    check(epoch.epoch === info.epoch, 'CURRENT_EPOCH')
    const config = epoch.protocolConfig, summary = checkpoint?.summary, raw = summary?.bcs?.value
    if (!config || !u64(config.protocolVersion) || !config.featureFlags || !raw || !checkpoint?.signature) { reason = 'ANCHOR_METADATA_UNAVAILABLE'; return }
    check(raw.length > 0 && raw.length <= 65536 && checkpoint.sequenceNumber === info.checkpointHeight
      && summary.epoch === info.epoch && summary.sequenceNumber === info.checkpointHeight && checkpoint.digest === summary.digest
      && checkpoint.signature.epoch === info.epoch && checkpoint.signature.signature?.length === 48 && checkpoint.signature.bitmap?.length, 'CHECKPOINT_PROJECTION')
    const decoded = EpochCheckpointSummaryBcs.parse(raw), encoded = toBase64(raw)
    check(toBase64(EpochCheckpointSummaryBcs.serialize(decoded).toBytes()) === encoded && epochCheckpointDigest(raw) === checkpoint.digest
      && decoded.epoch === String(info.epoch) && decoded.sequence_number === String(info.checkpointHeight), 'CHECKPOINT_BYTES')
    const text = configText(config); check(text.length <= 262144, 'PROTOCOL_CONFIG_BOUND')
    return { public: Object.freeze({ epoch: String(info.epoch), checkpoint: String(info.checkpointHeight), checkpointDigest: checkpoint.digest!, checkpointSummaryBytes: encoded,
      protocolVersion: String(config.protocolVersion), protocolConfigurationSha256: hash(new TextEncoder().encode(text)) }),
      explicit: Object.hasOwn(config.featureFlags, 'relocate_event_module'), relocateEventModule: config.featureFlags.relocate_event_module }
  }
  if (!models.length) reason = 'EXECUTION_MODEL_NOT_INSTALLED'
  const before = reason ? undefined : await anchor()
  const simulated = await profileReadStep(signal, () => simulate(signal))
  const effects = structuredClone(simulated.effects)
  check(effects.V2?.status.$kind === 'Success' && effects.V2.transactionDigest === context.transactionDigest, 'SIMULATION_EFFECTS')
  const after = before ? await anchor() : undefined
  signal.throwIfAborted()
  if (!before || !after) return { value: simulated.value, observation: unavailable(reason ?? 'ANCHOR_METADATA_UNAVAILABLE') }
  check(before.public.epoch === effects.V2.executedEpoch && after.public.epoch === before.public.epoch
    && before.public.protocolVersion === after.public.protocolVersion && before.public.protocolConfigurationSha256 === after.public.protocolConfigurationSha256
    && BigInt(after.public.checkpoint) >= BigInt(before.public.checkpoint), 'PROTOCOL_CHANGED_DURING_SIMULATION')
  const selected = models.find(row => row.manifest.genesisDigest === context.genesisDigest
    && [before, after].every(a => inside(a.public.checkpoint, row.manifest.checkpointRange) && inside(a.public.protocolVersion, row.manifest.protocolVersionRange)))
  if (!selected) return { value: simulated.value, observation: unavailable('UNSUPPORTED_EXECUTION_MODEL') }
  const expected = selected.manifest.relocateEventModule
  for (const a of [before, after]) {
    if (expected.presence === 'EXPLICIT' && !a.explicit) return { value: simulated.value, observation: unavailable('ANCHOR_METADATA_UNAVAILABLE') }
    check(a.explicit ? a.relocateEventModule === expected.value : expected.presence === 'AUDITED_ABSENT_FALSE' && !expected.value, 'PROTOCOL_MODEL_FLAG')
  }
  let runtimePackageId: string | null = null
  if (selected.manifest.model === 'RUNTIME_TOP_LEVEL_MOVE_CALL') {
    check(top.moduleBytes instanceof Uint8Array && top.moduleBytes.length <= 8 * 1024 * 1024 && hash(top.moduleBytes) === top.moduleSha256, 'RUNTIME_MODULE_SOURCE')
    const identity = readMoveModuleIdentity(top.moduleBytes)
    check(identity.self.address === top.packagePin.originalPackageId && identity.self.name === top.module, 'RUNTIME_MODULE_IDENTITY'); runtimePackageId = identity.self.address
  }
  const frame: QualifiedSimulatedEventFrameV1 = Object.freeze({ status: 'QUALIFIED_SIMULATED_EVENT_FRAME', kind: 'SIMULATED', genesisDigest: context.genesisDigest,
    transactionBytes: context.transactionBytes, transactionDigest: context.transactionDigest, effectsSha256: effectsHash(effects), before: before.public, after: after.public,
    commandIndex: top.commandIndex, storagePackageId: top.packagePin.callablePackageId, runtimePackageId,
    packageId: selected.manifest.model === 'STORAGE_TOP_LEVEL_MOVE_CALL' ? top.packagePin.callablePackageId : runtimePackageId!, module: top.module, function: top.function, sender: data.sender!,
    model: selected.manifest.model, modelManifestSha256: selected.manifestSha256, modelAuditDocumentSha256: selected.auditDocumentSha256,
    requiresQualifiedOriginalSource: true, notFinalizedEvidence: true, notSigningAuthority: true })
  frames.add(frame); return { value: simulated.value, observation: frame }
}
export function isQualifiedSimulatedEventFrameV1(value: SimulatedExecutionFrameObservationV1): value is QualifiedSimulatedEventFrameV1 {
  return value.status === 'QUALIFIED_SIMULATED_EVENT_FRAME' && frames.has(value)
}
export function assertSimulatedEventFrameV1(input: { frame: QualifiedSimulatedEventFrameV1; context: SimulatedExecutionContextV1 & { effects: Effects }; topCall: { commandIndex: number; packageId: string; module: string; function: string }; event: { package_id: string; transaction_module: string; sender: string } }) {
  const { frame, context, topCall, event } = input
  check(context.kind === 'SIMULATED' && frames.has(frame) && frame.genesisDigest === context.genesisDigest && frame.transactionBytes === context.transactionBytes
    && frame.transactionDigest === context.transactionDigest && frame.effectsSha256 === effectsHash(context.effects), 'FRAME_CONTEXT')
  check(frame.commandIndex === topCall.commandIndex && frame.storagePackageId === topCall.packageId && frame.module === topCall.module && frame.function === topCall.function, 'FRAME_TOP_CALL')
  check(event.package_id === frame.packageId && event.transaction_module === frame.module && event.sender === frame.sender, 'EVENT_ENVELOPE')
}
