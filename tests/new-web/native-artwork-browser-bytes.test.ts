import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { deriveDynamicFieldID, fromBase64, toBase64 } from '@mysten/sui/utils'
import { nativeArtworkBlobId, nativeArtworkConcat, nativeArtworkHash, nativeArtworkHex } from '../../web/lib/animacraft/native-artwork-bytes'
import { completeReadHash } from '../../web/lib/animacraft/native-complete-read-bcs'
import { fetchNativeArtwork, NativeArtworkOutputBcs, readNativeArtwork } from '../../web/lib/animacraft/native-artwork'
import { fetchNativeRenderBlob } from '../../web/lib/animacraft/native-render-scene'
import { readNativeCompleteReadTarget } from '../../web/lib/animacraft/native-complete-read'
import { readNativeEquipmentReadTarget } from '../../web/lib/animacraft/native-equipment-read'
import { completeReadAggregatorUrls } from '../../web/lib/animacraft/native-protected-read-authority'
import { CompleteRecipeFieldBcs, CompleteRecipeKeyBcs, readNativeRecipe } from '../../web/lib/animacraft/native-recipe'
import { equipmentCommitment } from '../../web/lib/animacraft/native-equipment'
import { nativeCompleteReadFixture, completeId as id } from './fixtures/native-complete-read'
import { nativeEquipmentReadFixture } from './fixtures/native-equipment-read'
import { nativeRenderSourceFixture } from './fixtures/native-render-source'
import { nativeEquipmentRenderFixture } from './fixtures/native-equipment-render'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
const png = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7WQAAAAASUVORK5CYII=')
const blobId = toBase64(new Uint8Array(32).fill(4)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const proof = () => ({ status: 'PUBLIC' as const, soulId: id(12), bindingId: id(13), outputId: id(15), blobId,
  sha256: createHash('sha256').update(png).digest('hex') })
const withoutBuffer = () => vi.stubGlobal('Buffer', undefined)

it.each(['', 'abc', '漢字 🧬', '\ud800', 'İ'.repeat(50)])('keeps Node UTF8/SHA semantics for %j without Buffer', text => {
  const expected = createHash('sha256').update(text).digest('hex')
  withoutBuffer()
  expect(nativeArtworkHex(nativeArtworkHash(text))).toBe(expected)
  expect(nativeArtworkHex(completeReadHash(new TextEncoder().encode(text)))).toBe(expected)
})
it.each([0, 1, 255])('roundtrips canonical 32-byte Blob ID %i without Buffer', byte => {
  const canonical = Buffer.alloc(32, byte).toString('base64url')
  withoutBuffer(); expect(nativeArtworkBlobId(canonical)).toBe(true)
})
it.each(['', 'A'.repeat(42), 'A'.repeat(44), 'A'.repeat(42) + 'B', 'A'.repeat(42) + '+', 'A'.repeat(43) + '='])
  ('rejects noncanonical Blob ID %j', value => { withoutBuffer(); expect(nativeArtworkBlobId(value)).toBe(false) })
it('concatenates detached exact bytes and rejects inconsistent lengths', () => {
  withoutBuffer(); const chunk = new Uint8Array([1, 2]), joined = nativeArtworkConcat([chunk, new Uint8Array([3])], 3)
  chunk[0] = 9; expect([...joined]).toEqual([1, 2, 3])
  expect(() => nativeArtworkConcat([chunk], 3)).toThrow(); expect(() => nativeArtworkConcat([chunk], 1)).toThrow()
})
it('reads actual protected Complete authority, AAD and hashes without Buffer', async () => {
  const f = nativeCompleteReadFixture(), expected = await f.read(); withoutBuffer()
  expect(await f.read()).toEqual(expected)
  f.set(id(15), NativeArtworkOutputBcs, output => { output.render_sha256[0] ^= 1 })
  await expect(f.read()).rejects.toThrow()
})
it.each(['base', 'owned-base', 'pack'] as const)('reads actual protected %s slot without Buffer', async kind => {
  const f = nativeEquipmentReadFixture(kind), expected = await f.readEquipment(); withoutBuffer()
  expect(await f.readEquipment()).toEqual(expected)
  await expect(f.readEquipment(1)).rejects.toThrow()
})
it('reads actual Base/Pack/External render rows without Buffer', async () => {
  const f = nativeRenderSourceFixture(), rows = [f.baseSelection, { ...f.packSelection, selection_index: '1' },
    { ...f.externalSelection, selection_index: '2' }], expected = await f.readRender(rows)
  withoutBuffer(); expect(await f.readRender(rows)).toEqual(expected)
  await expect(f.readRender([{ ...f.baseSelection, part_key: '界'.repeat(43) }])).rejects.toThrow()
})
it.each(['base', 'pack'] as const)('resolves actual %s equipment manifests without Buffer', async kind => {
  const f = nativeEquipmentRenderFixture(kind)
  // Construct Response before removing Node's Buffer: Undici is not a browser.
  const responses = new Map([...f.manifests].map(([key, value]) => [key, new Response(new Uint8Array(value))]))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => responses.get(url.split('/').at(-1)!)!))
  withoutBuffer()
  const result = await f.readScene()
  expect(result.status).toBe('AVAILABLE'); expect(result.selectionIndexes).toEqual([2])
})
it('reads immutable artwork and completed recipe bytes without Buffer', async () => {
  const f = nativeCompleteReadFixture(), keyType = `${id(3)}::output_v8::CompleteRecipeKeyV8`, snapshotType = `${id(3)}::output_v8::CompleteRecipeSnapshotV8`
  const outputPackage = f.objects.get(f.target.outputCallablePackageId).package
  for (const datatypeName of ['CompleteRecipeKeyV8', 'CompleteRecipeSnapshotV8']) outputPackage.typeOrigins.push({ moduleName: 'output_v8', datatypeName, packageId: id(3) })
  const fieldId = deriveDynamicFieldID(id(15), keyType, CompleteRecipeKeyBcs.serialize({ dummy_field: false }).toBytes())
  const definition_slots = [{ source_definition_id: id(10), part_key: 'body', profile_commitment: Array(32).fill(1), start: '0', capacity: '1' }]
  f.set(id(15), NativeArtworkOutputBcs, output => { output.loadout_commitment = [...Buffer.from(equipmentCommitment({
    version: '8', root_id: output.root_id, root_version: output.maker_version, root_content_commitment: output.root_content_commitment,
    attached_pack_definitions: [], definition_slots, selections: [null],
  }), 'hex')] })
  f.objects.set(fieldId, { objectId: fieldId, version: 2n, digest: f.objects.get(id(15)).digest, owner: { kind: 2, address: id(15) },
    objectType: `0x2::dynamic_field::Field<${keyType},${snapshotType}>`, contents: { value: CompleteRecipeFieldBcs.serialize({
      id: fieldId, name: { dummy_field: false }, value: { version: '8', attached_pack_definitions: [], definition_slots, selections: [null] },
    }).toBytes() } })
  withoutBuffer()
  expect((await readNativeArtwork(f.client, f.target, { soulId: id(12), stateId: id(14) })).status).toBe('PROTECTED')
  expect((await readNativeRecipe(f.client, f.target, { soulId: id(12), stateId: id(14) })).status).toBe('AVAILABLE')
})
it.each(['complete', 'equipment'] as const)('captures explicit %s aggregator map before await without env reads', async kind => {
  const f = kind === 'complete' ? nativeCompleteReadFixture() : nativeEquipmentReadFixture()
  const urls = new Map([[id(270), 'https://keys.example/first']])
  vi.stubEnv('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', 'invalid')
  const pending = kind === 'complete' ? readNativeCompleteReadTarget(f.client, f.target, { soulId: id(12), stateId: id(14) }, undefined, urls)
    : readNativeEquipmentReadTarget(f.client, f.target, { soulId: id(12), stateId: id(14), selectionIndex: 0 }, undefined, urls)
  urls.set(id(270), 'https://keys.example/second')
  expect((await pending).policy.keyServers[0].aggregatorUrl).toBe('https://keys.example/first')
})
it.each(['complete', 'equipment'] as const)('captures default %s aggregator config before await', async kind => {
  const f = kind === 'complete' ? nativeCompleteReadFixture() : nativeEquipmentReadFixture()
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet')
  vi.stubEnv('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', JSON.stringify([{ objectId: id(270), aggregatorUrl: 'https://keys.example/' }]))
  const pending = kind === 'complete' ? readNativeCompleteReadTarget(f.client, f.target, { soulId: id(12), stateId: id(14) })
    : readNativeEquipmentReadTarget(f.client, f.target, { soulId: id(12), stateId: id(14), selectionIndex: 0 })
  vi.stubEnv('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', 'invalid')
  expect((await pending).policy.keyServers[0].aggregatorUrl).toBe('https://keys.example/')
})
it('retains strict typed public service parsing', () => {
  expect(() => completeReadAggregatorUrls({ NEXT_PUBLIC_SUI_NETWORK: 'testnet', NEXT_PUBLIC_SEAL_SERVER_CONFIGS: '[]' })).toThrow()
})
it.each(['artwork', 'manifest'] as const)('downloads %s browser bytes with caller abort and no Buffer', async kind => {
  const p = proof(), response = new Response(png), fetcher = vi.fn(async () => response), signal = new AbortController().signal
  withoutBuffer()
  const result = kind === 'artwork' ? await fetchNativeArtwork(p, fetcher, signal) : await fetchNativeRenderBlob(blobId, 1000, signal, fetcher)
  expect([...result]).toEqual([...png]); expect(fetcher.mock.calls[0]).toHaveLength(2)
})
it.each(['artwork', 'manifest'] as const)('cancels late %s fetch response after caller abort', async kind => {
  const p = proof(), cancel = vi.fn(), response = new Response(new ReadableStream({ cancel })), controller = new AbortController()
  let resolve!: (value: Response) => void
  const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done }))
  const pending = kind === 'artwork' ? fetchNativeArtwork(p, fetcher, controller.signal) : fetchNativeRenderBlob(blobId, 1000, controller.signal, fetcher)
  controller.abort(new Error('session changed')); await expect(pending).rejects.toThrow('session changed')
  resolve(response); await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
})
it.each(['artwork', 'manifest'] as const)('disposes %s response when abort wins the response handoff microtask', async kind => {
  const p = proof(), cancel = vi.fn(), response = new Response(new ReadableStream({ cancel })), controller = new AbortController()
  const fetcher = vi.fn(async () => response), cancelBody = vi.spyOn(response.body!, 'cancel')
  const pending = kind === 'artwork' ? fetchNativeArtwork(p, fetcher, controller.signal)
    : fetchNativeRenderBlob(blobId, 1000, controller.signal, fetcher)
  queueMicrotask(() => controller.abort(new Error('handoff aborted')))
  await expect(pending).rejects.toThrow('handoff aborted')
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  expect(cancelBody).toHaveBeenCalledOnce(); expect(response.body?.locked).toBe(false)
})
it.each(['artwork', 'manifest'] as const)('owns late rejected %s transport without swallowing active failures', async kind => {
  const p = proof(), controller = new AbortController()
  let reject!: (reason: Error) => void
  const fetcher = vi.fn(() => new Promise<Response>((_resolve, fail) => { reject = fail }))
  const pending = kind === 'artwork' ? fetchNativeArtwork(p, fetcher, controller.signal)
    : fetchNativeRenderBlob(blobId, 1000, controller.signal, fetcher)
  controller.abort(new Error('cancel first')); await expect(pending).rejects.toThrow('cancel first')
  reject(new Error('late transport error')); await new Promise(resolve => setTimeout(resolve, 0))
  const failure = vi.fn(async () => { throw new Error('active transport error') })
  await expect(kind === 'artwork' ? fetchNativeArtwork(p, failure)
    : fetchNativeRenderBlob(blobId, 1000, undefined, failure)).rejects.toThrow('active transport error')
})
it.each(['artwork', 'manifest'] as const)('rejects already aborted %s before fetching', async kind => {
  const p = proof(), fetcher = vi.fn(), controller = new AbortController(); controller.abort()
  await expect(kind === 'artwork' ? fetchNativeArtwork(p, fetcher, controller.signal) : fetchNativeRenderBlob(blobId, 1000, controller.signal, fetcher)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
it.each(['artwork', 'manifest'] as const)('disposes rejected %s responses even when cancel never resolves', async kind => {
  const p = proof()
  for (const problem of ['status', 'length']) {
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const response = new Response(new ReadableStream({ cancel }), problem === 'status'
      ? { status: 503 } : { headers: { 'content-length': String(13 * 1024 * 1024) } })
    const fetcher = vi.fn(async () => response)
    await expect(kind === 'artwork' ? fetchNativeArtwork(p, fetcher) : fetchNativeRenderBlob(blobId, 1000, undefined, fetcher)).rejects.toThrow()
    expect(cancel).toHaveBeenCalledOnce()
  }
})
it.each(['artwork', 'manifest'] as const)('cancels an uncooperative active %s body read', async kind => {
  const p = proof(), controller = new AbortController(), cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }))
  const fetcher = vi.fn(async () => response)
  const pending = kind === 'artwork' ? fetchNativeArtwork(p, fetcher, controller.signal) : fetchNativeRenderBlob(blobId, 1000, controller.signal, fetcher)
  await vi.waitFor(() => expect(response.body?.locked).toBe(true))
  controller.abort(new Error('stop stream')); await expect(pending).rejects.toThrow('stop stream')
  expect(cancel).toHaveBeenCalledOnce(); expect(response.body?.locked).toBe(false)
})
it.each(['signature', 'ihdr', 'width', 'height', 'hash', 'short'] as const)('retains PNG %s rejection without Buffer', async problem => {
  const p = proof(), bytes = png.slice()
  if (problem === 'signature') bytes[0] ^= 1
  if (problem === 'ihdr') bytes[12] = 0xc9
  if (problem === 'width') new DataView(bytes.buffer).setUint32(16, 8193)
  if (problem === 'height') new DataView(bytes.buffer).setUint32(20, 0)
  if (problem !== 'hash') p.sha256 = createHash('sha256').update(bytes).digest('hex')
  else p.sha256 = '0'.repeat(64)
  const response = new Response(problem === 'short' ? bytes.slice(0, 24) : bytes)
  withoutBuffer(); await expect(fetchNativeArtwork(p, vi.fn(async () => response))).rejects.toThrow('PNG bytes/hash')
})
