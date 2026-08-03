import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import { getBlobUrl, getQuiltFileUrl } from './walrus'
import type {
  PhysicalStyleAssetV7View,
  PhysicalWardrobeV7Runtime,
  PhysicalWardrobeV7Snapshot,
} from './physical-wardrobe-v7'

const COMPANION_SCHEMA = 'animacraft.maker-composable.v6'
const ITEM_DEFINITION_SCHEMA = 'animacraft.item-product-definition.v6'
const BASE_MANIFEST_IDENTIFIER = 'animacraft-manifest.json'
const MAX_MANIFEST_BYTES = 24 * 1024 * 1024
const MAX_PNG_BYTES = 20 * 1024 * 1024
const MAX_PRODUCTS = 2_000
const MAX_RENDER_LAYERS = 128
const HASH = /^[0-9a-f]{64}$/

type Fields = Record<string, unknown>
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface PhysicalRendererV7Transform {
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
  blendMode: string
}

export interface PhysicalRendererV7Layer {
  styleAssetObjectId: string
  styleProductObjectId: string
  v6ProductObjectId: string
  slotKey: string
  styleName: string
  componentId: string
  layerTrackId: string
  layerTrackOrder: number
  componentOrder: number
  assetUrl: string
  assetBlob: Blob
  assetWidth: number
  assetHeight: number
  expectedAssetHash: string
  integrity: 'sha256'
  transform: PhysicalRendererV7Transform
}

export interface PhysicalRendererV7AssetMetadata {
  name: string
  description: string
  thumbnailUrl: string | null
  verified: true
}

export interface PhysicalRendererV7Scene {
  wardrobeObjectId: string
  wardrobeRevision: bigint
  width: number
  height: number
  pixelMode: boolean
  companionManifestBlobId: string
  companionManifestHash: string
  baseMakerManifestQuiltId: string
  baseMakerManifestHash: string
  layers: PhysicalRendererV7Layer[]
  assetMetadata: Record<string, PhysicalRendererV7AssetMetadata>
}

export class PhysicalRendererV7IntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhysicalRendererV7IntegrityError'
  }
}

function fail(message: string): never {
  throw new PhysicalRendererV7IntegrityError(message)
}

function record(value: unknown): Fields {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Fields
    : {}
}

function fields(value: unknown): Fields {
  const source = record(value)
  return Object.keys(record(source.fields)).length > 0 ? record(source.fields) : source
}

function pick(source: Fields, ...keys: string[]): unknown {
  for (const key of keys) if (key in source) return source[key]
  return undefined
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value) && value.every((entry) => Number.isInteger(entry))) {
    try { return new TextDecoder().decode(Uint8Array.from(value as number[])).trim() } catch { return '' }
  }
  const source = fields(value)
  const nested = pick(source, 'bytes', 'value', 'vec')
  return nested === undefined || nested === value ? '' : text(nested)
}

function suiId(value: unknown): string | null {
  if (typeof value === 'string') {
    try { return normalizeSuiAddress(value.trim()) } catch { return null }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = suiId(entry)
      if (candidate) return candidate
    }
    return null
  }
  const source = fields(value)
  for (const key of ['id', 'bytes', 'value', 'vec', 'some']) {
    if (key in source) {
      const candidate = suiId(source[key])
      if (candidate) return candidate
    }
  }
  return null
}

function requiredId(value: unknown, label: string): string {
  const result = suiId(value)
  if (!result) fail(`${label} is missing or invalid`)
  return result
}

function sameId(left: string, right: string): boolean {
  try { return normalizeSuiAddress(left) === normalizeSuiAddress(right) } catch { return false }
}

function bytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value) && value.every((entry) => (
    Number.isInteger(entry) && Number(entry) >= 0 && Number(entry) <= 255
  ))) return Uint8Array.from(value as number[])
  const source = fields(value)
  for (const key of ['bytes', 'value', 'vec']) {
    if (key in source) {
      const candidate = bytes(source[key])
      if (candidate) return candidate
    }
  }
  return null
}

function commitment(value: unknown): string {
  if (typeof value === 'string') {
    const normalized = value.replace(/^0x/i, '').toLowerCase()
    return HASH.test(normalized) ? normalized : ''
  }
  const valueBytes = bytes(value)
  if (!valueBytes || valueBytes.length !== 32) return ''
  return Array.from(valueBytes, (entry) => entry.toString(16).padStart(2, '0')).join('')
}

function bool(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 1 || value === '1') return true
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  return null
}

function integer(value: unknown): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1
}

function finite(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function objectEnvelope(response: unknown, expectedId: string, expectedType: string): Fields {
  const data = record(record(response).data)
  const content = record(data.content)
  const objectId = requiredId(data.objectId ?? data.object_id, 'Sui object id')
  if (!sameId(objectId, expectedId)) fail(`Loaded Sui object ${objectId} does not match ${expectedId}`)
  const actualType = text(content.type ?? data.type)
  try {
    if (normalizeStructTag(actualType) !== normalizeStructTag(expectedType)) {
      fail(`Sui object ${objectId} has an unexpected type`)
    }
  } catch {
    fail(`Sui object ${objectId} has an invalid type`)
  }
  const result = record(content.fields)
  if (Object.keys(result).length === 0) fail(`Sui object ${objectId} has no Move fields`)
  return result
}

function animacraftType(runtime: PhysicalWardrobeV7Runtime, module: string, name: string): string {
  return `${runtime.animacraftTypeOriginPackageId}::${module}::${name}`
}

async function getObject(
  client: Pick<SuiJsonRpcClient, 'getObject'>,
  objectId: string,
): Promise<unknown> {
  return client.getObject({ id: objectId, options: { showContent: true } })
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) fail('SHA-256 is unavailable in this runtime')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', value as BufferSource)
  return Array.from(new Uint8Array(digest), (entry) => entry.toString(16).padStart(2, '0')).join('')
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  const source = record(value)
  if (Object.keys(source).length === 0 || value === null) return value
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, stableValue(source[key])]))
}

async function stableHash(value: unknown): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(stableValue(value))))
}

async function fetchBytes(
  fetcher: Fetcher,
  url: string,
  label: string,
  maximum: number,
): Promise<Uint8Array> {
  const response = await fetcher(url, { cache: 'force-cache' })
  if (!response.ok) fail(`${label} is unavailable (${response.status})`)
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > maximum) fail(`${label} exceeds the size limit`)
  const result = new Uint8Array(await response.arrayBuffer())
  if (result.byteLength === 0 || result.byteLength > maximum) fail(`${label} has an invalid size`)
  return result
}

function parseJson(value: Uint8Array, label: string): Fields {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(value))
    const result = record(parsed)
    if (Object.keys(result).length === 0) fail(`${label} must be a JSON object`)
    return result
  } catch (error) {
    if (error instanceof PhysicalRendererV7IntegrityError) throw error
    return fail(`${label} is not valid JSON`)
  }
}

function pngDimensions(value: Uint8Array, label: string): { width: number; height: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (value.length < 24 || signature.some((entry, index) => value[index] !== entry)) {
    fail(`${label} is not a PNG`)
  }
  if (String.fromCharCode(...value.slice(12, 16)) !== 'IHDR') fail(`${label} has no PNG IHDR`)
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width <= 0 || height <= 0 || width > 16_384 || height > 16_384) {
    fail(`${label} has invalid PNG dimensions`)
  }
  return { width, height }
}

interface V6Profile {
  rootId: string
  companionBlobId: string
  companionHash: string
  slotSchemaCommitment: string
  rendererCommitment: string
  sealed: boolean
}

function parseV6Profile(
  response: unknown,
  runtime: PhysicalWardrobeV7Runtime,
  objectId: string,
): V6Profile {
  const source = objectEnvelope(
    response,
    objectId,
    animacraftType(runtime, 'composition_v6', 'MakerProfileV6'),
  )
  const result = {
    rootId: requiredId(pick(source, 'root_id', 'rootId'), 'MakerProfileV6 root'),
    companionBlobId: text(pick(source, 'companion_manifest_blob_id', 'companionManifestBlobId')),
    companionHash: commitment(pick(source, 'companion_manifest_hash', 'companionManifestHash')),
    slotSchemaCommitment: commitment(pick(source, 'slot_schema_commitment', 'slotSchemaCommitment')),
    rendererCommitment: commitment(pick(source, 'renderer_commitment', 'rendererCommitment')),
    sealed: bool(pick(source, 'sealed')) === true,
  }
  if (!result.companionBlobId || !result.companionHash || !result.slotSchemaCommitment || !result.rendererCommitment) {
    fail('MakerProfileV6 is missing immutable renderer commitments')
  }
  return result
}

interface PhysicalProfile {
  rootId: string
  v6ProfileId: string
  slotSchemaCommitment: string
  rendererCommitment: string
  sealed: boolean
}

function parsePhysicalProfile(
  response: unknown,
  runtime: PhysicalWardrobeV7Runtime,
  objectId: string,
): PhysicalProfile {
  const source = objectEnvelope(
    response,
    objectId,
    animacraftType(runtime, 'physical_composition_v7', 'MakerPhysicalProfileV7'),
  )
  const result = {
    rootId: requiredId(pick(source, 'root_id', 'rootId'), 'MakerPhysicalProfileV7 root'),
    v6ProfileId: requiredId(pick(source, 'v6_profile_id', 'v6ProfileId'), 'MakerPhysicalProfileV7 v6 profile'),
    slotSchemaCommitment: commitment(pick(source, 'slot_schema_commitment', 'slotSchemaCommitment')),
    rendererCommitment: commitment(pick(source, 'renderer_commitment', 'rendererCommitment')),
    sealed: bool(pick(source, 'sealed')) === true,
  }
  if (!result.slotSchemaCommitment || !result.rendererCommitment) {
    fail('MakerPhysicalProfileV7 is missing immutable renderer commitments')
  }
  return result
}

interface MakerRoot {
  legacyMakerId: string
}

function parseMakerRoot(
  response: unknown,
  runtime: PhysicalWardrobeV7Runtime,
  objectId: string,
): MakerRoot {
  const source = objectEnvelope(
    response,
    objectId,
    animacraftType(runtime, 'commerce_v5', 'MakerRootV5'),
  )
  return {
    legacyMakerId: requiredId(pick(source, 'legacy_maker_id', 'legacyMakerId'), 'MakerRootV5 legacy Maker'),
  }
}

interface LegacyMaker {
  manifestQuiltId: string
}

function parseLegacyMaker(
  response: unknown,
  runtime: PhysicalWardrobeV7Runtime,
  objectId: string,
): LegacyMaker {
  const source = objectEnvelope(
    response,
    objectId,
    animacraftType(runtime, 'animacraft', 'OCMaker'),
  )
  const manifestQuiltId = text(pick(source, 'manifest_blob_id', 'manifestBlobId'))
  if (!manifestQuiltId || bool(pick(source, 'published')) !== true) {
    fail('The legacy OCMaker has no published immutable manifest')
  }
  return { manifestQuiltId }
}

interface ChainProduct {
  id: string
  sourceRootId: string | null
  originKind: number
  definitionCommitment: string
  assetCommitment: string
  slotKey: string
  slotSchemaCommitment: string
}

function parseChainProduct(
  response: unknown,
  runtime: PhysicalWardrobeV7Runtime,
  objectId: string,
): ChainProduct {
  const source = objectEnvelope(
    response,
    objectId,
    animacraftType(runtime, 'composition_v6', 'ItemProductV6'),
  )
  const result = {
    id: normalizeSuiAddress(objectId),
    sourceRootId: suiId(pick(source, 'source_root_id', 'sourceRootId')),
    originKind: integer(pick(source, 'origin_kind', 'originKind')),
    definitionCommitment: commitment(pick(source, 'definition_commitment', 'definitionCommitment')),
    assetCommitment: commitment(pick(source, 'asset_commitment', 'assetCommitment')),
    slotKey: text(pick(source, 'slot_key', 'slotKey')),
    slotSchemaCommitment: commitment(pick(source, 'slot_schema_commitment', 'slotSchemaCommitment')),
  }
  if (
    result.originKind < 0
    || result.originKind > 2
    || !result.definitionCommitment
    || !result.assetCommitment
    || !result.slotKey
    || !result.slotSchemaCommitment
  ) fail(`ItemProductV6 ${objectId} is incomplete`)
  return result
}

interface ChainStyleProduct {
  profileId: string
  v6ProfileId: string
  v6ProductId: string
  slotKey: string
  label: string
  definitionCommitment: string
  assetCommitment: string
  definitionBlobId: string
  definitionIdentifier: string
  assetBlobId: string
  assetIdentifier: string
  rendererCommitment: string
}

function parseChainStyleProduct(
  response: unknown,
  runtime: PhysicalWardrobeV7Runtime,
  objectId: string,
): ChainStyleProduct {
  const source = objectEnvelope(
    response,
    objectId,
    animacraftType(runtime, 'physical_composition_v7', 'StyleProductV7'),
  )
  const result = {
    profileId: requiredId(pick(source, 'profile_id', 'profileId'), 'StyleProductV7 profile'),
    v6ProfileId: requiredId(pick(source, 'v6_profile_id', 'v6ProfileId'), 'StyleProductV7 v6 profile'),
    v6ProductId: requiredId(pick(source, 'v6_product_id', 'v6ProductId'), 'StyleProductV7 v6 product'),
    slotKey: text(pick(source, 'slot_key', 'slotKey')),
    label: text(pick(source, 'label')),
    definitionCommitment: commitment(pick(source, 'definition_commitment', 'definitionCommitment')),
    assetCommitment: commitment(pick(source, 'asset_commitment', 'assetCommitment')),
    definitionBlobId: text(pick(source, 'definition_blob_id', 'definitionBlobId')),
    definitionIdentifier: text(pick(source, 'definition_identifier', 'definitionIdentifier')),
    assetBlobId: text(pick(source, 'asset_blob_id', 'assetBlobId')),
    assetIdentifier: text(pick(source, 'asset_identifier', 'assetIdentifier')),
    rendererCommitment: commitment(pick(source, 'renderer_commitment', 'rendererCommitment')),
  }
  if (
    !result.slotKey
    || !result.label
    || !result.definitionCommitment
    || !result.assetCommitment
    || !result.definitionBlobId
    || !result.assetBlobId
    || !result.rendererCommitment
  ) fail(`StyleProductV7 ${objectId} is incomplete`)
  return result
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeSuiAddress(value)))]
}

function requireRecord(value: unknown, label: string): Fields {
  const result = record(value)
  if (Object.keys(result).length === 0) fail(`${label} is missing`)
  return result
}

function stringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some((entry) => typeof entry !== 'string' || !entry.trim())
  ) {
    fail(`${label} must be a non-empty string array`)
  }
  const result = (value as string[]).map((entry) => entry.trim())
  if (new Set(result).size !== result.length) fail(`${label} contains duplicates`)
  return result
}

function immutableLocator(blobId: string, identifier: string, label: string): string {
  try {
    return identifier ? getQuiltFileUrl(blobId, identifier) : getBlobUrl(blobId)
  } catch {
    return fail(`${label} has an invalid Walrus locator`)
  }
}

function componentTransform(value: unknown): PhysicalRendererV7Transform {
  const source = requireRecord(value, 'Item component transform')
  const x = finite(source.x)
  const y = finite(source.y)
  const scale = finite(source.scale)
  const rotation = finite(source.rotation)
  const opacity = finite(source.opacity)
  const blendMode = text(source.blendMode).toLowerCase()
  if (
    x == null || y == null || scale == null || rotation == null || opacity == null
    || scale <= 0 || scale > 1_000 || Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000
    || Math.abs(rotation) > 360_000 || opacity < 0 || opacity > 1
  ) fail('Item component transform is outside the v6 renderer bounds')
  const allowed = new Set([
    'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge',
    'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue',
    'saturation', 'color', 'luminosity', 'linear-dodge',
  ])
  if (!allowed.has(blendMode)) fail(`Unsupported v6 blend mode: ${blendMode}`)
  return { x, y, scale, rotation, opacity, blendMode }
}

interface VerifiedProductDefinition {
  definition: Fields
  component: Fields
  display: Fields
}

async function resolveProductDefinition(
  fetcher: Fetcher,
  styleProduct: ChainStyleProduct,
  product: ChainProduct,
  makerRootObjectId: string,
  slotSchemaCommitment: string,
): Promise<VerifiedProductDefinition> {
  const url = immutableLocator(
    styleProduct.definitionBlobId,
    styleProduct.definitionIdentifier,
    `StyleProductV7 ${product.id} definition`,
  )
  const definitionBytes = await fetchBytes(
    fetcher,
    url,
    `ItemProductDefinitionV6 ${product.id}`,
    MAX_MANIFEST_BYTES,
  )
  if (await sha256Hex(definitionBytes) !== product.definitionCommitment) {
    fail(`ItemProductDefinitionV6 ${product.id} does not match its on-chain commitment`)
  }
  const definition = parseJson(definitionBytes, `ItemProductDefinitionV6 ${product.id}`)
  const claims = Array.isArray(definition.slotClaims)
    ? definition.slotClaims.map(record)
    : []
  const components = Array.isArray(definition.components)
    ? definition.components.map(record)
    : []
  const expectedOrigin = ['OFFICIAL', 'CERTIFIED', 'OPEN'][product.originKind]
  if (
    text(definition.schemaVersion) !== ITEM_DEFINITION_SCHEMA
    || !sameId(requiredId(definition.makerRootId, 'Item definition MakerRoot'), makerRootObjectId)
    || commitment(definition.compatibilityHash) !== slotSchemaCommitment
    || commitment(definition.contentHash) !== product.assetCommitment
    || text(definition.originClass) !== expectedOrigin
    || claims.length !== 1
    || text(claims[0]?.slotId) !== product.slotKey
    || integer(claims[0]?.units) !== 1
    || components.length !== 1
  ) {
    fail(`ItemProductDefinitionV6 ${product.id} is not the exact admitted Product`)
  }

  const component = components[0]!
  const layerTrackId = text(component.layerTrackId)
  const assetHash = commitment(component.assetHash)
  const assetWidth = exactPositive(component.assetWidth, 'Item component width')
  const assetHeight = exactPositive(component.assetHeight, 'Item component height')
  const transform = componentTransform(component.transform)
  const rawBaseSource = component.baseSource
  const baseSource = rawBaseSource == null
    ? null
    : (() => {
        const source = requireRecord(rawBaseSource, 'Official base source')
        const result = {
          partId: text(source.partId),
          itemId: text(source.itemId),
          styleId: text(source.styleId),
        }
        if (!result.partId || !result.itemId || !result.styleId) {
          fail('Official base source is incomplete')
        }
        return result
      })()
  if (!text(component.id) || !layerTrackId || !assetHash) {
    fail(`ItemProductDefinitionV6 ${product.id} has an incomplete component`)
  }
  const computedContentHash = await stableHash({
    schemaVersion: 'animacraft.item-content.v6',
    components: [{
      layerTrackId,
      assetHash,
      assetWidth,
      assetHeight,
      transform,
      baseSource,
    }],
  })
  if (computedContentHash !== product.assetCommitment) {
    fail(`ItemProductDefinitionV6 ${product.id} contentHash is not reproducible`)
  }
  return {
    definition,
    component,
    display: record(definition.display),
  }
}

function baseStyleAndAsset(
  baseManifest: Fields,
  baseSource: Fields,
): { style: Fields; asset: Fields } {
  const partId = text(baseSource.partId)
  const itemId = text(baseSource.itemId)
  const styleId = text(baseSource.styleId)
  const parts = Array.isArray(baseManifest.parts) ? baseManifest.parts.map(record) : []
  const part = parts.find((entry) => text(entry.id) === partId)
  const items = Array.isArray(part?.items) ? (part.items as unknown[]).map(record) : []
  const item = items.find((entry) => text(entry.id) === itemId)
  const styles = Array.isArray(item?.styles) ? (item.styles as unknown[]).map(record) : []
  const style = styles.find((entry) => text(entry.id) === styleId)
  const assetId = text(style?.assetId)
  const assets = Array.isArray(baseManifest.assets) ? baseManifest.assets.map(record) : []
  const matches = assets.filter((entry) => text(entry.id) === assetId)
  if (!part || !item || !style || !assetId || matches.length !== 1) {
    fail(`Official base source ${partId}/${itemId}/${styleId} is not resolvable`)
  }
  return { style, asset: matches[0]! }
}

function exactPositive(value: unknown, label: string): number {
  const result = integer(value)
  if (result <= 0 || result > 16_384) fail(`${label} is invalid`)
  return result
}

async function fetchLayer(
  fetcher: Fetcher,
  params: {
    asset: PhysicalStyleAssetV7View
    styleName: string
    component: Fields
    componentOrder: number
    trackOrder: number
    chainProduct: ChainProduct
    styleProduct: ChainStyleProduct
    baseManifest: Fields
    baseQuiltId: string
  },
): Promise<PhysicalRendererV7Layer> {
  const componentId = text(params.component.id)
  const layerTrackId = text(params.component.layerTrackId)
  const expectedAssetHash = commitment(params.component.assetHash)
  const width = exactPositive(params.component.assetWidth, 'Item component width')
  const height = exactPositive(params.component.assetHeight, 'Item component height')
  const transform = componentTransform(params.component.transform)
  if (!componentId || !layerTrackId || !expectedAssetHash) fail('Item component identity is incomplete')

  const baseSource = params.component.baseSource == null
    ? null
    : requireRecord(params.component.baseSource, 'Official base source')
  let assetUrl: string
  let bytesValue: Uint8Array

  if (baseSource) {
    // The exact root comparison is performed by the caller. This branch also
    // prevents a third-party Product from claiming an OCMaker Quilt source.
    if (params.chainProduct.originKind !== 0) {
      fail('Only an official Item may use a base Maker source')
    }
    const { style, asset } = baseStyleAndAsset(params.baseManifest, baseSource)
    const identifier = text(asset.identifier)
    if (
      !identifier
      || text(style.layerTrackId) !== layerTrackId
      || params.styleProduct.assetBlobId !== params.baseQuiltId
      || params.styleProduct.assetIdentifier !== identifier
    ) {
      fail('Official base Style and companion Layer Track differ')
    }
    const manifestWidth = exactPositive(asset.width, 'Base Maker asset width')
    const manifestHeight = exactPositive(asset.height, 'Base Maker asset height')
    if (manifestWidth !== width || manifestHeight !== height) {
      fail('Official base asset dimensions differ from the companion Item')
    }
    const declaredHash = commitment(asset.sha256 ?? asset.contentHash ?? asset.digest)
    if (declaredHash && declaredHash !== expectedAssetHash) {
      fail('Official base asset commitment differs from the companion Item')
    }
    assetUrl = immutableLocator(
      params.styleProduct.assetBlobId,
      params.styleProduct.assetIdentifier,
      `StyleProductV7 ${params.asset.styleProductObjectId} PNG`,
    )
    bytesValue = await fetchBytes(fetcher, assetUrl, `Base Maker PNG ${identifier}`, MAX_PNG_BYTES)
  } else {
    assetUrl = immutableLocator(
      params.styleProduct.assetBlobId,
      params.styleProduct.assetIdentifier,
      `StyleProductV7 ${params.asset.styleProductObjectId} PNG`,
    )
    bytesValue = await fetchBytes(fetcher, assetUrl, `Item component ${componentId}`, MAX_PNG_BYTES)
  }
  if (await sha256Hex(bytesValue) !== expectedAssetHash) {
    fail(`Item component ${componentId} does not match its exact PNG commitment`)
  }

  const dimensions = pngDimensions(bytesValue, `Item component ${componentId}`)
  if (dimensions.width !== width || dimensions.height !== height) {
    fail(`Item component ${componentId} PNG dimensions do not match its immutable definition`)
  }
  return {
    styleAssetObjectId: params.asset.objectId,
    styleProductObjectId: params.asset.styleProductObjectId,
    v6ProductObjectId: params.asset.v6ProductObjectId,
    slotKey: params.asset.slotKey,
    styleName: params.styleName,
    componentId,
    layerTrackId,
    layerTrackOrder: params.trackOrder,
    componentOrder: params.componentOrder,
    assetUrl,
    assetBlob: new Blob([bytesValue.slice().buffer as ArrayBuffer], { type: 'image/png' }),
    assetWidth: width,
    assetHeight: height,
    expectedAssetHash,
    integrity: 'sha256',
    transform,
  }
}

async function mapLimited<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++
      result[index] = await mapper(values[index]!, index)
    }
  })
  await Promise.all(workers)
  return result
}

/**
 * Resolve the only preview that Soulidity may label as a physical v7 render.
 * Every locator comes from a hash-bound Walrus manifest and every object is
 * re-read from Sui. A failure returns no partial scene to the caller.
 */
export async function resolvePhysicalRendererV7Scene(
  client: Pick<SuiJsonRpcClient, 'getObject'>,
  runtime: PhysicalWardrobeV7Runtime,
  snapshot: PhysicalWardrobeV7Snapshot,
  fetcher: Fetcher = globalThis.fetch.bind(globalThis),
): Promise<PhysicalRendererV7Scene> {
  const maker = snapshot.maker
  const [physicalObject, profileObject, rootObject] = await Promise.all([
    getObject(client, maker.physicalProfileObjectId),
    getObject(client, maker.compositionProfileObjectId),
    getObject(client, maker.makerRootObjectId),
  ])
  const physical = parsePhysicalProfile(physicalObject, runtime, maker.physicalProfileObjectId)
  const profile = parseV6Profile(profileObject, runtime, maker.compositionProfileObjectId)
  const root = parseMakerRoot(rootObject, runtime, maker.makerRootObjectId)
  if (
    !physical.sealed || !profile.sealed
    || !sameId(physical.rootId, maker.makerRootObjectId)
    || !sameId(profile.rootId, maker.makerRootObjectId)
    || !sameId(physical.v6ProfileId, maker.compositionProfileObjectId)
    || physical.slotSchemaCommitment !== profile.slotSchemaCommitment
    || physical.rendererCommitment !== profile.rendererCommitment
  ) fail('The physical v7 and composable v6 Profiles are not the same sealed Maker release')

  const companionUrl = getBlobUrl(profile.companionBlobId)
  const companionBytes = await fetchBytes(
    fetcher,
    companionUrl,
    'Maker v6 companion manifest',
    MAX_MANIFEST_BYTES,
  )
  if (await sha256Hex(companionBytes) !== profile.companionHash) {
    fail('The Maker v6 companion manifest does not match MakerProfileV6')
  }
  const companion = parseJson(companionBytes, 'Maker v6 companion manifest')
  if (text(companion.schemaVersion) !== COMPANION_SCHEMA) fail('The Maker companion schema is unsupported')
  const baseBinding = requireRecord(companion.baseMaker, 'Companion base Maker binding')
  if (!sameId(requiredId(baseBinding.makerRootId, 'Companion MakerRootV5'), maker.makerRootObjectId)) {
    fail('The companion manifest belongs to a different MakerRootV5')
  }
  const compatibility = requireRecord(companion.compatibility, 'Companion compatibility profile')
  const renderer = requireRecord(compatibility.renderer, 'Companion renderer definition')
  if (
    commitment(compatibility.manifestHash) !== profile.slotSchemaCommitment
    || commitment(renderer.commitment) !== profile.rendererCommitment
  ) fail('The companion renderer commitments differ from MakerProfileV6')
  const canvas = requireRecord(compatibility.canvas, 'Companion canvas')
  const width = exactPositive(canvas.width, 'Companion canvas width')
  const height = exactPositive(canvas.height, 'Companion canvas height')
  const coordinate = requireRecord(compatibility.coordinate, 'Companion coordinate system')
  if (text(coordinate.origin) !== 'TOP_LEFT' || text(coordinate.unit) !== 'PIXEL') {
    fail('The v7 renderer supports only the reviewed top-left pixel coordinate system')
  }
  const pixelMode = bool(coordinate.pixelMode) === true
  const trackIds = stringArray(compatibility.layerTrackIds, 'Companion Layer Tracks')
  const slots = Array.isArray(compatibility.slots) ? compatibility.slots.map(record) : []
  if (slots.length === 0) fail('The companion has no Part slots')

  const legacyMakerObject = await getObject(client, root.legacyMakerId)
  const legacyMaker = parseLegacyMaker(legacyMakerObject, runtime, root.legacyMakerId)
  const baseManifestUrl = getQuiltFileUrl(legacyMaker.manifestQuiltId, BASE_MANIFEST_IDENTIFIER)
  const baseBytes = await fetchBytes(
    fetcher,
    baseManifestUrl,
    'Base Maker manifest',
    MAX_MANIFEST_BYTES,
  )
  const baseManifestHash = commitment(baseBinding.manifestHash)
  if (!baseManifestHash || await sha256Hex(baseBytes) !== baseManifestHash) {
    fail('The base Maker manifest does not match the v6 companion binding')
  }
  const baseManifest = parseJson(baseBytes, 'Base Maker manifest')
  const baseVersion = requireRecord(baseManifest.version, 'Base Maker version')
  if (
    text(baseManifest.schemaVersion) !== text(baseBinding.manifestSchemaVersion)
    || text(baseVersion.rootMakerId) !== text(baseBinding.rootMakerId)
    || text(baseVersion.versionId) !== text(baseBinding.versionId)
    || integer(baseVersion.number) !== integer(baseBinding.versionNumber)
  ) fail('The base Maker version identity differs from the companion binding')

  const allAssets = [...snapshot.wardrobeAssets, ...snapshot.walletAssets]
  if (allAssets.length > MAX_PRODUCTS) fail('The v7 Style asset catalog exceeds the query limit')
  if (new Set(allAssets.map((asset) => normalizeSuiAddress(asset.objectId))).size !== allAssets.length) {
    fail('The v7 Style asset catalog contains a duplicate object')
  }
  const productIds = uniqueIds(allAssets.map((asset) => asset.v6ProductObjectId))
  const styleProductIds = uniqueIds(allAssets.map((asset) => asset.styleProductObjectId))
  const [productObjects, styleProductObjects] = await Promise.all([
    Promise.all(productIds.map((objectId) => getObject(client, objectId))),
    Promise.all(styleProductIds.map((objectId) => getObject(client, objectId))),
  ])
  const products = new Map(productIds.map((objectId, index) => [
    objectId,
    parseChainProduct(productObjects[index], runtime, objectId),
  ]))
  const styleProducts = new Map(styleProductIds.map((objectId, index) => [
    objectId,
    parseChainStyleProduct(styleProductObjects[index], runtime, objectId),
  ]))
  const matchedDefinitions = new Map<string, VerifiedProductDefinition>()
  const definitionPromises = new Map<string, Promise<VerifiedProductDefinition>>()
  const metadata: Record<string, PhysicalRendererV7AssetMetadata> = {}

  for (const asset of allAssets) {
    const product = products.get(normalizeSuiAddress(asset.v6ProductObjectId))
    const styleProduct = styleProducts.get(normalizeSuiAddress(asset.styleProductObjectId))
    if (!product || !styleProduct) fail(`StyleAssetV7 ${asset.objectId} has no immutable product definition`)
    if (
      !sameId(asset.profileObjectId, maker.physicalProfileObjectId)
      || !sameId(styleProduct.profileId, maker.physicalProfileObjectId)
      || !sameId(styleProduct.v6ProfileId, maker.compositionProfileObjectId)
      || !sameId(styleProduct.v6ProductId, product.id)
      || styleProduct.slotKey !== asset.slotKey
      || product.slotKey !== asset.slotKey
      || product.slotSchemaCommitment !== profile.slotSchemaCommitment
      || styleProduct.definitionCommitment !== product.definitionCommitment
      || styleProduct.assetCommitment !== product.assetCommitment
      || styleProduct.rendererCommitment !== profile.rendererCommitment
    ) fail(`StyleAssetV7 ${asset.objectId} is not compatible with this exact Maker Profile`)
    if (product.originKind === 0) {
      if (!product.sourceRootId || !sameId(product.sourceRootId, maker.makerRootObjectId)) {
        fail(`Official ItemProductV6 ${product.id} belongs to another Maker root`)
      }
    } else if (product.sourceRootId) {
      fail(`Third-party ItemProductV6 ${product.id} unexpectedly claims a Maker root`)
    }
    const slot = slots.find((entry) => text(entry.id) === asset.slotKey)
    if (!slot) fail(`Part slot ${asset.slotKey} is absent from the compatibility profile`)
    const allowedTracks = stringArray(slot.layerTrackIds, `Part ${asset.slotKey} Layer Tracks`)
    const styleProductId = normalizeSuiAddress(asset.styleProductObjectId)
    let definitionPromise = definitionPromises.get(styleProductId)
    if (!definitionPromise) {
      definitionPromise = resolveProductDefinition(
        fetcher,
        styleProduct,
        product,
        maker.makerRootObjectId,
        profile.slotSchemaCommitment,
      )
      definitionPromises.set(styleProductId, definitionPromise)
    }
    const verifiedDefinition = await definitionPromise
    if (!allowedTracks.includes(text(verifiedDefinition.component.layerTrackId))) {
      fail(`ItemProductDefinitionV6 ${product.id} uses a Layer Track outside Part ${asset.slotKey}`)
    }
    matchedDefinitions.set(asset.objectId, verifiedDefinition)
    const display = verifiedDefinition.display
    metadata[asset.objectId] = {
      name: styleProduct.label || text(display.name) || `${asset.slotKey} Style`,
      description: text(display.description),
      thumbnailUrl: null,
      verified: true,
    }
  }

  const equippedAssets = snapshot.wardrobe.loadout.map((row) => {
    const asset = snapshot.wardrobeAssets.find((entry) => sameId(entry.objectId, row.styleAssetObjectId))
    if (!asset) fail(`Equipped StyleAssetV7 ${row.styleAssetObjectId} is not in wardrobe custody`)
    return asset
  })
  const layerInputs = equippedAssets.flatMap((asset) => {
    const definition = matchedDefinitions.get(asset.objectId)
    if (!definition) fail(`StyleAssetV7 ${asset.objectId} has no verified Product definition`)
    return [{ asset, component: definition.component, componentOrder: 0 }]
  })
  if (layerInputs.length > MAX_RENDER_LAYERS) fail('The equipped v7 Loadout exceeds the renderer layer limit')

  const layers = await mapLimited(layerInputs, 6, async ({ asset, component, componentOrder }) => {
    const trackId = text(component.layerTrackId)
    const trackOrder = trackIds.indexOf(trackId)
    if (trackOrder < 0) fail(`Unknown Layer Track ${trackId}`)
    const chainProduct = products.get(normalizeSuiAddress(asset.v6ProductObjectId))!
    const styleProduct = styleProducts.get(normalizeSuiAddress(asset.styleProductObjectId))!
    return fetchLayer(fetcher, {
      asset,
      styleName: metadata[asset.objectId]!.name,
      component,
      componentOrder,
      trackOrder,
      chainProduct,
      styleProduct,
      baseManifest,
      baseQuiltId: legacyMaker.manifestQuiltId,
    })
  })
  layers.sort((left, right) => (
    left.layerTrackOrder - right.layerTrackOrder
    || left.componentOrder - right.componentOrder
    || left.styleAssetObjectId.localeCompare(right.styleAssetObjectId)
  ))
  for (const layer of layers) {
    metadata[layer.styleAssetObjectId]!.thumbnailUrl ??= layer.assetUrl
  }

  return {
    wardrobeObjectId: snapshot.wardrobe.objectId,
    wardrobeRevision: snapshot.wardrobe.revision,
    width,
    height,
    pixelMode,
    companionManifestBlobId: profile.companionBlobId,
    companionManifestHash: profile.companionHash,
    baseMakerManifestQuiltId: legacyMaker.manifestQuiltId,
    baseMakerManifestHash: baseManifestHash,
    layers,
    assetMetadata: metadata,
  }
}

const COMPOSITES: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  'linear-dodge': 'lighter',
}

async function imageSource(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob)
  if (typeof Image === 'undefined') fail('Canvas image decoding is unavailable')
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Draw a previously integrity-verified scene with Animacraft's v6 transform semantics. */
export async function renderPhysicalRendererV7Scene(
  scene: PhysicalRendererV7Scene,
  canvas: HTMLCanvasElement,
): Promise<void> {
  canvas.width = scene.width
  canvas.height = scene.height
  const context = canvas.getContext('2d')
  if (!context) fail('Canvas 2D is unavailable')
  context.clearRect(0, 0, scene.width, scene.height)
  for (const layer of scene.layers) {
    const source = await imageSource(layer.assetBlob)
    const { transform } = layer
    const originX = layer.assetWidth / 2
    const originY = layer.assetHeight / 2
    try {
      context.save()
      context.imageSmoothingEnabled = !scene.pixelMode
      context.globalAlpha = transform.opacity
      context.globalCompositeOperation = COMPOSITES[transform.blendMode] ?? 'source-over'
      context.translate(
        transform.x + Math.abs(transform.scale) * originX,
        transform.y + Math.abs(transform.scale) * originY,
      )
      context.rotate(transform.rotation * Math.PI / 180)
      context.scale(transform.scale, transform.scale)
      context.translate(-originX, -originY)
      context.drawImage(source, 0, 0, layer.assetWidth, layer.assetHeight)
    } finally {
      context.restore()
      if ('close' in source && typeof source.close === 'function') source.close()
    }
  }
}
