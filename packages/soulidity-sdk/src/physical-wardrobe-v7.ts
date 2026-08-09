import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { getAnimacraftWardrobeV7Id } from './queries'

/**
 * Client contract for Animacraft physical-composition v7.
 *
 * Package/object IDs are deliberately runtime configuration. No v7 package
 * identity is copied into Soulidity's deployment manifest before the package
 * has been reviewed and activated. The public gate defaults to OFF and every
 * transaction builder fails closed when any identity is absent.
 */
export const PHYSICAL_WARDROBE_V7_ABI_VERSION = 1 as const
export const PHYSICAL_WARDROBE_V7_MODULE = 'physical_composition_v7' as const
export const SOULIDITY_WARDROBE_ADAPTER_V7_MODULE = 'animacraft_wardrobe_adapter_v7' as const

export type PhysicalWardrobeV7Operation =
  | 'create'
  | 'deposit-and-equip'
  | 'deposit-and-swap'
  | 'equip'
  | 'swap'
  | 'unequip'
  | 'withdraw'
  | 'emergency-withdraw'

export interface PhysicalWardrobeV7Runtime {
  enabled: boolean
  soulidityCallablePackageId: string
  soulidityTypeOriginPackageId: string
  animacraftCallablePackageId: string
  animacraftTypeOriginPackageId: string
  physicalRegistryObjectId: string
  physicalProtocolConfigObjectId: string
  compositionProtocolConfigObjectId: string
  commerceProtocolConfigObjectId: string
}

export interface PhysicalWardrobeV7MakerContext {
  physicalProfileObjectId: string
  compositionProfileObjectId: string
  makerRootObjectId: string
}

export type PhysicalPartBehaviorV7 = 0 | 1 | 2 | 3
export type PhysicalPartSourceKindV7 = 0 | 1 | 2

export interface PhysicalPartPolicyV7View {
  slotKey: string
  /** 0 Fixed, 1 Soul-local, 2 Open, 3 Hybrid. */
  behavior: PhysicalPartBehaviorV7
  required: boolean
  /** 0 Official, 1 Certified, 2 Open. */
  maxSourceKind: PhysicalPartSourceKindV7
}

export interface PhysicalMakerProfileV7View extends PhysicalWardrobeV7MakerContext {
  sealed: boolean
  partPoliciesTableObjectId: string
  requiredSlotKeys: string[]
  partPolicyCount: number
  /** Loaded from the profile's on-chain Table, including currently empty slots. */
  partPolicies: PhysicalPartPolicyV7View[]
}

export interface PhysicalWardrobeV7SoulContext {
  soulObjectId: string
  soulStateObjectId: string
  wardrobeObjectId: string
  expectedRevision: number | bigint
}

export interface PhysicalWardrobeV7LoadoutRow {
  slotKey: string
  styleAssetObjectId: string
  styleProductObjectId: string | null
  itemFamilyObjectId: string | null
  soulLocal: boolean
}

export interface PhysicalStyleAssetV7View {
  objectId: string
  styleProductObjectId: string
  itemFamilyObjectId: string
  profileObjectId: string
  v6ProductObjectId: string
  slotKey: string
  sourceKind: number
  assetKind: number
  soulLocal: boolean
  transferable: boolean
  serial: bigint
  holderAddress: string | null
  /** Derived from SoulWardrobeV7.equipped_asset_ids, never read from the asset. */
  equipped: boolean
  name: string
  imageUrl: string | null
}

export interface PhysicalSoulWardrobeV7View {
  objectId: string
  soulObjectId: string
  rootObjectId: string
  profileObjectId: string
  revision: bigint
  initialized: boolean
  listed: boolean
  externalAssetCount: number
  soulLocalAssetCount: number
  equippedCount: number
  equippedAssetObjectIds: string[]
  /** Derived by joining equippedAssetObjectIds to object-owned StyleAssetV7s. */
  loadout: PhysicalWardrobeV7LoadoutRow[]
}

export interface PhysicalWardrobeV7Snapshot {
  wardrobe: PhysicalSoulWardrobeV7View
  maker: PhysicalMakerProfileV7View
  wardrobeAssets: PhysicalStyleAssetV7View[]
  walletAssets: PhysicalStyleAssetV7View[]
}

export class PhysicalWardrobeV7DisabledError extends Error {
  constructor(message = 'Physical Wardrobe v7 is not enabled for this deployment') {
    super(message)
    this.name = 'PhysicalWardrobeV7DisabledError'
  }
}

function env(name: string): string {
  return typeof process !== 'undefined' ? (process.env[name]?.trim() ?? '') : ''
}

/** Browser-safe loader. Explicit property reads allow Next to inline values. */
export function physicalWardrobeV7RuntimeFromPublicEnv(): PhysicalWardrobeV7Runtime {
  return {
    enabled: process.env.NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_ENABLED === 'true',
    soulidityCallablePackageId: process.env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID?.trim() ?? '',
    soulidityTypeOriginPackageId: process.env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID?.trim() ?? '',
    animacraftCallablePackageId: process.env.NEXT_PUBLIC_ANIMACRAFT_V7_CALLABLE_PACKAGE_ID?.trim() ?? '',
    animacraftTypeOriginPackageId: process.env.NEXT_PUBLIC_ANIMACRAFT_V7_TYPE_ORIGIN_PACKAGE_ID?.trim() ?? '',
    physicalRegistryObjectId: process.env.NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_REGISTRY_ID?.trim() ?? '',
    physicalProtocolConfigObjectId: process.env.NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_CONFIG_ID?.trim() ?? '',
    compositionProtocolConfigObjectId: process.env.NEXT_PUBLIC_ANIMACRAFT_COMPOSITION_V6_CONFIG_ID?.trim() ?? '',
    commerceProtocolConfigObjectId: process.env.NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_CONFIG_ID?.trim() ?? '',
  }
}

/** Node/runtime loader for callers that cannot use Next's public env inlining. */
export function physicalWardrobeV7RuntimeFromEnv(): PhysicalWardrobeV7Runtime {
  return {
    enabled: env('NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_ENABLED') === 'true',
    soulidityCallablePackageId: env('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID'),
    soulidityTypeOriginPackageId: env('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID'),
    animacraftCallablePackageId: env('NEXT_PUBLIC_ANIMACRAFT_V7_CALLABLE_PACKAGE_ID'),
    animacraftTypeOriginPackageId: env('NEXT_PUBLIC_ANIMACRAFT_V7_TYPE_ORIGIN_PACKAGE_ID'),
    physicalRegistryObjectId: env('NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_REGISTRY_ID'),
    physicalProtocolConfigObjectId: env('NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_CONFIG_ID'),
    compositionProtocolConfigObjectId: env('NEXT_PUBLIC_ANIMACRAFT_COMPOSITION_V6_CONFIG_ID'),
    commerceProtocolConfigObjectId: env('NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_CONFIG_ID'),
  }
}

function requireId(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new PhysicalWardrobeV7DisabledError(`Missing ${label}`)
  try {
    return normalizeSuiAddress(trimmed)
  } catch {
    throw new PhysicalWardrobeV7DisabledError(`Invalid ${label}`)
  }
}

export function assertPhysicalWardrobeV7Runtime(
  runtime: PhysicalWardrobeV7Runtime,
): PhysicalWardrobeV7Runtime {
  if (!runtime.enabled) throw new PhysicalWardrobeV7DisabledError()
  requireId(runtime.soulidityCallablePackageId, 'Soulidity v7 callable package ID')
  requireId(runtime.soulidityTypeOriginPackageId, 'Soulidity v7 type-origin package ID')
  requireId(runtime.animacraftCallablePackageId, 'Animacraft v7 callable package ID')
  requireId(runtime.animacraftTypeOriginPackageId, 'Animacraft v7 type-origin package ID')
  requireId(runtime.physicalRegistryObjectId, 'Animacraft physical registry object ID')
  requireId(runtime.physicalProtocolConfigObjectId, 'Animacraft physical protocol config object ID')
  requireId(runtime.compositionProtocolConfigObjectId, 'Animacraft composition v6 config object ID')
  requireId(runtime.commerceProtocolConfigObjectId, 'Animacraft commerce v5 config object ID')
  return runtime
}

export function physicalWardrobeV7Type(runtime: PhysicalWardrobeV7Runtime): string {
  assertPhysicalWardrobeV7Runtime(runtime)
  return `${runtime.animacraftTypeOriginPackageId}::${PHYSICAL_WARDROBE_V7_MODULE}::SoulWardrobeV7`
}

export function physicalStyleAssetV7Type(runtime: PhysicalWardrobeV7Runtime): string {
  assertPhysicalWardrobeV7Runtime(runtime)
  return `${runtime.animacraftTypeOriginPackageId}::${PHYSICAL_WARDROBE_V7_MODULE}::StyleAssetV7`
}

export function physicalWardrobeV7CreatedEventType(runtime: PhysicalWardrobeV7Runtime): string {
  assertPhysicalWardrobeV7Runtime(runtime)
  return `${runtime.animacraftTypeOriginPackageId}::${PHYSICAL_WARDROBE_V7_MODULE}::SoulWardrobeCreatedV7`
}

type Fields = Record<string, unknown>

function fieldsOf(value: unknown): Fields | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const fields = record.fields
  if (fields && typeof fields === 'object') return fields as Fields
  return record
}

function pick(fields: Fields, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in fields) return fields[key]
  }
  return undefined
}

function id(value: unknown): string | null {
  if (typeof value === 'string') {
    try { return normalizeSuiAddress(value) } catch { return null }
  }
  const nested = fieldsOf(value)
  return nested ? id(pick(nested, 'id', 'bytes', 'object_id', 'objectId')) : null
}

function integer(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
  try { return BigInt(value) } catch { return null }
}

function boolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) {
    try { return new TextDecoder().decode(Uint8Array.from(value)) } catch { return '' }
  }
  const nested = fieldsOf(value)
  if (nested) return text(pick(nested, 'bytes', 'value', 'vec'))
  return ''
}

function objectFields(response: unknown): Fields | null {
  const data = fieldsOf(response)?.data
  const content = fieldsOf(data)?.content
  return fieldsOf(content)?.fields as Fields | null ?? fieldsOf(content)
}

function idVector(value: unknown): string[] {
  const nested = fieldsOf(value)
  const source = nested && !Array.isArray(value)
    ? pick(nested, 'vec', 'value', 'contents')
    : value
  if (!Array.isArray(source)) return []
  return source.flatMap((entry) => {
    const objectId = id(entry)
    return objectId ? [objectId] : []
  })
}

function textVector(value: unknown): string[] {
  const nested = fieldsOf(value)
  const source = nested && !Array.isArray(value)
    ? pick(nested, 'vec', 'value', 'contents')
    : value
  if (!Array.isArray(source)) return []
  return source.map((entry) => text(entry)).filter(Boolean)
}

export function parsePhysicalSoulWardrobeV7Object(response: unknown): PhysicalSoulWardrobeV7View {
  const data = fieldsOf(response)?.data
  const objectId = id(pick(fieldsOf(data) ?? {}, 'objectId', 'object_id'))
  const fields = objectFields(response)
  if (!objectId || !fields) throw new Error('Invalid SoulWardrobeV7 object response')
  const soulObjectId = id(pick(fields, 'soul_id', 'soulId'))
  const rootObjectId = id(pick(fields, 'root_id', 'rootId'))
  const profileObjectId = id(pick(fields, 'profile_id', 'profileId', 'physical_profile_id', 'physicalProfileId'))
  const revision = integer(pick(fields, 'revision'))
  if (!soulObjectId || !rootObjectId || !profileObjectId || revision == null) {
    throw new Error('SoulWardrobeV7 is missing canonical identity fields')
  }
  const equippedAssetObjectIds = idVector(pick(fields, 'equipped_asset_ids', 'equippedAssetIds'))
  const equippedCount = Number(integer(pick(fields, 'equipped_count', 'equippedCount')) ?? 0n)
  if (equippedAssetObjectIds.length !== equippedCount) {
    throw new Error('SoulWardrobeV7 equipped index/count mismatch')
  }
  if (
    new Set(equippedAssetObjectIds.map((value) => normalizeSuiAddress(value))).size
    !== equippedCount
  ) {
    throw new Error('SoulWardrobeV7 equipped index contains duplicates')
  }
  return {
    objectId,
    soulObjectId,
    rootObjectId,
    profileObjectId,
    revision,
    initialized: boolean(pick(fields, 'initialized')),
    listed: boolean(pick(fields, 'listed')),
    externalAssetCount: Number(integer(pick(fields, 'external_asset_count', 'externalAssetCount')) ?? 0n),
    soulLocalAssetCount: Number(integer(pick(fields, 'soul_local_asset_count', 'soulLocalAssetCount')) ?? 0n),
    equippedCount,
    equippedAssetObjectIds,
    loadout: [],
  }
}

export function parsePhysicalMakerProfileV7Object(
  response: unknown,
): PhysicalMakerProfileV7View {
  const data = fieldsOf(response)?.data
  const physicalProfileObjectId = id(pick(fieldsOf(data) ?? {}, 'objectId', 'object_id'))
  const fields = objectFields(response)
  if (!physicalProfileObjectId || !fields) {
    throw new Error('Invalid MakerPhysicalProfileV7 object response')
  }
  const compositionProfileObjectId = id(pick(fields, 'v6_profile_id', 'v6ProfileId'))
  const makerRootObjectId = id(pick(fields, 'root_id', 'rootId'))
  const partPoliciesTableObjectId = id(pick(fields, 'part_policies', 'partPolicies'))
  const rawPartPolicyCount = integer(pick(fields, 'part_policy_count', 'partPolicyCount'))
  if (
    !compositionProfileObjectId
    || !makerRootObjectId
    || !partPoliciesTableObjectId
    || rawPartPolicyCount == null
    || rawPartPolicyCount < 0n
    || rawPartPolicyCount > 2_000n
  ) {
    throw new Error('MakerPhysicalProfileV7 is missing canonical v6/root links')
  }
  const requiredSlotKeys = textVector(pick(fields, 'required_slot_keys', 'requiredSlotKeys'))
  if (new Set(requiredSlotKeys).size !== requiredSlotKeys.length) {
    throw new Error('MakerPhysicalProfileV7 required slot index contains duplicates')
  }
  return {
    physicalProfileObjectId,
    compositionProfileObjectId,
    makerRootObjectId,
    partPoliciesTableObjectId,
    requiredSlotKeys,
    partPolicyCount: Number(rawPartPolicyCount),
    partPolicies: [],
    sealed: boolean(pick(fields, 'sealed')),
  }
}

export function parsePhysicalPartPolicyV7DynamicFieldObject(
  response: unknown,
): PhysicalPartPolicyV7View {
  const dynamicFields = objectFields(response)
  const policyFields = dynamicFields ? fieldsOf(pick(dynamicFields, 'value')) : null
  if (!policyFields) throw new Error('Invalid PartPolicyV7 dynamic field response')
  const slotKey = text(pick(policyFields, 'slot_key', 'slotKey'))
  const behavior = Number(integer(pick(policyFields, 'behavior')) ?? -1n)
  const maxSourceKind = Number(integer(pick(policyFields, 'max_source_kind', 'maxSourceKind')) ?? -1n)
  const required = boolean(pick(policyFields, 'required'))
  if (
    !slotKey
    || behavior < 0
    || behavior > 3
    || maxSourceKind < 0
    || maxSourceKind > 2
    || ((behavior === 0 || behavior === 1) && maxSourceKind !== 0)
    || (required && behavior === 2)
  ) {
    throw new Error('PartPolicyV7 contains an invalid slot policy')
  }
  return {
    slotKey,
    behavior: behavior as PhysicalPartBehaviorV7,
    required,
    maxSourceKind: maxSourceKind as PhysicalPartSourceKindV7,
  }
}

async function loadPhysicalPartPoliciesV7(
  client: Pick<SuiJsonRpcClient, 'getDynamicFields' | 'getObject'>,
  profile: PhysicalMakerProfileV7View,
): Promise<PhysicalPartPolicyV7View[]> {
  const policies: PhysicalPartPolicyV7View[] = []
  let cursor: string | null | undefined = null
  do {
    const page = await client.getDynamicFields({
      parentId: profile.partPoliciesTableObjectId,
      cursor,
      limit: 50,
    })
    const objects = await Promise.all(page.data.map((field) => client.getObject({
      id: field.objectId,
      options: { showContent: true },
    })))
    policies.push(...objects.map(parsePhysicalPartPolicyV7DynamicFieldObject))
    if (policies.length > 2_000) {
      throw new Error('MakerPhysicalProfileV7 Part policy query exceeded the bounded limit')
    }
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)

  if (policies.length !== profile.partPolicyCount) {
    throw new Error('MakerPhysicalProfileV7 Part policy table/count mismatch')
  }
  if (new Set(policies.map((policy) => policy.slotKey)).size !== policies.length) {
    throw new Error('MakerPhysicalProfileV7 Part policy table contains duplicate slots')
  }
  const requiredFromPolicies = policies
    .filter((policy) => policy.required)
    .map((policy) => policy.slotKey)
    .sort()
  const requiredFromIndex = [...profile.requiredSlotKeys].sort()
  if (
    requiredFromPolicies.length !== requiredFromIndex.length
    || requiredFromPolicies.some((slotKey, index) => slotKey !== requiredFromIndex[index])
  ) {
    throw new Error('MakerPhysicalProfileV7 required slot index/policy mismatch')
  }
  return policies.sort((left, right) => left.slotKey.localeCompare(right.slotKey))
}

/**
 * Canonical Part list for the player wardrobe. Policies come first so an empty
 * but configurable Part remains visible before the player owns any Style.
 */
export function physicalWardrobeV7SlotKeys(snapshot: PhysicalWardrobeV7Snapshot): string[] {
  return Array.from(new Set([
    ...snapshot.maker.partPolicies.map((policy) => policy.slotKey),
    ...snapshot.wardrobe.loadout.map((row) => row.slotKey),
    ...snapshot.wardrobeAssets.map((asset) => asset.slotKey),
    ...snapshot.walletAssets.map((asset) => asset.slotKey),
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right))
}

export function physicalPartPolicyV7AcceptsAsset(
  policy: PhysicalPartPolicyV7View | null | undefined,
  asset: Pick<PhysicalStyleAssetV7View, 'slotKey' | 'soulLocal' | 'sourceKind'>,
): boolean {
  if (!policy) return false
  if (
    policy.slotKey !== asset.slotKey
    || policy.behavior === 0
    || asset.sourceKind > policy.maxSourceKind
  ) return false
  return asset.soulLocal
    ? policy.behavior === 1 || policy.behavior === 3
    : policy.behavior === 2 || policy.behavior === 3
}

export function physicalPartPolicyV7CanUnequip(
  policy: PhysicalPartPolicyV7View | null | undefined,
): boolean {
  return Boolean(policy && policy.behavior !== 0 && !policy.required)
}

/**
 * Verify that a confirmed mutation is visible in a fresh chain snapshot.
 * Revision alone is insufficient because an unrelated owner action may have
 * advanced it from another device.
 */
export function physicalWardrobeV7OperationReadbackMatches(
  snapshot: PhysicalWardrobeV7Snapshot,
  operation: Exclude<PhysicalWardrobeV7Operation, 'create'>,
  styleAssetObjectId: string,
  previousRevision: bigint,
  replacedStyleAssetObjectId: string | null = null,
): boolean {
  if (snapshot.wardrobe.listed || snapshot.wardrobe.revision <= previousRevision) return false
  const wardrobeAsset = snapshot.wardrobeAssets.find((asset) =>
    sameId(asset.objectId, styleAssetObjectId),
  )
  const walletAsset = snapshot.walletAssets.find((asset) =>
    sameId(asset.objectId, styleAssetObjectId),
  )
  if (operation === 'deposit-and-swap' || operation === 'swap') {
    if (
      !replacedStyleAssetObjectId
      || sameId(replacedStyleAssetObjectId, styleAssetObjectId)
    ) return false
    const replacedWardrobeAsset = snapshot.wardrobeAssets.find((asset) =>
      sameId(asset.objectId, replacedStyleAssetObjectId),
    )
    const replacedWalletAsset = snapshot.walletAssets.find((asset) =>
      sameId(asset.objectId, replacedStyleAssetObjectId),
    )
    return Boolean(
      wardrobeAsset?.equipped
      && !walletAsset
      && replacedWardrobeAsset
      && !replacedWardrobeAsset.equipped
      && !replacedWalletAsset,
    )
  }
  if (operation === 'deposit-and-equip' || operation === 'equip') {
    return Boolean(wardrobeAsset?.equipped && !walletAsset)
  }
  if (operation === 'unequip') {
    return Boolean(wardrobeAsset && !wardrobeAsset.equipped && !walletAsset)
  }
  return Boolean(!wardrobeAsset && walletAsset)
}

export function parsePhysicalStyleAssetV7Object(response: unknown): PhysicalStyleAssetV7View {
  const dataFields = fieldsOf(response)?.data
  const objectId = id(pick(fieldsOf(dataFields) ?? {}, 'objectId', 'object_id'))
  const fields = objectFields(response)
  if (!objectId || !fields) throw new Error('Invalid StyleAssetV7 object response')
  const slotKey = text(pick(fields, 'slot_key', 'slotKey'))
  const styleProductObjectId = id(pick(fields, 'style_product_id', 'styleProductId'))
  const itemFamilyObjectId = id(pick(fields, 'family_id', 'familyId'))
  const profileObjectId = id(pick(fields, 'profile_id', 'profileId'))
  const v6ProductObjectId = id(pick(fields, 'v6_product_id', 'v6ProductId'))
  const assetKind = Number(integer(pick(fields, 'asset_kind', 'assetKind')) ?? -1n)
  const sourceKind = Number(integer(pick(fields, 'source_kind', 'sourceKind')) ?? -1n)
  const serial = integer(pick(fields, 'serial'))
  if (
    !styleProductObjectId
    || !itemFamilyObjectId
    || !profileObjectId
    || !v6ProductObjectId
    || !slotKey
    || serial == null
    || (assetKind !== 0 && assetKind !== 1)
    || sourceKind < 0
  ) {
    throw new Error('StyleAssetV7 is missing canonical product fields')
  }
  return {
    objectId,
    styleProductObjectId,
    itemFamilyObjectId,
    profileObjectId,
    v6ProductObjectId,
    slotKey,
    sourceKind,
    assetKind,
    soulLocal: assetKind === 0,
    transferable: boolean(pick(fields, 'transferable', 'is_transferable', 'isTransferable')),
    serial,
    holderAddress: id(pick(fields, 'holder')),
    equipped: false,
    // StyleAssetV7 has no Display object. Player-facing metadata is populated
    // only after joining exact v6/v7 products and hash-bound Walrus manifests.
    name: `${slotKey} Style`,
    imageUrl: null,
  }
}

function sameId(left: string, right: string): boolean {
  try { return normalizeSuiAddress(left) === normalizeSuiAddress(right) } catch { return false }
}

export async function findPhysicalSoulWardrobeV7(
  client: Pick<SuiJsonRpcClient, 'getDynamicFieldObject' | 'getObject'>,
  runtime: PhysicalWardrobeV7Runtime,
  soulObjectId: string,
  soulStateObjectId: string,
): Promise<PhysicalSoulWardrobeV7View | null> {
  assertPhysicalWardrobeV7Runtime(runtime)
  const expectedSoulId = requireId(soulObjectId, 'Soul object ID')
  const wardrobeObjectId = await getAnimacraftWardrobeV7Id(
    requireId(soulStateObjectId, 'SoulState object ID'),
    client,
  )
  if (!wardrobeObjectId) return null
  const object = await client.getObject({ id: wardrobeObjectId, options: { showContent: true } })
  const wardrobe = parsePhysicalSoulWardrobeV7Object(object)
  if (!sameId(wardrobe.soulObjectId, expectedSoulId)) {
    throw new Error('SoulWardrobeV7 binding/object Soul mismatch')
  }
  return wardrobe
}

async function loadStyleAssets(
  client: Pick<SuiJsonRpcClient, 'getOwnedObjects'>,
  runtime: PhysicalWardrobeV7Runtime,
  owner: string,
): Promise<PhysicalStyleAssetV7View[]> {
  const result: PhysicalStyleAssetV7View[] = []
  let cursor: string | null | undefined = null
  do {
    const page = await client.getOwnedObjects({
      owner,
      cursor,
      limit: 50,
      filter: { StructType: physicalStyleAssetV7Type(runtime) },
      options: { showContent: true },
    })
    for (const row of page.data) {
      try { result.push(parsePhysicalStyleAssetV7Object(row)) } catch { /* fail closed per row */ }
    }
    if (result.length > 2_000) {
      throw new Error('Physical Style asset query exceeded the bounded limit')
    }
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)
  return result
}

export async function fetchPhysicalWardrobeV7Snapshot(
  client: Pick<
    SuiJsonRpcClient,
    'getDynamicFieldObject' | 'getDynamicFields' | 'getObject' | 'getOwnedObjects'
  >,
  runtime: PhysicalWardrobeV7Runtime,
  params: { soulObjectId: string; soulStateObjectId: string; walletAddress: string },
): Promise<PhysicalWardrobeV7Snapshot | null> {
  const wardrobe = await findPhysicalSoulWardrobeV7(
    client,
    runtime,
    params.soulObjectId,
    params.soulStateObjectId,
  )
  if (!wardrobe) return null
  if (!wardrobe.initialized) throw new Error('SoulWardrobeV7 is not finalized')
  const [profileObject, wardrobeAssets, walletAssets] = await Promise.all([
    client.getObject({ id: wardrobe.profileObjectId, options: { showContent: true } }),
    loadStyleAssets(client, runtime, wardrobe.objectId),
    loadStyleAssets(client, runtime, requireId(params.walletAddress, 'wallet address')),
  ])
  const makerProfile = parsePhysicalMakerProfileV7Object(profileObject)
  const partPolicies = await loadPhysicalPartPoliciesV7(client, makerProfile)
  const maker = { ...makerProfile, partPolicies }
  if (!maker.sealed) throw new Error('MakerPhysicalProfileV7 is not sealed')
  if (
    !sameId(maker.physicalProfileObjectId, wardrobe.profileObjectId)
    || !sameId(maker.makerRootObjectId, wardrobe.rootObjectId)
  ) {
    throw new Error('SoulWardrobeV7 Maker profile/root mismatch')
  }
  const equippedIds = new Set(
    wardrobe.equippedAssetObjectIds.map((value) => normalizeSuiAddress(value)),
  )
  const indexedWardrobeAssets = wardrobeAssets.map((asset) => ({
    ...asset,
    equipped: equippedIds.has(normalizeSuiAddress(asset.objectId)),
  }))
  const externalCount = indexedWardrobeAssets.filter((asset) => !asset.soulLocal).length
  const soulLocalCount = indexedWardrobeAssets.filter((asset) => asset.soulLocal).length
  if (
    externalCount !== wardrobe.externalAssetCount
    || soulLocalCount !== wardrobe.soulLocalAssetCount
  ) {
    throw new Error('SoulWardrobeV7 custody index/count mismatch')
  }
  const loadout = wardrobe.equippedAssetObjectIds.map((assetId) => {
    const asset = indexedWardrobeAssets.find((candidate) => sameId(candidate.objectId, assetId))
    if (!asset) {
      throw new Error(`SoulWardrobeV7 equipped child ${assetId} is not readable`)
    }
    if (!sameId(asset.profileObjectId, wardrobe.profileObjectId)) {
      throw new Error('SoulWardrobeV7 equipped child/profile mismatch')
    }
    return {
      slotKey: asset.slotKey,
      styleAssetObjectId: asset.objectId,
      styleProductObjectId: asset.styleProductObjectId,
      itemFamilyObjectId: asset.itemFamilyObjectId,
      soulLocal: asset.soulLocal,
    }
  })
  if (new Set(loadout.map((row) => row.slotKey)).size !== loadout.length) {
    throw new Error('SoulWardrobeV7 equips more than one Style in a Part')
  }
  const compatibleWalletAssets = walletAssets.filter((asset) =>
    sameId(asset.profileObjectId, wardrobe.profileObjectId),
  )
  return {
    wardrobe: { ...wardrobe, loadout },
    maker,
    wardrobeAssets: indexedWardrobeAssets,
    walletAssets: compatibleWalletAssets,
  }
}
