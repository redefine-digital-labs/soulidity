import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase58, fromBase64, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { buildDeleteContentVersionAsOwnerTx, buildDeleteContentVersionAsGrantedAgentTx,
  buildPurgeContentVersionAsOwnerTx, buildSetActiveContentTx, buildClearActiveContentTx, profileReadStep,
  SoulContentSlotPublicBcs, SoulContentPublicBcs, SoulStatePublicBcs, SoulContentKeyPublicBcs, SoulDetailStateBcs } from '@soulidity/sdk'
import { readHistoricalMoveObject } from '../sui/historical-object'
import type { BrowserContentWriteState } from './browser-content-write-state'

type Selection = { name: string; versionIndex: string }
export interface ContentMutationPlan {
  deployment: { chainIdentifier: string; originalPackageId: string; callablePackageId: string; marketConfigId: string; kindRegistryId: string }
  soulId: string; stateId: string; contentId: string; author: string; ownershipEpoch: string
  kind: number; action: 'delete' | 'purge' | 'set-active' | 'clear-active'
  target: Selection | null; expectedActive: Selection | null; grantId: string | null
  /** Canonical public slot BCS, never content plaintext or an encryption key. */
  expectedSlot: string | null
}
export interface ContentMutationRecord {
  schema: 'soulidity.content-mutation.v1'; plan: ContentMutationPlan
  packet: { bytes: string; digest: string; expirationEpoch: string
    phase: 'PREPARED' | 'SIGNING' | 'SIGNED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; signature: string | null }
}
export interface ContentMutationQuery {
  status: 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'; checkpoint?: string; contentVersion?: string
}
const MAX = 18446744073709551615n, CLOCK = `0x${'0'.repeat(63)}6`
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
function check(v: unknown, code: string): asserts v { if (!v) throw new Error(`CONTENT_MUTATION_${code}`) }
function exact(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length
    && keys.every(key => Object.hasOwn(v, key)), 'INVALID_FIELDS')
}
function id(v: unknown): asserts v is string { check(typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v), 'INVALID_ID') }
function uint(v: unknown, positive = false): asserts v is string {
  check(typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= MAX && (!positive || BigInt(v) > 0n), 'INVALID_U64')
}
function digest(v: unknown): asserts v is string {
  check(typeof v === 'string' && v.length <= 44 && fromBase58(v).length === 32 && toBase58(fromBase58(v)) === v, 'INVALID_DIGEST')
}
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
function decode<C extends Codec>(codec: C, bytes: Uint8Array): ReturnType<C['parse']> {
  const value = codec.parse(bytes)
  check(toBase64(codec.serialize(value).toBytes()) === toBase64(bytes), 'NONCANONICAL_BCS'); return value
}
function selection(v: unknown, kind: number) {
  exact(v, ['name', 'versionIndex']); uint(v.versionIndex)
  check(typeof v.name === 'string' && /^[a-z0-9_-]{1,32}$/.test(v.name)
    && (kind !== 0 || v.name === 'soul') && (kind !== 1 || v.name === 'default'), 'INVALID_NAME')
}
export function parseContentMutationPlan(input: unknown): ContentMutationPlan {
  const p = structuredClone(input) as ContentMutationPlan
  exact(p, ['deployment', 'soulId', 'stateId', 'contentId', 'author', 'ownershipEpoch', 'kind', 'action', 'target', 'expectedActive', 'grantId', 'expectedSlot'])
  exact(p.deployment, ['chainIdentifier', 'originalPackageId', 'callablePackageId', 'marketConfigId', 'kindRegistryId'])
  const d = p.deployment
  check(typeof d.chainIdentifier === 'string' && /^[0-9a-f]{8}$/.test(d.chainIdentifier), 'INVALID_CHAIN')
  ;[d.originalPackageId, d.callablePackageId, d.marketConfigId, d.kindRegistryId, p.soulId, p.stateId, p.contentId, p.author].forEach(id)
  uint(p.ownershipEpoch)
  check(Number.isInteger(p.kind) && p.kind >= 0 && p.kind <= 0xffff_ffff
    && ['delete', 'purge', 'set-active', 'clear-active'].includes(p.action), 'INVALID_ACTION')
  const roots = [p.soulId, p.stateId, p.contentId, d.marketConfigId, d.kindRegistryId, CLOCK]
  check(new Set(roots).size === roots.length && !roots.includes(d.originalPackageId) && !roots.includes(d.callablePackageId), 'OBJECT_ALIAS')
  if (p.expectedActive !== null) selection(p.expectedActive, p.kind)
  if (p.grantId !== null) { id(p.grantId); check(p.action === 'delete' && !roots.includes(p.grantId)
    && p.grantId !== d.originalPackageId && p.grantId !== d.callablePackageId, 'GRANT_ROLE_INVALID') }
  if (p.action === 'clear-active') check(p.target === null && p.expectedSlot === null && p.expectedActive !== null, 'CLEAR_REQUIRES_ACTIVE')
  else {
    selection(p.target, p.kind)
    check(typeof p.expectedSlot === 'string' && p.expectedSlot.length <= 1024 && p.expectedSlot.length > 0, 'SLOT_REQUIRED')
    const bytes = fromBase64(p.expectedSlot), slot = decode(SoulContentSlotPublicBcs, bytes)
    check(toBase64(bytes) === p.expectedSlot && slot.version === '1' && slot.kind === p.kind && !slot.purged
      && slot.deleted === (p.action === 'purge') && slot.seal_encrypted, 'SLOT_STATE_INVALID')
    id(slot.blob_object_id); check(!roots.includes(slot.blob_object_id) && slot.blob_object_id !== p.grantId, 'BLOB_ROLE_ALIAS')
    check((BigInt(slot.op_mask) & (p.action === 'delete' ? 2n : p.action === 'purge' ? 4n : 8n)) !== 0n, 'SLOT_OPERATION_NOT_ALLOWED')
    check(p.action === 'purge' || !same(p.target, p.expectedActive), p.action === 'delete' ? 'DELETE_ACTIVE_FORBIDDEN' : 'ALREADY_ACTIVE')
  }
  return p
}
export function contentMutationKey(input: ContentMutationPlan) {
  const p = parseContentMutationPlan(input), d = p.deployment
  return `soulidity.content-mutation:${d.chainIdentifier}:${d.originalPackageId}:${d.callablePackageId}:${d.marketConfigId}:${d.kindRegistryId}:${p.soulId}:${p.author}`
}
export function buildContentMutationTransaction(input: ContentMutationPlan) {
  const p = parseContentMutationPlan(input), d = { packageId: p.deployment.callablePackageId, marketConfigId: p.deployment.marketConfigId }
  const common = { contentObjectId: p.contentId, stateObjectId: p.stateId, kindRegistryObjectId: p.deployment.kindRegistryId,
    kind: p.kind, expectedOwnershipEpoch: p.ownershipEpoch, expectedActive: p.expectedActive }
  if (p.action === 'clear-active') return buildClearActiveContentTx(common, d)
  const target = { ...common, ...p.target! }
  if (p.action === 'set-active') return buildSetActiveContentTx(target, d)
  if (p.action === 'purge') return buildPurgeContentVersionAsOwnerTx(target, d)
  return p.grantId ? buildDeleteContentVersionAsGrantedAgentTx({ ...target, soulGrantObjectId: p.grantId }, d)
    : buildDeleteContentVersionAsOwnerTx(target, d)
}

/** Exact command graph + pure args + object roles; no RPC resolution of saved
 * bytes. Assertions are part of the signed template, not replaceable preflight. */
export function parseContentMutationRecord(input: unknown): ContentMutationRecord {
  const r = structuredClone(input) as ContentMutationRecord
  exact(r, ['schema', 'plan', 'packet']); check(r.schema === 'soulidity.content-mutation.v1', 'INVALID_SCHEMA')
  r.plan = parseContentMutationPlan(r.plan)
  const p = r.plan, packet = r.packet
  exact(packet, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature']); uint(packet.expirationEpoch); digest(packet.digest)
  check(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(packet.phase), 'INVALID_PHASE')
  check(packet.signature === null || typeof packet.signature === 'string' && packet.signature.length > 0
    && packet.signature.length <= 32768 && toBase64(fromBase64(packet.signature)) === packet.signature, 'INVALID_SIGNATURE')
  check(packet.phase !== 'SIGNED' || packet.signature !== null, 'SIGNATURE_REQUIRED')
  check(!['PREPARED', 'SIGNING', 'CANCELLED'].includes(packet.phase) || packet.signature === null, 'UNEXPECTED_SIGNATURE')
  check(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 180000, 'BYTE_BUDGET')
  const bytes = fromBase64(packet.bytes), raw = decode(bcs.TransactionData, bytes), data = Transaction.from(bytes).getData()
  check(toBase64(bytes) === packet.bytes && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest, 'DIGEST_MISMATCH')
  check(raw.V1 && data.sender === p.author && data.gasData.owner === p.author
    && String(raw.V1.expiration.Epoch) === packet.expirationEpoch, 'SENDER_EXPIRATION_MISMATCH')
  uint(data.gasData.budget, true); uint(data.gasData.price, true)
  const expected = buildContentMutationTransaction(p).getData()
  const commands = (rows: typeof data.commands) => rows.map(row => {
    check(row.MoveCall && row.MoveCall.typeArguments.length === 0, 'TEMPLATE_MISMATCH')
    const call = row.MoveCall
    return { package: call.package, module: call.module, function: call.function, arguments: call.arguments.map(arg => {
      check(arg.$kind === 'Input', 'TEMPLATE_MISMATCH'); return arg.Input
    }) }
  })
  check(same(commands(data.commands), commands(expected.commands)) && data.inputs.length === expected.inputs.length, 'TEMPLATE_MISMATCH')
  const objects = new Set<string>([p.soulId, p.deployment.originalPackageId, p.deployment.callablePackageId, CLOCK,
    ...(p.expectedSlot ? [SoulContentSlotPublicBcs.fromBase64(p.expectedSlot).blob_object_id] : [])])
  expected.inputs.forEach((wanted, i) => {
    const actual = data.inputs[i]
    if (wanted.Pure) { check(actual?.Pure?.bytes === wanted.Pure.bytes, 'PURE_ARGUMENT_MISMATCH'); return }
    const objectId = wanted.UnresolvedObject?.objectId
    check(objectId, 'UNEXPECTED_TEMPLATE_INPUT'); objects.add(objectId)
    if (objectId === p.grantId) {
      const owned = actual.Object?.ImmOrOwnedObject
      check(owned?.objectId === objectId, 'GRANT_REFERENCE_MISMATCH'); uint(owned.version, true); digest(owned.digest)
    } else {
      const shared = actual.Object?.SharedObject
      check(shared?.objectId === objectId && shared.mutable === (objectId === p.contentId), 'SHARED_REFERENCE_MISMATCH')
      uint(shared.initialSharedVersion, true)
    }
  })
  const payments = data.gasData.payment
  check(payments && payments.length > 0 && payments.length <= 256 && new Set(payments.map(row => row.objectId)).size === payments.length, 'GAS_REQUIRED')
  payments.forEach(row => { id(row.objectId); uint(row.version, true); digest(row.digest); check(!objects.has(row.objectId), 'GAS_OVERLAP') })
  return r
}

export function assertContentMutationAuthority(input: ContentMutationPlan, proof: BrowserContentWriteState) {
  const p = parseContentMutationPlan(input), s = proof.snapshot, d = p.deployment
  check(proof.soulId === p.soulId && proof.stateId === p.stateId && proof.contentId === p.contentId
    && proof.originalPackageId === d.originalPackageId && proof.callablePackageId === d.callablePackageId
    && proof.kindRegistryId === d.kindRegistryId && s.ownershipEpoch === p.ownershipEpoch, 'SCOPE_CHANGED')
  const active = s.activeBindings.find(row => row.kind === p.kind)
  check(same(active ? { name: active.name, versionIndex: active.version_index } : null, p.expectedActive), 'ACTIVE_CHANGED')
  const descriptor = s.kindDescriptors.find(row => row.kind === p.kind)
  check(descriptor, 'KIND_UNAVAILABLE')
  if (p.target) {
    const target = s.contentVersions.find(row => row.kind === p.kind && row.name === p.target!.name && row.versionIndex === p.target!.versionIndex)
    check(target && SoulContentSlotPublicBcs.serialize(target.slot).toBase64() === p.expectedSlot, 'TARGET_CHANGED')
  }
  if (p.action === 'set-active' || p.action === 'clear-active') check(descriptor.has_active_binding && (BigInt(descriptor.op_mask) & 8n) !== 0n, 'ACTIVE_NOT_SUPPORTED')
  // Deprecation stops new append, not management of existing cached slots.
  if (p.grantId === null) check(s.currentOwner === p.author, 'OWNER_CHANGED')
  else {
    const slot = SoulContentSlotPublicBcs.fromBase64(p.expectedSlot!), scope = BigInt(slot.grant_scope_mask)
    const grant = s.grants.find(row => row.slot.grant_id === p.grantId && row.slot.grantee === p.author)
    check(scope > 0n && grant?.currentEpoch && grant.unexpiredAtObservation && grant.grant
      && (BigInt(grant.slot.scope_mask) & scope) === scope, 'GRANT_INVALID')
  }
}

/** Observation only, separate from original completion and never authorization
 * to replay. A later purge/selection/transfer does not invalidate the receipt. */
export function observeContentMutation(input: ContentMutationPlan, proof: BrowserContentWriteState) {
  const p = parseContentMutationPlan(input), s = proof.snapshot
  check(proof.soulId === p.soulId && proof.stateId === p.stateId && proof.contentId === p.contentId
    && proof.originalPackageId === p.deployment.originalPackageId, 'OBSERVATION_ROOT_MISMATCH')
  if (s.ownershipEpoch !== p.ownershipEpoch || p.grantId === null && s.currentOwner !== p.author) return 'OWNER_EPOCH_CHANGED' as const
  const active = s.activeBindings.find(row => row.kind === p.kind)
  if (p.action === 'clear-active') return active ? 'LATER_CONTENT_CHANGED' as const : 'STILL_APPLIED' as const
  if (p.action === 'set-active') return active && active.name === p.target!.name && active.version_index === p.target!.versionIndex
    ? 'STILL_APPLIED' as const : 'LATER_CONTENT_CHANGED' as const
  const slot = s.contentVersions.find(row => row.kind === p.kind && row.name === p.target!.name && row.versionIndex === p.target!.versionIndex)?.slot
  const expected = { ...SoulContentSlotPublicBcs.fromBase64(p.expectedSlot!), deleted: true, purged: p.action === 'purge' }
  return slot && SoulContentSlotPublicBcs.serialize(slot).toBase64() === SoulContentSlotPublicBcs.serialize(expected).toBase64()
    ? 'STILL_APPLIED' as const : 'LATER_CONTENT_CHANGED' as const
}

async function historicalOutputs(r: ContentMutationRecord, effects: ReturnType<typeof bcs.TransactionEffects.parse>, client: SuiGrpcClient, signal: AbortSignal) {
  const p = r.plan, pkg = p.deployment.originalPackageId
  const read = (objectId: string, type: string, mode: 'created' | 'mutated' | 'written' | 'readonly' = 'written') =>
    readHistoricalMoveObject({ client, signal, effects, transactionDigest: r.packet.digest, objectId, type, mode })
  const shared = async <C extends Codec>(objectId: string, type: string, codec: C, mode: 'mutated' | 'readonly') => {
    const result = await read(objectId, type, mode)
    const inputs = Transaction.from(fromBase64(r.packet.bytes)).getData().inputs
      .flatMap(row => row.Object?.SharedObject?.objectId === objectId ? [row.Object.SharedObject] : [])
    check(inputs.length === 1 && result.reference.owner.Shared?.initialSharedVersion === inputs[0].initialSharedVersion
      && result.reference.inputOwner?.Shared?.initialSharedVersion === inputs[0].initialSharedVersion, 'HISTORICAL_SHARED_MISMATCH')
    return { ...result, value: decode(codec, result.bytes) }
  }
  const state = await shared(p.stateId, `${pkg}::soul::SoulState`, SoulStatePublicBcs, 'readonly')
  const content = await shared(p.contentId, `${pkg}::content::SoulContent`, SoulContentPublicBcs, 'mutated')
  check(state.value.version === '1' && state.value.id === p.stateId && state.value.soul_id === p.soulId
    && state.value.content_id === p.contentId && state.value.ownership_epoch === p.ownershipEpoch
    && (p.grantId !== null || state.value.current_owner === p.author), 'HISTORICAL_STATE_MISMATCH')
  check(content.value.version === '1' && content.value.id === p.contentId && content.value.soul_id === p.soulId, 'HISTORICAL_CONTENT_MISMATCH')
  const field = async <K extends Codec, C extends Codec>(parent: string, keyType: string, keyCodec: K, key: any, type: string, codec: C, mode: 'created' | 'written' | 'mutated') => {
    const keyBytes = keyCodec.serialize(key).toBytes(), objectId = deriveDynamicFieldID(parent, keyType, keyBytes)
    const result = await read(objectId, `0x2::dynamic_field::Field<${keyType},${type}>`, mode)
    check(result.reference.owner.ObjectOwner === parent && (result.reference.created || result.reference.inputOwner?.ObjectOwner === parent), 'HISTORICAL_FIELD_OWNER')
    const row = decode(bcs.struct('Field', { id: bcs.Address, name: keyCodec as any, value: codec as any }), result.bytes)
    check(row.id === objectId && toBase64(keyCodec.serialize(row.name).toBytes()) === toBase64(keyBytes), 'HISTORICAL_FIELD_KEY')
    return row.value as ReturnType<C['parse']>
  }
  function deleted(objectId: string, parent: string) {
    const e = effects.V2!, rows = e.changedObjects.filter(([id]) => id === objectId), change = rows[0]?.[1]
    check(rows.length === 1 && !e.unchangedConsensusObjects.some(([id]) => id === objectId)
      && change.idOperation.$kind === 'Deleted' && change.outputState.$kind === 'NotExist'
      && change.inputState.Exist?.[1].ObjectOwner === parent, 'HISTORICAL_DELETION_MISMATCH')
    const ref = change.inputState.Exist![0]; uint(ref[0], true); digest(ref[1])
    check(BigInt(ref[0]) < BigInt(e.lamportVersion), 'HISTORICAL_DELETION_LINEAGE')
  }
  if (p.action === 'delete' || p.action === 'purge') {
    const slots = await field(content.value.items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs,
      { kind: p.kind, name: p.target!.name }, `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs), 'mutated')
    check(BigInt(p.target!.versionIndex) < BigInt(slots.length), 'HISTORICAL_SLOT_MISSING')
    const slot = slots[Number(p.target!.versionIndex)], expected = SoulContentSlotPublicBcs.fromBase64(p.expectedSlot!)
    check(SoulContentSlotPublicBcs.serialize({ ...expected, deleted: true, purged: p.action === 'purge' }).toBase64()
      === SoulContentSlotPublicBcs.serialize(slot).toBase64(), 'HISTORICAL_SLOT_MISMATCH')
    if (p.action === 'purge') {
      const keyType = `${pkg}::content::ContentBlobKey`, keyCodec = bcs.struct('ContentBlobKey', { kind: bcs.u32(), name: bcs.string(), version_index: bcs.u64() })
      const wrapper = deriveDynamicFieldID(p.contentId, `0x2::dynamic_object_field::Wrapper<${keyType}>`,
        bcs.struct('Wrapper', { name: keyCodec }).serialize({ name: { kind: p.kind, name: p.target!.name, version_index: p.target!.versionIndex } }).toBytes())
      deleted(wrapper, p.contentId); deleted(expected.blob_object_id, wrapper)
    }
  } else if (p.action === 'set-active') {
    const active = await field(content.value.active.id, 'u32', bcs.u32(), p.kind, `${pkg}::content::ActiveBinding`, SoulDetailStateBcs.Active,
      p.expectedActive === null ? 'created' : 'mutated')
    check(active.version === '1' && active.kind === p.kind && active.name === p.target!.name && active.version_index === p.target!.versionIndex
      && active.download_policy === SoulContentSlotPublicBcs.fromBase64(p.expectedSlot!).download_policy, 'HISTORICAL_ACTIVE_MISMATCH')
  } else deleted(deriveDynamicFieldID(content.value.active.id, 'u32', bcs.u32().serialize(p.kind).toBytes()), content.value.active.id)
  return { contentVersion: String(content.reference.version) }
}

/** Frozen signed transaction adapter. Query does not consult wallet, current
 * authority, current release switches or a mutable local completion cache. */
export function createContentMutationAdapter(params: {
  client: SuiGrpcClient; getAddress: () => string | null; sign: (tx: Transaction) => Promise<{ bytes: string; signature: string }>
  preflight: (plan: ContentMutationPlan, signing: boolean) => Promise<void>
}) {
  const { client, getAddress, sign, preflight } = params
  const timeout = () => AbortSignal.timeout(45000)
  async function chain(p: ContentMutationPlan, signal: AbortSignal) {
    const { chainIdentifier } = await profileReadStep(signal, () => client.core.getChainIdentifier()); digest(chainIdentifier)
    check(toHex(fromBase58(chainIdentifier).subarray(0, 4)) === p.deployment.chainIdentifier, 'WRONG_CHAIN')
  }
  async function epoch(signal: AbortSignal) {
    const { response } = await profileReadStep(signal, () => client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }, { abort: signal }))
    const value = response.epoch?.epoch
    check(typeof value === 'bigint' && value >= 0n && value < MAX, 'EPOCH_UNAVAILABLE'); return value
  }
  const wallet = (p: ContentMutationPlan) => check(getAddress() === p.author, 'WALLET_CHANGED')
  async function ready(p: ContentMutationPlan, packet: ContentMutationRecord['packet'] | null, signing: boolean) {
    const signal = timeout(); wallet(p); await chain(p, signal)
    await profileReadStep(signal, () => preflight(structuredClone(p), signing))
    if (packet) {
      const observed = await epoch(signal)
      check(observed <= BigInt(packet.expirationEpoch), 'EXPIRED_QUERY_ONLY')
      check(BigInt(packet.expirationEpoch) <= observed + 1n, 'EXPIRATION_OUTSIDE_PREPARED_WINDOW')
    }
    wallet(p)
  }
  async function limits(bytes: Uint8Array, signal: AbortSignal) {
    const { protocolConfig } = await profileReadStep(signal, () => client.core.getProtocolConfig())
    const limit = (key: string) => { const value = protocolConfig.attributes[key]; uint(value, true); return BigInt(value) }
    const tx = Transaction.from(bytes).getData()
    check(BigInt(bytes.length) <= limit('max_tx_size_bytes') && BigInt(tx.commands.length) <= limit('max_programmable_tx_commands'), 'PROTOCOL_LIMIT')
    for (const input of tx.inputs) if (input.Pure) check(BigInt(fromBase64(input.Pure.bytes).length) <= limit('max_pure_argument_size'), 'PURE_ARGUMENT_LIMIT')
  }
  async function simulate(r: ContentMutationRecord) {
    const signal = timeout(), bytes = fromBase64(r.packet.bytes); await limits(bytes, signal)
    const { response } = await profileReadStep(signal, () => client.transactionExecutionService.simulateTransaction({
      transaction: { bcs: { value: bytes } }, checks: 0, doGasSelection: false,
      readMask: { paths: ['transaction.transaction.bcs', 'transaction.effects.status'] },
    }, { abort: signal }))
    check(response.transaction?.transaction?.bcs?.value && toBase64(response.transaction.transaction.bcs.value) === r.packet.bytes
      && response.transaction.effects?.status?.success === true, 'SIMULATION_REJECTED')
  }
  async function verify(r: ContentMutationRecord) {
    check(r.packet.signature, 'SIGNATURE_REQUIRED')
    await verifyTransactionSignature(fromBase64(r.packet.bytes), r.packet.signature, { address: r.plan.author, client })
  }
  return {
    async prepare(input: ContentMutationPlan): Promise<ContentMutationRecord> {
      const plan = parseContentMutationPlan(input); await ready(plan, null, true)
      const signal = timeout(), expirationEpoch = String(await epoch(signal) + 1n), tx = buildContentMutationTransaction(plan)
      tx.setSender(plan.author); tx.setExpiration({ Epoch: expirationEpoch })
      const bytes = await profileReadStep(signal, () => tx.build({ client })); wallet(plan)
      const record = parseContentMutationRecord({ schema: 'soulidity.content-mutation.v1', plan, packet: {
        bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch, phase: 'PREPARED', signature: null } })
      await simulate(record); wallet(plan); return record
    },
    async preflight(input: ContentMutationRecord, signing: boolean) {
      const r = parseContentMutationRecord(input); await ready(r.plan, r.packet, signing); await simulate(r); wallet(r.plan)
    },
    async sign(input: ContentMutationRecord) {
      const r = parseContentMutationRecord(input)
      check(['PREPARED', 'SIGNING'].includes(r.packet.phase), 'NOT_SIGNABLE'); await ready(r.plan, r.packet, true)
      const signed = await profileReadStep(timeout(), () => sign(Transaction.from(fromBase64(r.packet.bytes))))
      wallet(r.plan); check(signed.bytes === r.packet.bytes, 'WALLET_CHANGED_BYTES')
      const result = parseContentMutationRecord({ ...r, packet: { ...r.packet, phase: 'SIGNED', signature: signed.signature } })
      await verify(result); return signed
    },
    async verifySignature(input: ContentMutationRecord) { await verify(parseContentMutationRecord(input)) },
    async broadcast(input: ContentMutationRecord) {
      const r = parseContentMutationRecord(input); check(r.packet.phase === 'SIGNED', 'NOT_SIGNED')
      await ready(r.plan, r.packet, false); await verify(r); wallet(r.plan)
      // An abort/transport failure remains unknown; the runner retains this
      // digest. No timeout handler is allowed to rebuild or clear the record.
      await profileReadStep(timeout(), () => client.core.executeTransaction({ transaction: fromBase64(r.packet.bytes), signatures: [r.packet.signature!] }))
    },
    async query(input: ContentMutationRecord): Promise<ContentMutationQuery> {
      const r = parseContentMutationRecord(input), signal = timeout(); await chain(r.plan, signal)
      let response
      try { response = (await profileReadStep(signal, () => client.ledgerService.getTransaction({ digest: r.packet.digest,
        readMask: { paths: ['digest', 'transaction.digest', 'transaction.bcs', 'effects.bcs', 'effects.transaction_digest', 'effects.status', 'checkpoint'] },
      }, { abort: signal }))).response }
      catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return { status: 'MISSING' }; throw error }
      const value = response.transaction
      check(value?.digest === r.packet.digest && value.transaction?.digest === r.packet.digest && value.transaction.bcs?.value
        && toBase64(value.transaction.bcs.value) === r.packet.bytes && value.effects?.transactionDigest === r.packet.digest
        && value.effects.bcs?.value && value.effects.bcs.value.length > 0 && value.effects.bcs.value.length <= 256 * 1024, 'EVIDENCE_MISMATCH')
      const effects = decode(bcs.TransactionEffects, value.effects.bcs.value), e = effects.V2
      check(e && e.transactionDigest === r.packet.digest && ['Success', 'Failure'].includes(e.status.$kind)
        && value.effects.status?.success === (e.status.$kind === 'Success') && BigInt(e.executedEpoch) <= BigInt(r.packet.expirationEpoch), 'STATUS_MISMATCH')
      if (value.checkpoint === undefined) return { status: 'PENDING' }
      check(typeof value.checkpoint === 'bigint' && value.checkpoint >= 0n && value.checkpoint <= MAX, 'CHECKPOINT_INVALID')
      const checkpoint = String(value.checkpoint)
      if (e.status.$kind === 'Failure') return { status: 'FAILED', checkpoint }
      const proof = await historicalOutputs(r, effects, client, signal)
      signal.throwIfAborted(); return { status: 'SUCCEEDED', checkpoint, ...proof }
    },
  }
}
