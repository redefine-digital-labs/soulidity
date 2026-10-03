import { expect, it, vi } from 'vitest'
import { buildCollectionAuthoringInput, type CollectionAuthoringInput } from '../../web/lib/soulidity/collection-authoring-input'
import { soulAuthoringRequestFixture, soulAuthoringManifestFixture } from './fixtures/soul-authoring'
import { prepareSoulAuthoring } from '../../web/lib/soulidity/soul-authoring-preparation'
import type { SoulAuthoringPreparation, SoulAuthoringStore } from '../../web/lib/soulidity/soul-authoring-store'
const author = '0x' + '11'.repeat(32), target = soulAuthoringRequestFixture(author).target
function draft(): CollectionAuthoringInput {
  return { name: 'Original Collection', description: 'Original description', coverImageFile: new File(['cover'], 'cover.png'),
    extraRoyaltyBps: 500, tradeable: true, maxSupply: 100, floorPriceAtomic: '12345678901234567890',
    collectionRightListing: { priceAtomic: '9007199254740993' },
    souls: [{ name: 'A', description: 'First', tags: [' One '], creatorRoyaltyBps: 300 },
      { name: 'B', description: 'Second', tags: ['Two'], creatorRoyaltyBps: 400 }],
    soulFolders: new Map([[1, { characterFile: new File(['original soul'], 'soul.md'), memoryFile: new File(['original memory'], 'memory.md'),
      imageFile: new File(['own cover'], 'image.png') }]]) }
}
const build = (d: CollectionAuthoringInput) => buildCollectionAuthoringInput(d, target, author, new AbortController().signal)
it.each([0, 2])('composes %s original Soul rows into durable real encrypted preparation and reuses exact identity on resume', async count => {
  const f = await soulAuthoringManifestFixture(), d = draft()
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  d.coverImageFile = new File([png], 'cover.png')
  d.soulFolders!.get(1)!.imageFile = new File([png], 'own.png')
  for (const index of [1, 2]) {
    const folder = d.soulFolders!.get(index)
    d.soulFolders!.set(index, { ...folder, characterFile: new File(['Original character content. '.repeat(4)], 'soul.md'),
      memoryFile: new File(['Original memory content. '.repeat(4)], 'memory.md') })
  }
  d.souls = d.souls!.slice(0, count); if (!count) d.soulFolders = new Map()
  const input = await buildCollectionAuthoringInput(d, target, f.request.author, f.controller.signal)
  let saved: SoulAuthoringPreparation | null = null
  const store: SoulAuthoringStore = { exclusive: async (_key, work) => work(), read: async () => structuredClone(saved),
    create: vi.fn(async (_key, value) => { if (saved) throw Error('Existing'); saved = structuredClone(value) }) }
  const params = { ...input, client: f.walrus as any, wallet: f.params.wallet, sealConfig: f.params.sealConfig,
    recoveryNonce: '3'.repeat(32), store,
    lifetime: { signal: f.controller.signal, getAddress: f.params.wallet.getAddress, isCurrent: () => true } }
  const first = await prepareSoulAuthoring(params)
  expect(first.manifest.request).toEqual(input.request)
  expect(first.manifest.sidecars).toHaveLength(count * 2)
  expect(first.preparation.manifest.files.filter(file => file.uploadType === 'encrypted')).toHaveLength(count * 2)
  const calls = f.walrus.encodeBlob.mock.calls.length
  const resumed = await prepareSoulAuthoring({ ...params, files: [] })
  expect(resumed).toEqual(first); expect(f.walrus.encodeBlob).toHaveBeenCalledTimes(calls)
  expect(store.create).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled()
})
it('preserves original Collection/Right settings, per-row content identity, actual files and image fallback', async () => {
  const d = draft(), result = await build(d), [a, b] = result.request.mints
  expect(result.request.collection).toMatchObject({ name: d.name, maxSupply: '100', floorPriceAtomic: d.floorPriceAtomic,
    listingPriceAtomic: '9007199254740993', extraRoyaltyBps: 500, tradeable: true })
  expect(a.contentObjectId).not.toBe(b.contentObjectId); expect(a.mintNonce).not.toBe(b.mintNonce)
  expect(a.image).toEqual({ kind: 'FILE', fileIndex: 3 }); expect(b.image).toEqual({ kind: 'FILE', fileIndex: 0 })
  expect(a.publicPreview).toEqual({ tags: ['one'], previewImages: [a.image] })
  expect(b.publicPreview).toEqual({ tags: ['two'], previewImages: [b.image] })
  expect(a.slots.map(s => s.fileIndex)).toEqual([1, 2]); expect(b.slots.map(s => s.fileIndex)).toEqual([4, 5])
  expect(await result.files[1].file.text()).toBe('original soul')
  expect(await result.files[2].file.text()).toBe('original memory')
  expect(await result.files[4].file.text()).toBe('# B\n\nSecond\n')
  expect(await result.files[5].file.text()).toBe('B memory.\n')
  expect(result.files.map(f => f.uploadType)).toEqual(['public', 'encrypted', 'encrypted', 'public', 'encrypted', 'encrypted'])
  expect(result.files.every(f => f.sendObjectTo === author)).toBe(true)
  expect(result.files[1].file.type).toBe('text/markdown')
  expect(a.slots.every(s => s.versionIndex === '0' && s.readModeMask === 3 && s.downloadPolicy === 'public' && !s.setActive)).toBe(true)
})
it('preserves empty Collection launch with one public cover and no encrypted Soul placeholders', async () => {
  const d = draft(); d.souls = []; d.soulFolders = new Map(); d.maxSupply = null
  const result = await build(d)
  expect(result.request.mints).toEqual([]); expect(result.request.collection?.maxSupply).toBeNull()
  expect(result.files).toHaveLength(1); expect(result.files[0].uploadType).toBe('public')
})
it.each(['cover', 'cap', 'below-supply', 'nontradeable-listing', 'folder-index', 'fractional', 'negative-floor'])('rejects invalid %s before any payment', async variant => {
  const d = draft()
  if (variant === 'cover') d.coverImageFile = null
  if (variant === 'cap') d.maxSupply = Number.MAX_SAFE_INTEGER + 1
  if (variant === 'below-supply') d.maxSupply = 1
  if (variant === 'nontradeable-listing') d.tradeable = false
  if (variant === 'folder-index') d.soulFolders!.set(3, d.soulFolders!.get(1)!)
  if (variant === 'fractional') d.maxSupply = 1.5
  if (variant === 'negative-floor') d.floorPriceAtomic = '-1'
  await expect(build(d)).rejects.toThrow()
})
it('snapshots all rows and file references before asynchronous skill inspection', async () => {
  const d = draft(), skill = new File(['skill'], 'SKILL.md')
  let finish!: (buffer: ArrayBuffer) => void
  skill.arrayBuffer = () => new Promise(resolve => { finish = resolve })
  d.soulFolders!.get(1)!.skillsFile = skill
  const pending = build(d)
  d.name = 'changed'; d.souls![1].name = 'changed'; d.soulFolders!.clear()
  finish(new Uint8Array([1, 2]).buffer)
  const r = await pending
  expect(r.request.collection?.name).toBe('Original Collection'); expect(r.request.mints[1].name).toBe('B')
  expect(r.request.mints[0].slots[2]).toMatchObject({ fileIndex: 3, kind: 2, name: 'default' })
  expect(r.files[3].extractSkillMetadata).toBe(true)
})
it('honors abort before building a new identity', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(buildCollectionAuthoringInput(draft(), target, author, controller.signal)).rejects.toThrow()
})
