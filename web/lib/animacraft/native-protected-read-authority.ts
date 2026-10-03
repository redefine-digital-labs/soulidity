import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, parseStructTag } from '@mysten/sui/utils'
import { attestNativeReceiveTarget, decodeNativeBcs, NativeReceiveError, receiveId, type NativeReceiveTarget } from './native-receive'
import { EquipmentReadSet } from './native-equipment'
import { EquipmentMakerBcs, EquipmentProtocolBcs } from './native-equipment-source-bcs'
import { equipmentEconomicsCommitment, equipmentProtocolCommitment } from './native-equipment-source'
import { EquipmentSealPolicyBcs, EquipmentSealRegistryBcs } from './native-equipment-seal'
import { CompleteReadCatalogBcs, CompleteReadEmptyKeyBcs, CompleteReadNativeSlotBcs,
  CompleteReadReleaseConfigBcs, completeReadCatalogHashes,
  completeReadPolicyHashes, completeReadRegistryHash, completeReadRoleHash } from './native-complete-read-bcs'
import { assertNativeSealEncryptionProfile } from './native-seal-profile'
import { equipmentBytesEqual, equipmentUtf8 } from './native-equipment-bytes'

const A = bcs.Address
const eq = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.some(v => v !== 0) && a.every((v, i) => v === b[i])
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_COMPLETE_READ_INVALID', message)
}
type ObjectRow = NonNullable<Awaited<ReturnType<SuiGrpcClient['ledgerService']['getObject']>>['response']['object']>

/** Only explicitly public transport URLs; no private overrides, default
 * servers, default weights or testnet fallback can enter this read target. */
export function completeReadAggregatorUrls(env: Record<string, string | undefined> = process.env): Map<string, string> {
  const raw = env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS
  if (!raw) return new Map()
  try {
    check(env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet', 'Mainnet service config required')
    const entries = JSON.parse(raw)
    check(Array.isArray(entries) && entries.length <= 64, 'Public Seal service list invalid')
    const ids = new Set<string>(), urls = new Map<string, string>()
    for (const row of entries) {
      check(row && typeof row === 'object' && !Array.isArray(row)
        && Object.keys(row).every(key => ['objectId', 'weight', 'aggregatorUrl'].includes(key)), 'Secret/unrecognized public service fields')
      const id = receiveId(row.objectId)
      check(!ids.has(id), 'Duplicate public service'); ids.add(id)
      if (row.aggregatorUrl === undefined) continue
      check(typeof row.aggregatorUrl === 'string', 'Aggregator URL missing')
      const url = new URL(row.aggregatorUrl)
      check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
        && url.hostname !== 'localhost' && !/^\d+(?:\.\d+){3}$/.test(url.hostname) && !url.hostname.includes(':'), 'Aggregator URL must be public and credential-free')
      urls.set(id, url.href)
    }
    return urls
  } catch {
    throw new NativeReceiveError('NATIVE_COMPLETE_READ_SERVICES_UNAVAILABLE', 'Explicit public Seal services are invalid', 503)
  }
}

/** Shared exact Release/Seal authority for Complete and current equipment reads. */
export async function createNativeProtectedReadContext(client: SuiGrpcClient, target: NativeReceiveTarget,
  reads: EquipmentReadSet, signal?: AbortSignal) {
  if (!target.release) throw new NativeReceiveError('NATIVE_COMPLETE_READ_TARGET_UNAVAILABLE', 'Exact Release package pin is required', 503)
  const pin = target.release
  const types = await attestNativeReceiveTarget(client, target)
  const packages = new Map<string, ObjectRow>()
  const raw = async (objectId: string) => {
    signal?.throwIfAborted()
    return (await client.ledgerService.getObject({ objectId: receiveId(objectId),
      readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents', 'package'] } })).response.object
  }
  const pkg = async (id: string, original: string, digest?: string, version?: bigint) => {
    const row = packages.get(id) ?? await raw(id)
    check(row?.objectId === id && row.owner?.kind === 4 && row.version && row.version > 0n
      && row.package?.storageId === id && row.package.originalId === original && row.package.version === row.version
      && (!digest || row.digest === digest) && (!version || row.version === version), 'Exact package identity/digest mismatch')
    const names = row.package.typeOrigins.map(origin => `${origin.moduleName}::${origin.datatypeName}`)
    check(new Set(names).size === names.length, 'Duplicate package type origins')
    packages.set(id, row)
    return row
  }
  const origin = (row: ObjectRow, module: string, name: string) => {
    const entries = row.package?.typeOrigins.filter(entry => entry.moduleName === module && entry.datatypeName === name)
    check(entries?.length === 1 && row.package?.modules.some(m => m.name === module && m.contents && m.contents.length > 4), 'Exact type origin unavailable')
    return `${receiveId(entries[0].packageId)}::${module}::${name}`
  }
  const link = (parent: ObjectRow, original: string) => {
    const links = parent.package?.linkage.filter(row => row.originalId === original)
    check(links?.length === 1 && links[0].upgradedVersion, 'Exact dependency linkage unavailable')
    return links[0]
  }
  const linked = async (parent: ObjectRow, original: string) => {
    const l = link(parent, original)
    return pkg(receiveId(l.upgradedId), original, undefined, l.upgradedVersion)
  }
  const assertLink = (parent: ObjectRow, child: ObjectRow) => {
    const l = link(parent, child.package!.originalId!)
    check(l.upgradedId === child.objectId && l.upgradedVersion === child.version, 'Dependency release substitution')
  }
  const release = await pkg(pin.callablePackageId, pin.originalPackageId, pin.callableDigest)
  const native = await pkg(target.soulidityCallablePackageId, target.soulidityOriginalPackageId, target.soulidityCallableDigest)
  const outputPackage = await pkg(target.outputCallablePackageId, target.outputOriginalPackageId, target.outputCallableDigest)
  for (const child of [native, outputPackage]) assertLink(release, child)
  assertLink(native, outputPackage)
  const core = await linked(release, target.coreOriginalPackageId)
  assertLink(native, core); assertLink(outputPackage, core)
  const ct = (module: string, name: string) => origin(core, module, name)
  const ot = (name: string) => origin(outputPackage, 'output_v8', name)
  const empty = { dummy_field: false }
  const field = async (parent: string, keyType: string, keySchema: any, key: any, valueType: string, schema: any, optional = false): Promise<any> => {
    const keyBytes = keySchema.serialize(key).toBytes()
    const id = deriveDynamicFieldID(parent, keyType, keyBytes)
    const type = `0x2::dynamic_field::Field<${keyType},${valueType}>`
    const bytes = optional ? await reads.optional(id, type, 2, parent) : await reads.read(id, type, 2, parent)
    if (bytes === null) return null
    const row = decodeNativeBcs(bcs.struct('Field', { id: A, name: keySchema, value: schema }), bytes)
    check(row.id === id && equipmentBytesEqual(keySchema.serialize(row.name).toBytes(), keyBytes), 'Dynamic field key/ID mismatch')
    return row.value
  }
  return { client, target, reads, types, raw, pkg, origin, link, linked, assertLink, release, native, outputPackage, core, ct, ot, empty, field, pin }
}

export async function readNativeProtectedReadPolicy(context: Awaited<ReturnType<typeof createNativeProtectedReadContext>>,
  input: { rootId: string; makerVersion: string; rootContentCommitment: number[] }) {
  const { client, target, reads, types, raw, pkg, origin, link, linked, assertLink, release, native, outputPackage, core, ct, ot, empty, field, pin } = context
    const rawRoot = await raw(input.rootId)
    check(rawRoot?.objectType, 'Root type unavailable')
    const tag = parseStructTag(rawRoot.objectType)
    check(tag.typeParams.length === 1 && typeof tag.typeParams[0] !== 'string', 'Root payment type invalid')
    const coin = normalizeStructTag(tag.typeParams[0])
    const root = decodeNativeBcs(EquipmentMakerBcs, reads.accept(rawRoot, input.rootId, `${ct('maker_v8', 'MakerRootV8')}<${coin}>`, 3))
    const registryIds = root.publication.registry_ids, terms = root.publication.release_commitments
    check(root.id === input.rootId && root.version === '8' && root.maker_version === input.makerVersion
      && eq(root.content.content_commitment, input.rootContentCommitment) && [1, 2, 3].includes(root.lifecycle)
      && root.core_original_package_id === target.coreOriginalPackageId
      && root.core_callable_package_id === parseStructTag(ct('protocol_config_v8', 'CorePackageMarkerV8')).address
      && root.economics.protocol_config_id === target.protocolConfigId && normalizeStructTag(root.economics.payment_coin_type) === coin
      && eq(root.economics.commitment, equipmentEconomicsCommitment(root.economics))
      && registryIds && terms && root.publication.catalog_id,
    'Root immutable provenance/companion mismatch')
    const protocol = decodeNativeBcs(EquipmentProtocolBcs, await reads.read(target.protocolConfigId, ct('protocol_config_v8', 'ProtocolConfigV8'), 3))
    check(protocol.id === target.protocolConfigId && protocol.version === '8' && eq(protocol.commitment, equipmentProtocolCommitment(protocol)), 'Protocol commitment mismatch')
    const slot = await field(protocol.id, ct('protocol_config_v8', 'SoulidityBindingSlotKeyV8'), CompleteReadEmptyKeyBcs, empty,
      ct('protocol_config_v8', 'SoulidityBindingV8'), CompleteReadNativeSlotBcs)
    check(slot.config_id === protocol.id, 'Native protocol slot parent mismatch')
    for (const [stored, expected] of [['soul_original','soulOriginalType'],['soul_defining','soulDefiningType'],
      ['mint_original','mintWitnessOriginalType'],['mint_defining','mintWitnessDefiningType'],
      ['owner_original','ownerWitnessOriginalType'],['owner_defining','ownerWitnessDefiningType']] as const) {
      check(`0x${slot[stored].name}` === target.expectedNativeBinding[expected], 'Native owner witness type pin mismatch')
    }
    const catalogId = root.publication.catalog_id
    const catalogSlot = await field(protocol.id, ct('protocol_config_v8', 'ProductReleaseCatalogSlotKeyV2'), CompleteReadEmptyKeyBcs, empty,
      ct('protocol_config_v8', 'ProductReleaseCatalogSlotV2'), bcs.struct('ProductReleaseCatalogSlotV2', { catalog_id: A }))
    check(catalogSlot.catalog_id === catalogId, 'Protocol catalog pointer mismatch')
    const catalog = decodeNativeBcs(CompleteReadCatalogBcs, await reads.read(catalogId, ct('package_binding_v8', 'ProductReleaseCatalogV8'), 3))
    check(catalog.id === catalogId && catalog.schema_revision === '2' && catalog.protocol_config_id === protocol.id
      && catalog.binding.bindings.length === 7 && catalog.authority_ids.length === 6
      && catalog.role_config_ids.length === 6 && catalog.role_config_commitments.length === 6 && catalog.next_setup_role === 6,
    'Catalog setup shape mismatch')
    for (const ids of [catalog.authority_ids, catalog.role_config_ids,
      catalog.binding.bindings.map(row => row.original_package_id), catalog.binding.bindings.map(row => row.callable_package_id)]) {
      ids.forEach(receiveId); check(new Set(ids).size === ids.length, 'Catalog duplicate identity')
    }
    const catalogHashes = completeReadCatalogHashes(catalog)
    check(eq(catalog.catalog_commitment, catalogHashes.commitment) && eq(catalog.call_cap_set_commitment, catalogHashes.caps)
      && eq(catalog.binding.commitment, catalogHashes.tuple) && eq(terms.product_binding_commitment, catalogHashes.tuple)
      && eq(terms.call_cap_set_commitment, catalogHashes.caps)
      && catalog.binding.bindings.every((row, i) => eq(row.commitment, catalogHashes.bindings[i])), 'Catalog canonical commitment mismatch')
    const roleNames = [['protocol_config_v8','CorePackageMarkerV8'],['seal_v8','SealCallableMarkerV8'],
      ['runtime_v8','RuntimeCallableMarkerV8'],['output_v8','OutputCallableMarkerV8'],['physical_v8','PhysicalCallableMarkerV8'],
      ['market_v8','MarketCallableMarkerV8'],['release_v8','ReleaseCallableMarkerV8']] as const
    const rolePackages: ObjectRow[] = []
    for (const [i, role] of catalog.binding.bindings.entries()) {
      // Market is part of the canonical publication tuple but not a Release
      // protected-read dependency. Never invent a linkage to an unused role.
      if (i === 5) continue
      const row = i === 6 ? release : await linked(release, role.original_package_id)
      check(row.package!.originalId === role.original_package_id
        && parseStructTag(origin(row, roleNames[i][0], roleNames[i][1])).address === role.callable_package_id, 'Catalog package/marker mismatch')
      rolePackages[i] = row
    }
    check(rolePackages[0].objectId === core.objectId && rolePackages[3].objectId === outputPackage.objectId, 'Catalog native dependency mismatch')
    const seal = rolePackages[1]
    assertLink(native, seal); assertLink(outputPackage, seal)
    const st = (name: string) => origin(seal, 'seal_v8', name)
    const releaseConfigId = catalog.role_config_ids[5]
    const releaseConfig = decodeNativeBcs(CompleteReadReleaseConfigBcs, await reads.read(releaseConfigId, origin(release, 'release_v8', 'ReleasePackageConfigV8'), 3))
    const installation = completeReadRoleHash(catalog, 6, releaseConfigId)
    check(releaseConfig.id === releaseConfigId && releaseConfig.version === '8' && releaseConfig.catalog_id === catalogId
      && eq(releaseConfig.product_binding_commitment, catalog.binding.commitment)
      && eq(releaseConfig.call_cap_set_commitment, catalog.call_cap_set_commitment)
      && eq(releaseConfig.installation_commitment, installation) && eq(catalog.role_config_commitments[5], installation)
      && parseStructTag(origin(release, 'release_v8', 'ReleaseTransportWitnessV8')).address === catalog.binding.bindings[6].callable_package_id
      && parseStructTag(origin(release, 'release_v8', 'ReleaseSetupInstallWitnessV2')).address === catalog.binding.bindings[6].callable_package_id,
    'Release installation mismatch')
    const registry = decodeNativeBcs(EquipmentSealRegistryBcs, await reads.read(registryIds.seal_registry_id, st('SealRegistryV8'), 3))
    const policy = decodeNativeBcs(EquipmentSealPolicyBcs, await reads.read(registry.policy_config_id, st('SealPolicyConfigV8'), 3))
    check(registry.id === registryIds.seal_registry_id && registry.version === '8' && registry.sealed
      && registry.root_id === root.id && registry.maker_version === root.maker_version && eq(registry.root_content_commitment, root.content.content_commitment)
      && registry.catalog_id === catalogId && eq(registry.product_binding_commitment, catalog.binding.commitment)
      && registry.policy_config_id === policy.id && eq(registry.policy_commitment, policy.commitment)
      && registry.base_count === registry.expected_base_count && BigInt(registry.pack_count) >= BigInt(registry.expected_pack_count)
      && BigInt(registry.complete_count) >= BigInt(registry.expected_complete_count) && registry.revision === registry.runtime_revision
      && eq(registry.commitment, completeReadRegistryHash(registry)), 'Seal registry identity/commitment mismatch')
    const policyHashes = completeReadPolicyHashes(policy)
    check(policy.id === catalog.role_config_ids[0] && policy.version === '8' && policy.role === 1 && policy.finalized
      && policy.catalog_id === catalogId && policy.protocol_config_id === protocol.id
      && policy.protocol_config_revision === catalog.protocol_config_revision
      && policy.seal_original_package_id === seal.package!.originalId
      && policy.seal_callable_package_id === catalog.binding.bindings[1].callable_package_id
      && eq(policy.seal_binding_commitment, catalog.binding.bindings[1].commitment)
      && policy.seal_authority_id === catalog.authority_ids[0] && eq(policy.call_cap_set_commitment, catalog.call_cap_set_commitment)
      && eq(policy.product_binding_commitment, catalog.binding.commitment)
      && eq(policy.key_server_set_commitment, policyHashes.servers) && eq(policy.encryption_policy_commitment, policyHashes.encryption)
      && eq(policy.commitment, policyHashes.commitment) && eq(policy.config_commitment, completeReadRoleHash(catalog, 1, policy.id, policy))
      && eq(policy.config_commitment, catalog.role_config_commitments[0]), 'Seal policy exact setup/commitment mismatch')
    const totalShares = policy.key_servers.reduce((sum, row) => sum + row.weight, 0)
    check(policy.key_servers.length > 0 && policy.key_servers.length <= 64 && policy.threshold > 0
      && totalShares < 255 && policy.threshold <= totalShares
      && BigInt(policy.max_plaintext_bytes) > 0n && BigInt(policy.max_plaintext_bytes) <= 3n * 1024n * 1024n,
    'Seal policy bounds invalid')
    policy.key_servers.forEach((row, i) => { receiveId(row.key_server_id)
      check(row.weight > 0 && (i === 0 || policy.key_servers[i - 1].key_server_id < row.key_server_id), 'Seal key server order/weight invalid') })
    for (const value of [policy.cipher_suite, policy.key_derivation, policy.ciphertext_format]) {
      check(equipmentUtf8(value).length > 0 && equipmentUtf8(value).length <= 128, 'Seal cipher descriptor invalid')
    }
    try { assertNativeSealEncryptionProfile({ cipherSuite: policy.cipher_suite,
      keyDerivation: policy.key_derivation, ciphertextFormat: policy.ciphertext_format }) } catch {
      throw new NativeReceiveError('NATIVE_SEAL_PROFILE_UNSUPPORTED', 'Unsupported certified Seal profile', 503)
    }
  const rt = (name: string) => origin(rolePackages[2], 'runtime_v8', name)
  const baseType = (name: string) => ct('base_registry_v8', name)
  return { root, protocol, catalogId, catalog, releaseConfigId, releaseConfig, registry, policy, coin, seal, st, rt, baseType, rolePackages }
}
