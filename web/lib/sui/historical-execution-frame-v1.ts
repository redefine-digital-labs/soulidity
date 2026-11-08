import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64, toHex, fromBase58, toBase58 } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { profileReadStep } from '@soulidity/sdk'
import { publicMutationCanonical } from './public-mutation-journal'
import { readMoveModuleIdentity } from './move-module-identity'
import type { PinnedMovePackage } from './pinned-move-package'

type Effects = ReturnType<typeof bcs.TransactionEffects.parse>
type Model = 'STORAGE_TOP_LEVEL_MOVE_CALL' | 'RUNTIME_TOP_LEVEL_MOVE_CALL'
export interface HistoricalExecutionModelManifestV1 {
  schema: 'soulidity.historical-event-execution-model.v1'
  genesisDigest: string
  checkpointRange: { first: string; last: string }
  protocolVersionRange: { first: string; last: string }
  model: Model
  relocateEventModule: { presence: 'EXPLICIT' | 'AUDITED_ABSENT_FALSE'; value: boolean }
  executionSource: { revision: string; artifacts: Array<{ path: string; sha256: string }> }
}
export interface HistoricalExecutionModelInstallationV1 {
  manifestText: string; acceptedManifestSha256: string
  auditDocumentText: string; acceptedAuditDocumentSha256: string
}
export const HISTORICAL_EXECUTION_MODEL_ASSUMPTIONS_V1 = [
  'audited-execution-source-and-protocol-range', 'top-call-envelope-versus-datatype',
  'relocate-event-module-storage-runtime-semantics', 'historical-epoch-protocol-config',
] as const
const canonical = publicMutationCanonical
const hash = (text: string) => toHex(sha256(new TextEncoder().encode(text)))
const digest = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
const genesis = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 44) return false
  try { const bytes = fromBase58(value); return bytes.length === 32 && toBase58(bytes) === value } catch { return false }
}
const effectsHash = (effects: Effects) => toHex(sha256(bcs.TransactionEffects.serialize(effects).toBytes()))
const address = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v)
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,254}$/.test(v)
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`HISTORICAL_EXECUTION_FRAME_V1_${code}`) }
function keys(value: unknown, fields: string) {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === fields, 'SHAPE')
}
function uint(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n, 'U64')
}
function range(value: { first: string; last: string }) {
  keys(value, 'first,last'); uint(value.first); uint(value.last)
  check(BigInt(value.first) <= BigInt(value.last), 'RANGE')
}
function inside(value: string, bound: { first: string; last: string }) {
  return BigInt(value) >= BigInt(bound.first) && BigInt(value) <= BigInt(bound.last)
}
function overlap(a: { first: string; last: string }, b: { first: string; last: string }) {
  return BigInt(a.first) <= BigInt(b.last) && BigInt(b.first) <= BigInt(a.last)
}
export const historicalExecutionModelDocumentHashV1 = hash

/** Public canonical parsing is not source attestation or first-party installation. */
export function parseHistoricalExecutionModelV1(text: string): HistoricalExecutionModelManifestV1 {
  check(typeof text === 'string' && text.length > 0 && text.length <= 65536, 'DOCUMENT_BOUND')
  const m = JSON.parse(text) as HistoricalExecutionModelManifestV1
  check(canonical(m) === text, 'NONCANONICAL_DOCUMENT')
  keys(m, 'checkpointRange,executionSource,genesisDigest,model,protocolVersionRange,relocateEventModule,schema')
  check(m.schema === 'soulidity.historical-event-execution-model.v1' && genesis(m.genesisDigest), 'DOMAIN')
  range(m.checkpointRange); range(m.protocolVersionRange)
  check(m.model === 'STORAGE_TOP_LEVEL_MOVE_CALL' || m.model === 'RUNTIME_TOP_LEVEL_MOVE_CALL', 'MODEL')
  keys(m.relocateEventModule, 'presence,value')
  check(['EXPLICIT', 'AUDITED_ABSENT_FALSE'].includes(m.relocateEventModule.presence)
    && typeof m.relocateEventModule.value === 'boolean'
    && m.relocateEventModule.value === (m.model === 'STORAGE_TOP_LEVEL_MOVE_CALL')
    && (m.relocateEventModule.presence !== 'AUDITED_ABSENT_FALSE' || !m.relocateEventModule.value), 'MODEL_FLAG')
  keys(m.executionSource, 'artifacts,revision')
  check(typeof m.executionSource.revision === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(m.executionSource.revision)
    && Array.isArray(m.executionSource.artifacts) && m.executionSource.artifacts.length > 0 && m.executionSource.artifacts.length <= 64, 'SOURCE')
  const seen = new Set<string>()
  for (const artifact of m.executionSource.artifacts) {
    keys(artifact, 'path,sha256')
    check(typeof artifact.path === 'string' && artifact.path.length > 0 && artifact.path.length <= 1024
      && !artifact.path.startsWith('/') && !artifact.path.split('/').includes('..') && !seen.has(artifact.path) && digest(artifact.sha256), 'SOURCE_ARTIFACT')
    seen.add(artifact.path)
  }
  return m
}

interface Installed { readonly manifest: HistoricalExecutionModelManifestV1; readonly manifestSha256: string; readonly auditDocumentSha256: string }
const installedModels = new WeakSet<object>()
/** Explicit registries are reusable protocol trust inputs. The caller must
 * state its trust registry. This factory never modifies a first-party catalog. */
export function createHistoricalExecutionModelRegistryV1(entries: readonly HistoricalExecutionModelInstallationV1[]) {
  check(Array.isArray(entries) && entries.length <= 32, 'CATALOG_BOUND')
  const result: Installed[] = entries.map(supplied => {
    const entry = structuredClone(supplied)
    keys(entry, 'acceptedAuditDocumentSha256,acceptedManifestSha256,auditDocumentText,manifestText')
    check(digest(entry.acceptedManifestSha256) && digest(entry.acceptedAuditDocumentSha256)
      && hash(entry.manifestText) === entry.acceptedManifestSha256 && typeof entry.auditDocumentText === 'string'
      && entry.auditDocumentText.length > 0 && entry.auditDocumentText.length <= 65536
      && hash(entry.auditDocumentText) === entry.acceptedAuditDocumentSha256, 'ACCEPTED_DOCUMENT')
    const manifest = parseHistoricalExecutionModelV1(entry.manifestText), audit = JSON.parse(entry.auditDocumentText)
    check(canonical(audit) === entry.auditDocumentText, 'NONCANONICAL_AUDIT')
    keys(audit, 'assumptions,evidence,manifestSha256,schema')
    check(audit.schema === 'soulidity.historical-event-execution-model-audit.v1'
      && audit.manifestSha256 === entry.acceptedManifestSha256
      && canonical(audit.assumptions) === canonical(HISTORICAL_EXECUTION_MODEL_ASSUMPTIONS_V1), 'AUDIT')
    keys(audit.evidence, [...HISTORICAL_EXECUTION_MODEL_ASSUMPTIONS_V1].sort().join(','))
    check(Object.values(audit.evidence).every(digest), 'AUDIT_EVIDENCE')
    const installed = Object.freeze({ manifest: freeze(manifest), manifestSha256: entry.acceptedManifestSha256, auditDocumentSha256: entry.acceptedAuditDocumentSha256 })
    installedModels.add(installed); return installed
  })
  for (let i = 0; i < result.length; i++) for (let j = 0; j < i; j++) {
    const a = result[i].manifest, b = result[j].manifest
    check(a.genesisDigest !== b.genesisDigest || !overlap(a.checkpointRange, b.checkpointRange) || !overlap(a.protocolVersionRange, b.protocolVersionRange), 'AMBIGUOUS_MODEL')
  }
  return Object.freeze(result)
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const row of Object.values(value)) freeze(row); Object.freeze(value) }
  return value
}
export type HistoricalExecutionModelRegistryV1 = ReturnType<typeof createHistoricalExecutionModelRegistryV1>
interface Reader { readonly available: boolean }
type GetEpoch = SuiGrpcClient['ledgerService']['getEpoch']
type GetInfo = SuiGrpcClient['ledgerService']['getServiceInfo']
const readers = new WeakMap<object, { getEpoch?: GetEpoch; getInfo?: GetInfo; signal: AbortSignal }>()
/** Capture before any original query await; later mutations cannot replace
 * services, methods, receivers or the original cancellation signal. */
export function captureHistoricalExecutionFrameReaderV1(input: { client: SuiGrpcClient; signal: AbortSignal }): Reader {
  const ledger = input.client.ledgerService
  // Optional adapter capabilities may be absent, nonfunctions, or throwing
  // getters. Their absence must not prevent the original raw query/export.
  let getEpoch: GetEpoch | undefined, getInfo: GetInfo | undefined
  try { const method = ledger.getEpoch as GetEpoch | undefined; if (typeof method === 'function') getEpoch = method.bind(ledger) } catch { /* unavailable optional capability */ }
  try { const method = ledger.getServiceInfo as GetInfo | undefined; if (typeof method === 'function') getInfo = method.bind(ledger) } catch { /* unavailable optional capability */ }
  const reader = Object.freeze({ available: Boolean(getEpoch && getInfo) })
  readers.set(reader, { getEpoch, getInfo, signal: input.signal }); return reader
}
export interface HistoricalExecutionContextV1 { kind: 'HISTORICAL_FINALIZED'; genesisDigest: string; transactionBytes: string; transactionDigest: string; effects: Effects; checkpoint: string }
export interface HistoricalTopMoveCallV1 {
  commandIndex: number; packagePin: PinnedMovePackage; module: string; function: string
  /** For RUNTIME, actual pinned module bytes and their accepted source hash. */
  moduleBytes?: Uint8Array; moduleSha256?: string
}
export interface QualifiedHistoricalEventFrameV1 {
  readonly status: 'QUALIFIED_EVENT_FRAME'; readonly transactionDigest: string; readonly transactionBytes: string
  readonly checkpoint: string; readonly genesisDigest: string; readonly effectsSha256: string; readonly epoch: string; readonly protocolVersion: string
  readonly commandIndex: number; readonly storagePackageId: string; readonly runtimePackageId: string | null
  readonly module: string; readonly function: string; readonly sender: string; readonly packageId: string
  readonly model: Model; readonly modelManifestSha256: string; readonly modelAuditDocumentSha256: string
  readonly requiresQualifiedOriginalSource: true
}
const qualifiedFrames = new WeakSet<object>()
export type HistoricalExecutionFrameObservationV1 = QualifiedHistoricalEventFrameV1 | {
  status: 'EXECUTION_MODEL_UNQUALIFIED'; reason: 'EXECUTION_MODEL_NOT_INSTALLED' | 'EPOCH_READER_UNAVAILABLE' | 'PROTOCOL_CONFIG_UNAVAILABLE' | 'EPOCH_METADATA_UNAVAILABLE' | 'UNSUPPORTED_EXECUTION_MODEL' | 'EPOCH_READ_UNAVAILABLE'
  transactionDigest: string; checkpoint: string; epoch: string; completeBusinessOutputVerified: false
}
export async function observeHistoricalExecutionFrameV1(input: {
  reader: Reader; registry: HistoricalExecutionModelRegistryV1; context: HistoricalExecutionContextV1; topCall: HistoricalTopMoveCallV1
  /** A worker may narrow cancellation, never replace the captured original. */
  scopedSignal?: AbortSignal
}): Promise<HistoricalExecutionFrameObservationV1> {
  const port = readers.get(input.reader); check(port, 'READER_CAPABILITY')
  const scopedSignal = input.scopedSignal
  const signal = scopedSignal ? AbortSignal.any([port.signal, scopedSignal]) : port.signal
  const context = structuredClone(input.context), top = structuredClone(input.topCall), registry = [...input.registry]
  check(context.kind === 'HISTORICAL_FINALIZED', 'HISTORICAL_CONTEXT_REQUIRED')
  signal.throwIfAborted()
  check(genesis(context.genesisDigest), 'EXPECTED_GENESIS')
  check(context.effects.V2?.status.$kind === 'Success' && context.effects.V2.transactionDigest === context.transactionDigest, 'ORIGINAL_SUCCESS')
  uint(context.checkpoint); uint(context.effects.V2.executedEpoch)
  const epoch = context.effects.V2.executedEpoch
  check(toBase64(fromBase64(context.transactionBytes)) === context.transactionBytes
    && TransactionDataBuilder.getDigestFromBytes(fromBase64(context.transactionBytes)) === context.transactionDigest, 'ORIGINAL_TRANSACTION')
  const data = Transaction.from(fromBase64(context.transactionBytes)).getData(), command = data.commands[top.commandIndex]?.MoveCall
  check(Number.isSafeInteger(top.commandIndex) && top.commandIndex >= 0 && address(top.packagePin.callablePackageId)
    && address(top.packagePin.originalPackageId) && identifier(top.module) && identifier(top.function)
    && command?.package === top.packagePin.callablePackageId && command.module === top.module && command.function === top.function
    && address(data.sender), 'TOP_CALL_BINDING')
  const partial = (reason: Extract<HistoricalExecutionFrameObservationV1, { status: 'EXECUTION_MODEL_UNQUALIFIED' }>['reason']): HistoricalExecutionFrameObservationV1 =>
    ({ status: 'EXECUTION_MODEL_UNQUALIFIED', reason, transactionDigest: context.transactionDigest, checkpoint: context.checkpoint, epoch, completeBusinessOutputVerified: false })
  if (!registry.length) return partial('EXECUTION_MODEL_NOT_INSTALLED')
  check(registry.every(row => installedModels.has(row)), 'MODEL_CAPABILITY')
  if (!port.getEpoch || !port.getInfo) return partial('EPOCH_READER_UNAVAILABLE')
  let chain: string | undefined, response: Awaited<ReturnType<GetEpoch>>['response']
  try { chain = (await profileReadStep(signal, () => port.getInfo!({}, { abort: signal }))).response.chainId }
  catch (error) { signal.throwIfAborted(); return partial('EPOCH_READ_UNAVAILABLE') }
  signal.throwIfAborted(); check(chain === context.genesisDigest, 'GENESIS')
  try {
    response = (await profileReadStep(signal, () => port.getEpoch!({ epoch: BigInt(epoch), readMask: { paths: ['epoch', 'protocol_config'] } }, { abort: signal }))).response
    signal.throwIfAborted()
  } catch (error) { signal.throwIfAborted(); return partial('EPOCH_READ_UNAVAILABLE') }
  if (typeof response.epoch?.epoch !== 'bigint') return partial('EPOCH_METADATA_UNAVAILABLE')
  check(response.epoch.epoch === BigInt(epoch), 'ORIGINAL_EPOCH')
  const config = response.epoch.protocolConfig, version = config?.protocolVersion
  if (typeof version !== 'bigint' || version < 0n || version > 18446744073709551615n || !config) return partial('PROTOCOL_CONFIG_UNAVAILABLE')
  const selected = registry.find(row => row.manifest.genesisDigest === chain && inside(context.checkpoint, row.manifest.checkpointRange) && inside(String(version), row.manifest.protocolVersionRange))
  if (!selected) return partial('UNSUPPORTED_EXECUTION_MODEL')
  const flags = config.featureFlags
  if (!flags || typeof flags !== 'object') return partial('PROTOCOL_CONFIG_UNAVAILABLE')
  const explicit = Object.hasOwn(flags, 'relocate_event_module'), expected = selected.manifest.relocateEventModule
  if (expected.presence === 'EXPLICIT' && !explicit) return partial('PROTOCOL_CONFIG_UNAVAILABLE')
  check(explicit ? flags.relocate_event_module === expected.value : expected.presence === 'AUDITED_ABSENT_FALSE' && !expected.value, 'PROTOCOL_MODEL_FLAG')
  let runtimePackageId: string | null = null
  if (selected.manifest.model === 'RUNTIME_TOP_LEVEL_MOVE_CALL') {
    check(top.moduleBytes instanceof Uint8Array && digest(top.moduleSha256) && toHex(sha256(top.moduleBytes)) === top.moduleSha256, 'RUNTIME_MODULE_SOURCE')
    const identity = readMoveModuleIdentity(top.moduleBytes)
    check(identity.self.name === top.module && identity.self.address === top.packagePin.originalPackageId, 'RUNTIME_MODULE_IDENTITY')
    runtimePackageId = identity.self.address
  }
  signal.throwIfAborted()
  const frame: QualifiedHistoricalEventFrameV1 = Object.freeze({ status: 'QUALIFIED_EVENT_FRAME', transactionDigest: context.transactionDigest,
    transactionBytes: context.transactionBytes, genesisDigest: context.genesisDigest, effectsSha256: effectsHash(context.effects), checkpoint: context.checkpoint, epoch, protocolVersion: String(version), commandIndex: top.commandIndex,
    storagePackageId: top.packagePin.callablePackageId, runtimePackageId, module: top.module, function: top.function, sender: data.sender!,
    packageId: selected.manifest.model === 'STORAGE_TOP_LEVEL_MOVE_CALL' ? top.packagePin.callablePackageId : runtimePackageId!,
    model: selected.manifest.model, modelManifestSha256: selected.manifestSha256, modelAuditDocumentSha256: selected.auditDocumentSha256,
    requiresQualifiedOriginalSource: true })
  qualifiedFrames.add(frame); return frame
}
export function isQualifiedHistoricalEventFrameV1(value: HistoricalExecutionFrameObservationV1): value is QualifiedHistoricalEventFrameV1 {
  return value.status === 'QUALIFIED_EVENT_FRAME' && qualifiedFrames.has(value)
}
export function assertHistoricalEventFrameV1(input: {
  frame: QualifiedHistoricalEventFrameV1; context: HistoricalExecutionContextV1
  event: { package_id: string; transaction_module: string; sender: string }
  topCall?: { commandIndex: number; packageId: string; module: string; function: string }
}) {
  const { frame, context, event, topCall } = input
  check(context.kind === 'HISTORICAL_FINALIZED', 'HISTORICAL_CONTEXT_REQUIRED')
  check(qualifiedFrames.has(frame) && frame.transactionBytes === context.transactionBytes && frame.transactionDigest === context.transactionDigest
    && frame.checkpoint === context.checkpoint && frame.genesisDigest === context.genesisDigest && frame.effectsSha256 === effectsHash(context.effects), 'FRAME_CONTEXT')
  if (topCall) check(frame.commandIndex === topCall.commandIndex && frame.storagePackageId === topCall.packageId && frame.module === topCall.module && frame.function === topCall.function, 'FRAME_TOP_CALL')
  check(event.package_id === frame.packageId && event.transaction_module === frame.module && event.sender === frame.sender, 'EVENT_ENVELOPE')
}
