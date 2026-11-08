import { sha256 } from '@noble/hashes/sha2.js'
import { toHex } from '@mysten/sui/utils'
import { ManagementCompositionBcs, ManagementRootVisualBcs, ManagementProfileBcs, ManagementVariantBcs, ManagementPartBcs, ManagementSourceBcs, ManagementLayoutBcs, ManagementAdapterBcs, ManagementColorBcs, ManagementScopeBcs, ManagementSceneBcs } from './application-bcs'
import { verifyManagementSceneRules } from './application-scene-rules'
import { verifyFormsSourcePolicy, assertManagementSourceLayout } from './application-forms-source-policy'
import { renderManagementVisualLayers, orderManagementVisualLayers } from './application-visual-layers'
type Scope = ReturnType<typeof ManagementScopeBcs.parse>
const key = (scope: Scope) => ManagementScopeBcs.serialize(scope).toBase64()
const eq = (a: Uint8Array, b: Uint8Array) => toHex(a) === toHex(b)
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_ASSEMBLY_RENDER_${code}`) }
export function renderManagementAssembly(input: {
  composition: ReturnType<typeof ManagementCompositionBcs.parse>; rootVisual: ReturnType<typeof ManagementRootVisualBcs.parse>
  profiles: Array<{ profile: ReturnType<typeof ManagementProfileBcs.parse>; colors: ReturnType<typeof ManagementColorBcs.parse>[] }>
  variants: ReturnType<typeof ManagementVariantBcs.parse>[]
  slots: Array<{ part: ReturnType<typeof ManagementPartBcs.parse>; source: ReturnType<typeof ManagementSourceBcs.parse>; layout: ReturnType<typeof ManagementLayoutBcs.parse>; adapter: ReturnType<typeof ManagementAdapterBcs.parse> | null }>
}) {
  const { composition: c, rootVisual, profiles, variants, slots } = structuredClone(input)
  verifyFormsSourcePolicy({ required: c.required, slots })
  verifyManagementSceneRules({ composition: c, rootVisual, profiles: profiles.map(row => row.profile), variants, slots })
  const profileMap = new Map(profiles.map(row => [key(row.profile.scope), row])), variantMap = new Map(variants.map(row => [key(row.original.scope), row]))
  const baseHash = sha256(ManagementSceneBcs.serialize(rootVisual.scene).toBytes())
  const rootTarget = variantMap.get(key(c.assembly.root))?.target ?? rootVisual.scene
  const fact = (row: typeof slots[number]) => ({ product: row.source.product, version: row.source.version, part: row.part.key, item: row.source.definition.item, style: row.source.definition.style })
  const local = (scope: Scope | null) => slots.filter(row => row.part.scope === null || (scope !== null && key(row.part.scope) === key(scope))).map(fact)
  const isNative = (row: typeof slots[number]) => {
    const s = row.source, part = row.part, root = c.assembly.root
    if (s.source_type.name !== root.source_type.name || s.protocol !== root.protocol || s.maker !== root.product || s.maker_version !== root.version || !eq(s.definition.part, part.key)) return false
    const representation = s.definition.representation
    if (eq(representation.scene_hash, baseHash)) return part.scope === null && c.assembly.base_parts.some(value => eq(value, part.key))
    return c.assembly.scopes.some(scope => {
      const p = profileMap.get(key(scope))!.profile
      return scope.product === s.product && scope.version === s.version && eq(representation.scene_hash, sha256(ManagementSceneBcs.serialize(p.scene).toBytes()))
        && p.parts.some(value => eq(value, part.key)) && (c.assembly.base_parts.some(value => eq(value, part.key)) ? part.scope === null : part.scope !== null && key(part.scope) === key(scope))
    })
  }
  const layers = slots.flatMap(row => {
    check(isNative(row) || row.adapter !== null, 'SOURCE_TARGET')
    let scope: Scope | null
    if (row.adapter !== null) scope = row.part.scope
    else if (eq(row.source.definition.representation.scene_hash, baseHash)) scope = null
    else {
      const scopes = c.assembly.scopes.filter(scope => scope.product === row.source.product && scope.version === row.source.version)
      check(scopes.length === 1, 'SOURCE_SCOPE'); scope = scopes[0]
    }
    const v = variantMap.get(key(scope ?? c.assembly.root)), profile = scope ? profileMap.get(key(scope)) : null
    check(scope === null || profile, 'PROFILE')
    const scene = v?.target ?? profile?.profile.scene ?? rootVisual.scene, sourceHash = sha256(ManagementSourceBcs.serialize(row.source).toBytes())
    const overrides = v?.adapters.filter(adapter => eq(adapter.source_hash, sourceHash) && eq(adapter.target_part, row.part.key)) ?? []
    check(overrides.length <= 1, 'VARIANT_ADAPTER_ALIAS')
    const adapter = overrides[0] ?? row.adapter
    if (adapter) { check(eq(adapter.source_hash, sourceHash) && eq(adapter.target_part, row.part.key), 'ADAPTER_SOURCE'); assertManagementSourceLayout(adapter.bounds, row.layout) }
    const colors = profile ? structuredClone(profile.colors).map(color => c.colors.find(root => eq(root.channel, color.channel)) ?? color) : c.colors
    if (scope === null) check(eq(sha256(ManagementSceneBcs.serialize(scene).toBytes()), sha256(ManagementSceneBcs.serialize(rootTarget).toBytes())), 'ROOT_TARGET')
    return renderManagementVisualLayers({ scene, representation: row.source.definition.representation, mapping: adapter?.mapping ?? null,
      sourceHash, fact: fact(row), facts: local(scope), colors, layout: row.layout })
  })
  return orderManagementVisualLayers(layers)
}
