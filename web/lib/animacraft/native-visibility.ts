import { bcs } from '@mysten/sui/bcs'
import type { ResolvedMakerV8Layer } from '@soulidity/animacraft-render-core'
import { EquipmentSelectionBcs } from './native-equipment'
import { EquipmentVisibilityTokensBcs } from './native-equipment-source-bcs'
import { nativeArtworkHash, nativeArtworkHex } from './native-artwork-bytes'
import { equipmentUtf8 } from './native-equipment-bytes'
import { NativeReceiveError } from './native-receive'

export type NativeVisibilityToken = ReturnType<typeof EquipmentVisibilityTokensBcs.parse>[number]
export type NativeVisibilitySelection = ReturnType<typeof EquipmentSelectionBcs.parse>
export type NativeVisibilityLevel = 'PART' | 'ITEM' | 'STYLE'
export interface NativeVisibility {
  valid: boolean
  violations: Array<{ selectionIndex: number; levels: NativeVisibilityLevel[] }>
}
export interface NativeVisibilitySubject {
  level: NativeVisibilityLevel
  partKey: string
  itemKey: string | null
  styleKey: string | null
  definitionSource?: 1 | 2
  definitionSourceKey?: string | null
}
const levels: NativeVisibilityLevel[] = ['PART', 'ITEM', 'STYLE']
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_VISIBILITY_INVALID', message)
}
const key = (value: unknown): value is string => typeof value === 'string'
  && equipmentUtf8(value).length > 0 && equipmentUtf8(value).length <= 128
const id = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)

/** Same V1 program grammar as Core: unary ALL/ANY is legal on chain. This
 * validates the complete program before evaluating it, including unused arms. */
function validate(tokens: readonly NativeVisibilityToken[]) {
  check(Array.isArray(tokens) && tokens.length <= 288, 'Visibility token limit exceeded')
  const depths: number[] = []; let leaves = 0
  for (const token of tokens) {
    check(token && Number.isInteger(token.opcode) && token.opcode >= 0 && token.opcode <= 3
      && Number.isInteger(token.arity), 'Invalid visibility opcode or arity')
    if (token.opcode === 0) {
      const s = token.selector
      check(s && token.arity === 0 && Number.isInteger(s.source) && s.source >= 0 && s.source <= 3
        && key(s.part_key) && (s.item_key === null || key(s.item_key))
        && (s.style_key === null || key(s.style_key) && s.item_key !== null), 'Invalid visibility selector')
      check(s.source <= 1 ? s.source_key === null : s.source === 2 ? key(s.source_key) : id(s.source_key),
        'Invalid visibility selector source')
      check(++leaves <= 32, 'Visibility leaf limit exceeded'); depths.push(1)
    } else {
      check(token.selector === null && (token.opcode === 1 ? token.arity === 1 : token.arity >= 1 && token.arity <= 32)
        && depths.length >= token.arity, 'Invalid visibility postfix stack')
      const depth = Math.max(...depths.splice(depths.length - token.arity)) + 1
      check(depth <= 8, 'Visibility depth limit exceeded'); depths.push(depth)
    }
  }
  check(tokens.length === 0 || depths.length === 1, 'Invalid visibility postfix result')
}

/** Runtime source classes are BASE=0/PACK=1/EXTERNAL=2; selectors reserve 0
 * for ANY. References compare identities, never labels or asset names. */
export type NativeVisibilityMatcher = (selector: NonNullable<NativeVisibilityToken['selector']>, selection: NativeVisibilitySelection) => boolean
export const nativeVisibilitySelectorMatches: NativeVisibilityMatcher = (s, row) => (s.source === 0 || s.source === row.source_class + 1)
  && (s.source < 2 || s.source_key === (row.source_class === 1 ? row.source_semantic_id : row.source_definition_id))
  && s.part_key === row.part_key && (s.item_key === null || s.item_key === row.item_key)
  && (s.style_key === null || s.style_key === row.style_key)

export function evaluateNativeVisibility(tokens: readonly NativeVisibilityToken[], selections: readonly (NativeVisibilitySelection | null)[],
  matches: NativeVisibilityMatcher = nativeVisibilitySelectorMatches): boolean {
  validate(tokens)
  if (tokens.length === 0) return true
  const stack: boolean[] = []
  for (const token of tokens) {
    if (token.opcode === 0) {
      const s = token.selector!
      stack.push(selections.some(row => row !== null && matches(s, row)))
    } else if (token.opcode === 1) stack.push(!stack.pop()!)
    else {
      const children = stack.splice(stack.length - token.arity)
      stack.push(token.opcode === 2 ? children.every(Boolean) : children.some(Boolean))
    }
  }
  return stack[0]
}

const Commitment = bcs.struct('VisibilityProgramCommitmentInputV1', {
  domain: bcs.string(), schema_revision: bcs.u64(), definition_source: bcs.u8(),
  definition_source_key: bcs.option(bcs.string()), subject_level: bcs.u8(),
  part_key: bcs.string(), item_key: bcs.option(bcs.string()), style_key: bcs.option(bcs.string()),
  tokens: EquipmentVisibilityTokensBcs,
})
/** Namespace is part of the commitment; Pack rows bind their semantic identity. */
export function nativeVisibilityCommitment(subject: NativeVisibilitySubject, tokens: NativeVisibilityToken[]): number[] {
  validate(tokens)
  const level = levels.indexOf(subject.level)
  const definitionSource = subject.definitionSource ?? 1
  const definitionSourceKey = subject.definitionSourceKey ?? null
  check(definitionSource === 1 ? definitionSourceKey === null
    : definitionSource === 2 && key(definitionSourceKey), 'Invalid visibility definition source')
  check(level >= 0 && key(subject.partKey)
    && (level === 0 ? subject.itemKey === null : key(subject.itemKey))
    && (level < 2 ? subject.styleKey === null : key(subject.styleKey)), 'Invalid visibility subject')
  return [...nativeArtworkHash(Commitment.serialize({ domain: 'animacraft-fresh-v8/core/visibility-program/v1',
    schema_revision: '1', definition_source: definitionSource, definition_source_key: definitionSourceKey, subject_level: level,
    part_key: subject.partKey, item_key: subject.itemKey, style_key: subject.styleKey, tokens }).toBytes())]
}

export function evaluateNativeVisibilityRow(subject: NativeVisibilitySubject,
  row: { visibility_tokens: NativeVisibilityToken[]; visibility_commitment: number[] },
  selections: readonly (NativeVisibilitySelection | null)[], matches?: NativeVisibilityMatcher): boolean {
  const expected = nativeVisibilityCommitment(subject, row.visibility_tokens)
  check(Array.isArray(row.visibility_commitment) && row.visibility_commitment.length === 32
    && expected.every((byte, index) => byte === row.visibility_commitment[index]), 'Visibility subject commitment mismatch')
  return evaluateNativeVisibility(row.visibility_tokens, selections, matches)
}

export interface NativeVisibilityScene {
  selections: Array<NativeVisibilitySelection | null>
  selectionIndexes: number[]
  visibility: NativeVisibility
  layers: ResolvedMakerV8Layer[]
}

/** Completeness is measured against every selected slot. Visible layers are
 * exactly the subset without violations, in original slot order. Consumers
 * must not replace this check with layers.length === selected.length. */
export function assertNativeSceneVisibility(scene: NativeVisibilityScene): void {
  check(scene && Array.isArray(scene.selections) && scene.selections.length > 0 && scene.selections.length <= 500
    && Array.isArray(scene.selectionIndexes) && Array.isArray(scene.layers)
    && scene.visibility && typeof scene.visibility.valid === 'boolean' && Array.isArray(scene.visibility.violations),
  'Missing complete scene visibility evidence')
  const selected: number[] = []
  scene.selections.forEach((row, index) => {
    if (row === null) return
    check(row && row.selection_index === String(index) && [0, 1, 2].includes(row.source_class)
      && [row.part_key, row.item_key, row.style_key].every(key), 'Invalid scene selection identity')
    // Retain the complete chain selection contract, including hidden slots.
    try { EquipmentSelectionBcs.serialize(row).toBytes() } catch { check(false, 'Invalid scene selection fields') }
    selected.push(index)
  })
  check(selected.length === scene.selectionIndexes.length && selected.every((index, position) => index === scene.selectionIndexes[position]),
    'Scene selection indexes do not match complete selections')
  const hidden = new Set<number>(); let previous = -1
  for (const violation of scene.visibility.violations) {
    check(violation && Number.isInteger(violation.selectionIndex) && violation.selectionIndex > previous
      && selected.includes(violation.selectionIndex) && Array.isArray(violation.levels) && violation.levels.length > 0
      && violation.levels.every((level, index) => levels.includes(level) && (index === 0 || levels.indexOf(violation.levels[index - 1]) < levels.indexOf(level))),
    'Invalid scene visibility violation')
    const row = scene.selections[violation.selectionIndex]!
    check(row.source_class !== 2 || violation.levels.every(level => level === 'PART'), 'Unpublished remote visibility condition')
    previous = violation.selectionIndex; hidden.add(violation.selectionIndex)
  }
  check(scene.visibility.valid === (hidden.size === 0), 'Scene visibility validity mismatch')
  const visible = selected.filter(index => !hidden.has(index))
  check(scene.layers.length === visible.length, 'Scene visible layer set is incomplete')
  scene.layers.forEach((layer, index) => {
    const row = scene.selections[visible[index]]!
    check(layer && layer.selectionIndex === visible[index] && layer.selection
      && layer.selection.source === ['BASE', 'PACK', 'EXTERNAL'][row.source_class]
      && layer.selection.partKey === row.part_key && layer.selection.itemKey === row.item_key && layer.selection.styleKey === row.style_key
      && layer.asset?.blobId === row.asset_blob_id && layer.asset.sha256 === nativeArtworkHex(row.asset_sha256)
      && layer.protected === row.protected && (layer.swatch?.key ?? null) === row.swatch_key,
    'Scene visible layer identity mismatch')
  })
}
