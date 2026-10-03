import { afterEach, expect, it, vi } from 'vitest'
import { UnaryCall, type RpcTransport } from '@protobuf-ts/runtime-rpc'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { sha256 } from '@noble/hashes/sha2.js'
import { getBrowserNativeArtworkConfig, getBrowserNativeProtectedArtworkConfig, readBrowserNativeArtwork,
  createBrowserNativeReadSession, readBrowserNativeCompleteReadTarget, readBrowserNativeEquipmentReadTarget,
  readBrowserNativeEquipmentRenderTarget } from '../../web/lib/animacraft/browser-native-artwork'
import { NativeSoulBcs, NativeSoulBindingBcs, NativeSoulStateBcs } from '../../web/lib/animacraft/native-receive'
import { NativeArtworkOutputBcs } from '../../web/lib/animacraft/native-artwork'
import { browserArtworkFixture, browserEquipmentSceneFixture, browserCompleteFixture, browserEquipmentReadFixture,
  artworkWire, artworkPng, artId as id } from './fixtures/browser-native-artwork'
import { nativeEquipmentRenderFixture } from './fixtures/native-equipment-render'
import { EquipmentMakerBcs } from '../../web/lib/animacraft/native-equipment-source-bcs'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })
function publicEnv(target: ReturnType<typeof browserArtworkFixture>['target']) {
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet')
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', target.soulidityCallablePackageId)
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID', target.soulidityOriginalPackageId)
  vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON', JSON.stringify(target))
}
it('keeps public configuration independent of missing or invalid Seal configuration', () => {
  const f = browserArtworkFixture(); publicEnv(f.target)
  vi.stubEnv('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', 'secret-invalid-json')
  expect(getBrowserNativeArtworkConfig()).toEqual(f.config)
  expect(Object.isFrozen(getBrowserNativeArtworkConfig().target)).toBe(true)
  expect(() => getBrowserNativeProtectedArtworkConfig()).toThrow()
})
it('captures a JSON-serializable public-only protected config', () => {
  const f = browserCompleteFixture(); publicEnv(f.target)
  vi.stubEnv('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', JSON.stringify([{ objectId: id(98), weight: 2, aggregatorUrl: 'https://seal.example.com' }]))
  const config = getBrowserNativeProtectedArtworkConfig()
  expect(config.aggregators).toEqual([[id(98), 'https://seal.example.com/']])
  expect(JSON.parse(JSON.stringify(config))).toEqual(config); expect(Object.isFrozen(config.aggregators[0])).toBe(true)
})
it.each(['network', 'missing', 'private-fallback'] as const)('rejects invalid public release %s', problem => {
  const f = browserArtworkFixture(); publicEnv(f.target)
  if (problem === 'network') vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'testnet')
  else vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON', '')
  if (problem === 'private-fallback') vi.stubEnv('ANIMACRAFT_V8_RECEIVE_TARGET_JSON', JSON.stringify(f.target))
  expect(() => getBrowserNativeArtworkConfig()).toThrow()
})
it('resolves the Soul pointer and native Output before fetching a hashed public PNG', async () => {
  const f = browserArtworkFixture(), fetcher = vi.fn(async () => new Response(new Uint8Array(artworkPng)))
  vi.stubGlobal('fetch', fetcher)
  const result = await readBrowserNativeArtwork({ soulId: id(12), config: f.config }, { client: f.factory })
  expect(result.status).toBe('PUBLIC')
  if (result.status !== 'PUBLIC') throw new Error('Expected public artwork')
  expect(result.blob.type).toBe('image/png'); expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(artworkPng)
  expect(f.get.mock.calls[0][0].objectId).toBe(f.pointerId)
  expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(f.output.render_blob_id),
    expect.objectContaining({ credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) }))
  expect(f.execute).not.toHaveBeenCalled()
})
it('returns protected status without downloading ciphertext or any wallet action', async () => {
  const f = browserArtworkFixture(true), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  expect(await readBrowserNativeArtwork({ soulId: id(12), config: f.config }, { client: f.factory })).toEqual({ status: 'PROTECTED' })
  expect(fetcher).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it.each(['pointer', 'state', 'binding', 'image', 'digest', 'bytes'] as const)('rejects public artwork %s substitution', async problem => {
  const f = browserArtworkFixture(), fetcher = vi.fn(async () => new Response(new Uint8Array(artworkPng))); vi.stubGlobal('fetch', fetcher)
  if (problem === 'pointer') f.objects.delete(f.pointerId)
  if (problem === 'state') f.edit(id(14), NativeSoulStateBcs, state => { state.soul_id = id(99) })
  if (problem === 'binding') f.edit(id(13), NativeSoulBindingBcs, binding => { binding.output_id = id(99) })
  if (problem === 'image') f.edit(id(12), NativeSoulBcs, soul => { soul.image_url = 'https://unsafe.example.com/image.png' })
  if (problem === 'digest') f.objects.get(id(15)).digest = 'invalid'
  if (problem === 'bytes') f.edit(id(15), NativeArtworkOutputBcs, output => { output.render_sha256 = Array(32).fill(7) })
  await expect(readBrowserNativeArtwork({ soulId: id(12), config: f.config }, { client: f.factory })).rejects.toThrow()
  if (problem !== 'bytes') expect(fetcher).not.toHaveBeenCalled()
})
it('rejects same-reference immutable Output drift after PNG download', async () => {
  const f = browserArtworkFixture()
  vi.stubGlobal('fetch', vi.fn(async () => {
    f.edit(id(15), NativeArtworkOutputBcs, output => { output.render_sha256 = Array(32).fill(7) })
    return new Response(new Uint8Array(artworkPng))
  }))
  await expect(readBrowserNativeArtwork({ soulId: id(12), config: f.config }, { client: f.factory })).rejects.toThrow('evidence changed')
})
// Same deterministic RGBA vectors as Animacraft's selected completion test;
// prove its actual export sizes survive the raw Output -> fetched PNG boundary.
it.each([[576, 1024, 0], [576, 1024, 255], [1080, 1920, 0], [1080, 1920, 255]])(
  'preserves completed PNG %sx%s alpha %s without recipe or equipment reads', async (width, height, alpha) => {
  const f = browserArtworkFixture()
  const chunk = (name: string, bytes: Buffer) => {
    const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4)
    length.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([type, bytes])))
    return Buffer.concat([length, type, bytes, checksum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  const scanlines = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) scanlines.set([23, 45, 67, alpha], y * (1 + width * 4) + 1 + x * 4)
  const pixels = deflateSync(scanlines)
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))])
  f.edit(id(15), NativeArtworkOutputBcs, output => { output.render_sha256 = [...sha256(png)] })
  const fetcher = vi.fn(async () => new Response(new Uint8Array(png))); vi.stubGlobal('fetch', fetcher)
  const result = await readBrowserNativeArtwork({ soulId: id(12), config: f.config }, { client: f.factory })
  expect(result.status).toBe('PUBLIC'); if (result.status !== 'PUBLIC') throw new Error('Expected public PNG')
  const received = Buffer.from(await result.blob.arrayBuffer())
  expect(received.equals(png)).toBe(true); expect(received.readUInt32BE(16)).toBe(width); expect(received.readUInt32BE(20)).toBe(height)
  // Exact byte comparison, without enumerating millions of Buffer properties.
  expect(inflateSync(received.subarray(41, 41 + pixels.length)).equals(scanlines)).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(f.get.mock.calls.some(([request]) => request.objectId === id(10) || request.objectId === id(80))).toBe(false)
})
it('uses captured public Seal transport with the actual protected Complete proof', async () => {
  const f = browserCompleteFixture()
  vi.stubEnv('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', 'invalid-current-env')
  const target = await readBrowserNativeCompleteReadTarget({ ...f.params, config: f.config }, { client: f.factory })
  expect(target).toMatchObject({ schema: 'native-complete-read-v1', soulId: id(12), stateId: id(14), outputId: id(15),
    policy: { keyServers: [expect.objectContaining({ aggregatorUrl: 'https://seal.example.com/' }), expect.anything()] } })
  expect(f.execute).not.toHaveBeenCalled()
})
it('reads the exact current protected equipment slot with original Complete independent', async () => {
  const f = browserEquipmentReadFixture(); f.objects.delete(id(15)); f.objects.delete(id(16))
  const target = await readBrowserNativeEquipmentReadTarget({ ...f.params, selectionIndex: 0, config: f.config }, { client: f.factory })
  expect(target).toMatchObject({ schema: 'native-equipment-read-v1', soulId: id(12), stateId: id(14),
    policy: { keyServers: [expect.objectContaining({ aggregatorUrl: 'https://seal.example.com/' }), expect.anything()] } })
  expect(f.execute).not.toHaveBeenCalled()
})
it.each(['base', 'pack'] as const)('renders actual current %s equipment metadata without Complete', async kind => {
  const base = nativeEquipmentRenderFixture(kind), f = artworkWire(base)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(new Uint8Array(base.manifests.get(url.split('/').at(-1)!)!))))
  f.objects.delete(id(15)); f.objects.delete(id(16))
  const target = await readBrowserNativeEquipmentRenderTarget({ ...f.params, config: f.config }, { client: f.factory })
  expect(target).toMatchObject({ status: 'AVAILABLE', scope: 'CURRENT_EQUIPMENT_ONLY', selectionIndexes: [2] })
})
it.each(['http://seal.example.com', 'https://user:pass@seal.example.com', 'https://seal.example.com/?secret=a',
  'https://localhost', 'https://127.0.0.1', 'https://seal.example.com/#secret'])('rejects supplied protected transport %s before RPC', async url => {
  const f = browserCompleteFixture(); f.config.aggregators[0][1] = url
  await expect(readBrowserNativeCompleteReadTarget({ ...f.params, config: f.config }, { client: f.factory })).rejects.toThrow()
  expect(f.factory).not.toHaveBeenCalled()
})
it.each(['duplicate', 'invalid-id', 'extra-field', 'missing-list'] as const)('rejects malformed captured services %s', async problem => {
  const f = browserCompleteFixture()
  if (problem === 'duplicate') f.config.aggregators.push(f.config.aggregators[0])
  if (problem === 'invalid-id') f.config.aggregators[0][0] = 'bad-id'
  if (problem === 'extra-field') (f.config.aggregators[0] as unknown[]).push('secret')
  if (problem === 'missing-list') delete (f.config as any).aggregators
  await expect(readBrowserNativeCompleteReadTarget({ ...f.params, config: f.config }, { client: f.factory })).rejects.toThrow()
  expect(f.factory).not.toHaveBeenCalled()
})
it.each([-1, 500, 1.5, NaN])('rejects invalid equipment selection %s before network', async selectionIndex => {
  const f = browserEquipmentReadFixture()
  await expect(readBrowserNativeEquipmentReadTarget({ ...f.params, selectionIndex, config: f.config }, { client: f.factory })).rejects.toThrow()
  expect(f.factory).not.toHaveBeenCalled()
})
it('rejects a valid but wrong current equipment slot', async () => {
  const f = browserEquipmentReadFixture()
  await expect(readBrowserNativeEquipmentReadTarget({ ...f.params, selectionIndex: 2, config: f.config }, { client: f.factory })).rejects.toThrow()
})
it('captures protected configuration before any await', async () => {
  const f = browserCompleteFixture(), pending = readBrowserNativeCompleteReadTarget({ ...f.params, config: f.config }, { client: f.factory })
  f.config.target.protocolConfigId = id(99); f.config.aggregators[0][1] = 'https://changed.example.com/'
  expect((await pending).policy.keyServers[0].aggregatorUrl).toBe('https://seal.example.com/')
})
it('cancels even an uncooperative raw transport and never returns stale metadata', async () => {
  const f = browserArtworkFixture(), controller = new AbortController()
  f.get.mockImplementation((() => new Promise(() => {})) as any)
  const pending = readBrowserNativeArtwork({ ...f.params, config: f.config, signal: controller.signal }, { client: f.factory })
  controller.abort(); await expect(pending).rejects.toThrow()
  expect(f.execute).not.toHaveBeenCalled()
})
it('cancels public PNG streaming after the chain proof', async () => {
  const f = browserArtworkFixture(), controller = new AbortController()
  vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); return new Response(new Uint8Array(artworkPng)) }))
  await expect(readBrowserNativeArtwork({ soulId: id(12), config: f.config, signal: controller.signal }, { client: f.factory })).rejects.toThrow()
})
it('rechecks immutable equipment source after manifest awaits', async () => {
  const f = browserEquipmentSceneFixture()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const result = await f.fetcher(url)
    f.edit(id(10), EquipmentMakerBcs, root => { root.lifecycle = 2 })
    return result
  }))
  await expect(readBrowserNativeEquipmentRenderTarget({ ...f.params, config: f.config }, { client: f.factory })).rejects.toThrow('evidence changed')
})
it.each(['complete', 'equipment-read', 'equipment-render'] as const)('rejects wrong State for %s', async kind => {
  const f = kind === 'complete' ? browserCompleteFixture() : kind === 'equipment-read' ? browserEquipmentReadFixture() : browserEquipmentSceneFixture()
  const params = { ...f.params, stateId: id(99), config: { ...f.config, aggregators: [] as [string, string][] } }, deps = { client: f.factory }
  const pending = kind === 'complete' ? readBrowserNativeCompleteReadTarget(params, deps)
    : kind === 'equipment-read' ? readBrowserNativeEquipmentReadTarget({ ...params, selectionIndex: 0 }, deps) : readBrowserNativeEquipmentRenderTarget(params, deps)
  await expect(pending).rejects.toThrow(); expect(f.execute).not.toHaveBeenCalled()
})
it.each(['cover', 'complete', 'equipment-read', 'equipment-render'] as const)('runs %s with no global Buffer', async kind => {
  const f = kind === 'complete' ? browserCompleteFixture() : kind === 'equipment-read' ? browserEquipmentReadFixture()
    : kind === 'equipment-render' ? browserEquipmentSceneFixture() : browserArtworkFixture()
  const responses = new Map<string, Response>()
  if ('manifests' in f && f.manifests instanceof Map) for (const [key, bytes] of f.manifests) responses.set(key, new Response(new Uint8Array(bytes)))
  const image = new Response(new Uint8Array(artworkPng))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => responses.get(url.split('/').at(-1)!) ?? image))
  vi.stubGlobal('Buffer', undefined)
  const params = { ...f.params, config: { ...f.config, aggregators: [] as [string, string][] } }, deps = { client: f.factory }
  const result = kind === 'cover' ? await readBrowserNativeArtwork(params, deps)
    : kind === 'complete' ? await readBrowserNativeCompleteReadTarget(params, deps)
      : kind === 'equipment-read' ? await readBrowserNativeEquipmentReadTarget({ ...params, selectionIndex: 0 }, deps)
        : await readBrowserNativeEquipmentRenderTarget(params, deps)
  expect(result).toBeTruthy(); expect(f.execute).not.toHaveBeenCalled()
})
it('rejects oversized raw BCS before decoding or downloading', async () => {
  const f = browserArtworkFixture(), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  f.objects.get(id(15)).contents.value = new Uint8Array(256 * 1024 + 1)
  await expect(readBrowserNativeArtwork({ ...f.params, config: f.config }, { client: f.factory })).rejects.toThrow('byte budget')
  expect(fetcher).not.toHaveBeenCalled()
})
it('bounds an uncooperative transport with one browser deadline', async () => {
  vi.useFakeTimers()
  const f = browserArtworkFixture(), deadline = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { setTimeout(() => deadline.abort(new Error('artwork deadline')), 25000); return deadline.signal })
  f.get.mockImplementation((() => new Promise(() => {})) as any)
  const result = expect(readBrowserNativeArtwork({ ...f.params, config: f.config }, { client: f.factory })).rejects.toThrow('artwork deadline')
  await vi.advanceTimersByTimeAsync(25001); await result
})
it('preserves gRPC service this and propagates abort to every raw request', async () => {
  const f = browserArtworkFixture(true), implementation = f.get.getMockImplementation()!
  f.get.mockImplementation((function(this: unknown, request: any, options: any) {
    expect(this).toBe(f.client.ledgerService); expect(options.abort).toBeInstanceOf(AbortSignal)
    return implementation(request, options)
  }) as any)
  expect(await readBrowserNativeArtwork({ soulId: id(12), config: f.config }, { client: f.factory })).toEqual({ status: 'PROTECTED' })
})
it.each([7, 13, 14])('never treats public snapshot RPC status %s as absent data', async code => {
  const f = browserArtworkFixture(true), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  f.batch.mockImplementation((async () => ({ response: { objects: [{ result: { oneofKind: 'error', error: { code } } }] } })) as any)
  await expect(readBrowserNativeArtwork({ ...f.params, config: f.config }, { client: f.factory })).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
it('preserves actual UnaryCall reflection and metadata while cloning only its response', async () => {
  const f = browserArtworkFixture(true), calls: Array<{ call: UnaryCall<any, any>; response: any; options: any }> = []
  const headers = { 'fixture-header': 'yes' }, trailers = { 'fixture-trailer': 'yes' }, status = { code: 'OK', detail: '' }
  const transport: RpcTransport = {
    mergeOptions(options) { return { ...options } },
    unary(method, request, options) {
      expect(this).toBe(transport)
      expect(options.abort).toBeInstanceOf(AbortSignal)
      const input = request as { objectId: string; requests: Array<{ objectId: string }> }
      if (!['getObject', 'batchGetObjects'].includes(method.localName)) throw new Error(`Unexpected method ${method.localName}`)
      const response = method.localName === 'getObject'
        ? { object: structuredClone(f.objects.get(input.objectId)) } as any
        : { objects: input.requests.map(({ objectId }) => ({ result: {
          oneofKind: 'object', object: structuredClone(f.objects.get(objectId)),
        } })) }
      const call = new UnaryCall(method, options.meta ?? {}, request, Promise.resolve(headers), Promise.resolve(response),
        Promise.resolve(status), Promise.resolve(trailers))
      calls.push({ call, response, options }); return call
    },
    serverStreaming() { throw new Error('No streaming') }, clientStreaming() { throw new Error('No client streaming') }, duplex() { throw new Error('No duplex') },
  }
  const client = new SuiGrpcClient({ network: 'mainnet', transport })
  vi.spyOn(client.core, 'getChainIdentifier').mockImplementation(f.client.core.getChainIdentifier.bind(f.client.core))
  vi.spyOn(client.core, 'getDynamicField').mockImplementation(f.client.core.getDynamicField.bind(f.client.core))
  const signal = new AbortController().signal
  const session = createBrowserNativeReadSession(client, signal), wrapped = session.client
  const call = wrapped.ledgerService.getObject({ objectId: id(12) }, { meta: { 'fixture-request': 'yes' } })
  const raw = calls.at(-1)!
  expect(call).toBeInstanceOf(UnaryCall)
  expect(call.method).toBe(raw.call.method); expect(typeof call.method.I.create).toBe('function')
  expect(call.request).toBe(raw.call.request); expect(call.request.readMask?.paths).toContain('contents')
  expect(call.requestHeaders).toBe(raw.call.requestHeaders); expect(call.requestHeaders).toEqual({ 'fixture-request': 'yes' })
  expect(call.headers).toBe(raw.call.headers); expect(call.status).toBe(raw.call.status); expect(call.trailers).toBe(raw.call.trailers)
  const finished = await call, response = await call.response
  expect(finished.method).toBe(raw.call.method); expect(finished.request).toBe(raw.call.request)
  expect(finished.headers).toBe(headers); expect(finished.status).toBe(status); expect(finished.trailers).toBe(trailers)
  expect(response).toBe(finished.response); expect(response).not.toBe(raw.response)
  expect(response.object?.contents?.value).not.toBe(raw.response.object.contents.value)
  const originalByte = response.object!.contents!.value![0]
  raw.response.object.contents.value[0] ^= 1
  expect((await call.response).object!.contents!.value![0]).toBe(originalByte)
  expect(raw.options.abort).toBe(signal)
  await session.finish(undefined)
  expect(calls.some(({ call }) => call.method.localName === 'batchGetObjects')).toBe(true)
})
it('rejects same-reference package bytes changed after public image fetch', async () => {
  const f = browserArtworkFixture()
  vi.stubGlobal('fetch', vi.fn(async () => {
    f.objects.get(id(4)).package.modules[0].contents[0] ^= 1
    return new Response(new Uint8Array(artworkPng))
  }))
  await expect(readBrowserNativeArtwork({ soulId: id(12), config: f.config }, { client: f.factory })).rejects.toThrow('evidence changed')
})
it('rejects optional evidence that appears during the final absence recheck', async () => {
  const f = browserArtworkFixture(), session = createBrowserNativeReadSession(f.client, new AbortController().signal)
  await session.client.ledgerService.batchGetObjects({ requests: [{ objectId: id(999) }] })
  const row = structuredClone(f.objects.get(id(15))); row.objectId = id(999); f.objects.set(id(999), row)
  await expect(session.finish(undefined)).rejects.toThrow('optional evidence changed')
})
