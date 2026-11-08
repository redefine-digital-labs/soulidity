import { bcs } from '@mysten/sui/bcs'

// Current independent Application/Model/Visual/Transport layouts. No legacy
// NativeStateV8, MakerLoadoutV8 or producer-specific generated source is used.
const A = bcs.Address, U = bcs.u64(), V = bcs.byteVector(), B = bcs.bool(), S = bcs.string(), N = bcs.u16()
const T = bcs.struct('TypeName', { name: S }), Table = bcs.struct('Table', { id: A, size: U })
const Signed = bcs.struct('Signed', { negative: B, magnitude: U })
const Transform = bcs.struct('Transform', { x: Signed, y: Signed, scale_ppm: U, rotation: Signed })
const Track = bcs.struct('Track', { key: V, order: U, locked: B })
const Stop = bcs.struct('Stop', { offset_ppm: U, rgba: bcs.u32() })
const Swatch = bcs.struct('Swatch', { key: V, rgba: bcs.u32(), stops: bcs.vector(Stop) })
const Channel = bcs.struct('Channel', { key: V, default: V, editable: B, swatches: bcs.vector(Swatch) })
const Selector = bcs.struct('Selector', { product: bcs.option(A), version: bcs.option(U), part: V, item: bcs.option(V), style: bcs.option(V) })
const Token = bcs.struct('Token', { opcode: bcs.u8(), selector: bcs.option(Selector), arity: N })
const Rule = bcs.struct('Rule', { key: V, kind: bcs.u8(), trigger: Selector, any: B, targets: bcs.vector(Selector) })
const Anchor = bcs.struct('Anchor', { key: V, when: bcs.vector(Token), x: Signed, y: Signed })
export const ManagementSceneBcs = bcs.struct('Scene', { domain: V, schema: N, width: U, height: U, origin_x: Signed, origin_y: Signed,
  axes: bcs.u8(), sampling: bcs.u8(), clip_viewport: B, color_space: bcs.u8(), premultiplied: B, renderer: V, body: V, pose: V,
  parts: bcs.vector(V), tracks: bcs.vector(Track), channels: bcs.vector(Channel), anchors: bcs.vector(Anchor), rules: bcs.vector(Rule) })
const Fragment = bcs.struct('Fragment', { key: V, asset: V, media: V, byte_length: U, image_width: U, image_height: U,
  crop_x: U, crop_y: U, crop_width: U, crop_height: U, local_x: U, local_y: U, track: V, display_order: U, anchor: V,
  transform: Transform, opacity_ppm: U, blend: bcs.u8(), channel: bcs.option(V), swatch: bcs.option(V), mask: bcs.option(U), visible: bcs.vector(Token) })
const Representation = bcs.struct('Representation', { domain: V, schema: N, scene_hash: V, renderer: V,
  canvas_width: U, canvas_height: U, fragments: bcs.vector(Fragment), visible: bcs.vector(Token) })
const FragmentMap = bcs.struct('FragmentMap', { index: U, track: V, anchor: V, transform: Transform, channel: bcs.option(V), swatch: bcs.option(V) })
const Mapping = bcs.struct('Mapping', { representation: V, scene: V, maps: bcs.vector(FragmentMap) })
export const ManagementLayoutBcs = bcs.struct('Layout', { x_negative: B, x: U, y_negative: B, y: U, scale_ppm: U,
  rotation_mdeg: U, rotation_negative: B, color: V })
const Bounds = bcs.struct('Bounds', { max_x: U, max_y: U, min_scale: U, max_scale: U, max_rotation: U, colors: bcs.vector(V) })
export const ManagementDefinitionBcs = bcs.struct('Definition', { part: V, item: V, style: V, rights: bcs.u8(), content_hash: V, license_hash: V,
  representation: Representation, supply: U, default_layout: ManagementLayoutBcs, bounds: Bounds,
  required_styles: bcs.vector(V), forbidden_styles: bcs.vector(V), transferable_use: B })
const MarketPolicy = bcs.struct('MarketPolicy', { schema: N, config: A, snapshot_revision: U, platform: A,
  control_fee_bps: N, equipment_fee_bps: N, control_royalty_bps: N, creator: A })
const PrimaryPolicy = bcs.struct('PrimaryPolicy', { schema: N, config: A, snapshot_revision: U, platform: A, bps: N, complete_fee: U })
export const ManagementSourceBcs = bcs.struct('Source', { product: A, source_type: T, maker: A, maker_version: U, version: U,
  protocol: A, royalty_bps: N, beneficiary: A, market: MarketPolicy, primary: PrimaryPolicy, definition_hash: V, definition: ManagementDefinitionBcs })
const Adapter = bcs.struct('Adapter', { source_hash: V, target_part: V, mapping: Mapping, bounds: Bounds })
export const ManagementScopeBcs = bcs.struct('Scope', { protocol: A, product: A, source_type: T, version: U, policy: V })
export const ManagementPartBcs = bcs.struct('PartKey', { scope: bcs.option(ManagementScopeBcs), key: V })
export const ManagementSelectionBcs = bcs.enum('Selection', { Empty: null,
  Reference: bcs.struct('Reference', { index: U, layout: ManagementLayoutBcs }),
  Bound: bcs.struct('Bound', { index: U, layout: ManagementLayoutBcs }),
  Free: bcs.struct('Free', { id: A, layout: ManagementLayoutBcs }) })
export const ManagementDesiredSlotBcs = bcs.struct('DesiredSlot', { part: ManagementPartBcs, selection: ManagementSelectionBcs })
const Assembly = bcs.struct('State', { root: ManagementScopeBcs, base_parts: bcs.vector(V), scopes: bcs.vector(ManagementScopeBcs),
  parts: bcs.vector(ManagementPartBcs), profiles: Table, palettes: Table })
const Color = bcs.struct('ColorChoice', { channel: V, swatch: bcs.option(V) })
const Location = bcs.struct('Location', { page: U, index: U })
export const ManagementPagedSourcesBcs = bcs.struct('Store', { pages: Table, locations: bcs.vector(Location), page_count: U, last_bytes: U })
export const ManagementApplicationBcs = bcs.struct('ApplicationState', { id: A, root: A, revision: U, recipe_hash: V, operator: T })
export const ManagementCompositionBcs = bcs.struct('Composition', { id: A, revision: U, assembly: Assembly, required: bcs.vector(V),
  slots: Table, references: ManagementPagedSourcesBcs, colors: bcs.vector(Color), enhancements: Table })
export const ManagementStoredBindingBcs = bcs.struct('StoredBinding', { reference: bcs.option(U), layout: ManagementLayoutBcs,
  item: bcs.option(A), bound: bcs.option(U), adapter: bcs.option(Adapter) })
export const ManagementBindingBcs = bcs.struct('Binding', { source: ManagementSourceBcs, layout: ManagementLayoutBcs,
  item: bcs.option(A), bound: bcs.option(U), adapter: bcs.option(Adapter) })
export const ManagementBoundPartsBcs = bcs.struct('BoundParts', { id: A, records: ManagementPagedSourcesBcs })
export const ManagementItemBcs = bcs.struct('Item', { id: A, source: ManagementSourceBcs })
export const ManagementLoadoutLibraryBcs = bcs.struct('Library', { id: A,
  controller: bcs.struct('Controller', { operator: T, parent: A, root: A }), root: A, version: N, count: U, heads: Table, receipts: Table })
export { Adapter as ManagementAdapterBcs, Color as ManagementColorBcs, Representation as ManagementRepresentationBcs }
export const ManagementProfileBcs = bcs.struct('Profile', { scope: ManagementScopeBcs, parent: bcs.option(ManagementScopeBcs),
  scene: ManagementSceneBcs, parts: bcs.vector(V), adapters: bcs.vector(Adapter) })
export const ManagementProfileSnapshotBcs = bcs.struct('ProfileSnapshot', { scope: ManagementScopeBcs, parent: bcs.option(ManagementScopeBcs),
  scene: V, parts: bcs.vector(V), colors: bcs.vector(Color), adapters: bcs.vector(V) })
export const ManagementVariantBcs = bcs.struct('Variant', { domain: V, schema: N, original: ManagementProfileBcs,
  target: ManagementSceneBcs, adapters: bcs.vector(Adapter), target_hash: V, commitment: V })
export const ManagementRootVisualBcs = bcs.struct('RootVisual', { id: A, scene: ManagementSceneBcs, adapters: bcs.vector(Adapter) })
export const ManagementActiveVariantsBcs = bcs.struct('ActiveVariants', { id: A, scopes: bcs.vector(ManagementScopeBcs), values: Table })

export { Mapping as ManagementMappingBcs, Transform as ManagementTransformBcs }
export const ManagementLayerBcs = bcs.struct('Layer', { source: V, part: V, item: V, style: V, index: U,
  track: Track, fragment: Fragment, anchor: Anchor, adapter: bcs.option(Transform), user: Transform, tint: V, color: bcs.option(Swatch) })
