import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { SoulContentPublicBcs, SoulContentKeyPublicBcs, SoulContentSlotPublicBcs,
  SoulStatePointerFieldV1Bcs, SoulStatePointerKeyV1Bcs, buildSoulPublicPreviewStateConfig } from '@soulidity/sdk'
import { NativeSoulBindingBcs, NativeSoulBcs, NativeSoulStateBcs } from '../../../web/lib/animacraft/native-receive'
import { NativeArtworkOutputBcs } from '../../../web/lib/animacraft/native-artwork'
import { nativeReceiveFixture } from './native-receive'
import { nativeCompleteReadFixture } from './native-complete-read'
import { nativeEquipmentReadFixture } from './native-equipment-read'
import { nativeEquipmentRenderFixture } from './native-equipment-render'

export const artId = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const id = artId, h = (n = 1) => Array(32).fill(n)
export const artworkPng = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7WQAAAAASUVORK5CYII=')

/** Real raw fixtures and real SDK service surfaces; no injected proof readers. */
export function artworkWire<F extends ReturnType<typeof nativeReceiveFixture>>(base: F) {
  const { objects } = base, digest = toBase58(new Uint8Array(32).fill(3))
  const normalize = () => {
    for (const row of objects.values()) {
      if (!row.package) row.digest = digest
      if (row.objectType) row.objectType = normalizeStructTag(row.objectType)
      if (row.owner.kind === 3) row.owner.version ??= 1n
    }
  }
  normalize()
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' })
  const get = vi.spyOn(client.ledgerService, 'getObject').mockImplementation((async (request: any) => ({ response: {
    object: structuredClone(objects.get(request.objectId)),
  } })) as any)
  const batch = vi.spyOn(client.ledgerService, 'batchGetObjects').mockImplementation((async (request: any) => ({ response: {
    objects: request.requests.map((request: any) => ({ result: objects.has(request.objectId)
      ? { oneofKind: 'object', object: structuredClone(objects.get(request.objectId)) } : { oneofKind: 'error', error: { code: 5 } } })),
  } })) as any)
  const chain = vi.spyOn(client.core, 'getChainIdentifier').mockImplementation(base.client.core.getChainIdentifier.bind(base.client.core))
  const field = vi.spyOn(client.core, 'getDynamicField').mockImplementation(base.client.core.getDynamicField.bind(base.client.core))
  const execute = vi.spyOn(client.core, 'executeTransaction').mockImplementation(async () => { throw new Error('Artwork reader must not execute') })
  const factory = vi.fn((_signal: AbortSignal) => client)
  const edit = (objectId: string, codec: any, change: (value: any) => void) => {
    const row = objects.get(objectId), value = codec.parse(row.contents.value)
    change(value); row.contents.value = codec.serialize(value).toBytes()
  }
  return { ...base, client, factory, get, batch, chain, field, execute, edit, normalize,
    config: { target: structuredClone(base.target) }, params: { soulId: id(12), stateId: id(14) } }
}

function addPublicOutput(base: ReturnType<typeof nativeReceiveFixture>, protectedOutput = false) {
  const bindingRow = base.objects.get(id(13)), binding = NativeSoulBindingBcs.parse(bindingRow.contents.value)
  for (const key of ['root_content_commitment', 'output_policy_commitment', 'recipe_commitment', 'render_commitment', 'output_commitment'] as const) binding[key] = h()
  const output = { id: id(15), version: '8', root_id: id(10), maker_version: '1', root_content_commitment: h(),
    output_registry_id: id(30), output_key: 'main', original_holder: id(11), holder: id(11), loadout_id: id(31), loadout_revision: '1',
    loadout_commitment: h(), output_policy_commitment: h(), renderer_schema_commitment: h(), recipe_commitment: h(), render_commitment: h(),
    render_blob_id: toBase64(new Uint8Array(32).fill(4)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), render_sha256: [...sha256(artworkPng)],
    render_blob_commitment: h(), output_commitment: h(), protected: protectedOutput, scope_key: protectedOutput ? 'complete' : '',
    asset_key: protectedOutput ? 'image' : '', seal_id: protectedOutput ? h(4) : null, protection_binding_commitment: h() }
  bindingRow.contents.value = NativeSoulBindingBcs.serialize(binding).toBytes()
  const soul = NativeSoulBcs.parse(base.objects.get(id(12)).contents.value); soul.image_url = `walrus://${output.render_blob_id}`
  base.objects.get(id(12)).contents.value = NativeSoulBcs.serialize(soul).toBytes()
  base.objects.set(id(15), { objectId: id(15), version: 2n, owner: { kind: 4 },
    objectType: `${id(3)}::output_v8::CompleteOutputV8`, contents: { value: NativeArtworkOutputBcs.serialize(output).toBytes() } })
  return output
}

export function browserArtworkFixture(protectedOutput = false) {
  const base = nativeReceiveFixture(), output = addPublicOutput(base, protectedOutput), A = bcs.Address, S = bcs.string()
  const put = (objectId: string, type: string, bytes: Uint8Array, kind: number, parent?: string) => base.objects.set(objectId,
    { objectId, version: 2n, owner: { kind, ...(parent ? { address: parent } : {}) }, objectType: type, contents: { value: bytes } })
  const field = (parent: string, keyType: string, keyCodec: any, name: any, valueType: string, codec: any, value: any) => {
    const fieldId = deriveDynamicFieldID(parent, keyType, keyCodec.serialize(name).toBytes())
    put(fieldId, `0x2::dynamic_field::Field<${keyType},${valueType}>`, bcs.struct('Field', { id: A, name: keyCodec, value: codec })
      .serialize({ id: fieldId, name, value }).toBytes(), 2, parent)
    return fieldId
  }
  const state = NativeSoulStateBcs.parse(base.objects.get(id(14)).contents.value)
  state.active_grants = { id: id(301), size: '0' }; state.active_grant_ids = { id: id(302), size: '0' }
  state.config_ext = { id: id(303), size: '1' }
  base.objects.get(id(14)).contents.value = NativeSoulStateBcs.serialize(state).toBytes()
  const pointerKey = `${id(6)}::soul::SoulStatePointerKeyV1`
  const pointerId = deriveDynamicFieldID(id(12), pointerKey, SoulStatePointerKeyV1Bcs.serialize({ version: 1 }).toBytes())
  put(pointerId, `0x2::dynamic_field::Field<${pointerKey},0x2::object::ID>`, SoulStatePointerFieldV1Bcs.serialize({
    id: pointerId, name: { version: 1 }, value: id(14) }).toBytes(), 2, id(12))
  const preview = buildSoulPublicPreviewStateConfig({ tags: [], previewImages: [] })
  field(state.config_ext.id, '0x1::string::String', S, preview.key, 'vector<u8>', bcs.vector(bcs.u8()), [...new TextEncoder().encode(preview.valueUtf8)])
  const content = { id: id(17), version: '1', soul_id: id(12), items: { id: id(304), size: '2' }, count_by_kind: { id: id(305), size: '2' }, active: { id: id(306), size: '0' } }
  put(id(17), `${id(6)}::content::SoulContent`, SoulContentPublicBcs.serialize(content).toBytes(), 3)
  field(content.items.id, `${id(6)}::content::ContentKey`, SoulContentKeyPublicBcs, { kind: 0, name: 'soul' },
    `vector<${id(6)}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs), [{ version: '1', kind: 0,
      blob_object_id: id(307), is_public: false, deleted: false, purged: false, download_policy: 0, grant_scope_mask: '0',
      read_mode_mask: '3', op_mask: '0', seal_encrypted: true, created_at_ms: '1' }])
  for (const datatypeName of ['CompleteRecipeKeyV8', 'CompleteRecipeSnapshotV8']) base.objects.get(id(4)).package.typeOrigins.push({
    moduleName: 'output_v8', datatypeName, packageId: id(3) })
  return { ...artworkWire(base), output, pointerId }
}

export function browserEquipmentSceneFixture() {
  const base = nativeEquipmentRenderFixture()
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const bytes = base.manifests.get(String(url).split('/').at(-1)!)
    if (!bytes) throw new Error('Unexpected non-manifest fetch')
    return new Response(new Uint8Array(bytes))
  })
  return { ...artworkWire(base), fetcher }
}
export function browserCompleteFixture() {
  const f = artworkWire(nativeCompleteReadFixture())
  return { ...f, config: { ...f.config, aggregators: [[f.policy.key_servers[0].key_server_id, 'https://seal.example.com/']] as [string, string][] } }
}
export function browserEquipmentReadFixture() {
  const f = artworkWire(nativeEquipmentReadFixture())
  return { ...f, config: { ...f.config, aggregators: [[f.policy.key_servers[0].key_server_id, 'https://seal.example.com/']] as [string, string][] } }
}
