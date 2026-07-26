import { isValidSuiAddress, normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import type { AnimacraftRecipeSlotInput } from '@soulidity/sdk'

const MAX_HANDOFF_JSON_BYTES = 512 * 1024
const MAX_NAME_BYTES = 128
const MAX_DESCRIPTION_BYTES = 4096
const MAX_LIVING_FILE_BYTES = 64 * 1024
const MAX_RECIPE_SLOTS = 128
const SAFE_KEY = /^[A-Za-z0-9_-]{1,128}$/
const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/
const SKILL_NAME = /^[a-z0-9_-]{1,32}$/
const WALRUS_PATCH_ID = /^[A-Za-z0-9_-]{1,256}$/
const encoder = new TextEncoder()

export const ANIMACRAFT_MAINNET_ORIGINAL_PACKAGE_ID =
  '0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea'

type UnknownRecord = Record<string, unknown>

export interface ParsedAnimacraftHandoff {
  name: string
  description: string
  world: string
  tags: string[]
  makerId: string
  recipe: AnimacraftRecipeSlotInput[]
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
  protocolFeeConfigId: string
  protocolTreasuryId: string
  missing: string[]
}

export function getAnimacraftIntegrationConfig(): AnimacraftIntegrationConfig {
  const enabled = process.env.NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED === 'true'
  const network = process.env.NEXT_PUBLIC_SUI_NETWORK?.trim().toLowerCase() ?? ''
  const packageId = process.env.NEXT_PUBLIC_ANIMACRAFT_PACKAGE_ID?.trim() ?? ''
  const protocolFeeConfigId = process.env.NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_FEE_CONFIG_ID?.trim() ?? ''
  const protocolTreasuryId = process.env.NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_TREASURY_ID?.trim() ?? ''
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
  return {
    enabled,
    ready: missing.length === 0,
    packageId,
    protocolFeeConfigId,
    protocolTreasuryId,
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
  const segments = url.pathname.split('/').filter(Boolean)
  const markerIndex = segments.lastIndexOf('by-quilt-patch-id')
  if (markerIndex < 0 || markerIndex !== segments.length - 2 || segments.at(-1) !== patchId) {
    throw new Error(`${label} URL does not match its certified Walrus patch id`)
  }
  return href
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

  const rawRecipe = schemaVersion === 'animacraft.oc-package.v2'
    ? asRecord(root.suiSummary, 'Animacraft Sui summary').recipe
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

  return {
    name,
    description,
    world,
    tags,
    makerId: normalizedExpectedMakerId,
    recipe,
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
  if (![0, 100, 200, 300, 400, 500].includes(royaltyBps)) {
    throw new Error('Animacraft Maker royalty is outside the supported 0%-5% tiers')
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
