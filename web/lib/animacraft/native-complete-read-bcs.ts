import { nativeArtworkHash } from './native-artwork-bytes'
import { equipmentUtf8 } from './native-equipment-bytes'
import { bcs } from '@mysten/sui/bcs'

// Exact fresh Move layouts and preimage order, shared by the reader and fixtures.
const A = bcs.Address, U = bcs.u64(), V = bcs.vector(bcs.u8()), S = bcs.string(), B = bcs.bool()
const BaseLine = bcs.struct('BaseCompleteLineV8', { ordinal: U, base_gross_atomic: U, base_protocol_atomic: U,
  maker_atomic: U, fixed_protocol_atomic: U, total_atomic: U })
const PackLine = bcs.struct('PackPaymentLineV8', { release_id: A, semantic_pack_id: S, release_content_commitment: V,
  ordinal: U, gross_atomic: U, protocol_atomic: U, pack_atomic: U })
const receiptFields = { root_id: A, maker_version: U, root_content_commitment: V, original_holder: A,
  output_key: S, loadout_id: A, loadout_revision: U, loadout_commitment: V, output_policy_commitment: V,
  renderer_schema_commitment: V, economics_commitment: V, recipe_commitment: V, render_commitment: V,
  output_commitment: V, base_line: BaseLine, pack_lines: bcs.vector(PackLine), total_paid_atomic: bcs.u128(), protected: B }
export const CompleteReadReceiptBcs = bcs.struct('CompleteReceiptV8', {
  id: A, version: U, output_id: A, root_id: A, maker_version: U, root_content_commitment: V, output_key: S,
  original_holder: A, holder: A, loadout_id: A, loadout_revision: U, loadout_commitment: V,
  output_policy_commitment: V, renderer_schema_commitment: V, economics_commitment: V,
  recipe_commitment: V, render_commitment: V, output_commitment: V, base_line: BaseLine,
  pack_lines: bcs.vector(PackLine), total_paid_atomic: bcs.u128(), receipt_commitment: V, protected: B, seal_id: bcs.option(V),
})
const exactFields = { original_package_id: A, callable_package_id: A, source_commitment: V, package_commitment: V, abi_commitment: V }
const ExactBinding = bcs.struct('ExactPackageBindingV8', { ...exactFields, commitment: V })
export const CompleteReadCatalogBcs = bcs.struct('ProductReleaseCatalogV8', {
  id: A, schema_revision: U, protocol_config_id: A, protocol_config_revision: U, protocol_config_commitment: V,
  binding: bcs.struct('ProductReleaseBindingV8', { bindings: bcs.vector(ExactBinding), commitment: V }),
  authority_ids: bcs.vector(A), call_cap_set_commitment: V, catalog_commitment: V, next_setup_role: bcs.u8(),
  role_config_ids: bcs.vector(A), role_config_commitments: bcs.vector(V),
})
export const CompleteReadReleaseConfigBcs = bcs.struct('ReleasePackageConfigV8', {
  id: A, version: U, catalog_id: A, product_binding_commitment: V, call_cap_set_commitment: V, installation_commitment: V,
})
export const CompleteReadEmptyKeyBcs = bcs.struct('EmptyKey', { dummy_field: B })
const TypeName = bcs.struct('TypeName', { name: S })
export const CompleteReadNativeSlotBcs = bcs.struct('SoulidityBindingV8', { config_id: A,
  soul_original: TypeName, soul_defining: TypeName, mint_original: TypeName, mint_defining: TypeName,
  owner_original: TypeName, owner_defining: TypeName })
type Shape = Record<string, any>
export const completeReadHash = (bytes: Uint8Array) => [...nativeArtworkHash(bytes)]
function hash(shape: Shape, value: Shape, domain: string, v8 = false) {
  const prefix: Shape = v8 ? { domain: V, version: U } : { domain: S, schema_revision: U }
  return completeReadHash(bcs.struct('Commitment', { ...prefix, ...shape }).serialize({ ...value,
    domain: v8 ? [...equipmentUtf8(domain)] : domain, ...(v8 ? { version: '8' } : { schema_revision: '2' }),
  }).toBytes())
}
const roles = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']
const authorities = Object.fromEntries(roles.slice(1).map(role => [`${role}_authority_id`, A]))
export function completeReadCatalogHashes(catalog: ReturnType<typeof CompleteReadCatalogBcs.parse>) {
  const bindings = catalog.binding.bindings.map((row, role) => hash({ role: bcs.u8(), ...exactFields },
    { ...row, role }, 'animacraft-fresh-v8/package/exact-binding/v2'))
  const auth = Object.fromEntries(roles.slice(1).map((role, i) => [`${role}_authority_id`, catalog.authority_ids[i]]))
  const rows = Object.fromEntries(roles.map((role, i) => [`${role}_binding_commitment`, bindings[i]]))
  const caps = hash({ catalog_id: A, ...Object.fromEntries(roles.map(role => [`${role}_binding_commitment`, V])), ...authorities },
    { catalog_id: catalog.id, ...rows, ...auth }, 'animacraft-fresh-v8/package/call-cap-set/v2')
  const tuple = hash({ catalog_id: A, native_capability_mask: U, call_cap_set_commitment: V,
    ...Object.fromEntries(roles.map(role => [`${role}_binding`, V])) }, { catalog_id: catalog.id,
    native_capability_mask: '127', call_cap_set_commitment: caps,
    ...Object.fromEntries(roles.map((role, i) => [`${role}_binding`, bindings[i]])) }, 'animacraft-fresh-v8/package/product-tuple/v2')
  const commitment = hash({ catalog_id: A, protocol_config_id: A, protocol_config_revision: U, protocol_config_commitment: V,
    package_tuple_commitment: V, call_cap_set_commitment: V, native_capability_mask: U, ...authorities },
  { ...catalog, catalog_id: catalog.id, package_tuple_commitment: tuple, call_cap_set_commitment: caps,
    native_capability_mask: '127', ...auth }, 'animacraft-fresh-v8/core/catalog/v2')
  return { bindings, caps, tuple, commitment }
}
export function completeReadRoleHash(catalog: ReturnType<typeof CompleteReadCatalogBcs.parse>, role: number, configId: string, policy?: Shape) {
  return hash({ role: bcs.u8(), config_id: A, catalog_id: A, package_tuple_commitment: V, call_cap_set_commitment: V,
    authority_id: A, finalized: B, seal_policy_commitment: bcs.option(V), key_server_set_commitment: bcs.option(V),
    encryption_policy_commitment: bcs.option(V), external_validator_policy_id: bcs.option(A),
    external_validator_registry_id: bcs.option(A), soul_binding_registry_id: bcs.option(A),
    runtime_caller_cap_commitment: bcs.option(V), bootstrap_certificate_id: bcs.option(A), bootstrap_certificate_commitment: bcs.option(V) },
  { role, config_id: configId, catalog_id: catalog.id, package_tuple_commitment: catalog.binding.commitment,
    call_cap_set_commitment: catalog.call_cap_set_commitment, authority_id: catalog.authority_ids[role - 1], finalized: role === 1,
    seal_policy_commitment: policy?.commitment ?? null, key_server_set_commitment: policy?.key_server_set_commitment ?? null,
    encryption_policy_commitment: policy?.encryption_policy_commitment ?? null, external_validator_policy_id: null,
    external_validator_registry_id: null, soul_binding_registry_id: null, runtime_caller_cap_commitment: null,
    bootstrap_certificate_id: null, bootstrap_certificate_commitment: null }, 'animacraft-fresh-v8/package/role-config/v2')
}
export function completeReadOutputHashes(output: Shape, receipt: Shape, rendererCommitment: number[]) {
  return {
    render: hash({ recipe_commitment: V, renderer_commitment: V, renderer_schema_commitment: V, render_blob_id: S,
      render_sha256: V, render_blob_commitment: V, protected: B, scope_key: S, asset_key: S },
    { ...output, renderer_commitment: rendererCommitment }, 'animacraft-v8/output/render', true),
    output: hash({ root_id: A, maker_version: U, root_content_commitment: V, output_registry_id: A, output_key: S,
      original_holder: A, loadout_id: A, loadout_revision: U, loadout_commitment: V, output_policy_commitment: V,
      recipe_commitment: V, render_commitment: V, protected: B, scope_key: S, asset_key: S }, output, 'animacraft-v8/output/complete', true),
    receipt: hash(receiptFields, receipt, 'animacraft-v8/output/receipt', true),
    protection: hash({ output_id: A, receipt_id: A, output_commitment: V, receipt_commitment: V,
      scope_key: S, asset_key: S, seal_id: V }, { ...output, output_id: output.id,
      receipt_id: receipt.id, receipt_commitment: receipt.receipt_commitment }, 'animacraft-v8/output/protection', true),
    authorization: hash({ output_id: A, receipt_id: A, holder: A, output_commitment: V, receipt_commitment: V, protection_binding_commitment: V },
      { ...output, output_id: output.id, receipt_id: receipt.id, receipt_commitment: receipt.receipt_commitment }, 'animacraft-v8/output/soul-authorization', true),
    instance: hash({ recipe_commitment: V, render_commitment: V, output_commitment: V, receipt_commitment: V },
      { ...output, receipt_commitment: receipt.receipt_commitment }, 'animacraft-fresh-v8/seal/complete-instance/v2'),
  }
}
export function completeReadPolicyHashes(policy: Shape) {
  return {
    servers: hash({ ordered_key_servers: bcs.vector(bcs.struct('KeyServerRowV2', { key_server_id: A, weight: bcs.u16() })), threshold: bcs.u16() },
      { ...policy, ordered_key_servers: policy.key_servers }, 'animacraft-fresh-v8/seal/key-server-set/v2'),
    encryption: hash({ cipher_suite: S, key_derivation: S, ciphertext_format: S, max_plaintext_bytes: U }, policy, 'animacraft-fresh-v8/seal/encryption-policy/v2'),
    commitment: hash({ policy_id: A, catalog_id: A, package_tuple_commitment: V, call_cap_set_commitment: V,
      key_server_set_commitment: V, encryption_policy_commitment: V }, { ...policy, policy_id: policy.id,
      package_tuple_commitment: policy.product_binding_commitment }, 'animacraft-fresh-v8/seal/policy/v2'),
  }
}
export function completeReadRegistryHash(registry: Shape) {
  return hash({ registry_id: A, root_id: A, maker_version: U, root_content_commitment: V, policy_id: A,
    base_count: U, pack_count: U, complete_count: U, base_commitment: V, pack_commitment: V, complete_commitment: V,
    revision: U, sealed: B }, { ...registry, registry_id: registry.id, policy_id: registry.policy_config_id }, 'animacraft-fresh-v8/seal/registry/v2')
}
export function completeReadCertificationHash(registry: Shape, asset: Shape) {
  return hash({ catalog_id: A, product_binding_commitment: V, policy_commitment: V, root_content_commitment: V,
    maker_version: U, scope_kind: bcs.u8(), scope_key: S, scope_commitment: V, asset_key: S, asset_content_commitment: V,
    ciphertext_blob_id: S, ciphertext_sha256: V, ciphertext_blob_commitment: V },
  { ...registry, ...asset }, 'animacraft-fresh-v8/seal/ciphertext-certification/v2')
}
