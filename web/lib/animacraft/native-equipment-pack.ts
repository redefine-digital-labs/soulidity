import { sha256 } from '@noble/hashes/sha2.js'
import { equipmentBytesEqual, equipmentUtf8, validEquipmentCursor } from './native-equipment-bytes'
import { bcs, type BcsType } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag } from '@mysten/sui/utils'
import { decodeNativeBcs, NativeReceiveError, receiveId } from './native-receive'
import type { EquipmentReadSet } from './native-equipment'
import { EquipmentColorRowBcs, type EquipmentPackRegistryBcs } from './native-equipment-source-bcs'
import { findNativePackDefinitions, nativePackOwnedDefinition, validateNativePackRules } from './native-pack-definitions'

const A = bcs.Address; const U = bcs.u64(); const S = bcs.string(); const V = bcs.vector(bcs.u8())
const Table = bcs.struct('Table', { id: A, size: U })
const passFields = { version: U, release_id: A, root_id: A, root_version: U, root_content_commitment: V,
  release_content_commitment: V, holder: A, paid_atomic: U, issued_at_ms: U }
export const EquipmentPackPassBcs = bcs.struct('PackPassV8', { id: A, ...passFields, commitment: V })
const PassCommitment = bcs.struct('PackPassCommitmentInputV8', { domain: V, ...passFields })
export const EquipmentPackStyleKeyBcs = bcs.struct('PackStyleKeyV8', { part_key: S, item_key: S, style_key: S })
export const EquipmentPackStyleDefinitionSourcesBcs = bcs.struct('PackStyleDefinitionSourcesV8', {
  part: bcs.u8(), track: bcs.u8(), color: bcs.option(bcs.u8()),
})
export const EquipmentPackStyleBcs = bcs.struct('PackStyleV8', {
  index: U, definition_sources: EquipmentPackStyleDefinitionSourcesBcs,
  part_key: S, item_key: S, style_key: S, layer_track_key: S, color_channel_key: bcs.option(S),
  default_swatch_key: bcs.option(S), asset_blob_id: S, asset_sha256: V, asset_content_commitment: V,
  protected: bcs.bool(), seal_binding_commitment: V, style_commitment: V,
})
export const EquipmentPackReleaseBcs = bcs.struct('PackReleaseV8', {
  id: A, version: U, root_id: A, root_version: U, root_content_commitment: V, creator: A, owner: A,
  control_epoch: U, admin_cap_id: A, treasury_id: A, semantic_pack_id: S, manifest_blob_id: S,
  manifest_sha256: V, content_commitment: V, lifecycle: bcs.u8(), access_kind: bcs.u8(), access_price_atomic: U,
  complete_mode: bcs.u8(), complete_price_atomic: U, complete_free_quota_per_wallet: U, complete_total_cap: U,
  expected_style_count: U, observed_style_count: U, expected_style_commitment: V, rolling_style_commitment: V,
  protected_style_count: U, pass_count: U, total_complete_count: U, styles: Table, complete_by_wallet: Table,
})
export const EquipmentPackAdmissionBcs = bcs.struct('PackAdmissionRecordV8', {
  release_id: A, semantic_pack_id: S, release_content_commitment: V, admitted_revision: U, admission_state: bcs.u8(),
})
export type PackPass = ReturnType<typeof EquipmentPackPassBcs.parse>
export type PackRelease = ReturnType<typeof EquipmentPackReleaseBcs.parse>
export type PackStyle = ReturnType<typeof EquipmentPackStyleBcs.parse>
export type PackAdmission = ReturnType<typeof EquipmentPackAdmissionBcs.parse>
export function validatePackDefinitionSources(style: PackStyle,
  validate: (value: unknown, message: string) => void = check) {
  const sources = style.definition_sources
  validate(sources && [1, 2].includes(sources.part) && [1, 2].includes(sources.track)
    && (style.color_channel_key === null ? sources.color === null
      : sources.color !== null && [1, 2].includes(sources.color)), 'Pack definition sources invalid')
}
export type EquipmentPackQuery = { passId?: string; cursor?: string; styleCursor?: string;
  exactStyles?: { partKey: string; itemKey: string; styleKey: string }[];
  style?: { partKey: string; itemKey: string; styleKey: string } }
export type EquipmentPackSource = {
  passes: Array<{ pass: PackPass; compatible: boolean }>; hasNextPage: boolean; cursor: string | null;
  selected: null | { pass: PackPass; release: PackRelease; admission: PackAdmission | null;
    semanticReleaseId: string | null; styles: PackStyle[]; definitionCommitment: number[] | null; definitionCapacity: number;
    colors: Array<ReturnType<typeof EquipmentColorRowBcs.parse> & { definition_source: number }>;
    hasNextPage: boolean; cursor: string | null }
}
/** A channel key is only unique within its definition source, even inside a
 * single Pack: one Style may reference Base and another PACK_SELF. */
export function equipmentPackStyleColor(pack: NonNullable<EquipmentPackSource['selected']>, style: PackStyle) {
  const matches = pack.colors.filter(row => row.key === style.color_channel_key
    && row.definition_source === style.definition_sources.color)
  return matches.length === 1 ? matches[0] : undefined
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_EQUIPMENT_PACK_INVALID', message)
}
const eq = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.every((v, i) => v === b[i])
export const validEquipmentPackCursor = validEquipmentCursor
export const validEquipmentPackKey = (key: string) => equipmentUtf8(key).length > 0
  && equipmentUtf8(key).length <= 128 && !/[\0/]/.test(key)
export function equipmentPackPassCommitment(pass: PackPass) {
  return [...sha256(PassCommitment.serialize({ ...pass,
    domain: [...equipmentUtf8('animacraft-v8/runtime/pack-pass')],
  }).toBytes())]
}

/** Runtime/Core resolvers are supplied by the pinned source reader. Index results
 * only locate objects: exact BCS, defining types and current custody grant authority. */
export async function readEquipmentPack(client: SuiGrpcClient, reads: EquipmentReadSet,
  input: { owner: string; rootId: string; rootVersion: string; rootCommitment: number[]; paymentCoinType: string;
    baseRegistryId: string; packs: ReturnType<typeof EquipmentPackRegistryBcs.parse>;
    runtimeType: (name: string) => string; baseType: (name: string) => string; query: EquipmentPackQuery }): Promise<EquipmentPackSource> {
  const { query, runtimeType: rt } = input
  check(query.exactStyles === undefined || (query.passId !== undefined && query.style === undefined
    && query.styleCursor === undefined && query.exactStyles.length > 0 && query.exactStyles.length <= 500
    && query.exactStyles.every(row => [row.partKey,row.itemKey,row.styleKey].every(validEquipmentPackKey))), 'Invalid exact Pack styles')
  for (const cursor of [query.cursor, query.styleCursor]) check(cursor === undefined || validEquipmentPackCursor(cursor), 'Invalid Pack cursor')
  check(query.passId === undefined || query.cursor === undefined, 'Selected Pack pass cannot use inventory cursor')
  check(query.passId !== undefined || (query.styleCursor === undefined && query.style === undefined), 'Pack style query requires a pass')
  check(query.style === undefined || query.styleCursor === undefined, 'Exact Pack style cannot use a cursor')
  if (query.style) check([query.style.partKey, query.style.itemKey, query.style.styleKey].every(validEquipmentPackKey), 'Invalid Pack style key')
  const compatible = (row: { root_id: string; root_version: string; root_content_commitment: number[] }) => row.root_id === input.rootId
    && row.root_version === input.rootVersion && eq(row.root_content_commitment, input.rootCommitment)
  const passType = rt('PackPassV8')
  const page = query.passId !== undefined
    ? { objects: [{ objectId: receiveId(query.passId), type: passType,
      owner: { $kind: 'AddressOwner' as const, AddressOwner: input.owner } }], hasNextPage: false, cursor: null }
    : await client.core.listOwnedObjects({ owner: input.owner, type: passType, limit: 20, cursor: query.cursor })
  validatePage(page.objects.length, page.hasNextPage, page.cursor, query.cursor)
  const ids = new Set<string>()
  const passes = await Promise.all(page.objects.map(async row => {
    const id = receiveId(row.objectId)
    check(!ids.has(id), 'Duplicate Pack pass'); ids.add(id)
    check(normalizeStructTag(row.type) === normalizeStructTag(passType)
      && row.owner.$kind === 'AddressOwner' && row.owner.AddressOwner === input.owner, 'Pack discovery type/holder mismatch')
    const pass = decodeNativeBcs(EquipmentPackPassBcs, await reads.read(id, passType, 1, input.owner))
    check(pass.id === id && pass.version === '8' && pass.holder === input.owner
      && eq(pass.root_content_commitment, pass.root_content_commitment)
      && eq(pass.release_content_commitment, pass.release_content_commitment)
      && eq(pass.commitment, equipmentPackPassCommitment(pass)), 'Pack pass identity/commitment mismatch')
    return { pass, compatible: compatible(pass) }
  }))
  const result: EquipmentPackSource = { passes, hasNextPage: page.hasNextPage,
    cursor: page.hasNextPage ? page.cursor : null, selected: null }
  if (query.passId === undefined) return result
  const pass = passes[0].pass
  check(passes[0].compatible, 'Selected Pack pass belongs to a different Maker')
  const release = decodeNativeBcs(EquipmentPackReleaseBcs, await reads.read(pass.release_id,
    `${rt('PackReleaseV8')}<${input.paymentCoinType}>`, 3))
  check(release.id === pass.release_id && release.version === '8' && compatible(release)
    && eq(release.content_commitment, pass.release_content_commitment), 'Pack release/pass compatibility mismatch')
  check(release.styles.size === release.observed_style_count
    && BigInt(release.observed_style_count) <= BigInt(release.expected_style_count), 'Pack style count mismatch')
  const admission = await optionalField(input.packs.releases.id, '0x2::object::ID', A, release.id,
    rt('PackAdmissionRecordV8'), EquipmentPackAdmissionBcs)
  if (admission) check(admission.release_id === release.id, 'Pack admission identity mismatch')
  const semanticReleaseId = await optionalField(input.packs.semantic_releases.id, '0x1::string::String', S,
    release.semantic_pack_id, '0x2::object::ID', A)
  // Inactive/revoked admission is real source state; the eligibility layer reports
  // the reason. PackAccessKeyV8's bool is an issuance guard, not selection authority.
  const keyType = rt('PackStyleKeyV8'); const styleType = rt('PackStyleV8')
  const fieldType = `0x2::dynamic_field::Field<${keyType},${styleType}>`
  const exactKeys = query.exactStyles ?? (query.style ? [query.style] : undefined)
  const stylesPage = exactKeys
    ? { dynamicFields: exactKeys.map(style => {
      const exactKey = { part_key: style.partKey, item_key: style.itemKey, style_key: style.styleKey }
      return { $kind: 'DynamicField' as const,
      fieldId: deriveDynamicFieldID(release.styles.id, keyType, EquipmentPackStyleKeyBcs.serialize(exactKey).toBytes()),
      type: fieldType, name: { type: keyType, bcs: EquipmentPackStyleKeyBcs.serialize(exactKey).toBytes() }, valueType: styleType } }),
      hasNextPage: false, cursor: null }
    : await client.core.listDynamicFields({ parentId: release.styles.id, limit: 20, cursor: query.styleCursor })
  if (!query.exactStyles) validatePage(stylesPage.dynamicFields.length, stylesPage.hasNextPage, stylesPage.cursor, query.styleCursor)
  const fields = new Set<string>()
  const styles = await boundedMap<(typeof stylesPage.dynamicFields)[number], PackStyle>(stylesPage.dynamicFields, async hint => {
    check(hint.$kind === 'DynamicField' && normalizeStructTag(hint.type) === normalizeStructTag(fieldType)
      && normalizeStructTag(hint.name.type) === normalizeStructTag(keyType)
      && normalizeStructTag(hint.valueType) === normalizeStructTag(styleType), 'Pack style index type mismatch')
    const key = decodeNativeBcs(EquipmentPackStyleKeyBcs, hint.name.bcs)
    check([key.part_key, key.item_key, key.style_key].every(validEquipmentPackKey), 'Pack style key invalid')
    const id = deriveDynamicFieldID(release.styles.id, keyType, EquipmentPackStyleKeyBcs.serialize(key).toBytes())
    check(id === hint.fieldId && !fields.has(id), 'Pack style index identity/duplicate mismatch'); fields.add(id)
    const row = decodeNativeBcs(bcs.struct('Field', { id: A, name: EquipmentPackStyleKeyBcs, value: EquipmentPackStyleBcs }),
      await reads.read(id, fieldType, 2, release.styles.id))
    check(row.id === id && sameBytes(EquipmentPackStyleKeyBcs, row.name, key)
      && sameBytes(EquipmentPackStyleKeyBcs, row.value, key)
      && BigInt(row.value.index) < BigInt(release.observed_style_count), 'Pack style row identity mismatch')
    validatePackDefinitionSources(row.value)
    return row.value
  })
  const definitions = await findNativePackDefinitions(reads, release, rt)
  check(!styles.some(style => Object.values(style.definition_sources).includes(2)) || definitions, 'Pack definitions missing')
  if (definitions) validateNativePackRules(definitions)
  let definitionCapacity = 0
  for (const part of definitions?.rows.parts ?? []) {
    check(BigInt(part.capacity) > 0n && BigInt(part.capacity) <= 64n, 'Pack Part capacity invalid')
    // Soul adds one equipment position per Part; authoring capacity remains in
    // the immutable Pack definition for Maker/Player and is not an inventory cap.
    definitionCapacity += 1
  }
  check(definitionCapacity <= 500, 'Pack definition capacity exceeds limit')
  for (const style of styles) {
    if (style.definition_sources.part === 2) nativePackOwnedDefinition(definitions!, 'parts', style.part_key)
    if (style.definition_sources.track === 2) nativePackOwnedDefinition(definitions!, 'tracks', style.layer_track_key)
  }
  const colorKeys = [...new Map(styles.flatMap(style => style.color_channel_key === null ? []
    : [[`${style.definition_sources.color}:${style.color_channel_key}`,
      { channel_key: style.color_channel_key, definition_source: style.definition_sources.color! }] as const])).values()]
  const ColorKey = bcs.struct('ColorKeyV8', { channel_key: S })
  const colors = await boundedMap(colorKeys, async ({ channel_key, definition_source }) => {
    if (definition_source === 2) {
      check(definitions, 'Pack definitions missing')
      return { ...nativePackOwnedDefinition(definitions, 'colors', channel_key), definition_source }
    }
    const color = await optionalField(input.baseRegistryId, input.baseType('ColorKeyV8'), ColorKey, { channel_key },
      input.baseType('ColorChannelRowV2'), EquipmentColorRowBcs)
    check(color?.key === channel_key, 'Pack Core color missing/mismatch')
    return { ...color, definition_source }
  })
  result.selected = { pass, release, admission, semanticReleaseId, styles, colors, definitionCommitment: definitions?.commitment ?? null, definitionCapacity,
    hasNextPage: stylesPage.hasNextPage, cursor: stylesPage.hasNextPage ? stylesPage.cursor : null }
  return result

  async function optionalField<T, I>(parent: string, keyType: string, keySchema: BcsType<any, any>, key: unknown,
    valueType: string, schema: BcsType<T, I>): Promise<T | null> {
    const id = deriveDynamicFieldID(parent, keyType, keySchema.serialize(key).toBytes())
    const bytes = await reads.optional(id, `0x2::dynamic_field::Field<${keyType},${valueType}>`, 2, parent)
    if (bytes === null) return null
    const row = decodeNativeBcs(bcs.struct('Field', { id: A, name: keySchema, value: schema }), bytes)
    check(row.id === id && sameBytes(keySchema, row.name, key), 'Pack dynamic field key mismatch')
    return row.value
  }
}
async function boundedMap<T, R>(rows: T[], work: (row: T) => Promise<R>): Promise<R[]> {
  const result: R[] = []
  for (let start = 0; start < rows.length; start += 16) result.push(...await Promise.all(rows.slice(start, start + 16).map(work)))
  return result
}
function sameBytes(schema: BcsType<any, any>, a: unknown, b: unknown) {
  return equipmentBytesEqual(schema.serialize(a).toBytes(), schema.serialize(b).toBytes())
}
function validatePage(length: number, next: boolean, cursor: string | null, previous?: string) {
  check(length <= 20 && typeof next === 'boolean'
    && (!next || (typeof cursor === 'string' && validEquipmentPackCursor(cursor) && cursor !== previous && length > 0)), 'Invalid Pack page')
}
