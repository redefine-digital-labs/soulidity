import { bcs } from '@mysten/sui/bcs'
import { nativeEquipmentSourceFixture } from './native-equipment-source'
import { NativeSoulBindingBcs, NativeSoulBcs } from '../../../web/lib/animacraft/native-receive'
import { NativeArtworkOutputBcs } from '../../../web/lib/animacraft/native-artwork'
import { EquipmentMakerBcs, EquipmentProtocolBcs } from '../../../web/lib/animacraft/native-equipment-source-bcs'
import { EquipmentProtectedAssetBcs, EquipmentProtectedKeyBcs, EquipmentSealIdBcs, EquipmentSealPolicyBcs, EquipmentSealRegistryBcs } from '../../../web/lib/animacraft/native-equipment-seal'
import { CompleteReadCatalogBcs, CompleteReadEmptyKeyBcs, CompleteReadNativeSlotBcs, CompleteReadReceiptBcs,
  CompleteReadReleaseConfigBcs, completeReadCatalogHashes, completeReadCertificationHash, completeReadHash,
  completeReadOutputHashes, completeReadPolicyHashes, completeReadRegistryHash, completeReadRoleHash } from '../../../web/lib/animacraft/native-complete-read-bcs'
import { readNativeCompleteReadTarget } from '../../../web/lib/animacraft/native-complete-read'
import { NATIVE_SEAL_ENCRYPTION_PROFILE as profile } from '../../../web/lib/animacraft/native-seal-profile'

export const completeId = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const id = completeId, h = (n: number) => Array(32).fill(n)
export function nativeCompleteReadFixture(profileOverride: Partial<Record<keyof typeof profile, string>> = {},
  keyPolicy: { weights: [number, number]; threshold: number } = { weights: [2, 3], threshold: 4 }) {
  const f = nativeEquipmentSourceFixture(), A = bcs.Address
  const target = { ...f.target, release: { originalPackageId: id(240), callablePackageId: id(241), callableDigest: f.target.outputCallableDigest } }
  const addOrigin = (pkgId: string, moduleName: string, names: string[], packageId: string) => {
    const pkg = f.objects.get(pkgId).package
    if (!pkg.modules.some((m: any) => m.name === moduleName)) pkg.modules.push({ name: moduleName, contents: new Uint8Array([1,2,3,4,5]) })
    names.forEach(datatypeName => { if (!pkg.typeOrigins.some((r: any) => r.moduleName === moduleName && r.datatypeName === datatypeName)) {
      pkg.typeOrigins.push({ moduleName, datatypeName, packageId })
    } })
  }
  const newPackage = (original: number, callable: number, module: string, names: string[]) => {
    f.objects.set(id(callable), { objectId: id(callable), version: 1n, digest: target.outputCallableDigest, owner: { kind: 4 },
      package: { storageId: id(callable), originalId: id(original), version: 1n, modules: [], typeOrigins: [], linkage: [] } })
    addOrigin(id(callable), module, names, id(original))
  }
  newPackage(210, 211, 'seal_v8', ['SealCallableMarkerV8','SealSetupInstallWitnessV2','SealRegistryV8','SealPolicyConfigV8','ProtectedAssetV8','ProtectedAssetKeyV8'])
  newPackage(220, 221, 'physical_v8', ['PhysicalCallableMarkerV8'])
  newPackage(230, 231, 'market_v8', ['MarketCallableMarkerV8'])
  newPackage(240, 241, 'release_v8', ['ReleaseCallableMarkerV8','ReleaseSetupInstallWitnessV2','ReleaseTransportWitnessV8','ReleasePackageConfigV8'])
  addOrigin(id(71), 'runtime_v8', ['RuntimeCallableMarkerV8'], id(70))
  addOrigin(id(4), 'output_v8', ['OutputCallableMarkerV8','CompleteReceiptV8','NativeCompleteBindingKeyV8'], id(3))
  addOrigin(id(72), 'protocol_config_v8', ['SoulidityBindingSlotKeyV8','SoulidityBindingV8','ProductReleaseCatalogSlotKeyV2','ProductReleaseCatalogSlotV2'], id(2))
  addOrigin(id(72), 'package_binding_v8', ['ProductReleaseCatalogV8'], id(2))
  const addLink = (parent: number, original: number, callable: number) => {
    const links = f.objects.get(id(parent)).package.linkage
    if (!links.some((r: any) => r.originalId === id(original))) links.push({ originalId: id(original), upgradedId: id(callable), upgradedVersion: 1n })
  }
  const originals = [2,210,70,3,220,230,240], callables = [72,211,71,4,221,231,241]
  originals.slice(0,5).forEach((original, i) => addLink(241, original, callables[i]))
  addLink(241,6,5); addLink(4,2,72); addLink(4,210,211); addLink(5,210,211)
  const ct = (module: string, name: string) => `${id(2)}::${module}::${name}`
  const ot = (name: string) => `${id(3)}::output_v8::${name}`
  const st = (name: string) => `${id(210)}::seal_v8::${name}`
  const protocol = EquipmentProtocolBcs.parse(f.objects.get(id(1)).contents.value)
  const root = EquipmentMakerBcs.parse(f.objects.get(id(10)).contents.value)
  const catalog: any = { id: id(32), schema_revision: '2', protocol_config_id: id(1), protocol_config_revision: protocol.revision,
    protocol_config_commitment: protocol.commitment, binding: { bindings: originals.map((original, i) => ({ original_package_id: id(original),
      callable_package_id: id(original), source_commitment: h(30+i), package_commitment: h(40+i), abi_commitment: h(50+i), commitment: h(1) })), commitment: h(1) },
    authority_ids: Array.from({ length: 6 }, (_, i) => id(250+i)), call_cap_set_commitment: h(1), catalog_commitment: h(1), next_setup_role: 6,
    role_config_ids: Array.from({ length: 6 }, (_, i) => id(260+i)), role_config_commitments: Array.from({ length: 6 }, () => h(1)) }
  const ch = completeReadCatalogHashes(catalog)
  catalog.binding.bindings.forEach((row: any, i: number) => row.commitment = ch.bindings[i])
  catalog.binding.commitment = ch.tuple; catalog.call_cap_set_commitment = ch.caps; catalog.catalog_commitment = ch.commitment
  const policy: any = { id: id(260), version: '8', protocol_config_id: id(1), protocol_config_revision: protocol.revision,
    catalog_id: id(32), product_binding_commitment: ch.tuple, seal_original_package_id: id(210), seal_callable_package_id: id(210),
    seal_binding_commitment: ch.bindings[1], seal_authority_id: id(250), call_cap_set_commitment: ch.caps, role: 1, finalized: true,
    key_servers: [{ key_server_id: id(270), weight: keyPolicy.weights[0] }, { key_server_id: id(271), weight: keyPolicy.weights[1] }], threshold: keyPolicy.threshold,
    cipher_suite: profileOverride.cipherSuite ?? profile.cipherSuite, key_derivation: profileOverride.keyDerivation ?? profile.keyDerivation,
    ciphertext_format: profileOverride.ciphertextFormat ?? profile.ciphertextFormat,
    max_plaintext_bytes: String(3 * 1024 * 1024), key_server_set_commitment: h(1), encryption_policy_commitment: h(1), commitment: h(1), config_commitment: h(1) }
  const ph = completeReadPolicyHashes(policy); policy.key_server_set_commitment = ph.servers; policy.encryption_policy_commitment = ph.encryption
  policy.commitment = completeReadPolicyHashes(policy).commitment; policy.config_commitment = completeReadRoleHash(catalog, 1, policy.id, policy)
  catalog.role_config_commitments[0] = policy.config_commitment
  catalog.role_config_commitments[5] = completeReadRoleHash(catalog, 6, id(265))
  f.put(id(265), `${id(240)}::release_v8::ReleasePackageConfigV8`, CompleteReadReleaseConfigBcs, { id: id(265), version: '8',
    catalog_id: id(32), product_binding_commitment: ch.tuple, call_cap_set_commitment: ch.caps, installation_commitment: catalog.role_config_commitments[5] })
  f.put(id(32), ct('package_binding_v8','ProductReleaseCatalogV8'), CompleteReadCatalogBcs, catalog)
  f.put(id(260), st('SealPolicyConfigV8'), EquipmentSealPolicyBcs, policy)
  f.set(id(10), EquipmentMakerBcs, value => { value.publication.release_commitments = { product_binding_commitment: ch.tuple, call_cap_set_commitment: ch.caps } })
  const nativeSlot = CompleteReadNativeSlotBcs.parse(f.dynamicField.value.bcs)
  const slotId = f.field(id(1), ct('protocol_config_v8','SoulidityBindingSlotKeyV8'), CompleteReadEmptyKeyBcs, { dummy_field: false },
    ct('protocol_config_v8','SoulidityBindingV8'), CompleteReadNativeSlotBcs, nativeSlot)
  const catalogPointerId = f.field(id(1), ct('protocol_config_v8','ProductReleaseCatalogSlotKeyV2'), CompleteReadEmptyKeyBcs, { dummy_field: false },
    ct('protocol_config_v8','ProductReleaseCatalogSlotV2'), bcs.struct('ProductReleaseCatalogSlotV2', { catalog_id: A }), { catalog_id: id(32) })
  const blobId = Buffer.alloc(32, 29).toString('base64url')
  const output: any = { id: id(15), version: '8', root_id: id(10), maker_version: '1', root_content_commitment: h(1), output_registry_id: id(88),
    output_key: 'main', original_holder: id(11), holder: id(11), loadout_id: id(80), loadout_revision: '1', loadout_commitment: h(60),
    output_policy_commitment: h(61), renderer_schema_commitment: h(62), recipe_commitment: h(63), render_commitment: h(64),
    render_blob_id: blobId, render_sha256: h(65), render_blob_commitment: h(66), output_commitment: h(67), protected: true,
    scope_key: 'complete/main', asset_key: 'artwork/one', seal_id: h(1), protection_binding_commitment: h(1) }
  const receipt: any = { ...output, id: id(16), output_id: id(15), economics_commitment: root.economics.commitment,
    base_line: { ordinal: '0', base_gross_atomic: '0', base_protocol_atomic: '0', maker_atomic: '0', fixed_protocol_atomic: '0', total_atomic: '0' },
    pack_lines: [], total_paid_atomic: '0', receipt_commitment: h(1) }
  output.render_commitment = completeReadOutputHashes(output, receipt, root.content.renderer_commitment).render
  output.output_commitment = completeReadOutputHashes(output, receipt, root.content.renderer_commitment).output
  receipt.render_commitment = output.render_commitment; receipt.output_commitment = output.output_commitment
  receipt.receipt_commitment = completeReadOutputHashes(output, receipt, root.content.renderer_commitment).receipt
  const registry: any = { id: id(87), version: '8', root_id: id(10), maker_version: '1', root_content_commitment: h(1), catalog_id: id(32),
    product_binding_commitment: ch.tuple, policy_config_id: id(260), policy_commitment: policy.commitment,
    expected_base_count: '0', expected_pack_count: '0', expected_complete_count: '0', base_count: '0', pack_count: '0', complete_count: '1',
    base_commitment: h(1), pack_commitment: h(2), complete_commitment: h(3), revision: '1', commitment: h(1), sealed: true,
    keys: [], assets: { id: id(280), size: '0' }, runtime_revision: '1',
    runtime_keys: [{ scope_kind: 2, scope_key: output.scope_key, asset_key: output.asset_key }], runtime_assets: { id: id(281), size: '1' } }
  registry.commitment = completeReadRegistryHash(registry)
  const key = { scope_kind: 2, scope_key: output.scope_key, asset_key: output.asset_key }
  const aad = EquipmentSealIdBcs.serialize({ ...registry, ...key, domain: 'animacraft-fresh-v8/seal/ciphertext-id/v2', schema_revision: '2' }).toBytes()
  output.seal_id = completeReadHash(aad); receipt.seal_id = output.seal_id
  output.protection_binding_commitment = completeReadOutputHashes(output, receipt, root.content.renderer_commitment).protection
  const hashes = completeReadOutputHashes(output, receipt, root.content.renderer_commitment)
  const asset: any = { ...key, scope_commitment: hashes.instance, asset_content_commitment: output.output_commitment,
    ciphertext_blob_id: blobId, ciphertext_sha256: output.render_sha256, ciphertext_blob_commitment: output.render_blob_commitment,
    certification_commitment: h(1), seal_id: output.seal_id }
  asset.certification_commitment = completeReadCertificationHash(registry, asset)
  f.put(id(87), st('SealRegistryV8'), EquipmentSealRegistryBcs, registry)
  const assetId = f.field(id(281), st('ProtectedAssetKeyV8'), EquipmentProtectedKeyBcs, key, st('ProtectedAssetV8'), EquipmentProtectedAssetBcs, asset)
  f.put(id(15), ot('CompleteOutputV8'), NativeArtworkOutputBcs, output, 4)
  f.put(id(16), ot('CompleteReceiptV8'), CompleteReadReceiptBcs, receipt, 4)
  f.set(id(13), NativeSoulBindingBcs, value => {
    for (const name of ['output_key','root_content_commitment','output_policy_commitment','recipe_commitment','render_commitment','output_commitment']) value[name] = output[name]
    value.receipt_commitment = receipt.receipt_commitment; value.authorization_commitment = hashes.authorization
  })
  f.set(id(12), NativeSoulBcs, value => { value.image_url = `walrus://${blobId}` })
  const markerId = f.field(id(15), ot('NativeCompleteBindingKeyV8'), CompleteReadEmptyKeyBcs, { dummy_field: false }, '0x2::object::ID', A, id(13))
  return { ...f, target, blobId, aad, output, receipt, registry, policy, catalog, asset, assetId, markerId, slotId, catalogPointerId, ct, ot, st,
    read: (signal?: AbortSignal) => readNativeCompleteReadTarget(f.client, target, { soulId: id(12), stateId: id(14) }, signal) }
}
