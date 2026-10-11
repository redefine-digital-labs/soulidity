import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { NativeSoulBindingBcs, NativeSoulBcs, NativeSoulStateBcs } from '../../web/lib/animacraft/native-receive'
import { readNativeArtwork, fetchNativeArtwork, NativeArtworkOutputBcs } from '../../web/lib/animacraft/native-artwork'
import { soulArtworkUrl } from '../../web/lib/animacraft/artwork-url'
import { nativeReceiveFixture } from './fixtures/native-receive'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7WQAAAAASUVORK5CYII=', 'base64')
function fixture() {
  const f = nativeReceiveFixture()
  const bindingObject = f.objects.get(id(13))
  const binding = NativeSoulBindingBcs.parse(bindingObject.contents.value)
  for (const key of ['root_content_commitment', 'output_policy_commitment', 'recipe_commitment', 'render_commitment', 'output_commitment'] as const) binding[key] = Array(32).fill(1)
  const output = { id: id(15), version: '8', root_id: id(10), maker_version: '1', root_content_commitment: binding.root_content_commitment,
    output_registry_id: id(30), output_key: 'main', original_holder: id(11), holder: id(11), loadout_id: id(31), loadout_revision: '1',
    loadout_commitment: Array(32).fill(1), output_policy_commitment: binding.output_policy_commitment, renderer_schema_commitment: Array(32).fill(1),
    recipe_commitment: binding.recipe_commitment, render_commitment: binding.render_commitment,
    render_blob_id: Buffer.alloc(32, 4).toString('base64url'), render_sha256: [...createHash('sha256').update(png).digest()],
    render_blob_commitment: Array(32).fill(1), output_commitment: binding.output_commitment,
    protected: false, scope_key: '', asset_key: '', seal_id: null as number[] | null, protection_binding_commitment: Array(32).fill(1) }
  const soul = NativeSoulBcs.parse(f.objects.get(id(12)).contents.value)
  soul.image_url = `walrus://${output.render_blob_id}`; soul.provenance_kind = 3
  const save = () => {
    bindingObject.contents.value = NativeSoulBindingBcs.serialize(binding).toBytes()
    f.objects.get(id(12)).contents.value = NativeSoulBcs.serialize(soul).toBytes()
    f.objects.set(id(15), { objectId: id(15), version: 2n, digest: f.target.outputCallableDigest, owner: { kind: 4 }, objectType: `${id(3)}::output_v8::CompleteOutputV8`,
      contents: { value: NativeArtworkOutputBcs.serialize(output).toBytes() } })
  }
  save()
  return { ...f, binding, output, soul, save, read: () => readNativeArtwork(f.client, f.target, { soulId: id(12), stateId: id(14) }) }
}

describe('native Soul artwork graph and bytes', () => {
  it('verifies actual package/protocol, State DF9, binding and immutable output before fetching PNG', async () => {
    const f = fixture(); const proof = await f.read()
    expect(proof).toMatchObject({ status: 'PUBLIC', soulId: id(12), outputId: id(15) })
    const fetcher = vi.fn().mockResolvedValue(new Response(png))
    expect(Buffer.from(await fetchNativeArtwork(proof, fetcher))).toEqual(png)
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`/v1/blobs/${f.output.render_blob_id}`), expect.objectContaining({ redirect: 'error', credentials: 'omit' }))
    expect(soulArtworkUrl(f.soul.image_url, id(12))).toBe(`soulidity-artwork:${id(12)}`)
    expect(soulArtworkUrl('https://artist.example/art.png', id(12))).toBe('https://artist.example/art.png')
  })
  it('never fetches protected ciphertext or labels it as a public image', async () => {
    const f = fixture(); Object.assign(f.output, { protected: true, scope_key: 'scope', asset_key: 'asset', seal_id: [1] }); f.save()
    const proof = await f.read(); expect(proof.status).toBe('PROTECTED')
    const fetcher = vi.fn(); await expect(fetchNativeArtwork(proof, fetcher)).rejects.toMatchObject({ status: 403 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['soul', 'provenance', 'df', 'binding', 'outputOwner', 'outputHash', 'root', 'blob', 'publicSeal', 'protectedEmpty', 'state', 'trailing'])(
    'rejects %s substitution', async mode => {
      const f = fixture()
      if (mode === 'soul') f.soul.id = id(99)
      if (mode === 'provenance') f.soul.provenance_kind = 1
      if (mode === 'binding') f.binding.soul_id = id(99)
      if (mode === 'outputHash') f.output.output_commitment = Array(32).fill(2)
      if (mode === 'root') f.output.root_id = id(99)
      if (mode === 'blob') f.soul.image_url = 'https://attacker.example/image.png'
      if (mode === 'publicSeal') f.output.seal_id = [1]
      if (mode === 'protectedEmpty') f.output.protected = true
      f.save()
      if (mode === 'outputOwner') f.objects.get(id(15)).owner.kind = 3
      if (mode === 'df') f.objects.get(f.dfId).owner.address = id(99)
      if (mode === 'state') {
        const state = NativeSoulStateBcs.parse(f.objects.get(id(14)).contents.value); state.soul_id = id(99)
        f.objects.get(id(14)).contents.value = NativeSoulStateBcs.serialize(state).toBytes()
      }
      if (mode === 'trailing') f.objects.get(id(15)).contents.value = new Uint8Array([...f.objects.get(id(15)).contents.value, 0])
      await expect(f.read()).rejects.toThrow()
    })
  it.each(['hash', 'html', 'length', 'stream'])('rejects unsafe %s bytes', async mode => {
    const proof = await fixture().read()
    if (mode === 'hash') proof.sha256 = '0'.repeat(64)
    let response = new Response(mode === 'html' ? '<script>bad</script>' : png)
    if (mode === 'length') response = new Response(png, { headers: { 'content-length': String(13 * 1024 * 1024) } })
    if (mode === 'stream') response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(13 * 1024 * 1024)); controller.close() } }))
    await expect(fetchNativeArtwork(proof, vi.fn().mockResolvedValue(response))).rejects.toThrow()
  })
})
