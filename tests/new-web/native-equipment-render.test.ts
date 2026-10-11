import { afterEach, expect, it, vi } from 'vitest'
import { NativeSoulStateBcs } from '../../web/lib/animacraft/native-receive'
import { EquipmentMakerBcs } from '../../web/lib/animacraft/native-equipment-source-bcs'
import { EquipmentPackReleaseBcs } from '../../web/lib/animacraft/native-equipment-pack'
import { readNativeEquipmentRenderTarget } from '../../web/lib/animacraft/native-equipment-render'
import { nativeEquipmentRenderFixture, renderId as id } from './fixtures/native-equipment-render'

afterEach(() => vi.unstubAllGlobals())
function transport(f: ReturnType<typeof nativeEquipmentRenderFixture>, afterRead?: (url: string) => void) {
  const fetcher = vi.fn(async (url: string) => {
    const bytes = f.manifests.get(url.split('/').at(-1)!)
    if (!bytes) throw new Error('Unexpected non-manifest download')
    afterRead?.(url)
    return new Response(new Uint8Array(bytes))
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

it.each(['base','pack'] as const)('resolves actual sparse current %s selection without original Output/recipe', async kind => {
  const f = nativeEquipmentRenderFixture(kind), fetcher = transport(f)
  f.objects.delete(id(15)); f.objects.delete(id(16))
  const dto = await f.readScene()
  expect(dto).toMatchObject({ schema: 'native-equipment-render-v1', scope: 'CURRENT_EQUIPMENT_ONLY', status: 'AVAILABLE',
    soulId: id(12), stateId: id(14), owner: id(11), ownershipEpoch: '0', rootId: id(10),
    snapshot: { loadoutId: id(80), loadoutRevision: '1' }, selectionIndexes: [2],
    scene: { document: { canvas: { width: 512, height: 512, pixelMode: 'pixelated' } },
      layers: [{ selectionIndex: 2, selection: { source: kind === 'base' ? 'BASE' : 'PACK' }, asset: { blobId: f.mediaBlobId } }] } })
  expect(dto.snapshot?.loadoutCommitment).toMatch(/^[0-9a-f]{64}$/)
  expect(fetcher).toHaveBeenCalledTimes(kind === 'base' ? 1 : 2)
  expect(JSON.parse(JSON.stringify(dto))).toEqual(dto)
})
it.each(['base','pack'] as const)('returns protected %s metadata, without fetching ciphertext or granting keys', async kind => {
  const f = nativeEquipmentRenderFixture(kind, true), fetcher = transport(f)
  const dto = await f.readScene()
  expect(dto.status === 'AVAILABLE' && dto.scene.layers[0]).toMatchObject({ protected: true,
    asset: { mediaType: 'application/vnd.animacraft.seal-ciphertext' } })
  expect(fetcher.mock.calls.every(([url]) => !url.endsWith(f.mediaBlobId))).toBe(true)
  expect(dto).not.toHaveProperty('policy'); expect(dto).not.toHaveProperty('entitlement')
})
it('distinguishes absent equipment from an empty existing loadout, without source dependencies', async () => {
  const missing = nativeEquipmentRenderFixture(); missing.objects.delete(missing.pointerId); missing.objects.delete(id(10))
  const fetcher = transport(missing)
  expect(await missing.readScene()).toMatchObject({ status: 'NOT_CREATED', snapshot: null, selectionIndexes: [], scene: null })
  const empty = nativeEquipmentRenderFixture()
  empty.editLoadout(row => { row.selections = [null,null,null]; row.selection_count = '0' })
  empty.objects.delete(id(10))
  expect(await empty.readScene()).toMatchObject({ status: 'EMPTY', snapshot: { loadoutId: id(80) }, selectionIndexes: [], scene: null })
  expect(fetcher).not.toHaveBeenCalled()
})
it('does not translate DF10 transport failure into missing or empty', async () => {
  const f = nativeEquipmentRenderFixture(), original = f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).batchGetObjects = async (request: any) => request.requests.some((r: any) => r.objectId === f.pointerId)
    ? { response: { objects: [{ result: { oneofKind: 'error', error: { code: 14 } } }] } } : original(request)
  await expect(f.readScene()).rejects.toMatchObject({ status: 503 })
})
it('does not add access/lifecycle/write/listing predicates to public content rendering', async () => {
  const f = nativeEquipmentRenderFixture('pack'); transport(f)
  f.target.equipmentWritesEnabled = false
  f.set(id(14), NativeSoulStateBcs, row => { row.is_listed = true })
  f.set(id(10), EquipmentMakerBcs, row => { row.lifecycle = 2 })
  f.set(f.releaseId, EquipmentPackReleaseBcs, row => { row.lifecycle = 3 })
  for (const objectId of [id(83), f.passId, f.admissionId, f.semanticId]) f.objects.delete(objectId)
  expect((await f.readScene()).status).toBe('AVAILABLE')
})
it.each(['owner','epoch','pointer','loadout','source-root','source-part','source-item','source-style','source-asset','source-color'])('rejects %s drift while awaiting manifests', async changed => {
  const f = nativeEquipmentRenderFixture()
  const objectId = ({ owner: id(14), epoch: id(14), pointer: f.pointerId, loadout: id(80),
    'source-root': id(10), 'source-part': f.partId, 'source-item': f.itemRowId,
    'source-style': f.styleId, 'source-asset': f.assetId, 'source-color': f.baseColorId })[changed]!
  transport(f, () => { f.objects.get(objectId).digest = 'changed-after-source-verification' })
  await expect(f.readScene()).rejects.toMatchObject({ status: 409 })
})
it('all-hidden protected equipment is AVAILABLE with complete sparse identity and the original loadout commitment', async () => {
  const f = nativeEquipmentRenderFixture('base', true), fetcher = transport(f)
  const before = await f.readScene()
  f.setVisibility('STYLE', [{ opcode: 0, arity: 0, selector: { source: 1, source_key: null,
    part_key: 'body', item_key: 'hat', style_key: 'red' } }, { opcode: 1, arity: 1, selector: null }])
  const result = await f.readScene()
  expect(result).toMatchObject({ status: 'AVAILABLE', snapshot: before.snapshot, selectionIndexes: [2],
    scene: { layers: [], selectionIndexes: [2], visibility: { valid: false, violations: [{ selectionIndex: 2, levels: ['STYLE'] }] } } })
  if (before.status !== 'AVAILABLE' || result.status !== 'AVAILABLE') throw Error('Expected available selection')
  expect(result.scene.selections).toEqual(before.scene.selections)
  expect(fetcher.mock.calls.every(([url]) => url.endsWith(f.makerBlobId))).toBe(true)
})
it('rejects Pack release changes after its manifest was downloaded', async () => {
  const f = nativeEquipmentRenderFixture('pack')
  transport(f, url => { if (url.endsWith(f.packBlobId)) f.objects.get(f.releaseId).digest = 'changed' })
  await expect(f.readScene()).rejects.toMatchObject({ status: 409 })
})
it.each(['root','style','manifest','sha'])('propagates %s failure without original-scene fallback', async problem => {
  const f = nativeEquipmentRenderFixture(); const fetcher = transport(f)
  if (problem === 'root') f.objects.delete(id(10))
  if (problem === 'style') f.objects.delete(f.styleId)
  if (problem === 'manifest') f.manifests.clear()
  if (problem === 'sha') f.manifests.set(f.makerBlobId, new TextEncoder().encode('{}'))
  await expect(f.readScene()).rejects.toThrow()
  expect(fetcher.mock.calls.every(([url]) => url.endsWith(f.makerBlobId))).toBe(true)
})
it('snapshots caller identity before await', async () => {
  const f = nativeEquipmentRenderFixture(); transport(f)
  const input = { soulId: id(12), stateId: id(14) }
  const result = readNativeEquipmentRenderTarget(f.client, f.target, input)
  input.soulId = id(999); input.stateId = id(998)
  expect(await result).toMatchObject({ soulId: id(12), stateId: id(14) })
})
it.each(['before','manifest'] as const)('aborts %s and never returns a scene', async phase => {
  const f = nativeEquipmentRenderFixture(), controller = new AbortController()
  const fetcher = transport(f, () => { if (phase === 'manifest') controller.abort() })
  if (phase === 'before') controller.abort()
  await expect(f.readScene(controller.signal)).rejects.toThrow()
  if (phase === 'before') expect(fetcher).not.toHaveBeenCalled()
})
