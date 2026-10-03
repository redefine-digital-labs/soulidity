import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import type { EquipmentReadSet } from './native-equipment'
import type { PackRelease } from './native-equipment-pack'
import { equipmentBytesEqual, equipmentUtf8 } from './native-equipment-bytes'
import { decodeNativeBcs, NativeReceiveError } from './native-receive'
import { EquipmentTrackRowBcs, EquipmentColorRowBcs, EquipmentPartRowBcs,
  EquipmentSemanticSelectorBcs, EquipmentVisibilityTokensBcs } from './native-equipment-source-bcs'
import { evaluateNativeVisibility } from './native-visibility'

const A = bcs.Address; const U = bcs.u64(); const S = bcs.string(); const V = bcs.vector(bcs.u8())
const Rule = bcs.struct('RuleRowV2', {
  sequence: U, key: S, kind: bcs.u8(), trigger: EquipmentSemanticSelectorBcs,
  target_mode: bcs.u8(), targets: bcs.vector(EquipmentSemanticSelectorBcs), payload_commitment: V,
})
const Visibility = bcs.struct('PackVisibilityRowV2', {
  subject: bcs.u8(), definition_source: bcs.u8(), part_key: S, item_key: S,
  style_key: bcs.option(S), visibility_tokens: EquipmentVisibilityTokensBcs, visibility_commitment: V,
})
export const NativePackDefinitionRowsBcs = bcs.struct('PackDefinitionRowsV2', {
  semantic_pack_id: S, tracks: bcs.vector(EquipmentTrackRowBcs), colors: bcs.vector(EquipmentColorRowBcs),
  parts: bcs.vector(EquipmentPartRowBcs), rules: bcs.vector(Rule), visibility: bcs.vector(Visibility),
})
const fields = { version: U, release_id: A, release_content_commitment: V, rows: NativePackDefinitionRowsBcs }
export const NativePackDefinitionsBcs = bcs.struct('PackDefinitionsV8', { ...fields, commitment: V })
// Move's empty struct is encoded with its compiled dummy_field=false, not zero bytes.
export const NativePackDefinitionsKeyBcs = bcs.struct('PackDefinitionsKeyV8', { dummy_field: bcs.bool() })
export const NativePackDefinitionsFieldBcs = bcs.struct('Field', {
  id: A, name: NativePackDefinitionsKeyBcs, value: NativePackDefinitionsBcs,
})
const Commitment = bcs.struct('PackDefinitionsCommitmentInputV8', { domain: V, ...fields })
export type NativePackDefinitions = ReturnType<typeof NativePackDefinitionsBcs.parse>
export function nativePackDefinitionsCommitment(value: Omit<NativePackDefinitions, 'commitment'>) {
  return [...sha256(Commitment.serialize({
    domain: [...equipmentUtf8('animacraft-v8/runtime/pack-definitions')], ...value,
  }).toBytes())]
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_PACK_DEFINITIONS_INVALID', message)
}
const hashEqual = (a: number[], c: number[]) => a.length === 32 && c.length === 32
  && equipmentBytesEqual(Uint8Array.from(a), Uint8Array.from(c))

/** Validate published rule structure, not completion readiness. Runtime's
 * equipment proof deliberately skips completion-only combination rules; users
 * must remain able to edit and render an intermediate equipment arrangement. */
export function validateNativePackRules(value: NativePackDefinitions) {
  check(value.rows.rules.length <= 1000, 'Pack rule count exceeded')
  const keys = new Set<string>()
  value.rows.rules.forEach((rule, index) => {
    check(rule.sequence === String(index) && equipmentUtf8(rule.key).length > 0
      && equipmentUtf8(rule.key).length <= 128 && !keys.has(rule.key), 'Pack rule identity invalid')
    keys.add(rule.key)
    check([0, 1].includes(rule.kind) && [0, 1].includes(rule.target_mode)
      && (rule.kind !== 1 || rule.target_mode === 1), 'Pack rule mode invalid')
    check(rule.targets.length > 0 && rule.targets.length <= 32
      && rule.payload_commitment.length === 32, 'Pack rule targets or commitment invalid')
    // Core rules and visibility leaves share SemanticSelectorV2 grammar.
    for (const selector of [rule.trigger, ...rule.targets])
      evaluateNativeVisibility([{ opcode: 0, arity: 0, selector }], [])
  })
}

/** Content proof only, not admission/custody/selection authority. Call with an
 * already authenticated Release and pinned runtime type-origin resolver. The
 * final field participates in the caller's existing read-set recheck. Missing
 * fields and unfinished publication never authorize a Base-only fallback. */
export async function readNativePackDefinitions(reads: EquipmentReadSet,
  release: Pick<PackRelease, 'id' | 'content_commitment' | 'semantic_pack_id'>,
  runtimeType: (name: string) => string): Promise<NativePackDefinitions> {
  const value = await loadNativePackDefinitions(reads, release, runtimeType, false)
  check(value, 'Pack definitions missing')
  return value
}
/** Only exact read-set NOT_FOUND is absence; malformed fields never authorize
 * a simple-Pack interpretation. Caller must also recheck the bound Release. */
export function findNativePackDefinitions(reads: EquipmentReadSet,
  release: Pick<PackRelease, 'id' | 'content_commitment' | 'semantic_pack_id'>,
  runtimeType: (name: string) => string) {
  return loadNativePackDefinitions(reads, release, runtimeType, true)
}
async function loadNativePackDefinitions(reads: EquipmentReadSet,
  release: Pick<PackRelease, 'id' | 'content_commitment' | 'semantic_pack_id'>,
  runtimeType: (name: string) => string, optional: boolean): Promise<NativePackDefinitions | null> {
  const keyType = runtimeType('PackDefinitionsKeyV8')
  const valueType = runtimeType('PackDefinitionsV8')
  const key = { dummy_field: false }
  const id = deriveDynamicFieldID(release.id, keyType, NativePackDefinitionsKeyBcs.serialize(key).toBytes())
  const type = `0x2::dynamic_field::Field<${keyType},${valueType}>`
  const bytes = optional ? await reads.optional(id, type, 2, release.id) : await reads.read(id, type, 2, release.id)
  if (optional && bytes === null) return null
  check(bytes instanceof Uint8Array && bytes.length <= 2 * 1024 * 1024, 'Pack definitions BCS missing/oversized')
  const row = decodeNativeBcs(NativePackDefinitionsFieldBcs, bytes)
  const value = row.value
  check(row.id === id && row.name.dummy_field === false, 'Pack definitions field key mismatch')
  check(value.version === '8' && value.release_id === release.id
    && hashEqual(value.release_content_commitment, release.content_commitment)
    && value.rows.semantic_pack_id === release.semantic_pack_id, 'Pack definitions Release binding mismatch')
  check(hashEqual(value.commitment, nativePackDefinitionsCommitment(value)), 'Pack definitions commitment mismatch')
  return value
}

/** PACK_SELF never falls back to a matching Base key. Callers keep Base reads
 * separate and must select this resolver only for an explicit source marker 2. */
type OwnedCategory = 'parts' | 'tracks' | 'colors'
type OwnedRow = ReturnType<typeof EquipmentPartRowBcs.parse>
  | ReturnType<typeof EquipmentTrackRowBcs.parse> | ReturnType<typeof EquipmentColorRowBcs.parse>
export function nativePackOwnedDefinition(definitions: NativePackDefinitions, category: 'parts', key: string): ReturnType<typeof EquipmentPartRowBcs.parse>
export function nativePackOwnedDefinition(definitions: NativePackDefinitions, category: 'tracks', key: string): ReturnType<typeof EquipmentTrackRowBcs.parse>
export function nativePackOwnedDefinition(definitions: NativePackDefinitions, category: 'colors', key: string): ReturnType<typeof EquipmentColorRowBcs.parse>
export function nativePackOwnedDefinition(definitions: NativePackDefinitions, category: OwnedCategory, key: string): OwnedRow
export function nativePackOwnedDefinition(definitions: NativePackDefinitions, category: OwnedCategory, key: string): OwnedRow {
  const matches = definitions.rows[category].filter(row => row.key === key)
  check(matches.length === 1, 'Pack-owned definition missing/ambiguous')
  return matches[0]
}
