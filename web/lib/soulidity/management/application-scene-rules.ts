import { ManagementCompositionBcs, ManagementRootVisualBcs, ManagementProfileBcs, ManagementVariantBcs, ManagementPartBcs, ManagementSourceBcs, ManagementScopeBcs } from './application-bcs'
import { assertManagementVisualRules, assertManagementVisualColors, assertManagementAdditiveScene, type ManagementVisualFact } from './application-visual-rules'
type Scope = ReturnType<typeof ManagementScopeBcs.parse>
const key = (scope: Scope) => ManagementScopeBcs.serialize(scope).toBase64()
/** Exact assembly root/local/owned Fact selection and scene rule/color/frame
 * prerequisites. Inputs require original provenance. Mapping, fragments/layers,
 * assets and final render hash are deliberately not inferred. */
export function verifyManagementSceneRules(input: {
  composition: ReturnType<typeof ManagementCompositionBcs.parse>; rootVisual: ReturnType<typeof ManagementRootVisualBcs.parse>
  profiles: ReturnType<typeof ManagementProfileBcs.parse>[]; variants: ReturnType<typeof ManagementVariantBcs.parse>[]
  slots: Array<{ part: ReturnType<typeof ManagementPartBcs.parse>; source: ReturnType<typeof ManagementSourceBcs.parse> }>
}) {
  const { composition: c, rootVisual, profiles, variants, slots } = structuredClone(input)
  const check = (v: unknown, code: string) => { if (!v) throw Error(`APPLICATION_SCENE_RULE_${code}`) }
  const map = new Map(profiles.map(profile => [key(profile.scope), profile])), variantMap = new Map(variants.map(variant => [key(variant.original.scope), variant]))
  check(map.size === c.assembly.scopes.length && profiles.length === map.size && c.assembly.scopes.every(scope => map.has(key(scope)))
    && variantMap.size === variants.length && variants.length <= 65, 'PROFILE_COVERAGE')
  const rootProfile = { scope: c.assembly.root, parent: null, scene: rootVisual.scene, parts: c.assembly.base_parts, adapters: rootVisual.adapters }
  for (const variant of variants) {
    const original = key(variant.original.scope) === key(c.assembly.root) ? rootProfile : map.get(key(variant.original.scope))
    check(original && ManagementProfileBcs.serialize(original).toBase64() === ManagementProfileBcs.serialize(variant.original).toBase64(), 'VARIANT_ORIGINAL')
  }
  const fact = (row: typeof slots[number]): ManagementVisualFact => ({ product: row.source.product, version: row.source.version,
    part: row.part.key, item: row.source.definition.item, style: row.source.definition.style })
  const local = (scope: Scope | null) => slots.filter(row => row.part.scope === null || (scope !== null && key(row.part.scope) === key(scope))).map(fact)
  const root = variantMap.get(key(c.assembly.root))?.target ?? rootVisual.scene
  assertManagementVisualColors(root, c.colors); assertManagementVisualRules(root, local(null))
  for (const scope of c.assembly.scopes) {
    const active = slots.some(row => (row.part.scope !== null && key(row.part.scope) === key(scope)) || (row.source.product === scope.product && row.source.version === scope.version))
    if (variants.length && !active) continue
    const scene = variantMap.get(key(scope))?.target ?? map.get(key(scope))!.scene
    if (variants.length) assertManagementAdditiveScene(root, scene)
    const owned = slots.filter(row => (row.part.scope !== null && key(row.part.scope) === key(scope))
      || (row.part.scope === null && row.source.product === scope.product && row.source.version === scope.version)).map(fact)
    assertManagementVisualRules(scene, local(scope), { inheritedRules: root.rules.length, owned })
  }
  return { visualSceneRulesVerified: true as const, rootColorChoicesVerified: true as const, semanticRenderVerified: false as const }
}
