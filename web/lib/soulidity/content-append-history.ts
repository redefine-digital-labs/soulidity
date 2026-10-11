import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64, toBase64 } from '@mysten/sui/utils'
import { SoulStatePublicBcs, SoulContentPublicBcs, SoulContentKeyPublicBcs, SoulContentSlotPublicBcs,
  SoulDetailStateBcs, downloadPolicyToU8 } from '@soulidity/sdk'
import { historicalObjectOutput, readHistoricalMoveObject } from '../sui/historical-object'
import type { WalrusSingleRecord } from '../upload/walrus-single-operation'
import { assertContentAppendWalrusRecord, parseContentAppendIntent } from './content-append-operation'
import { contentAppendPreparationFingerprint, contentAppendPreparedEnvelope, verifyContentAppendPreparation,
  type ContentAppendPreparation } from './content-append-preparation'
import { contentEnvelopeKey } from './content-envelope'

const A = bcs.Address, S = bcs.string(), N = bcs.u32(), V = bcs.vector(bcs.u8())
const BlobKey = bcs.struct('ContentBlobKey', { kind: N, name: S, version_index: bcs.u64() })
const Wrapper = bcs.struct('Wrapper', { name: BlobKey })
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
function check(v: unknown, code: string): asserts v { if (!v) throw new Error(`CONTENT_APPEND_HISTORY_${code}`) }
function decode<C extends Codec>(codec: C, bytes: Uint8Array): ReturnType<C['parse']> {
  const value = codec.parse(bytes)
  check(toBase64(codec.serialize(value).toBytes()) === toBase64(bytes), 'NONCANONICAL_CONTENT'); return value
}

/** Domain output proof after the caller has proved the exact original Walrus
 * certify + complete signed attachment. No current ownership/table enumeration,
 * Clock, storage download, wallet authority, signature or local write is used. */
export async function readContentAppendHistoricalOutputs(params: {
  record: ContentAppendPreparation; payment: WalrusSingleRecord; effects: ReturnType<typeof bcs.TransactionEffects.parse>
  client: SuiGrpcClient; signal: AbortSignal
}) {
  const { client, signal } = params
  const paymentInput = structuredClone(params.payment), effects = structuredClone(params.effects)
  const record = await verifyContentAppendPreparation(params.record, client)
  const payment = assertContentAppendWalrusRecord(record, paymentInput), intent = parseContentAppendIntent(record), scope = record.scope
  check(payment.certify && payment.uploaded && effects.V2?.transactionDigest === payment.certify.digest
    && effects.V2.status.$kind === 'Success', 'CERTIFIED_EFFECTS_REQUIRED')
  const digest = payment.certify.digest, pkg = scope.originalPackageId, blobObjectId = payment.uploaded.blobObjectId
  const packet = Transaction.from(fromBase64(payment.certify.bytes)).getData()
  const read = (objectId: string, type: string, mode: 'created' | 'mutated' | 'written' = 'written', maxBytes = 1024 * 1024) =>
    readHistoricalMoveObject({ client, signal, effects, transactionDigest: digest, objectId, type, mode, maxBytes })
  const shared = async <C extends Codec>(objectId: string, type: string, codec: C) => {
    const result = await read(objectId, type, 'mutated', 16384)
    const inputs = packet.inputs.flatMap(input => input.Object?.SharedObject?.objectId === objectId ? [input.Object.SharedObject] : [])
    check(inputs.length === 1 && inputs[0].mutable && result.reference.owner.Shared
      && result.reference.inputOwner?.Shared
      && result.reference.owner.Shared.initialSharedVersion === inputs[0].initialSharedVersion
      && result.reference.inputOwner.Shared.initialSharedVersion === inputs[0].initialSharedVersion, 'ROOT_SHARED_REFERENCE_MISMATCH')
    return { value: decode(codec, result.bytes), reference: result.reference }
  }
  const state = await shared(intent.stateId, `${pkg}::soul::SoulState`, SoulStatePublicBcs)
  const content = await shared(scope.contentObjectId, `${pkg}::content::SoulContent`, SoulContentPublicBcs)
  check(state.value.id === intent.stateId && state.value.version === '1' && state.value.soul_id === intent.soulId
    && state.value.content_id === scope.contentObjectId && state.value.ownership_epoch === intent.ownershipEpoch
    && (intent.grantId !== null || state.value.current_owner === scope.author), 'STATE_SCOPE_MISMATCH')
  check(content.value.id === scope.contentObjectId && content.value.version === '1'
    && content.value.soul_id === intent.soulId, 'CONTENT_SCOPE_MISMATCH')
  const field = async <K extends Codec, C extends Codec>(parent: string, keyType: string, keyCodec: K,
    key: ReturnType<K['parse']>, valueType: string, codec: C, mode: 'created' | 'mutated' | 'written' = 'written') => {
    const keyBytes = keyCodec.serialize(key).toBytes(), objectId = deriveDynamicFieldID(parent, keyType, keyBytes)
    const result = await read(objectId, `0x2::dynamic_field::Field<${keyType},${valueType}>`, mode)
    check(result.reference.owner.ObjectOwner === parent
      && (result.reference.created || result.reference.inputOwner?.ObjectOwner === parent), 'FIELD_PARENT_MISMATCH')
    const value = decode(bcs.struct('Field', { id: A, name: keyCodec as any, value: codec as any }), result.bytes)
    check(value.id === objectId && toBase64(keyCodec.serialize(value.name).toBytes()) === toBase64(keyBytes), 'FIELD_KEY_MISMATCH')
    return { objectId, value: value.value as ReturnType<C['parse']> }
  }
  const slots = await field(content.value.items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs,
    { kind: scope.kind, name: scope.name }, `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs),
    scope.versionIndex === '0' ? 'created' : 'mutated')
  check(BigInt(slots.value.length) === BigInt(scope.versionIndex) + 1n, 'SLOT_VERSION_MISMATCH')
  const slot = slots.value.at(-1)!
  check(slot.version === '1' && slot.kind === scope.kind && slot.blob_object_id === blobObjectId && slot.seal_encrypted
    && !slot.deleted && !slot.purged && slot.read_mode_mask === String(intent.readModeMask)
    && slot.download_policy === downloadPolicyToU8(intent.downloadPolicy)
    && slot.is_public === Boolean(intent.readModeMask & 8), 'SLOT_CONTENT_MISMATCH')
  const identity = { contentObjectId: scope.contentObjectId, kind: scope.kind, name: scope.name,
    versionIndex: scope.versionIndex, blobObjectId }
  const envelope = await field(state.value.config_ext.id, '0x1::string::String', S, contentEnvelopeKey(identity), 'vector<u8>', V)
  check(toBase64(new Uint8Array(envelope.value)) === toBase64(contentAppendPreparedEnvelope(record, blobObjectId)), 'ENVELOPE_MISMATCH')
  const wrapper = await field(scope.contentObjectId, `0x2::dynamic_object_field::Wrapper<${pkg}::content::ContentBlobKey>`, Wrapper,
    { name: { kind: scope.kind, name: scope.name, version_index: scope.versionIndex } }, '0x2::object::ID', A, 'created')
  check(wrapper.value === blobObjectId && historicalObjectOutput(effects, blobObjectId, 'mutated').owner.ObjectOwner === wrapper.objectId,
    'BLOB_CONTAINMENT_MISMATCH')
  if (intent.spriteConfigJson !== null) {
    const sprite = await field(state.value.config_ext.id, '0x1::string::String', S, 'sprite_config_json', 'vector<u8>', V)
    check(toBase64(new Uint8Array(sprite.value)) === toBase64(new TextEncoder().encode(intent.spriteConfigJson)), 'SPRITE_CONFIG_MISMATCH')
  }
  if (intent.setActive) {
    const active = (await field(content.value.active.id, 'u32', N, scope.kind, `${pkg}::content::ActiveBinding`, SoulDetailStateBcs.Active)).value
    check(active.version === '1' && active.kind === scope.kind && active.name === scope.name
      && active.version_index === scope.versionIndex && active.download_policy === slot.download_policy, 'ACTIVE_BINDING_MISMATCH')
  }
  if (intent.autoGrantPlan) {
    check(state.value.grant_capacity === intent.autoGrantPlan.capacityAfter, 'GRANT_CAPACITY_MISMATCH')
    for (const target of intent.autoGrantPlan.targets) {
      const granted = (await field(state.value.active_grants.id, 'address', A, target.address,
        `${pkg}::soul::ActiveGrantSlot`, SoulDetailStateBcs.GrantSlot)).value
      check(granted.version === '1' && granted.grantee === target.address && granted.scope_mask === String(target.scopeMask)
        && granted.ownership_epoch_snapshot === intent.ownershipEpoch && granted.expires_at_ms === null, 'GRANT_SLOT_MISMATCH')
      const reverse = await field(state.value.active_grant_ids.id, '0x2::object::ID', A, granted.grant_id, 'address', A, 'created')
      check(reverse.value === target.address, 'GRANT_REVERSE_MISMATCH')
      const rawGrant = await read(granted.grant_id, `${pkg}::grant::SoulGrant`, 'created', 1024)
      check(rawGrant.reference.owner.AddressOwner === target.address, 'GRANT_RECIPIENT_MISMATCH')
      const grant = decode(SoulDetailStateBcs.Grant, rawGrant.bytes)
      check(grant.version === '1' && grant.id === granted.grant_id && grant.soul_id === intent.soulId
        && grant.grantee === target.address && grant.issued_by === scope.author && grant.scope_mask === String(target.scopeMask)
        && grant.ownership_epoch_snapshot === intent.ownershipEpoch && grant.expires_at_ms === null, 'GRANT_CONTENT_MISMATCH')
    }
  }
  signal.throwIfAborted()
  return { preparationFingerprint: contentAppendPreparationFingerprint(record), certifyDigest: digest,
    versionIndex: scope.versionIndex, blobObjectId, blobWrapperId: wrapper.objectId, stateVersion: String(state.reference.version),
    contentVersion: String(content.reference.version), slot }
}
