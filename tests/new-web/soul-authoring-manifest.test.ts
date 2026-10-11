import { afterEach, expect, it, vi } from 'vitest'
import { fromHex, fromBase64 } from '@mysten/sui/utils'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { deriveMintContentObjectId } from '../../packages/soulidity-sdk/src/index'
import { parseSoulAuthoringRequest, soulAuthoringManifestHash, soulAuthoringRequestHash,
  validateSoulAuthoringManifest, materializeSoulAuthoringMint, createSoulAuthoringMaterializer,
  type SoulAuthoringRequest } from '../../web/lib/soulidity/soul-authoring-manifest'
import { decodeContentEnvelope } from '../../web/lib/soulidity/content-envelope'
import { contentAppendFixtureId as id } from './fixtures/content-append-preparation'
import { createSoulAuthoringTransactionComposer, buildSoulAuthoringRegistrationTransaction, buildSoulAuthoringMintTransaction,
  type SoulAuthoringMintChunk } from '../../web/lib/soulidity/soul-authoring-transaction'

afterEach(() => vi.restoreAllMocks())
import { soulAuthoringRequestFixture as request, soulAuthoringManifestFixture as fixture } from './fixtures/soul-authoring'
it.each(['', 'ipfs://original-nft', 'ar://original-nft'])('preserves JOINED source display %s through real encrypted materialization without making a public preview', async url => {
  const f = await fixture(r => {
    Object.assign(r.mints[0], { kind: 'JOINED', description: '', image: { kind: 'URL', url }, originRef: `sui:${id(100)}`,
      source: { objectId: id(100), objectType: `${id(101)}::example::Asset` }, publicPreview: { tags: [], previewImages: [] } })
  })
  const built = materializeSoulAuthoringMint(f.manifest, f.preparation, 0, [id(90), id(91)])
  expect(built.imageUrl).toBe(url); expect(built.description).toBe('')
  const bad = structuredClone(f.request)
  bad.mints[0].publicPreview.previewImages = [{ kind: 'URL', url: '' }]
  expect(() => parseSoulAuthoringRequest(bad)).toThrow()
})
it('binds one complete pre-upload intent and materializes the new exact mint ABI from proved Blob IDs', async () => {
  const f = await fixture(), m = validateSoulAuthoringManifest(f.manifest, f.preparation)
  expect(soulAuthoringManifestHash(m, f.preparation)).toMatch(/^[0-9a-f]{64}$/)
  const built = materializeSoulAuthoringMint(m, f.preparation, 0, [id(90), id(91)])
  expect(built.mintNonce).toEqual(fromHex(f.request.mints[0].mintNonce))
  expect(built.expectedContentObjectId).toBe(f.request.mints[0].contentObjectId)
  expect(built.initialContent.map(row => row.expectedVersionIndex)).toEqual(['0', '0'])
  built.initialContent.forEach(row => {
    const decoded = decodeContentEnvelope(new TextDecoder().decode(row.encryptedEnvelope), { contentObjectId: built.expectedContentObjectId,
      kind: row.kind, name: row.name, versionIndex: String(row.expectedVersionIndex), blobObjectId: row.blobObjectId }, id(1))
    expect(decoded.sidecar.contentHash).toBe(f.preparation.manifest.files[row.kind].contentHash)
  })
  expect(f.sign).not.toHaveBeenCalled()
})
it('preserves successive MEMORY versions instead of assigning every founding entry zero', async () => {
  const f = await fixture(r => r.mints[0].slots.push({ ...r.mints[0].slots[1], fileIndex: 2, versionIndex: '1' }))
  const built = materializeSoulAuthoringMint(f.manifest, f.preparation, 0, [id(90), id(91), id(92)])
  expect(built.initialContent.map(row => row.expectedVersionIndex)).toEqual(['0', '0', '1'])
})
it.each(['nonce', 'derived-id', 'author', 'version', 'duplicate-file', 'invariant-name', 'invariant-policy', 'active',
  'raw-key', 'preview-secret', 'duplicate-preview', 'reserved-config', 'extra-target', 'unsafe-number', 'double-mint', 'kind', 'empty', 'network'])('rejects malformed authoring %s before upload', variant => {
  const r = request(id(5)), mint = r.mints[0]
  if (variant === 'nonce') mint.mintNonce = 'a'
  if (variant === 'derived-id') mint.contentObjectId = id(99)
  if (variant === 'author') r.author = id(6)
  if (variant === 'version') mint.slots[1].versionIndex = '1'
  if (variant === 'duplicate-file') mint.slots[1].fileIndex = 0
  if (variant === 'invariant-name') mint.slots[0].name = 'default'
  if (variant === 'invariant-policy') mint.slots[0].readModeMask = 11
  if (variant === 'active') mint.slots[0].setActive = true
  if (variant === 'raw-key') Object.assign(mint.slots[1], { dek: 'private' })
  if (variant === 'preview-secret') mint.image = { kind: 'URL', url: 'https://images.example.com/soul.png?token=secret' }
  if (variant === 'duplicate-preview') mint.stateConfig.push({ key: 'soul_public_preview_v1', valueUtf8: '{}' })
  if (variant === 'reserved-config') mint.stateConfig.push({ key: 'content_seal_envelope_v1:owned', valueUtf8: '{}' })
  if (variant === 'extra-target') Object.assign(r.target, { apiKey: 'private' })
  if (variant === 'unsafe-number') (mint as any).listingPriceAtomic = Number.MAX_SAFE_INTEGER + 1
  if (variant === 'double-mint') r.mints.push(structuredClone(mint))
  if (variant === 'kind') mint.kind = 'RETIRED' as any
  if (variant === 'empty') r.mints = []
  if (variant === 'network') r.target.chainIdentifier = 'a8df4829'
  expect(() => parseSoulAuthoringRequest(r)).toThrow()
})
it.each(['metadata', 'slot', 'context-slot', 'sidecar', 'upload', 'scope', 'recipient', 'extra-manifest'])('refuses %s drift between final manifest and registered-upload intent', async variant => {
  const f = await fixture(), m = structuredClone(f.manifest), p = structuredClone(f.preparation)
  if (variant === 'metadata') m.request.mints[0].name = 'changed'
  if (variant === 'slot') m.request.mints[0].slots.reverse()
  if (variant === 'context-slot') m.sealContext!.slots[1].contentObjectId = id(99)
  if (variant === 'sidecar') m.sidecars.reverse()
  if (variant === 'upload') p.payloads[0][0] ^= 1
  if (variant === 'scope') p.manifest.scope.operationId = 'other'
  if (variant === 'recipient') p.manifest.files[0].recipient = id(77)
  if (variant === 'extra-manifest') Object.assign(m, { rawMaterial: 'private' })
  expect(() => validateSoulAuthoringManifest(m, p)).toThrow()
})
it.each([['0', true, null], ['1', false, '10'], ['18446744073709551616', true, null]])('rejects inconsistent Collection capacity/tradeability (%s,%s)', (maxSupply, tradeable, listingPriceAtomic) => {
  const r = request(id(5))
  r.collection = { name: 'Collection', description: 'Description', image: r.mints[0].image, extraRoyaltyBps: 0,
    tradeable, maxSupply, listingPriceAtomic, floorPriceAtomic: null }
  expect(() => parseSoulAuthoringRequest(r)).toThrow()
})
it('preserves exact full-u64 listing and maximum supported floor without Number conversion', () => {
  const r = request(id(5)), price = '18446744073709551615', floor = '99999999999999999999'
  r.collection = { name: 'Collection', description: 'Description', image: r.mints[0].image, extraRoyaltyBps: 100,
    tradeable: true, maxSupply: '100', listingPriceAtomic: price, floorPriceAtomic: floor }
  r.mints[0].listingPriceAtomic = price
  const parsed = parseSoulAuthoringRequest(r)
  expect(parsed.collection?.floorPriceAtomic).toBe(floor); expect(parsed.mints[0].listingPriceAtomic).toBe(price)
  r.collection.floorPriceAtomic = '100000000000000000000'
  expect(() => parseSoulAuthoringRequest(r)).toThrow('INTEGER_INVALID')
  r.collection.floorPriceAtomic = '00'
  expect(() => parseSoulAuthoringRequest(r)).toThrow('INTEGER_INVALID')
  r.collection.floorPriceAtomic = '0'
  expect(parseSoulAuthoringRequest(r).collection?.floorPriceAtomic).toBe('0')
})
it('accepts recursively reordered recovery JSON keys without changing the complete manifest commitment', async () => {
  const f = await fixture()
  const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder)
    : value && typeof value === 'object' && !(value instanceof Uint8Array)
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorder(entry)])) : value
  expect(soulAuthoringManifestHash(reorder(f.manifest), reorder(f.preparation)))
    .toBe(soulAuthoringManifestHash(f.manifest, f.preparation))
})
it('hashes semantic object keys canonically while preserving user-visible and file-array order', () => {
  const r = request(id(5)), reversed = Object.fromEntries(Object.entries(r).reverse()) as unknown as SoulAuthoringRequest
  expect(soulAuthoringRequestHash(reversed)).toBe(soulAuthoringRequestHash(r))
  reversed.mints = structuredClone(r.mints); reversed.mints[0].slots.reverse()
  expect(soulAuthoringRequestHash(reversed)).not.toBe(soulAuthoringRequestHash(r))
})
it.each([{ refs: [id(90), id(90)] }, { refs: [id(90)] }, { refs: [id(90), id(0)] }])('never maps aliased/missing Blob IDs into mint inputs ($refs)', async ({ refs }) => {
  const f = await fixture()
  expect(() => materializeSoulAuthoringMint(f.manifest, f.preparation, 0, refs)).toThrow('REGISTERED_BLOBS_INVALID')
})
it('snapshots batch materialization once and isolates each returned state config and envelope', async () => {
  const f = await fixture(r => r.mints[0].stateConfig.push({ key: 'example', valueUtf8: 'original' })), ids = [id(90), id(91)]
  const materialize = createSoulAuthoringMaterializer(f.manifest, f.preparation, ids)
  const first = materialize(0)
  first.initialStateConfig[1].valueUtf8 = 'mutated'
  first.initialContent[0].encryptedEnvelope.fill(0)
  ids[0] = id(99); f.manifest.request.mints[0].name = 'mutated'; f.preparation.payloads[0].fill(0)
  const second = materialize(0)
  expect(second.name).toBe('First Soul'); expect(second.initialStateConfig[1].valueUtf8).toBe('original')
  expect(second.initialContent[0].blobObjectId).toBe(id(90)); expect(second.initialContent[0].encryptedEnvelope.some(v => v !== 0)).toBe(true)
})
const existingKiosk = { kind: 'EXISTING' as const, kioskId: id(80), capId: id(81) }
const defaultChunk = (): SoulAuthoringMintChunk => ({ mintIndices: [0], includePublicFiles: true, collectionObjectId: null, kiosk: existingKiosk })
function calls(tx: Transaction) { return tx.getData().commands.flatMap(c => c.MoveCall ? [c.MoveCall] : []) }
function pure(tx: Transaction, arg: any) {
  const input = tx.getData().inputs[arg.Input]
  if (!input?.Pure) throw new Error('expected pure input')
  return fromBase64(input.Pure.bytes)
}
it.each(['ORDINARY', 'IMPORTED', 'JOINED'] as const)('composes exact %s initial mint arguments with a frozen explicit deployment', async kind => {
  const f = await fixture(r => {
    const m = r.mints[0]; m.kind = kind
    if (kind !== 'ORDINARY') m.originRef = 'unverified author provenance'
    if (kind === 'JOINED') m.source = { objectId: id(100), objectType: `${id(101)}::example::Asset` }
  })
  const composer = createSoulAuthoringTransactionComposer(f.manifest, f.preparation)
  expect(composer.manifestHash).toBe(soulAuthoringManifestHash(f.manifest, f.preparation))
  const stage = composer.prepareMintBusiness(f.preparation, [id(90), id(91)], defaultChunk())
  const tx = new Transaction(); stage.append(tx)
  const variant = kind === 'ORDINARY' ? 'native' : kind === 'IMPORTED' ? 'imported' : 'joined'
  const mint = calls(tx).find(c => c.function === `mint_${variant}_in_personal_kiosk_v2`)!
  expect(mint.package).toBe(f.request.target.callablePackageId)
  expect(bcs.vector(bcs.u8()).parse(pure(tx, mint.arguments.at(-3)))).toEqual([...fromHex(f.request.mints[0].mintNonce)])
  expect(bcs.Address.parse(pure(tx, mint.arguments.at(-2)))).toBe(f.request.mints[0].contentObjectId)
  expect(mint.arguments).toHaveLength(kind === 'ORDINARY' ? 15 : kind === 'IMPORTED' ? 16 : 17)
  expect(calls(tx).filter(c => c.function === 'new_initial_content_entry')).toHaveLength(2)
  const entry = calls(tx).find(c => c.function === 'new_initial_content_entry')!
  expect(bcs.u64().parse(pure(tx, entry.arguments[6]))).toBe('0')
  expect(bcs.vector(bcs.u8()).parse(pure(tx, entry.arguments[7])).length).toBeGreaterThan(100)
  expect(calls(tx).at(-1)?.function).toBe('finalize_soul_state')
  expect(stage.fileIndices).toEqual([0, 1]); expect(f.sign).not.toHaveBeenCalled()
  if (kind === 'JOINED') {
    expect(calls(tx).filter(c => ['borrow_val', 'place', 'return_val'].includes(c.function)).map(c => c.function))
      .toEqual(['borrow_val', 'place', 'return_val'])
    expect(mint.typeArguments).toEqual([`${id(101)}::example::Asset`])
  }
})
it('commits the manifest once with create/list/finalize and reuses the one personal Kiosk', async () => {
  const f = await fixture(r => {
    r.collection = { name: 'Collection', description: 'Description', image: r.mints[0].image, extraRoyaltyBps: 100,
      tradeable: true, maxSupply: '100', floorPriceAtomic: '99999999999999999999', listingPriceAtomic: '18446744073709551615' }
    r.mints[0].listingPriceAtomic = '1000000'
  })
  const composer = createSoulAuthoringTransactionComposer(f.manifest, f.preparation), register = new Transaction()
  composer.appendRegistrationBusiness(register, { kind: 'NEW', kioskId: null, capId: null })
  const functions = calls(register).map(c => c.function)
  expect(functions).toEqual(['commit_mint_manifest', 'new', 'new', 'ensure_personal_kiosk_registered_v2',
    'create_collection_in_personal_kiosk_v2', 'list_collection_right_fixed_price_v2', 'finalize_collection_listing',
    'finalize_collection', 'public_share_object', 'transfer_to_sender'])
  const create = calls(register).find(c => c.function === 'create_collection_in_personal_kiosk_v2')!
  expect(bcs.option(bcs.u128()).parse(pure(register, create.arguments[11]))).toBe('99999999999999999999')
  const tx = new Transaction()
  composer.prepareMintBusiness(f.preparation, [id(90), id(91)], { ...defaultChunk(), collectionObjectId: id(82) }).append(tx)
  expect(calls(tx).slice(-4).map(c => c.function)).toEqual(['add_soul', 'list_soul_fixed_price_with_collection_v2', 'finalize_soul_listing', 'finalize_soul_state'])
})
it.each(['duplicate', 'missing', 'out-of-order', 'wrong-bind', 'bad-kiosk', 'empty'] as const)('rejects invalid %s chunk before touching a transaction', async variant => {
  const f = await fixture(), composer = createSoulAuthoringTransactionComposer(f.manifest, f.preparation), chunk = defaultChunk()
  if (variant === 'duplicate') chunk.mintIndices = [0, 0]
  if (variant === 'missing') chunk.mintIndices = [1]
  if (variant === 'out-of-order') chunk.mintIndices = [1, 0]
  if (variant === 'wrong-bind') chunk.collectionObjectId = id(99)
  if (variant === 'bad-kiosk') chunk.kiosk = { kind: 'EXISTING', kioskId: id(80), capId: id(80) }
  if (variant === 'empty') chunk.mintIndices = []
  expect(() => composer.prepareMintBusiness(f.preparation, [id(90), id(91)], chunk)).toThrow()
})
it('keeps an empty Collection public and creates it without a mint or a hidden envelope transaction', async () => {
  const f = await fixture(r => {
    r.collection = { name: 'Empty Collection', description: 'No Souls yet', image: { kind: 'FILE', fileIndex: 0 },
      extraRoyaltyBps: 0, tradeable: false, maxSupply: null, floorPriceAtomic: null, listingPriceAtomic: null }
    r.mints = []
  })
  const composer = createSoulAuthoringTransactionComposer(f.manifest, f.preparation), register = new Transaction()
  composer.appendRegistrationBusiness(register, existingKiosk)
  expect(calls(register).map(c => c.function)).toEqual(['commit_mint_manifest', 'ensure_personal_kiosk_registered_v2',
    'create_collection_in_personal_kiosk_v2', 'finalize_collection'])
  const certify = composer.prepareMintBusiness(f.preparation, [id(90)], { ...defaultChunk(), mintIndices: [], collectionObjectId: id(82) })
  expect(certify.fileIndices).toEqual([0])
  const tx = new Transaction(); certify.append(tx); expect(tx.getData().commands).toEqual([])
  expect(f.preparation.privateRecovery).toBeNull(); expect(f.manifest.sidecars).toEqual([]); expect(f.sign).not.toHaveBeenCalled()
})
it('builds ordered multi-mint and subsequent chunks from the same committed nonces and mappings', async () => {
  const f = await fixture(r => {
    r.collection = { name: 'Collection', description: 'Two Souls', image: r.mints[0].image,
      extraRoyaltyBps: 0, tradeable: true, maxSupply: '2', floorPriceAtomic: null, listingPriceAtomic: null }
    const second = structuredClone(r.mints[0]); second.mintNonce = '5'.repeat(32); second.name = 'Second Soul'
    second.contentObjectId = deriveMintContentObjectId({ ...r.target, author: r.author, mintNonce: fromHex(second.mintNonce) })
    second.slots.forEach(slot => { slot.fileIndex += 2 }); r.mints.push(second)
  })
  const composer = createSoulAuthoringTransactionComposer(f.manifest, f.preparation)
  const chunk = { ...defaultChunk(), mintIndices: [0, 1], collectionObjectId: id(82) }
  const full = composer.prepareMintBusiness(f.preparation, [id(90), id(91), id(92), id(93)], chunk)
  const tx = new Transaction(); full.append(tx)
  expect(calls(tx).filter(c => c.function === 'ensure_personal_kiosk_registered_v2')).toHaveLength(1)
  expect(calls(tx).filter(c => c.function === 'mint_native_in_personal_kiosk_v2')).toHaveLength(2)
  expect(full.fileIndices).toEqual([0, 1, 2, 3])
  const second = composer.prepareMintBusiness(f.preparation, [id(90), id(91), id(92), id(93)], { ...chunk, mintIndices: [1], includePublicFiles: false })
  expect(second.fileIndices).toEqual([2, 3])
  const single = new Transaction(); second.append(single)
  const mint = calls(single).find(c => c.function === 'mint_native_in_personal_kiosk_v2')!
  expect(bcs.Address.parse(pure(single, mint.arguments.at(-2)))).toBe(f.request.mints[1].contentObjectId)
  chunk.mintIndices.reverse(); f.manifest.request.target.callablePackageId = id(200)
  const again = new Transaction(); full.append(again); expect(again.getData()).toEqual(tx.getData())
})
it('creates an empty Collection with an existing URL without Walrus I/O or an empty second payment', async () => {
  const f = await fixture(r => {
    r.collection = { name: 'Empty Collection', description: 'Existing public cover', image: r.mints[0].image,
      extraRoyaltyBps: 0, tradeable: false, maxSupply: null, floorPriceAtomic: null, listingPriceAtomic: null }
    r.mints = []
  })
  expect(f.preparation.payloads).toEqual([]); expect(f.preparation.privateRecovery).toBeNull()
  expect(f.walrus.reset).not.toHaveBeenCalled(); expect(f.walrus.systemState).not.toHaveBeenCalled(); expect(f.walrus.encodeBlob).not.toHaveBeenCalled()
  const composer = createSoulAuthoringTransactionComposer(f.manifest, f.preparation), tx = new Transaction()
  composer.appendRegistrationBusiness(tx, existingKiosk)
  expect(calls(tx).map(c => c.function)).toContain('create_collection_in_personal_kiosk_v2')
  expect(() => composer.prepareMintBusiness(f.preparation, [], { ...defaultChunk(), mintIndices: [], collectionObjectId: id(82) }))
    .toThrow('NO_MINT_STAGE_REQUIRED')
  const upload = { appendRegisterCalls: vi.fn(async (_tx: Transaction) => { throw Error('must not register nothing') }) }
  const built = await buildSoulAuthoringRegistrationTransaction({ manifest: f.manifest, preparation: f.preparation, kiosk: existingKiosk, uploader: upload })
  expect(upload.appendRegisterCalls).not.toHaveBeenCalled(); expect(built.getData().sender).toBe(f.request.author)
  expect(calls(built).map(c => c.function)).toContain('create_collection_in_personal_kiosk_v2')
})
it('composes the uploader register prefix before manifest commitment and isolates delayed caller mutation', async () => {
  const f = await fixture(), expectedHash = soulAuthoringManifestHash(f.manifest, f.preparation), expectedAuthor = f.request.author
  const uploader = { appendRegisterCalls: vi.fn(async (tx: Transaction) => {
    tx.moveCall({ target: `${id(210)}::fixture::register_prefix`, arguments: [] })
    f.manifest.request.author = id(99); f.manifest.request.target.callablePackageId = id(100)
    await Promise.resolve()
  }) }
  const tx = await buildSoulAuthoringRegistrationTransaction({ manifest: f.manifest, preparation: f.preparation, kiosk: existingKiosk, uploader })
  expect(calls(tx).map(c => c.function)).toEqual(['register_prefix', 'commit_mint_manifest'])
  expect(tx.getData().sender).toBe(expectedAuthor); expect(calls(tx)[1].package).toBe(id(10))
  expect(bcs.vector(bcs.u8()).parse(pure(tx, calls(tx)[1].arguments[0]))).toEqual([...fromHex(expectedHash)])
})
it('certifies exactly the selected file indices before appending same-transaction atomic content mint', async () => {
  const f = await fixture(), ids = [id(90), id(91)], chunk = defaultChunk(), expectedContentId = f.request.mints[0].contentObjectId
  const uploader = { appendCertifyCalls: vi.fn(async (tx: Transaction, indices?: readonly number[]) => {
    expect(indices).toEqual([0, 1]); expect(Object.isFrozen(indices)).toBe(true)
    tx.moveCall({ target: `${id(210)}::fixture::certify_prefix`, arguments: [] })
    ids[0] = id(200); chunk.mintIndices = []; f.manifest.request.mints[0].contentObjectId = id(201)
    return {} as any
  }) }
  const { transaction: tx, fileIndices } = await buildSoulAuthoringMintTransaction({ manifest: f.manifest, preparation: f.preparation, blobIds: ids, chunk, uploader })
  expect(calls(tx)[0].function).toBe('certify_prefix'); expect(fileIndices).toEqual([0, 1])
  const mint = calls(tx).find(c => c.function === 'mint_native_in_personal_kiosk_v2')!
  expect(bcs.Address.parse(pure(tx, mint.arguments.at(-2)))).toBe(expectedContentId)
  expect(f.sign).not.toHaveBeenCalled()
})
it('does not append a business suffix when uploader construction fails', async () => {
  const f = await fixture(); let observed: Transaction | undefined
  const uploader = { appendCertifyCalls: vi.fn(async (tx: Transaction) => { observed = tx; throw Error('durable storage unavailable') }) }
  await expect(buildSoulAuthoringMintTransaction({ manifest: f.manifest, preparation: f.preparation,
    blobIds: [id(90), id(91)], chunk: defaultChunk(), uploader })).rejects.toThrow('durable storage unavailable')
  expect(observed?.getData().commands).toEqual([]); expect(f.sign).not.toHaveBeenCalled()
})
