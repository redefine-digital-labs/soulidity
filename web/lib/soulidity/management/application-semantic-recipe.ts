import { bcs } from '@mysten/sui/bcs'
import { sha256 } from '@noble/hashes/sha2.js'
import { ManagementCompositionBcs, ManagementRootVisualBcs, ManagementProfileSnapshotBcs, ManagementVariantBcs, ManagementPartBcs,
  ManagementSourceBcs, ManagementLayoutBcs, ManagementAdapterBcs, ManagementColorBcs, ManagementScopeBcs, ManagementSceneBcs } from './application-bcs'
import { assertManagementVisualColors } from './application-visual-rules'
const V = bcs.byteVector()
const Selection = bcs.struct('Selection', { source: ManagementSourceBcs, layout: ManagementLayoutBcs, adapter: bcs.option(ManagementAdapterBcs) })
const Slot = bcs.struct('RecipeSlot', { part: ManagementPartBcs, selection: bcs.option(Selection) })
const Recipe = bcs.struct('Recipe', { domain: V, schema: bcs.u16(), scene: V, colors: bcs.vector(ManagementColorBcs),
  profiles: bcs.vector(ManagementProfileSnapshotBcs), slots: bcs.vector(Slot) })
const VariantRecipe = bcs.struct('VariantRecipeCommitment', { domain: V, base: V, variants: bcs.vector(V) })
const text = (s: string) => new TextEncoder().encode(s)
const key = (s: Parameters<typeof ManagementScopeBcs.serialize>[0]) => ManagementScopeBcs.serialize(s).toBase64()
/** Exact Character semantic recipe (active admitted profiles/parts only), with
 * actual full Source values and original stored adapters; no Item ids included.
 * This differs intentionally from Application composition commitment. Caller
 * authenticates all inputs and visual eligibility before accepting the digest. */
export function applicationSemanticRecipeCommitment(input: {
  composition: ReturnType<typeof ManagementCompositionBcs.parse>; rootVisual: ReturnType<typeof ManagementRootVisualBcs.parse>
  profiles: ReturnType<typeof ManagementProfileSnapshotBcs.parse>[]; variants: ReturnType<typeof ManagementVariantBcs.parse>[]
  slots: Array<{ part: ReturnType<typeof ManagementPartBcs.parse>; source: ReturnType<typeof ManagementSourceBcs.parse>; layout: ReturnType<typeof ManagementLayoutBcs.parse>; adapter: ReturnType<typeof ManagementAdapterBcs.parse> | null }>
}) {
  const { composition: c, rootVisual, profiles, variants, slots } = structuredClone(input)
  const check = (v: unknown, code: string) => { if (!v) throw Error(`APPLICATION_SEMANTIC_RECIPE_${code}`) }
  check(c.assembly.parts.length <= 512 && c.assembly.scopes.length <= 64 && variants.length <= 65, 'BOUND')
  check(profiles.length === c.assembly.scopes.length && profiles.every((row, i) => key(row.scope) === key(c.assembly.scopes[i])), 'PROFILES')
  const active = new Set(c.assembly.scopes.filter(scope => slots.some(row => (row.part.scope !== null && key(row.part.scope) === key(scope))
    || (row.source.product === scope.product && row.source.version === scope.version))).map(key))
  const parts = c.assembly.parts.filter(part => part.scope === null || active.has(key(part.scope)))
  const equipped = new Map(slots.map(row => [ManagementPartBcs.serialize(row.part).toBase64(), row]))
  check(equipped.size === slots.length && slots.length === Number(c.slots.size), 'SLOTS')
  const sorted = variants.slice().sort((a, b) => {
    const aa = ManagementScopeBcs.serialize(a.original.scope).toBytes(), bb = ManagementScopeBcs.serialize(b.original.scope).toBytes()
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i]
    return aa.length - bb.length
  })
  check(new Set(sorted.map(row => key(row.original.scope))).size === sorted.length, 'VARIANT_ALIAS')
  const scene = sorted.find(row => key(row.original.scope) === key(c.assembly.root))?.target ?? rootVisual.scene
  assertManagementVisualColors(scene, c.colors)
  const bytes = Recipe.serialize({ domain: text('soulidity-semantic-recipe'), schema: 2, scene: sha256(ManagementSceneBcs.serialize(scene).toBytes()),
    colors: c.colors, profiles: profiles.filter(row => active.has(key(row.scope))), slots: parts.map(part => {
      const selected = equipped.get(ManagementPartBcs.serialize(part).toBase64())
      return { part, selection: selected ? { source: selected.source, layout: selected.layout, adapter: selected.adapter } : null }
    }) }).toBytes()
  const base = sha256(bytes)
  return sorted.length ? sha256(VariantRecipe.serialize({ domain: text('soulidity/variant-recipe/v1'), base, variants: sorted.map(row => row.commitment) }).toBytes()) : base
}
