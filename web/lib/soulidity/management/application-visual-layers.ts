import { sha256 } from '@noble/hashes/sha2.js'
import { toHex } from '@mysten/sui/utils'
import { ManagementSceneBcs, ManagementRepresentationBcs, ManagementMappingBcs, ManagementColorBcs, ManagementLayoutBcs, ManagementLayerBcs } from './application-bcs'
import { assertManagementVisualColors, evaluateManagementVisualProgram, type ManagementVisualFact } from './application-visual-rules'
type Layer = ReturnType<typeof ManagementLayerBcs.parse>
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_VISUAL_LAYER_${code}`) }
const eq = (a: Uint8Array, b: Uint8Array) => toHex(a) === toHex(b)
/** Exact visual::render_layers value projection, given authenticated validated
 * Scene/Representation/Mapping and original equipped facts. Asset bytes are not
 * fetched or rendered here. Caller must prove publication/mapping eligibility. */
export function renderManagementVisualLayers(input: {
  scene: ReturnType<typeof ManagementSceneBcs.parse>; representation: ReturnType<typeof ManagementRepresentationBcs.parse>
  mapping: ReturnType<typeof ManagementMappingBcs.parse> | null; sourceHash: Uint8Array
  fact: ManagementVisualFact; facts: ManagementVisualFact[]; colors: ReturnType<typeof ManagementColorBcs.parse>[]
  layout: ReturnType<typeof ManagementLayoutBcs.parse>
}): Layer[] {
  const { scene: s, representation: r, mapping: m, sourceHash, fact, facts, colors, layout: user } = structuredClone(input)
  check(sourceHash.length === 32 && r.fragments.length <= 500, 'BOUND')
  assertManagementVisualColors(s, colors)
  check(evaluateManagementVisualProgram(r.visible, facts), 'REPRESENTATION_VISIBLE')
  const sceneHash = sha256(ManagementSceneBcs.serialize(s).toBytes())
  if (m) check(eq(m.representation, sha256(ManagementRepresentationBcs.serialize(r).toBytes())) && eq(m.scene, sceneHash) && m.maps.length === r.fragments.length, 'MAPPING')
  else check(eq(r.scene_hash, sceneHash) && eq(r.renderer, s.renderer), 'NATIVE')
  check(BigInt(user.x) <= 8192000n && BigInt(user.y) <= 8192000n && BigInt(user.scale_ppm) > 0n
    && BigInt(user.scale_ppm) <= 100000000n && BigInt(user.rotation_mdeg) <= 360000n, 'USER_TRANSFORM')
  const transform = { x: { negative: user.x_negative && BigInt(user.x) > 0n, magnitude: user.x }, y: { negative: user.y_negative && BigInt(user.y) > 0n, magnitude: user.y },
    scale_ppm: user.scale_ppm, rotation: { negative: user.rotation_negative && BigInt(user.rotation_mdeg) > 0n, magnitude: user.rotation_mdeg } }
  const layers: Layer[] = []
  r.fragments.forEach((fragment, index) => {
    if (!evaluateManagementVisualProgram(fragment.visible, facts)) return
    const map = m?.maps[index], trackKey = map ? map.track : fragment.track, anchorKey = map ? map.anchor : fragment.anchor
    const channel = map ? map.channel : fragment.channel, fallback = map ? map.swatch : fragment.swatch
    let color: Layer['color'] = null
    if (channel !== null) {
      let chosen = fallback
      for (const value of colors) if (eq(value.channel, channel) && value.swatch !== null) chosen = value.swatch
      check(chosen !== null, 'COLOR')
      const matches = s.channels.flatMap(c => eq(c.key, channel) ? c.swatches.filter(w => eq(w.key, chosen!)) : [])
      check(matches.length === 1, 'COLOR'); color = matches[0]
    }
    const tracks = s.tracks.filter(track => eq(track.key, trackKey))
    const anchors = s.anchors.filter(anchor => eq(anchor.key, anchorKey) && evaluateManagementVisualProgram(anchor.when, facts))
    check(tracks.length === 1 && anchors.length === 1, 'TARGET')
    if (fragment.mask !== null) {
      check(BigInt(fragment.mask) < BigInt(r.fragments.length) && evaluateManagementVisualProgram(r.fragments[Number(fragment.mask)].visible, facts), 'MASK')
    }
    check(!user.color.length || (user.color.length === 4 && channel === null), 'TINT')
    layers.push({ source: sourceHash, part: fact.part, item: fact.item, style: fact.style, index: String(index), track: tracks[0], fragment,
      anchor: anchors[0], adapter: map?.transform ?? null, user: transform, tint: user.color, color })
  })
  return layers
}
export function orderManagementVisualLayers(input: Layer[]): Layer[] {
  const layers = structuredClone(input)
  check(layers.length <= 500, 'LAYER_BOUND')
  check(layers.reduce((n, row) => n + BigInt(row.fragment.image_width) * BigInt(row.fragment.image_height), 0n) <= 134217728n
    && layers.reduce((n, row) => n + BigInt(row.fragment.byte_length), 0n) <= 67108864n, 'RESOURCE_BOUND')
  const number = (a: string, b: string) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0
  const bytes = (a: Uint8Array, b: Uint8Array) => toHex(a) < toHex(b) ? -1 : toHex(a) > toHex(b) ? 1 : 0
  return layers.sort((a, b) => number(a.track.order, b.track.order) || number(a.fragment.display_order, b.fragment.display_order)
    || bytes(a.part, b.part) || bytes(a.item, b.item) || bytes(a.style, b.style) || bytes(a.source, b.source) || number(a.index, b.index))
}
