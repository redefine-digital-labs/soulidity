import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils'
import { equipmentUtf8 } from './native-equipment-bytes'
import { nativeArtworkBlobId, nativeArtworkHex } from './native-artwork-bytes'
import { decodeNativeBcs, NativeReceiveError, NativeSoulBcs, NativeSoulBindingBcs,
  NativeSoulStateBcs, receiveId, type NativeReceiveTarget } from './native-receive'
import { NativeArtworkOutputBcs } from './native-artwork'
import { EquipmentReadSet, EquipmentPointerBcs } from './native-equipment'
import { EquipmentProtectedAssetBcs, EquipmentProtectedKeyBcs, EquipmentSealIdBcs } from './native-equipment-seal'
import { CompleteReadEmptyKeyBcs, CompleteReadReceiptBcs, completeReadCertificationHash, completeReadHash,
  completeReadOutputHashes } from './native-complete-read-bcs'
import type { NativeCompleteReadTarget } from './native-complete-read-types'
import { createNativeProtectedReadContext, readNativeProtectedReadPolicy, completeReadAggregatorUrls } from './native-protected-read-authority'

const A = bcs.Address

const eq = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.some(v => v !== 0) && a.every((v, i) => v === b[i])
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_COMPLETE_READ_INVALID', message)
}
export { completeReadAggregatorUrls } from './native-protected-read-authority'

/** Metadata, not an entitlement. The sole Release entry independently reads
 * live Soul ownership when key servers evaluate the user's signed request. */
export async function readNativeCompleteReadTarget(client: SuiGrpcClient, target: NativeReceiveTarget,
  input: { soulId: string; stateId: string }, signal?: AbortSignal,
  aggregators: ReadonlyMap<string, string> = completeReadAggregatorUrls()): Promise<NativeCompleteReadTarget> {
  aggregators = new Map(aggregators)
  if (!target.release) throw new NativeReceiveError('NATIVE_COMPLETE_READ_TARGET_UNAVAILABLE', 'Exact Release package pin is required', 503)
  const soulId = receiveId(input.soulId), stateId = receiveId(input.stateId), pin = target.release
  signal?.throwIfAborted()
  const reads = new EquipmentReadSet(client)
  const context = await createNativeProtectedReadContext(client, target, reads, signal)
  const { types, ot, field, empty } = context
  try {
    const state = decodeNativeBcs(NativeSoulStateBcs, await reads.read(stateId, types.stateType, 3))
    check(state.id === stateId && state.soul_id === soulId, 'Live SoulState mismatch')
    receiveId(state.current_owner); receiveId(state.current_kiosk_id)
    const soul = decodeNativeBcs(NativeSoulBcs, await reads.kioskItem(soulId, types.soulType, state.current_kiosk_id))
    check(soul.id === soulId && soul.provenance_kind === 3, 'Native Soul custody mismatch')
    const pointerId = deriveDynamicFieldID(stateId, 'u8', new Uint8Array([9]))
    const pointer = decodeNativeBcs(EquipmentPointerBcs, await reads.read(pointerId, '0x2::dynamic_field::Field<u8,0x2::object::ID>', 2, stateId))
    check(pointer.id === pointerId && pointer.name === 9, 'Native State DF9 mismatch')
    const binding = decodeNativeBcs(NativeSoulBindingBcs, await reads.read(receiveId(pointer.value), types.bindingType, 4))
    check(binding.id === pointer.value && binding.version === '8' && binding.soul_id === soulId
      && binding.soul_state_id === stateId && binding.protocol_config_id === target.protocolConfigId, 'Native provenance mismatch')
    const output = decodeNativeBcs(NativeArtworkOutputBcs, await reads.read(binding.output_id, types.outputType, 4))
    const receipt = decodeNativeBcs(CompleteReadReceiptBcs, await reads.read(binding.receipt_id, ot('CompleteReceiptV8'), 4))
    check(output.id === binding.output_id && receipt.id === binding.receipt_id && receipt.output_id === output.id
      && output.version === '8' && receipt.version === '8', 'Exact immutable Complete pair required')
    if (!output.protected) throw new NativeReceiveError('NATIVE_COMPLETE_READ_NOT_PROTECTED', 'Output is not protected', 422)
    check(receipt.protected && output.seal_id && receipt.seal_id && eq(output.seal_id, receipt.seal_id)
      && output.scope_key.length > 0 && equipmentUtf8(output.scope_key).length <= 128
      && output.asset_key.length > 0 && equipmentUtf8(output.asset_key).length <= 128, 'Complete protection metadata mismatch')
    check(await field(output.id, ot('NativeCompleteBindingKeyV8'), CompleteReadEmptyKeyBcs, empty,
      '0x2::object::ID', A) === binding.id, 'Native Output marker mismatch')
    for (const row of [output, receipt]) {
      check(row.root_id === binding.root_id && row.maker_version === binding.maker_version
        && row.output_key === binding.output_key && row.original_holder === binding.original_holder
        && row.holder === binding.original_holder, 'Immutable issuance binding mismatch')
      for (const key of ['root_content_commitment', 'output_policy_commitment', 'recipe_commitment', 'render_commitment', 'output_commitment'] as const) {
        check(eq(row[key], binding[key]), `Complete ${key} mismatch`)
      }
    }
    check(eq(receipt.receipt_commitment, binding.receipt_commitment)
      && receipt.loadout_id === output.loadout_id && receipt.loadout_revision === output.loadout_revision
      && eq(receipt.loadout_commitment, output.loadout_commitment)
      && eq(receipt.renderer_schema_commitment, output.renderer_schema_commitment), 'Complete receipt pairing mismatch')
    const blobId = output.render_blob_id
    check(nativeArtworkBlobId(blobId) && soul.image_url === `walrus://${blobId}`
      && eq(output.render_sha256, output.render_sha256), 'Ciphertext Blob identity mismatch')
    const { root, protocol, catalogId, releaseConfigId, registry, policy, coin, st } = await readNativeProtectedReadPolicy(context, {
      rootId: binding.root_id, makerVersion: binding.maker_version, rootContentCommitment: binding.root_content_commitment })
    check(root.publication.registry_ids!.output_registry_id === output.output_registry_id
      && root.publication.registry_ids!.soul_registry_id === binding.soul_registry_id, 'Root immutable provenance/companion mismatch')
    const hashes = completeReadOutputHashes(output, receipt, root.content.renderer_commitment)
    check(eq(output.render_commitment, hashes.render) && eq(output.output_commitment, hashes.output)
      && eq(receipt.receipt_commitment, hashes.receipt) && eq(output.protection_binding_commitment, hashes.protection)
      && eq(binding.authorization_commitment, hashes.authorization), 'Complete canonical commitments mismatch')
    const key = { scope_kind: 2, scope_key: output.scope_key, asset_key: output.asset_key }
    // Match Seal's static-first exact lookup; an invalid present row cannot fall through.
    let asset = await field(registry.assets.id, st('ProtectedAssetKeyV8'), EquipmentProtectedKeyBcs, key,
      st('ProtectedAssetV8'), EquipmentProtectedAssetBcs, true)
    if (asset === null) asset = await field(registry.runtime_assets.id, st('ProtectedAssetKeyV8'), EquipmentProtectedKeyBcs, key,
      st('ProtectedAssetV8'), EquipmentProtectedAssetBcs, true)
    check(asset, 'Exact protected Complete asset missing')
    const aad = EquipmentSealIdBcs.serialize({ ...registry, ...key,
      domain: 'animacraft-fresh-v8/seal/ciphertext-id/v2', schema_revision: '2' }).toBytes()
    const sealId = completeReadHash(aad)
    check(asset.scope_kind === 2 && asset.scope_key === key.scope_key && asset.asset_key === key.asset_key
      && eq(asset.scope_commitment, hashes.instance) && eq(asset.asset_content_commitment, output.output_commitment)
      && eq(asset.seal_id, sealId) && eq(output.seal_id, sealId) && asset.ciphertext_blob_id === blobId
      && eq(asset.ciphertext_sha256, output.render_sha256) && eq(asset.ciphertext_blob_commitment, output.render_blob_commitment)
      && eq(asset.certification_commitment, completeReadCertificationHash(registry, asset)), 'Exact Complete ciphertext/certification mismatch')
    signal?.throwIfAborted()
    return { schema: 'native-complete-read-v1', soulId, stateId, owner: state.current_owner, ownershipEpoch: state.ownership_epoch,
      bindingId: binding.id, outputId: output.id, receiptId: receipt.id, rootId: root.id, protocolConfigId: protocol.id,
      catalogId, releaseConfigId, sealRegistryId: registry.id, sealPolicyId: policy.id, paymentCoinType: coin,
      release: { ...pin }, ciphertext: { blobId, sha256: nativeArtworkHex(output.render_sha256), sealId,
        aadBase64: toBase64(aad) }, policy: { keyServers: policy.key_servers.map(row => ({ objectId: row.key_server_id, weight: row.weight,
          ...(aggregators.has(row.key_server_id) ? { aggregatorUrl: aggregators.get(row.key_server_id)! } : {}) })),
        threshold: policy.threshold, maxPlaintextBytes: Number(policy.max_plaintext_bytes), cipherSuite: policy.cipher_suite,
        keyDerivation: policy.key_derivation, ciphertextFormat: policy.ciphertext_format } }
  } finally {
    await reads.verify()
    signal?.throwIfAborted()
  }
}
