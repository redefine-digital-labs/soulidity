import { sha256 } from '@noble/hashes/sha2.js'
import { equipmentUtf8 } from './native-equipment-bytes'
import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { decodeNativeBcs, NativeReceiveError, receiveId } from './native-receive'
import type { EquipmentReadSet } from './native-equipment'
import type { EquipmentMakerBcs, EquipmentStyleRowBcs } from './native-equipment-source-bcs'
import type { AnimacraftEquipmentV8Protection } from '@soulidity/sdk'

const A = bcs.Address; const U = bcs.u64(); const V = bcs.vector(bcs.u8()); const S = bcs.string()
const Table = bcs.struct('Table', { id: A, size: U })
export const EquipmentProtectedKeyBcs = bcs.struct('ProtectedAssetKeyV8', { scope_kind: bcs.u8(), scope_key: S, asset_key: S })
export const EquipmentProtectedAssetBcs = bcs.struct('ProtectedAssetV8', {
  scope_kind: bcs.u8(), scope_key: S, scope_commitment: V, asset_key: S, asset_content_commitment: V,
  ciphertext_blob_id: S, ciphertext_sha256: V, ciphertext_blob_commitment: V, certification_commitment: V, seal_id: V,
})
export const EquipmentSealRegistryBcs = bcs.struct('SealRegistryV8', {
  id: A, version: U, root_id: A, maker_version: U, root_content_commitment: V, catalog_id: A,
  product_binding_commitment: V, policy_config_id: A, policy_commitment: V,
  expected_base_count: U, expected_pack_count: U, expected_complete_count: U,
  base_count: U, pack_count: U, complete_count: U, base_commitment: V, pack_commitment: V, complete_commitment: V,
  revision: U, commitment: V, sealed: bcs.bool(), keys: bcs.vector(EquipmentProtectedKeyBcs), assets: Table,
  runtime_revision: U, runtime_keys: bcs.vector(EquipmentProtectedKeyBcs), runtime_assets: Table,
})
export const EquipmentSealPolicyBcs = bcs.struct('SealPolicyConfigV8', {
  id: A, version: U, protocol_config_id: A, protocol_config_revision: U, catalog_id: A, product_binding_commitment: V,
  seal_original_package_id: A, seal_callable_package_id: A, seal_binding_commitment: V, seal_authority_id: A,
  call_cap_set_commitment: V, role: bcs.u8(), finalized: bcs.bool(),
  key_servers: bcs.vector(bcs.struct('KeyServerRowV2', { key_server_id: A, weight: bcs.u16() })), threshold: bcs.u16(),
  cipher_suite: S, key_derivation: S, ciphertext_format: S, max_plaintext_bytes: U,
  key_server_set_commitment: V, encryption_policy_commitment: V, commitment: V, config_commitment: V,
})
export const EquipmentSealIdBcs = bcs.struct('SealIdInputV2', {
  domain: S, schema_revision: U, product_binding_commitment: V, policy_commitment: V, root_content_commitment: V,
  maker_version: U, scope_kind: bcs.u8(), scope_key: S, asset_key: S,
})
const BindingBcs = bcs.struct('SealBindingCommitmentInputV8', {
  domain: V, version: U, registry_id: A, registry_commitment: V, runtime_revision: U, runtime_commitment: V,
  policy_config_id: A, policy_commitment: V, root_id: A, root_version: U, root_content_commitment: V,
  scope_kind: bcs.u8(), scope_key: S, scope_commitment: V, asset_key: S, asset_content_commitment: V,
  ciphertext_blob_id: S, ciphertext_sha256: V, ciphertext_blob_commitment: V, certification_commitment: V, seal_id: V,
})
type Registry = ReturnType<typeof EquipmentSealRegistryBcs.parse>
type Asset = ReturnType<typeof EquipmentProtectedAssetBcs.parse>
type LedgerObject = NonNullable<Awaited<ReturnType<SuiGrpcClient['ledgerService']['getObject']>>['response']['object']>
export type EquipmentProtectedEntry = { partKey: string; itemKey: string; styleKey: string;
  proof: AnimacraftEquipmentV8Protection | null; bindingCommitment: number[] | null }
const eq = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.every((v,i) => v === b[i])
const hash = (bytes: Uint8Array) => [...sha256(bytes)]
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_EQUIPMENT_PROTECTED_INVALID',message)
}
export function equipmentSealId(registry: Registry, assetKey: string) {
  check(equipmentUtf8(assetKey).length > 0 && equipmentUtf8(assetKey).length <= 512, 'Invalid protected asset key')
  return hash(EquipmentSealIdBcs.serialize({ ...registry, domain: 'animacraft-fresh-v8/seal/ciphertext-id/v2',
    schema_revision: '2', scope_kind: 0, scope_key: 'maker/base', asset_key: assetKey }).toBytes())
}
export function equipmentSealBinding(registry: Registry, asset: Asset) {
  return hash(BindingBcs.serialize({ ...registry, ...asset, domain: [...equipmentUtf8('animacraft-v8/runtime/seal-binding')],
    version: '8', registry_id: registry.id, registry_commitment: registry.commitment,
    runtime_commitment: registry.commitment, root_version: registry.maker_version }).toBytes())
}

/** Metadata only: never fetch/decrypt ciphertext or mint decryption authority.
 * A protected-source outage disables only protected choices, not public styles. */
export async function readEquipmentProtectedBase(client: SuiGrpcClient, reads: EquipmentReadSet, params: {
  root: ReturnType<typeof EquipmentMakerBcs.parse>; styles: ReturnType<typeof EquipmentStyleRowBcs.parse>[];
  native: LedgerObject; runtime: LedgerObject;
}): Promise<{ available: boolean; entries: EquipmentProtectedEntry[] }> {
  const styles = params.styles.filter(style => style.protected)
  if (styles.length === 0) return { available: true, entries: [] }
  try {
    const root = params.root
    check(root.publication.registry_ids, 'Seal registry binding missing')
    const getObject = async (objectId: string) => (await client.ledgerService.getObject({ objectId: receiveId(objectId),
      readMask: { paths: ['object_id','object_type','version','digest','owner','contents','package'] } })).response.object
    const rawRegistry = await getObject(root.publication.registry_ids.seal_registry_id)
    check(rawRegistry?.contents?.value, 'Seal registry unavailable')
    // Decoded IDs are hints until exact dependency code/types/custody are verified below.
    const registry = decodeNativeBcs(EquipmentSealRegistryBcs,rawRegistry.contents.value)
    const rawPolicy = await getObject(registry.policy_config_id)
    check(rawPolicy?.contents?.value, 'Seal policy unavailable')
    const policy = decodeNativeBcs(EquipmentSealPolicyBcs,rawPolicy.contents.value)
    const links = [params.native,params.runtime].map(p => p.package?.linkage.filter(row => row.originalId === policy.seal_original_package_id))
    check(links[0]?.length === 1 && links[1]?.length === 1 && links[0][0].upgradedId === links[1][0].upgradedId
      && links[0][0].upgradedVersion === links[1][0].upgradedVersion, 'Seal dependency linkage mismatch')
    const sealId = receiveId(links[0][0].upgradedId)
    const seal = await getObject(sealId)
    check(seal && seal.objectId === sealId && seal.owner?.kind === 4 && seal.version === links[0][0].upgradedVersion
      && seal.package?.storageId === seal.objectId && seal.package.originalId === policy.seal_original_package_id
      && seal.package.modules.some(row => row.name === 'seal_v8' && row.contents && row.contents.length > 4), 'Seal package mismatch')
    const origin = (name: string) => {
      const rows = seal.package!.typeOrigins.filter(row => row.moduleName === 'seal_v8' && row.datatypeName === name)
      check(rows.length === 1, 'Seal type origin missing')
      return receiveId(rows[0].packageId)
    }
    const type = (name: string) => `${origin(name)}::seal_v8::${name}`
    check(policy.seal_callable_package_id === origin('SealCallableMarkerV8')
      && policy.seal_callable_package_id === origin('SealSetupInstallWitnessV2'), 'Seal callable marker mismatch')
    reads.accept(rawRegistry,root.publication.registry_ids.seal_registry_id,type('SealRegistryV8'),3)
    reads.accept(rawPolicy,registry.policy_config_id,type('SealPolicyConfigV8'),3)
    check(registry.id === root.publication.registry_ids.seal_registry_id && registry.version === '8' && registry.sealed
      && registry.root_id === root.id && registry.maker_version === root.maker_version
      && eq(registry.root_content_commitment,root.content.content_commitment)
      && registry.catalog_id === policy.catalog_id && eq(registry.product_binding_commitment,policy.product_binding_commitment)
      && policy.id === registry.policy_config_id && policy.version === '8' && eq(registry.policy_commitment,policy.commitment), 'Seal source binding mismatch')
    const keyType = type('ProtectedAssetKeyV8'); const valueType = type('ProtectedAssetV8')
    const Field = bcs.struct('Field', { id: A, name: EquipmentProtectedKeyBcs, value: EquipmentProtectedAssetBcs })
    const results = await Promise.allSettled(styles.map(async style => {
      const key = { scope_kind: 0, scope_key: 'maker/base', asset_key: `${style.part_key}/${style.item_key}/${style.style_key}` }
      const entry: EquipmentProtectedEntry = { partKey: style.part_key, itemKey: style.item_key, styleKey: style.style_key, proof: null, bindingCommitment: null }
      let asset: Asset | null = null
      for (const table of [registry.assets,registry.runtime_assets]) {
        const fieldId = deriveDynamicFieldID(table.id,keyType,EquipmentProtectedKeyBcs.serialize(key).toBytes())
        const bytes = await reads.optional(fieldId,`0x2::dynamic_field::Field<${keyType},${valueType}>`,2,table.id)
        if (bytes === null) continue
        const row = decodeNativeBcs(Field,bytes)
        check(row.id === fieldId && row.name.scope_kind === 0 && row.name.scope_key === key.scope_key && row.name.asset_key === key.asset_key,
          'Protected field key mismatch')
        asset = row.value; break // Never fall through from a present-but-invalid static row.
      }
      if (!asset) return entry
      check(asset.scope_kind === 0 && asset.scope_key === key.scope_key && asset.asset_key === key.asset_key
        && eq(asset.scope_commitment,root.content.content_commitment) && eq(asset.asset_content_commitment,style.payload_commitment)
        && asset.ciphertext_blob_id === style.asset_blob_id && eq(asset.ciphertext_sha256,style.asset_sha256)
        && eq(asset.seal_id,equipmentSealId(registry,key.asset_key))
        && asset.ciphertext_blob_commitment.length === 32 && asset.certification_commitment.length === 32, 'Protected style/Seal identity mismatch')
      entry.proof = { sealRegistryId: registry.id, sealPolicyId: policy.id, ciphertextBlobCommitment: asset.ciphertext_blob_commitment,
        certificationCommitment: asset.certification_commitment, sealId: asset.seal_id }
      entry.bindingCommitment = equipmentSealBinding(registry,asset)
      return entry
    }))
    const changed = results.find(row => row.status === 'rejected' && row.reason instanceof NativeReceiveError && row.reason.code === 'NATIVE_EQUIPMENT_CHANGED')
    if (changed?.status === 'rejected') throw changed.reason
    const failed = results.find(row => row.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    return { available: true, entries: results.map(row => {
      check(row.status === 'fulfilled','Protected source incomplete'); return row.value
    }) }
  } catch (error) {
    if (error instanceof NativeReceiveError && error.code === 'NATIVE_EQUIPMENT_CHANGED') throw error
    return { available: false, entries: [] }
  }
}
