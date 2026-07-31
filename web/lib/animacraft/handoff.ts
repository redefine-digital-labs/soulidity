import { isValidSuiAddress, normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import type {
  AnimacraftRecipeSlotInput,
  AnimacraftStyleSelectionV5Input,
} from '@soulidity/sdk'

const MAX_HANDOFF_JSON_BYTES = 512 * 1024
const MAX_NAME_BYTES = 128
const MAX_DESCRIPTION_BYTES = 4096
const MAX_LIVING_FILE_BYTES = 64 * 1024
const MAX_RECIPE_SLOTS = 128
const SAFE_KEY = /^[A-Za-z0-9_-]{1,128}$/
const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/
const SKILL_NAME = /^[a-z0-9_-]{1,32}$/
const WALRUS_PATCH_ID = /^[A-Za-z0-9_-]{1,256}$/
const ANIMACRAFT_MAINNET_WALRUS_AGGREGATOR =
  'https://aggregator.walrus-mainnet.walrus.space'
const encoder = new TextEncoder()

export const ANIMACRAFT_MAINNET_ORIGINAL_PACKAGE_ID =
  '0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea'

type UnknownRecord = Record<string, unknown>

export interface ParsedAnimacraftHandoff {
  protocolVersion: 4 | 5
  name: string
  description: string
  world: string
  tags: string[]
  makerId: string
  recipe: AnimacraftRecipeSlotInput[]
  styleSelections: AnimacraftStyleSelectionV5Input[]
  usedPackIds: string[]
  soulCreatorRoyaltyBps: number
  soulMd: string
  memoryMd: string
  skillMd: string
  skillName: string
}

export interface AnimacraftMakerState {
  objectId: string
  treasuryId: string
  paymentCoinType: string
  mintingEnabled: boolean
  mintFeeEnabled: boolean
  mintPriceAtomic: bigint
  royaltyBps: number
  published: boolean
  archived: boolean
}

export interface AnimacraftIntegrationConfig {
  enabled: boolean
  ready: boolean
  packageId: string
  originalPackageId: string
  protocolFeeConfigId: string
  protocolTreasuryId: string
  commerceV5Enabled: boolean
  commerceV5Ready: boolean
  commerceV5PackageId: string
  commerceV5TypeOriginPackageId: string
  commerceV5ProtocolConfigId: string
  commerceV5ProtocolTreasuryId: string
  commerceV5Missing: string[]
  missing: string[]
}

export interface AnimacraftCompletionPolicyV5 {
  mode: number
  freeQuotaPerWallet: bigint
  priceAtomic: bigint
  totalCap: bigint
}

export interface AnimacraftMakerRootV5State {
  objectId: string
  legacyMakerId: string
  treasuryId: string
  protocolConfigId: string
  paymentCoinType: string
  originalCreator: string
  currentOwner: string
  rightsOrigin: number
  /** Immutable MakerRootV5 value authenticated by Complete authorization. */
  soulCreatorRoyaltyBps: number
  lifecycle: number
  ownershipEpoch: bigint
  currentControlCapId: string | null
  activeListingId: string | null
  baseAccessKind: number
  basePurchasePriceAtomic: bigint
  basePolicy: AnimacraftCompletionPolicyV5
  packKeys: string[]
  styleRegistrySealed: boolean
  totalCompletes: bigint
}

export interface AnimacraftMakerTreasuryV5State {
  objectId: string
  rootId: string
  balanceAtomic: bigint
}

export interface AnimacraftProtocolV5State {
  objectId: string
  treasuryId: string
  paymentCoinType: string
  primaryProtocolFeeBps: number
  fixedCompleteFeeAtomic: bigint
  enabled: boolean
}

export interface AnimacraftProtocolTreasuryV5State {
  objectId: string
  configId: string
}

export interface AnimacraftPassV5State {
  objectId: string
  rootId: string
  holder: string
  packKey: string | null
}

export interface AnimacraftCommerceV5State {
  root: AnimacraftMakerRootV5State
  makerTreasury: AnimacraftMakerTreasuryV5State
  protocol: AnimacraftProtocolV5State
  protocolTreasury: AnimacraftProtocolTreasuryV5State
  makerAccessPasses: AnimacraftPassV5State[]
  packPasses: AnimacraftPassV5State[]
}

export function getAnimacraftIntegrationConfig(): AnimacraftIntegrationConfig {
  const enabled = process.env.NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED === 'true'
  const network = process.env.NEXT_PUBLIC_SUI_NETWORK?.trim().toLowerCase() ?? ''
  const packageId = process.env.NEXT_PUBLIC_ANIMACRAFT_PACKAGE_ID?.trim() ?? ''
  const protocolFeeConfigId = process.env.NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_FEE_CONFIG_ID?.trim() ?? ''
  const protocolTreasuryId = process.env.NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_TREASURY_ID?.trim() ?? ''
  const commerceV5Enabled =
    process.env.NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED === 'true'
  const commerceV5PackageId =
    process.env.NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PACKAGE_ID?.trim() ?? ''
  const commerceV5TypeOriginPackageId =
    process.env.NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_TYPE_ORIGIN_PACKAGE_ID?.trim() ?? ''
  const commerceV5ProtocolConfigId =
    process.env.NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_CONFIG_ID?.trim() ?? ''
  const commerceV5ProtocolTreasuryId =
    process.env.NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_TREASURY_ID?.trim() ?? ''
  const missing: string[] = []
  if (!enabled) missing.push('release gate')
  if (network !== 'mainnet') missing.push('Sui Mainnet network')
  for (const [label, value] of [
    ['Animacraft package', packageId],
    ['ProtocolFeeConfig', protocolFeeConfigId],
    ['ProtocolTreasury', protocolTreasuryId],
  ] as const) {
    try {
      normalizeObjectId(value, label)
    } catch {
      missing.push(label)
    }
  }
  const commerceV5Missing: string[] = []
  if (!commerceV5Enabled) commerceV5Missing.push('commerce v5 release gate')
  for (const [label, value] of [
    ['commerce v5 callable package', commerceV5PackageId],
    ['commerce v5 TypeOrigin package', commerceV5TypeOriginPackageId],
    ['CommerceProtocolConfigV5', commerceV5ProtocolConfigId],
    ['CommerceProtocolTreasuryV5', commerceV5ProtocolTreasuryId],
  ] as const) {
    try {
      normalizeObjectId(value, label)
    } catch {
      commerceV5Missing.push(label)
    }
  }
  return {
    enabled,
    ready: missing.length === 0,
    packageId,
    originalPackageId: ANIMACRAFT_MAINNET_ORIGINAL_PACKAGE_ID,
    protocolFeeConfigId,
    protocolTreasuryId,
    commerceV5Enabled,
    commerceV5Ready:
      network === 'mainnet'
      && commerceV5Missing.length === 0,
    commerceV5PackageId,
    commerceV5TypeOriginPackageId,
    commerceV5ProtocolConfigId,
    commerceV5ProtocolTreasuryId,
    commerceV5Missing,
    missing,
  }
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is malformed`)
  }
  return value as UnknownRecord
}

function fieldsOf(value: unknown, label: string): UnknownRecord {
  const record = asRecord(value, label)
  const fields = record.fields
  return fields && typeof fields === 'object' && !Array.isArray(fields)
    ? fields as UnknownRecord
    : record
}

function requiredText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  const result = value.trim()
  if (encoder.encode(result).length > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`)
  return result
}

function optionalText(value: unknown, fallback: string, maxBytes: number): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  return requiredText(value, 'Animacraft text field', maxBytes)
}

function normalizeObjectId(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^0x[0-9a-fA-F]{1,64}$/.test(value.trim())
    || /^0x0+$/i.test(value.trim())
  ) {
    throw new Error(`${label} is missing or invalid`)
  }
  try {
    const normalized = normalizeSuiAddress(value.trim())
    if (!isValidSuiAddress(normalized)) throw new Error('invalid')
    return normalized.toLowerCase()
  } catch {
    throw new Error(`${label} is not a valid Sui object id`)
  }
}

function readOptionId(value: unknown, label: string): string {
  if (typeof value === 'string') return normalizeObjectId(value, label)
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error(`${label} is missing`)
    return readOptionId(value[0], label)
  }
  const record = asRecord(value, label)
  if (Array.isArray(record.vec)) return readOptionId(record.vec, label)
  if (record.value !== undefined) return readOptionId(record.value, label)
  if (record.fields !== undefined) return readOptionId(record.fields, label)
  if (typeof record.id === 'string') return normalizeObjectId(record.id, label)
  throw new Error(`${label} is missing`)
}

function readId(value: unknown, label: string): string {
  if (typeof value === 'string') return normalizeObjectId(value, label)
  const record = asRecord(value, label)
  if (typeof record.id === 'string') return normalizeObjectId(record.id, label)
  if (record.fields !== undefined) return readId(record.fields, label)
  throw new Error(`${label} is missing`)
}

function readOptionalId(value: unknown, label: string): string | null {
  if (value == null) return null
  if (Array.isArray(value) && value.length === 0) return null
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as UnknownRecord
    if (Array.isArray(record.vec) && record.vec.length === 0) return null
  }
  return readOptionId(value, label)
}

function parseAddress(value: unknown, label: string): string {
  return normalizeObjectId(value, label)
}

function parseU16(value: unknown, label: string): number {
  const parsed = Number(parseU64(value, label))
  if (!Number.isSafeInteger(parsed) || parsed > 65_535) {
    throw new Error(`${label} is outside the u16 range`)
  }
  return parsed
}

function objectEnvelope(
  response: unknown,
  expectedObjectId: string,
  expectedType: string,
  label: string,
): { objectId: string; fields: UnknownRecord } {
  const root = asRecord(response, `${label} response`)
  const data = asRecord(root.data, `${label} data`)
  const objectId = normalizeObjectId(data.objectId, `${label} object id`)
  if (objectId !== normalizeObjectId(expectedObjectId, `Expected ${label} id`)) {
    throw new Error(`Loaded ${label} does not match the requested object`)
  }
  const content = asRecord(data.content, `${label} content`)
  let actualType: string
  try {
    actualType = normalizeStructTag(requiredText(content.type, `${label} type`, 512))
  } catch {
    throw new Error(`${label} has an unexpected on-chain type`)
  }
  if (actualType !== normalizeStructTag(expectedType)) {
    throw new Error(`${label} does not belong to the configured Animacraft v5 TypeOrigin`)
  }
  return {
    objectId,
    fields: fieldsOf(content.fields, `${label} fields`),
  }
}

function parseCompletionPolicyV5(
  value: unknown,
  label: string,
): AnimacraftCompletionPolicyV5 {
  const fields = fieldsOf(value, label)
  const mode = Number(parseU64(fields.mode, `${label} mode`))
  if (![0, 1, 2, 3].includes(mode)) throw new Error(`${label} mode is unsupported`)
  return {
    mode,
    freeQuotaPerWallet: parseU64(
      fields.free_quota_per_wallet,
      `${label} free quota`,
    ),
    priceAtomic: parseU64(fields.price_atomic, `${label} price`),
    totalCap: parseU64(fields.total_cap, `${label} total cap`),
  }
}

function tableBalance(value: unknown, label: string): bigint {
  const fields = fieldsOf(value, label)
  return parseU64(fields.value, `${label} balance`)
}

function parseU64(value: unknown, label: string): bigint {
  if (typeof value === 'bigint' && value >= 0n) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  throw new Error(`${label} is not a valid unsigned integer`)
}

function parseSkillName(markdown: string): string {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/m.exec(markdown)?.[1] ?? ''
  const name = /^name:\s*([^\s]+)\s*$/m.exec(frontmatter)?.[1] ?? ''
  if (!SKILL_NAME.test(name)) throw new Error('Animacraft Skills & Docs has invalid SKILL.md frontmatter')
  return name
}

export function assertAnimacraftAssetUrl(value: string, label: string): string {
  if (encoder.encode(value).length > 512) throw new Error(`${label} URL exceeds 512 UTF-8 bytes`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} URL is invalid`)
  }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) throw new Error(`${label} must use HTTPS`)
  return url.href
}

export function assertAnimacraftWalrusPatchUrl(
  value: string,
  patchId: string,
  label: string,
): string {
  const href = assertAnimacraftAssetUrl(value, label)
  if (!WALRUS_PATCH_ID.test(patchId)) throw new Error(`${label} Walrus patch id is invalid`)
  const url = new URL(href)
  const trustedAggregator = new URL(ANIMACRAFT_MAINNET_WALRUS_AGGREGATOR)
  if (
    url.origin !== trustedAggregator.origin
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(`${label} must use the trusted Animacraft Walrus Mainnet aggregator`)
  }
  const segments = url.pathname.split('/').filter(Boolean)
  const markerIndex = segments.lastIndexOf('by-quilt-patch-id')
  if (markerIndex < 0 || markerIndex !== segments.length - 2 || segments.at(-1) !== patchId) {
    throw new Error(`${label} URL does not match its certified Walrus patch id`)
  }
  // The patch id is the authenticated input. Return a canonical URL built
  // from it instead of preserving any caller-controlled URL representation.
  return new URL(
    `/v1/blobs/by-quilt-patch-id/${encodeURIComponent(patchId)}`,
    trustedAggregator,
  ).href
}

export function parseAnimacraftOcPackage(
  value: unknown,
  expectedMakerId: string,
): ParsedAnimacraftHandoff {
  const root = asRecord(value, 'Animacraft OC package')
  const schemaVersion = root.schemaVersion
  if (
    schemaVersion !== 'animacraft.oc-package.v1'
    && schemaVersion !== 'animacraft.oc-package.v2'
  ) {
    throw new Error('Animacraft OC package uses an unsupported schema version')
  }
  const profile = asRecord(root.profile, 'Animacraft profile')
  const living = asRecord(root.livingContent, 'Animacraft Living Content')
  const content = asRecord(living.content, 'Animacraft Living Content files')
  const normalizedExpectedMakerId = normalizeObjectId(expectedMakerId, 'Animacraft Maker id')
  const packageMakerId = normalizeObjectId(living.makerId, 'Animacraft package Maker id')
  if (packageMakerId !== normalizedExpectedMakerId) {
    throw new Error('Animacraft package Maker id does not match the handoff')
  }

  const name = requiredText(profile.name, 'OC name', MAX_NAME_BYTES)
  const description = optionalText(profile.description, 'Animacraft original character', MAX_DESCRIPTION_BYTES)
  const world = optionalText(profile.world, 'Original character', MAX_NAME_BYTES)
  const tags = Array.isArray(profile.tags)
    ? profile.tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 12)
    : []
  const soulMd = requiredText(content.soulMd, 'Soul Character', MAX_LIVING_FILE_BYTES)
  const memoryMd = requiredText(content.memoryMd, 'Memory', MAX_LIVING_FILE_BYTES)
  const skillMd = requiredText(content.skillMd, 'Skills & Docs', MAX_LIVING_FILE_BYTES)
  const skillName = parseSkillName(skillMd)

  const suiSummary = schemaVersion === 'animacraft.oc-package.v2'
    ? asRecord(root.suiSummary, 'Animacraft Sui summary')
    : null
  const rawRecipe = schemaVersion === 'animacraft.oc-package.v2'
    ? suiSummary!.recipe
    : root.recipe
  if (!Array.isArray(rawRecipe) || rawRecipe.length === 0 || rawRecipe.length > MAX_RECIPE_SLOTS) {
    throw new Error(`Animacraft recipe must contain 1 to ${MAX_RECIPE_SLOTS} slots`)
  }
  const recipe = rawRecipe.map((rawSlot, index) => {
    const slot = asRecord(rawSlot, `Animacraft recipe slot ${index + 1}`)
    const partKey = requiredText(
      schemaVersion === 'animacraft.oc-package.v2' ? slot.partKey : slot.slot,
      `Recipe slot ${index + 1} part`,
      128,
    )
    const itemKey = requiredText(
      schemaVersion === 'animacraft.oc-package.v2' ? slot.itemKey : slot.part,
      `Recipe slot ${index + 1} item`,
      128,
    )
    const colorHex = requiredText(
      schemaVersion === 'animacraft.oc-package.v2' ? slot.colorHex : slot.color,
      `Recipe slot ${index + 1} color`,
      16,
    )
    const renderOrder = Number(parseU64(slot.renderOrder, `Recipe slot ${index + 1} render order`))
    if (!SAFE_KEY.test(partKey) || !SAFE_KEY.test(itemKey)) {
      throw new Error(`Animacraft recipe slot ${index + 1} contains an unsafe key`)
    }
    if (!SAFE_COLOR.test(colorHex)) {
      throw new Error(`Animacraft recipe slot ${index + 1} contains an invalid color`)
    }
    if (!Number.isSafeInteger(renderOrder)) {
      throw new Error(`Animacraft recipe slot ${index + 1} render order is too large`)
    }
    return { partKey, itemKey, colorHex: colorHex.toLowerCase(), renderOrder }
  })
  const rawStyleSelections = suiSummary?.styleSelections
  const commerceDeclared = root.commerce != null || rawStyleSelections != null
  if (
    commerceDeclared
    && (
      !Array.isArray(rawStyleSelections)
      || rawStyleSelections.length !== recipe.length
    )
  ) {
    throw new Error(
      'Animacraft commerce v5 requires one exact Style selection for every Recipe slot',
    )
  }
  const styleSelections = Array.isArray(rawStyleSelections)
    ? rawStyleSelections.map((rawSelection, index) => {
        const selection = asRecord(
          rawSelection,
          `Animacraft Style selection ${index + 1}`,
        )
        const partKey = requiredText(
          selection.partKey,
          `Style selection ${index + 1} Part`,
          128,
        )
        const itemKey = requiredText(
          selection.itemKey,
          `Style selection ${index + 1} Item`,
          128,
        )
        const styleKey = requiredText(
          selection.styleKey,
          `Style selection ${index + 1} Style`,
          128,
        )
        if (
          !SAFE_KEY.test(partKey)
          || !SAFE_KEY.test(itemKey)
          || !SAFE_KEY.test(styleKey)
        ) {
          throw new Error(`Animacraft Style selection ${index + 1} contains an unsafe key`)
        }
        if (
          recipe[index]?.partKey !== partKey
          || recipe[index]?.itemKey !== itemKey
        ) {
          throw new Error(
            `Animacraft Style selection ${index + 1} does not match its Recipe Part and Item`,
          )
        }
        return { partKey, itemKey, styleKey }
      })
    : []
  const rawUsedPackIds = suiSummary?.usedPackIds
  const usedPackIds = Array.isArray(rawUsedPackIds)
    ? rawUsedPackIds.map((value, index) => {
        const packId = requiredText(value, `Used Pack ${index + 1}`, 128)
        if (!SAFE_KEY.test(packId)) throw new Error(`Used Pack ${index + 1} has an unsafe key`)
        return packId
      })
    : []
  if (new Set(usedPackIds).size !== usedPackIds.length) {
    throw new Error('Animacraft used Pack list contains duplicates')
  }
  const commerce = root.commerce == null
    ? null
    : asRecord(root.commerce, 'Animacraft commerce projection')
  const royalties = commerce?.royalties == null
    ? null
    : asRecord(commerce.royalties, 'Animacraft commerce royalties')
  const rawSoulCreatorRoyaltyBps = royalties?.soulCreatorBps
  // Legacy v5 documents created before this field was added migrate to the
  // reviewed 2.5% default. An explicit zero remains zero.
  const soulCreatorRoyaltyBps = rawSoulCreatorRoyaltyBps === undefined
    ? (commerceDeclared ? 250 : 0)
    : Number(parseU64(rawSoulCreatorRoyaltyBps, 'Soul creator royalty'))
  if (
    !Number.isSafeInteger(soulCreatorRoyaltyBps)
    || soulCreatorRoyaltyBps < 0
    || soulCreatorRoyaltyBps > 500
    || soulCreatorRoyaltyBps % 50 !== 0
  ) {
    throw new Error('Soul creator royalty must be 0%-5% in 0.5% tiers')
  }

  return {
    protocolVersion: commerceDeclared ? 5 : 4,
    name,
    description,
    world,
    tags,
    makerId: normalizedExpectedMakerId,
    recipe,
    styleSelections,
    usedPackIds,
    soulCreatorRoyaltyBps,
    soulMd,
    memoryMd,
    skillMd,
    skillName,
  }
}

export function parseAnimacraftMakerObject(
  response: unknown,
  expectedMakerId: string,
): AnimacraftMakerState {
  const root = asRecord(response, 'Animacraft Maker response')
  const data = asRecord(root.data, 'Animacraft Maker data')
  const objectId = normalizeObjectId(data.objectId, 'Animacraft Maker object id')
  const normalizedExpected = normalizeObjectId(expectedMakerId, 'Expected Animacraft Maker id')
  if (objectId !== normalizedExpected) throw new Error('Loaded Animacraft Maker does not match the handoff')
  const content = asRecord(data.content, 'Animacraft Maker content')
  let actualMakerType: string
  try {
    actualMakerType = normalizeStructTag(requiredText(
      content.type,
      'Animacraft Maker object type',
      512,
    ))
  } catch {
    throw new Error('The handoff Maker object has an unexpected on-chain type')
  }
  const expectedMakerType = normalizeStructTag(
    `${ANIMACRAFT_MAINNET_ORIGINAL_PACKAGE_ID}::animacraft::OCMaker`,
  )
  if (actualMakerType !== expectedMakerType) {
    throw new Error('The handoff Maker object does not belong to the Animacraft Mainnet package')
  }
  const fields = fieldsOf(content.fields, 'Animacraft Maker fields')
  const policy = fieldsOf(fields.policy, 'Animacraft Maker policy')
  const mintPriceAtomic = parseU64(fields.mint_price_atomic, 'Animacraft Maker mint price')
  const mintFeeEnabled = fields.mint_fee_enabled === true
  if (mintFeeEnabled !== (mintPriceAtomic > 0n)) {
    throw new Error('Animacraft Maker mint fee state is inconsistent')
  }
  const royaltyBps = Number(parseU64(policy.royalty_bps, 'Animacraft Maker royalty'))
  if (royaltyBps < 0 || royaltyBps > 500 || royaltyBps % 50 !== 0) {
    throw new Error('Animacraft Maker royalty must be 0%-5% in 0.5% tiers')
  }
  let paymentCoinType: string
  try {
    paymentCoinType = normalizeStructTag(requiredText(
      fields.payment_coin_type,
      'Animacraft Maker payment coin type',
      512,
    ))
  } catch {
    throw new Error('Animacraft Maker payment coin type is invalid')
  }

  return {
    objectId,
    treasuryId: readOptionId(fields.treasury_id, 'Animacraft Maker Treasury id'),
    paymentCoinType,
    mintingEnabled: fields.minting_enabled === true,
    mintFeeEnabled,
    mintPriceAtomic,
    royaltyBps,
    published: fields.published === true,
    archived: fields.archived === true,
  }
}

export function parseAnimacraftMakerRootV5Object(
  response: unknown,
  expectedObjectId: string,
  typeOriginPackageId: string,
): AnimacraftMakerRootV5State {
  const { objectId, fields } = objectEnvelope(
    response,
    expectedObjectId,
    `${typeOriginPackageId}::commerce_v5::MakerRootV5`,
    'Animacraft MakerRootV5',
  )
  const lifecycle = Number(parseU64(fields.lifecycle, 'MakerRootV5 lifecycle'))
  if (![0, 1, 2, 3].includes(lifecycle)) {
    throw new Error('MakerRootV5 lifecycle is unsupported')
  }
  const rightsOrigin = Number(parseU64(fields.rights_origin, 'MakerRootV5 rights origin'))
  if (![0, 1].includes(rightsOrigin)) throw new Error('MakerRootV5 rights origin is unsupported')
  const soulCreatorRoyaltyBps = parseU16(
    fields.soul_creator_royalty_bps,
    'MakerRootV5 Soul creator royalty',
  )
  if (soulCreatorRoyaltyBps > 500 || soulCreatorRoyaltyBps % 50 !== 0) {
    throw new Error('MakerRootV5 Soul creator royalty must be 0-500 bps in 50-bps steps')
  }
  let paymentCoinType: string
  try {
    paymentCoinType = normalizeStructTag(requiredText(
      fields.payment_coin_type,
      'MakerRootV5 payment coin type',
      512,
    ))
  } catch {
    throw new Error('MakerRootV5 payment coin type is invalid')
  }
  const packKeys = Array.isArray(fields.pack_keys)
    ? fields.pack_keys.map((key, index) => requiredText(key, `Pack key ${index + 1}`, 128))
    : []
  if (new Set(packKeys).size !== packKeys.length) {
    throw new Error('MakerRootV5 Pack key registry contains duplicates')
  }
  return {
    objectId,
    legacyMakerId: readId(fields.legacy_maker_id, 'MakerRootV5 legacy Maker id'),
    treasuryId: readId(fields.treasury_id, 'MakerRootV5 treasury id'),
    protocolConfigId: readId(
      fields.protocol_config_id,
      'MakerRootV5 protocol config id',
    ),
    paymentCoinType,
    originalCreator: parseAddress(
      fields.original_creator,
      'MakerRootV5 original creator',
    ),
    currentOwner: parseAddress(fields.current_owner, 'MakerRootV5 current owner'),
    rightsOrigin,
    soulCreatorRoyaltyBps,
    lifecycle,
    ownershipEpoch: parseU64(fields.ownership_epoch, 'MakerRootV5 ownership epoch'),
    currentControlCapId: readOptionalId(
      fields.current_control_cap_id,
      'MakerRootV5 control capability id',
    ),
    activeListingId: readOptionalId(
      fields.active_listing_id,
      'MakerRootV5 active listing id',
    ),
    baseAccessKind: Number(
      parseU64(fields.base_access_kind, 'MakerRootV5 Base access kind'),
    ),
    basePurchasePriceAtomic: parseU64(
      fields.base_purchase_price_atomic,
      'MakerRootV5 Base purchase price',
    ),
    basePolicy: parseCompletionPolicyV5(
      fields.base_policy,
      'MakerRootV5 Base Complete policy',
    ),
    packKeys,
    styleRegistrySealed: fields.style_registry_sealed === true,
    totalCompletes: parseU64(fields.total_completes, 'MakerRootV5 total Completes'),
  }
}

export function parseAnimacraftMakerTreasuryV5Object(
  response: unknown,
  expectedObjectId: string,
  typeOriginPackageId: string,
): AnimacraftMakerTreasuryV5State {
  const root = asRecord(response, 'Animacraft MakerTreasuryV5 response')
  const data = asRecord(root.data, 'Animacraft MakerTreasuryV5 data')
  const content = asRecord(data.content, 'Animacraft MakerTreasuryV5 content')
  const type = requiredText(content.type, 'MakerTreasuryV5 type', 512)
  if (
    !normalizeStructTag(type).startsWith(
      `${normalizeSuiAddress(typeOriginPackageId)}::commerce_v5::MakerTreasuryV5<`,
    )
  ) {
    throw new Error('MakerTreasuryV5 does not belong to the configured Animacraft v5 TypeOrigin')
  }
  const objectId = normalizeObjectId(data.objectId, 'MakerTreasuryV5 object id')
  if (objectId !== normalizeObjectId(expectedObjectId, 'Expected MakerTreasuryV5 id')) {
    throw new Error('Loaded MakerTreasuryV5 does not match the requested object')
  }
  const fields = fieldsOf(content.fields, 'MakerTreasuryV5 fields')
  return {
    objectId,
    rootId: readId(fields.root_id, 'MakerTreasuryV5 root id'),
    balanceAtomic: tableBalance(fields.revenue, 'MakerTreasuryV5 revenue'),
  }
}

export function parseAnimacraftProtocolV5Object(
  response: unknown,
  expectedObjectId: string,
  typeOriginPackageId: string,
): AnimacraftProtocolV5State {
  const { objectId, fields } = objectEnvelope(
    response,
    expectedObjectId,
    `${typeOriginPackageId}::commerce_v5::CommerceProtocolConfigV5`,
    'Animacraft CommerceProtocolConfigV5',
  )
  let paymentCoinType: string
  try {
    paymentCoinType = normalizeStructTag(requiredText(
      fields.payment_coin_type,
      'CommerceProtocolConfigV5 payment coin type',
      512,
    ))
  } catch {
    throw new Error('CommerceProtocolConfigV5 payment coin type is invalid')
  }
  const primaryProtocolFeeBps = parseU16(
    fields.primary_protocol_fee_bps,
    'CommerceProtocolConfigV5 primary fee',
  )
  if (primaryProtocolFeeBps !== 1_000) {
    throw new Error('CommerceProtocolConfigV5 primary fee must be 10%')
  }
  return {
    objectId,
    treasuryId: readId(fields.treasury_id, 'CommerceProtocolConfigV5 treasury id'),
    paymentCoinType,
    primaryProtocolFeeBps,
    fixedCompleteFeeAtomic: parseU64(
      fields.fixed_complete_fee_atomic,
      'CommerceProtocolConfigV5 fixed Complete fee',
    ),
    enabled: fields.enabled === true,
  }
}

export function parseAnimacraftProtocolTreasuryV5Object(
  response: unknown,
  expectedObjectId: string,
  typeOriginPackageId: string,
): AnimacraftProtocolTreasuryV5State {
  const root = asRecord(response, 'Animacraft CommerceProtocolTreasuryV5 response')
  const data = asRecord(root.data, 'Animacraft CommerceProtocolTreasuryV5 data')
  const content = asRecord(data.content, 'Animacraft CommerceProtocolTreasuryV5 content')
  const type = requiredText(content.type, 'CommerceProtocolTreasuryV5 type', 512)
  if (
    !normalizeStructTag(type).startsWith(
      `${normalizeSuiAddress(typeOriginPackageId)}::commerce_v5::CommerceProtocolTreasuryV5<`,
    )
  ) {
    throw new Error(
      'CommerceProtocolTreasuryV5 does not belong to the configured Animacraft v5 TypeOrigin',
    )
  }
  const objectId = normalizeObjectId(data.objectId, 'CommerceProtocolTreasuryV5 object id')
  if (
    objectId
    !== normalizeObjectId(expectedObjectId, 'Expected CommerceProtocolTreasuryV5 id')
  ) {
    throw new Error('Loaded CommerceProtocolTreasuryV5 does not match the requested object')
  }
  const fields = fieldsOf(content.fields, 'CommerceProtocolTreasuryV5 fields')
  return {
    objectId,
    configId: readId(fields.config_id, 'CommerceProtocolTreasuryV5 config id'),
  }
}

export function parseAnimacraftPassV5Object(
  response: unknown,
  typeOriginPackageId: string,
): AnimacraftPassV5State {
  const root = asRecord(response, 'Animacraft v5 Pass response')
  const data = asRecord(root.data, 'Animacraft v5 Pass data')
  const objectId = normalizeObjectId(data.objectId, 'Animacraft v5 Pass object id')
  const content = asRecord(data.content, 'Animacraft v5 Pass content')
  const type = normalizeStructTag(requiredText(content.type, 'Animacraft v5 Pass type', 512))
  const origin = normalizeSuiAddress(typeOriginPackageId)
  const makerType = `${origin}::commerce_v5::MakerAccessPassV5`
  const packType = `${origin}::commerce_v5::PackPassV5`
  if (type !== makerType && type !== packType) {
    throw new Error('Animacraft v5 Pass has an unexpected on-chain type')
  }
  const fields = fieldsOf(content.fields, 'Animacraft v5 Pass fields')
  return {
    objectId,
    rootId: readId(fields.root_id, 'Animacraft v5 Pass root id'),
    holder: parseAddress(fields.holder, 'Animacraft v5 Pass holder'),
    packKey: type === packType
      ? requiredText(fields.pack_key, 'Animacraft PackPassV5 Pack key', 128)
      : null,
  }
}

export function verifyAnimacraftCommerceV5State(
  state: AnimacraftCommerceV5State,
  params: {
    expectedLegacyMakerId: string
    expectedRootId: string
    expectedMakerTreasuryId: string
    expectedProtocolConfigId: string
    expectedProtocolTreasuryId: string
    expectedPaymentCoinType: string
    wallet: string
    usedPackIds: string[]
    legacyMaker: AnimacraftMakerState
    soulCreatorRoyaltyBps: number
  },
): void {
  const same = (left: string, right: string) =>
    normalizeSuiAddress(left) === normalizeSuiAddress(right)
  if (!same(state.root.objectId, params.expectedRootId)) {
    throw new Error('MakerRootV5 does not match the Animacraft handoff')
  }
  if (!same(state.root.legacyMakerId, params.expectedLegacyMakerId)) {
    throw new Error('MakerRootV5 belongs to another legacy OCMaker')
  }
  if (
    !same(state.root.treasuryId, params.expectedMakerTreasuryId)
    || !same(state.makerTreasury.objectId, params.expectedMakerTreasuryId)
    || !same(state.makerTreasury.rootId, state.root.objectId)
  ) {
    throw new Error('MakerRootV5 and MakerTreasuryV5 linkage is invalid')
  }
  if (
    !same(state.root.protocolConfigId, params.expectedProtocolConfigId)
    || !same(state.protocol.objectId, params.expectedProtocolConfigId)
    || !same(state.protocol.treasuryId, params.expectedProtocolTreasuryId)
    || !same(state.protocolTreasury.objectId, params.expectedProtocolTreasuryId)
    || !same(state.protocolTreasury.configId, state.protocol.objectId)
  ) {
    throw new Error('Animacraft commerce v5 protocol linkage is invalid')
  }
  if (
    normalizeStructTag(state.root.paymentCoinType)
      !== normalizeStructTag(params.expectedPaymentCoinType)
    || normalizeStructTag(state.protocol.paymentCoinType)
      !== normalizeStructTag(params.expectedPaymentCoinType)
  ) {
    throw new Error('Animacraft commerce v5 payment coin does not match Soulidity USDC')
  }
  if (!state.protocol.enabled || state.root.lifecycle !== 0 || !state.root.styleRegistrySealed) {
    throw new Error('This Animacraft Maker is not Active with a sealed Style registry')
  }
  if (
    !params.legacyMaker.published
    || !params.legacyMaker.archived
    || params.legacyMaker.mintingEnabled
    || params.legacyMaker.mintFeeEnabled
    || params.legacyMaker.mintPriceAtomic !== 0n
  ) {
    throw new Error('The legacy OCMaker has not been safely migrated to commerce v5')
  }
  if (state.root.soulCreatorRoyaltyBps !== params.soulCreatorRoyaltyBps) {
    throw new Error(
      'MakerRootV5 Soul creator royalty does not match the certified Animacraft handoff',
    )
  }
  if (
    250
      + params.legacyMaker.royaltyBps
      + state.root.soulCreatorRoyaltyBps
    > 1_250
  ) {
    throw new Error(
      'Animacraft v5 resale shares exceed the 10% rights pool plus 2.5% protocol ceiling',
    )
  }
  const wallet = normalizeSuiAddress(params.wallet)
  for (const pass of [...state.makerAccessPasses, ...state.packPasses]) {
    if (!same(pass.rootId, state.root.objectId) || !same(pass.holder, wallet)) {
      throw new Error('An Animacraft access Pass is stale or belongs to another wallet')
    }
  }
  for (const packId of params.usedPackIds) {
    if (!state.root.packKeys.includes(packId)) {
      throw new Error(`Animacraft Pack ${packId} is not registered by this Maker`)
    }
  }
}

export async function fetchAnimacraftPassesV5(
  client: {
    getOwnedObjects(input: {
      owner: string
      filter: { StructType: string }
      options: { showContent: true; showType: true }
      cursor?: string | null
      limit?: number
    }): Promise<{
      data: unknown[]
      hasNextPage?: boolean
      nextCursor?: string | null
    }>
  },
  params: {
    owner: string
    typeOriginPackageId: string
    expectedRootId: string
  },
): Promise<{
  makerAccessPasses: AnimacraftPassV5State[]
  packPasses: AnimacraftPassV5State[]
}> {
  const origin = normalizeSuiAddress(params.typeOriginPackageId)
  const owner = normalizeSuiAddress(params.owner)
  const expectedRootId = normalizeSuiAddress(params.expectedRootId)
  const readType = async (structName: 'MakerAccessPassV5' | 'PackPassV5') => {
    const values: AnimacraftPassV5State[] = []
    let cursor: string | null | undefined
    do {
      const page = await client.getOwnedObjects({
        owner,
        filter: {
          StructType: `${origin}::commerce_v5::${structName}`,
        },
        options: { showContent: true, showType: true },
        cursor,
        limit: 50,
      })
      for (const object of page.data) {
        const parsed = parseAnimacraftPassV5Object(object, origin)
        // A wallet may legitimately own Passes from many unrelated Makers.
        // Only Passes belonging to the handoff's exact MakerRoot participate
        // in this verification; unrelated roots are not stale credentials.
        if (normalizeSuiAddress(parsed.rootId) !== expectedRootId) continue
        if (normalizeSuiAddress(parsed.holder) !== owner) {
          throw new Error(`${structName} holder does not match its Sui owner`)
        }
        values.push(parsed)
      }
      cursor = page.hasNextPage ? page.nextCursor : null
      if (page.hasNextPage && !cursor) {
        throw new Error(`Animacraft ${structName} pagination cursor is missing`)
      }
    } while (cursor)
    return values
  }
  const [makerAccessPasses, packPasses] = await Promise.all([
    readType('MakerAccessPassV5'),
    readType('PackPassV5'),
  ])
  return { makerAccessPasses, packPasses }
}

export async function fetchAnimacraftOcPackage(
  profileUrl: string,
  expectedMakerId: string,
): Promise<ParsedAnimacraftHandoff> {
  const url = assertAnimacraftAssetUrl(profileUrl, 'Animacraft profile')
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error(`Animacraft profile request failed (${response.status})`)
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(declared) && declared > MAX_HANDOFF_JSON_BYTES) {
      throw new Error('Animacraft profile exceeds the 512 KiB handoff limit')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Animacraft profile response has no body')
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      total += chunk.byteLength
      if (total > MAX_HANDOFF_JSON_BYTES) {
        await reader.cancel()
        throw new Error('Animacraft profile exceeds the 512 KiB handoff limit')
      }
      chunks.push(chunk)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return parseAnimacraftOcPackage(parsed, expectedMakerId)
  } finally {
    window.clearTimeout(timeout)
  }
}
