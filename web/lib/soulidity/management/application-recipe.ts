import { bcs } from '@mysten/sui/bcs'
import { sha256 } from '@noble/hashes/sha2.js'
import { fromBase64, toHex } from '@mysten/sui/utils'
import { ManagementAdapterBcs, ManagementColorBcs, ManagementCompositionBcs, ManagementLayoutBcs, ManagementPartBcs,
  ManagementProfileBcs, ManagementProfileSnapshotBcs, ManagementRepresentationBcs, ManagementSceneBcs, ManagementScopeBcs,
  ManagementSourceBcs, ManagementStoredBindingBcs, ManagementVariantBcs } from './application-bcs'

const V = bcs.byteVector(), U = bcs.u64(), A = bcs.Address
const SourceSnapshot = bcs.struct('SourceSnapshot', { source_hash: V, product: A, maker: A, maker_version: U, version: U, definition: V, representation: V, rights: bcs.u8() })
const BindingSnapshot = bcs.struct('BindingSnapshot', { source: SourceSnapshot, layout: ManagementLayoutBcs, item: bcs.option(A), bound: bcs.option(U), adapter: bcs.option(V) })
const SlotSnapshot = bcs.struct('SlotSnapshot', { part: ManagementPartBcs, binding: bcs.option(BindingSnapshot) })
export { SlotSnapshot as ManagementSlotSnapshotBcs }
const CompositionCommitment = bcs.struct('CompositionCommitment', { domain: V, schema: bcs.u16(), scene: V,
  colors: bcs.vector(ManagementColorBcs), profiles: bcs.vector(ManagementProfileSnapshotBcs), slots: bcs.vector(SlotSnapshot) })
const VariantCommitment = bcs.struct('VariantCommitment', { domain: V, schema: bcs.u16(), original: ManagementProfileBcs,
  target: ManagementSceneBcs, adapters: bcs.vector(ManagementAdapterBcs) })
const VariantRecipe = bcs.struct('VariantRecipeCommitment', { domain: V, base: V, variants: bcs.vector(V) })
const enc = (s: string) => new TextEncoder().encode(s)
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`APPLICATION_RECIPE_${code}`) }
type Scope = ReturnType<typeof ManagementScopeBcs.parse>
type Profile = ReturnType<typeof ManagementProfileBcs.parse>
type Variant = ReturnType<typeof ManagementVariantBcs.parse>
export interface CompleteApplicationRecipe {
  composition: ReturnType<typeof ManagementCompositionBcs.parse>
  rootVisual: { scene: ReturnType<typeof ManagementSceneBcs.parse>; adapters: ReturnType<typeof ManagementAdapterBcs.parse>[] }
  profiles: Array<{ profile: Profile; colors: ReturnType<typeof ManagementColorBcs.parse>[] }>
  variants: Variant[]
  slots: Array<{ partBcs: string; source: ReturnType<typeof ManagementSourceBcs.parse>; binding: ReturnType<typeof ManagementStoredBindingBcs.parse> }>
}
const scopeKey = (s: Scope) => ManagementScopeBcs.serialize(s).toBase64()
function lessScope(a: Scope, b: Scope) {
  const aa = ManagementScopeBcs.serialize(a).toBytes(), bb = ManagementScopeBcs.serialize(b).toBytes()
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i]
  return aa.length - bb.length
}

/** Exact current Character composition/variant commitment, not a renderer or
 * authority proof. Complete root and admitted profile palettes, variants and
 * every empty/selected typed part are required; no defaulting away missing data.
 * Compare the result to the actual Application recipe_hash before capture. */
export function applicationRecipeCommitment(input: CompleteApplicationRecipe) {
  const value = structuredClone(input), c = value.composition
  check(c.assembly.parts.length <= 512 && c.assembly.scopes.length <= 64 && value.variants.length <= 65, 'BOUNDS')
  const profileMap = new Map(value.profiles.map(p => [scopeKey(p.profile.scope), p]))
  check(profileMap.size === value.profiles.length && profileMap.size === c.assembly.scopes.length
    && new Set(c.assembly.scopes.map(scopeKey)).size === c.assembly.scopes.length, 'PROFILES_INCOMPLETE')
  const rootProfile: Profile = { scope: c.assembly.root, parent: null, scene: value.rootVisual.scene,
    parts: c.assembly.base_parts, adapters: value.rootVisual.adapters }
  const profiles = c.assembly.scopes.map(scope => {
    const row = profileMap.get(scopeKey(scope)); check(row && row.profile.parent && scopeKey(row.profile.parent) === scopeKey(c.assembly.root), 'PROFILE_BINDING')
    return { scope, parent: row.profile.parent, scene: sha256(ManagementSceneBcs.serialize(row.profile.scene).toBytes()),
      parts: row.profile.parts, colors: row.colors, adapters: row.profile.adapters.map(adapter => sha256(ManagementAdapterBcs.serialize(adapter).toBytes())) }
  })
  const variants = [...value.variants].sort((a, b) => lessScope(a.original.scope, b.original.scope)), variantKeys = new Set<string>()
  for (const variant of variants) {
    const key = scopeKey(variant.original.scope), actual = key === scopeKey(c.assembly.root) ? rootProfile : profileMap.get(key)?.profile
    check(actual && !variantKeys.has(key) && ManagementProfileBcs.serialize(actual).toBase64() === ManagementProfileBcs.serialize(variant.original).toBase64(), 'VARIANT_ORIGINAL')
    variantKeys.add(key)
    check(toHex(variant.domain) === toHex(enc('soulidity/visual-variant/v1')) && variant.schema === 1
      && toHex(variant.target_hash) === toHex(sha256(ManagementSceneBcs.serialize(variant.target).toBytes()))
      && toHex(variant.commitment) === toHex(sha256(VariantCommitment.serialize(variant).toBytes())), 'VARIANT_COMMITMENT')
  }
  const slotMap = new Map(value.slots.map(slot => [slot.partBcs, slot]))
  check(slotMap.size === value.slots.length && BigInt(slotMap.size) === BigInt(c.slots.size), 'SLOTS_INCOMPLETE')
  const partKeys = new Set(c.assembly.parts.map(part => ManagementPartBcs.serialize(part).toBase64()))
  check(partKeys.size === c.assembly.parts.length && [...slotMap.keys()].every(key => partKeys.has(key)), 'PARTS')
  const slots = c.assembly.parts.map(part => {
    const selected = slotMap.get(ManagementPartBcs.serialize(part).toBase64())
    if (!selected) return { part, binding: null }
    // Canonical typed bytes must describe the same exact part, not a label.
    check(ManagementPartBcs.serialize(ManagementPartBcs.parse(fromBase64(selected.partBcs))).toBase64() === selected.partBcs, 'PART_BCS')
    const s = selected.source, b = selected.binding
    return { part, binding: { source: { source_hash: sha256(ManagementSourceBcs.serialize(s).toBytes()), product: s.product, maker: s.maker,
      maker_version: s.maker_version, version: s.version, definition: s.definition_hash,
      representation: sha256(ManagementRepresentationBcs.serialize(s.definition.representation).toBytes()), rights: s.definition.rights },
    layout: b.layout, item: b.item, bound: b.bound, adapter: b.adapter === null ? null : sha256(ManagementAdapterBcs.serialize(b.adapter).toBytes()) } }
  })
  const effective = variants.find(v => scopeKey(v.original.scope) === scopeKey(c.assembly.root))?.target ?? value.rootVisual.scene
  const base = sha256(CompositionCommitment.serialize({ domain: enc('soulidity/composition/v1'), schema: 2,
    scene: sha256(ManagementSceneBcs.serialize(effective).toBytes()), colors: c.colors, profiles, slots }).toBytes())
  return variants.length ? sha256(VariantRecipe.serialize({ domain: enc('soulidity/variant-recipe/v1'), base, variants: variants.map(v => v.commitment) }).toBytes()) : base
}

/** Reconstruct the Character composition commitment from fully verified Forms
 * capture fields. Caller must authenticate Snapshot contents and original App.
 * This binds captured values to App.recipe_hash, not semantic recipe/render. */
export function applicationCapturedCompositionCommitment(input: {
  scene: Uint8Array; colors: ReturnType<typeof ManagementColorBcs.parse>[]
  profiles: ReturnType<typeof ManagementProfileSnapshotBcs.parse>[]
  sources: ReturnType<typeof SlotSnapshot.parse>[]; variants: Variant[]
}) {
  const v = structuredClone(input)
  check(v.scene.length === 32 && v.sources.length <= 512 && v.profiles.length <= 64 && v.variants.length <= 65, 'CAPTURE_BOUNDS')
  const variants = v.variants.sort((a, b) => lessScope(a.original.scope, b.original.scope))
  check(new Set(variants.map(row => scopeKey(row.original.scope))).size === variants.length, 'CAPTURE_VARIANT_ALIAS')
  const base = sha256(CompositionCommitment.serialize({ domain: enc('soulidity/composition/v1'), schema: 2,
    scene: v.scene, colors: v.colors, profiles: v.profiles, slots: v.sources }).toBytes())
  return variants.length ? sha256(VariantRecipe.serialize({ domain: enc('soulidity/variant-recipe/v1'), base,
    variants: variants.map(row => row.commitment) }).toBytes()) : base
}
