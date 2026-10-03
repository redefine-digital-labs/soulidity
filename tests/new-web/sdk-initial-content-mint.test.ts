import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'
import { Transaction } from '@mysten/sui/transactions'
import { appendCommitMintManifest, buildCommitMintManifestTx, deriveMintContentObjectId } from '../../packages/soulidity-sdk/src/mint-content-identity'
import { buildPublishSoulTx, buildPublishSoulWithBindTx, buildPublishSoulWithListTx,
  buildPublishSoulWithCollectionAndListTx, buildBatchPublishSoulTx, buildCollectionFastPathPtb2Tx } from '../../packages/soulidity-sdk/src/tx/publish'
import { buildImportSoulTx } from '../../packages/soulidity-sdk/src/tx/import'
import { buildPersonalJoinSoulTx } from '../../packages/soulidity-sdk/src/tx/personal-join'
import { validateInitialContentEntries, validateInitialStateConfigEntries } from '../../packages/soulidity-sdk/src/tx/shared'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const seed = { kioskRegistryId: id(0x123), originalPackageId: id(0xab), author: id(0xa11), mintNonce: Uint8Array.from({ length: 16 }, (_, i) => i) }
const entries = () => [
  { kind: 0, name: 'soul', slotReadModeMask: 3, downloadPolicy: 'public' as const, setActive: false, blobObjectId: id(21), expectedVersionIndex: '0', encryptedEnvelope: new Uint8Array([1, 2, 3]) },
  { kind: 1, name: 'default', slotReadModeMask: 3, downloadPolicy: 'public' as const, setActive: false, blobObjectId: id(22), expectedVersionIndex: 0n, encryptedEnvelope: new Uint8Array([4, 5, 6]) },
  { kind: 1, name: 'default', slotReadModeMask: 3, downloadPolicy: 'public' as const, setActive: false, blobObjectId: id(23), expectedVersionIndex: 1, encryptedEnvelope: new Uint8Array([7, 8, 9]) },
]
const mint = () => ({ currentKioskId: id(10), currentKioskCapOnChainId: id(11), name: 'Soul', description: 'Description', imageUrl: 'walrus://image',
  creatorRoyaltyBps: 250, mintNonce: new Uint8Array(seed.mintNonce), expectedContentObjectId: deriveMintContentObjectId(seed),
  initialContent: entries(), initialStateConfig: [{ key: 'sprite_config_json', valueUtf8: '{"frames":3}' }] })
type Mint = ReturnType<typeof mint>
const variants = {
  publish: (p: Mint) => buildPublishSoulTx(p),
  bind: (p: Mint) => buildPublishSoulWithBindTx({ ...p, collectionOnChainId: id(30) }),
  list: (p: Mint) => buildPublishSoulWithListTx({ ...p, listingPriceAtomic: 1n }),
  collectionList: (p: Mint) => buildPublishSoulWithCollectionAndListTx({ ...p, collectionOnChainId: id(30), listingPriceAtomic: 1n }),
  import: (p: Mint) => buildImportSoulTx({ ...p, originRef: 'unverified' }),
  join: (p: Mint) => buildPersonalJoinSoulTx({ ...p, sourceObjectId: id(40), sourceObjectType: `${id(41)}::nft::Nft`, originRef: 'unverified' }),
  batch: (p: Mint) => buildBatchPublishSoulTx({ currentKioskId: p.currentKioskId, currentKioskCapOnChainId: p.currentKioskCapOnChainId, souls: [p] }),
  collectionBatch: (p: Mint) => buildCollectionFastPathPtb2Tx({ currentKioskId: p.currentKioskId, currentKioskCapOnChainId: p.currentKioskCapOnChainId,
    collectionOnChainId: id(30), souls: [p], attachCertifyCalls: () => {} }),
}
function inputBytes(tx: Transaction, arg: { Input?: number }): Uint8Array {
  if (arg.Input === undefined) throw new Error('Expected actual BCS input')
  const input = tx.getData().inputs[arg.Input]
  if (!input.Pure) throw new Error('Expected actual pure input')
  return fromBase64(input.Pure.bytes)
}
beforeEach(() => {
  for (const [name, value] of Object.entries({ CALLABLE_PACKAGE_ID: id(1), ORIGINAL_PACKAGE_ID: seed.originalPackageId,
    MARKET_CONFIG_V2_ID: id(2), KIND_REGISTRY_ID: id(3), KIOSK_REGISTRY_ID: seed.kioskRegistryId, SOUL_TRANSFER_POLICY_ID: id(4), KIOSK_PACKAGE_ID: id(5) })) {
    vi.stubEnv(`NEXT_PUBLIC_SOULIDITY_${name}`, value)
  }
  vi.stubEnv('NEXT_PUBLIC_KIOSK_PACKAGE_ID', id(5))
})
afterEach(() => vi.unstubAllEnvs())

it('derives an explicit-namespace golden and matches the coherent Move graph key framing golden', () => {
  expect(deriveMintContentObjectId(seed)).toBe('0x8a7f741c5870e5282fd1a23b7ed14695448daed8643b5ac6f634d12601f6652c')
  // The native eight-package test graph assigns Soulidity 0x107. This is not
  // a deployment default; production calls require their certified type origin.
  const vm = deriveMintContentObjectId({ ...seed, originalPackageId: id(0x107) })
  expect(vm).toBe('0x1d38c02388feceb85881c0338deb70131d59033e1adfda248d05d295c726bcc0')
  expect(readFileSync('move/soulidity/sources/market.move', 'utf8')).toContain(vm.slice(2))
})
it.each(['kioskRegistryId', 'originalPackageId', 'author', 'mintNonce'] as const)('binds identity to %s independently', key => {
  expect(deriveMintContentObjectId({ ...seed, [key]: key === 'mintNonce' ? new Uint8Array(16).fill(9) : id(99) })).not.toBe(deriveMintContentObjectId(seed))
})
it.each(['kioskRegistryId', 'originalPackageId', 'author'] as const)('rejects malformed %s', key => {
  for (const value of [undefined, null, 1, '', '0x1', id(0), id(0xab).toUpperCase()]) {
    expect(() => deriveMintContentObjectId({ ...seed, [key]: value } as never)).toThrow('canonical nonzero')
  }
})
it('commits exactly one public hash into the caller PTB without creating a ticket or mint', () => {
  const hash = Uint8Array.from({ length: 32 }, (_, i) => i)
  const tx = new Transaction()
  tx.moveCall({ target: `${id(9)}::system::register_blob`, arguments: [] })
  appendCommitMintManifest(tx, { callablePackageId: id(1), manifestHash: hash })
  hash.fill(255)
  const calls = tx.getData().commands.map(c => c.MoveCall!)
  expect(calls.map(c => c.function)).toEqual(['register_blob', 'commit_mint_manifest'])
  expect(calls[1].arguments).toHaveLength(1)
  expect(bcs.vector(bcs.u8()).parse(inputBytes(tx, calls[1].arguments[0] as never))).toEqual(Array.from({ length: 32 }, (_, i) => i))
  expect(buildCommitMintManifestTx({ callablePackageId: id(1), manifestHash: hash }).getData().commands).toHaveLength(1)
})
it('rejects missing or wrong-sized manifest bytes before mutating the supplied PTB', () => {
  for (const manifestHash of [undefined, null, '00'.repeat(32), [1], new Uint8Array(0), new Uint8Array(31), new Uint8Array(33)]) {
    const tx = new Transaction(), before = tx.getData()
    expect(() => appendCommitMintManifest(tx, { callablePackageId: id(1), manifestHash: manifestHash as never })).toThrow('exactly 32')
    expect(tx.getData()).toEqual(before)
  }
})

describe('all ordinary mint/bind/list/batch builders use the single new ABI', () => {
  it.each(Object.entries(variants))('%s writes nonce and expected Content ID immediately before Clock plus all ordered envelopes', async (_name, build) => {
    const params = mint(), tx = await build(params)
    const calls = tx.getData().commands.flatMap(c => c.MoveCall ? [c.MoveCall] : [])
    const call = calls.find(c => /^mint_(native|imported|joined)_in_personal_kiosk_v2$/.test(c.function))!
    expect(call).toBeDefined()
    const tail = call.arguments.length - 3
    expect(bcs.vector(bcs.u8()).parse(inputBytes(tx, call.arguments[tail] as never))).toEqual(Array.from(seed.mintNonce))
    expect(bcs.Address.parse(inputBytes(tx, call.arguments[tail + 1] as never))).toBe(params.expectedContentObjectId)
    const content = calls.filter(c => c.function === 'new_initial_content_entry')
    expect(content).toHaveLength(3)
    for (const [index, entry] of content.entries()) {
      expect(entry.arguments).toHaveLength(8)
      expect(bcs.u64().parse(inputBytes(tx, entry.arguments[6] as never))).toBe(String(params.initialContent[index].expectedVersionIndex))
      expect(bcs.vector(bcs.u8()).parse(inputBytes(tx, entry.arguments[7] as never))).toEqual(Array.from(params.initialContent[index].encryptedEnvelope))
    }
    expect(calls.some(c => /persist_envelope|prepare_mint_content/.test(c.function))).toBe(false)
  })
  it.each(Object.entries(variants))('%s rejects omitted nonce or expected ID instead of selecting old ABI', async (_name, build) => {
    const params = mint()
    delete (params as Partial<Mint>).mintNonce
    await expect(build(params)).rejects.toThrow('mintNonce')
    const other = mint()
    delete (other as Partial<Mint>).expectedContentObjectId
    await expect(build(other)).rejects.toThrow('expectedContentObjectId')
  })
  it.each(Object.entries(variants))('%s rejects omitted envelope and malformed initial counter', async (_name, build) => {
    const params = mint()
    params.initialContent[0].encryptedEnvelope = undefined as never
    await expect(build(params)).rejects.toThrow('encryptedEnvelope')
    const second = mint()
    second.initialContent[2].expectedVersionIndex = 0
    await expect(build(second)).rejects.toThrow('ordered slot version')
  })
})

it.each([buildPublishSoulTx, buildImportSoulTx, buildPersonalJoinSoulTx])('snapshots nonce/expected ID and envelope bytes before asynchronous attachment', async build => {
  const params = { ...mint(), originRef: 'source', sourceObjectId: id(40), sourceObjectType: `${id(41)}::nft::Nft`, attachBeforeMint: async () => {
    params.mintNonce.fill(255)
    params.expectedContentObjectId = id(99)
    params.initialContent[0].encryptedEnvelope.fill(255)
  } }
  const tx = await build(params)
  const calls = tx.getData().commands.flatMap(c => c.MoveCall ? [c.MoveCall] : [])
  const call = calls.find(c => c.function.startsWith('mint_'))!
  expect(bcs.vector(bcs.u8()).parse(inputBytes(tx, call.arguments.at(-3) as never))).toEqual(Array.from(seed.mintNonce))
  expect(bcs.Address.parse(inputBytes(tx, call.arguments.at(-2) as never))).toBe(deriveMintContentObjectId(seed))
  const entry = calls.find(c => c.function === 'new_initial_content_entry')!
  expect(bcs.vector(bcs.u8()).parse(inputBytes(tx, entry.arguments[7] as never))).toEqual([1, 2, 3])
})

it('keeps counters independent per typed kind/name slot and uses exact UTF8 names', () => {
  const rows = entries()
  rows.push({ ...rows[0], kind: 2, name: 'a', expectedVersionIndex: 0 })
  rows.push({ ...rows[0], kind: 2, name: 'b', expectedVersionIndex: 0 })
  rows.push({ ...rows[0], kind: 2, name: 'a', expectedVersionIndex: 1 })
  expect(() => validateInitialContentEntries(rows)).not.toThrow()
})
it('validates exact u64 input types without rounding or coercing malformed values', () => {
  for (const value of [undefined, null, true, [], {}, '', '00', '01', '+0', ' 0', '-1', '1e2', '0x0', '-0',
    -1, -1n, 0.1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '18446744073709551616', '1'.repeat(1000)]) {
    const rows = entries(); rows[0].expectedVersionIndex = value as never
    expect(() => validateInitialContentEntries(rows)).toThrow('expectedVersionIndex')
  }
})
it('requires actual bounded envelope bytes and allows the exact existing 64 KiB limit', () => {
  for (const bytes of [undefined, null, [1], '', 'encrypted', new Uint8Array(), new Uint8Array(65537)]) {
    const rows = entries(); rows[0].encryptedEnvelope = bytes as never
    expect(() => validateInitialContentEntries(rows)).toThrow('encryptedEnvelope')
  }
  const rows = entries(); rows[0].encryptedEnvelope = new Uint8Array(65536)
  expect(() => validateInitialContentEntries(rows)).not.toThrow()
})
it('reserves only initial envelope namespace and leaves ordinary config available', () => {
  for (const key of ['content_seal_envelope_v1:', 'content_seal_envelope_v1:' + '0'.repeat(64), 'content_seal_envelope_v1:future']) {
    expect(() => validateInitialStateConfigEntries([{ key, valueUtf8: 'substitute' }])).toThrow('reserved content envelope')
  }
  expect(() => validateInitialStateConfigEntries([{ key: 'sprite_config_json', valueUtf8: '{}' }, { key: 'content_seal_envelope_v1', valueUtf8: 'not a reserved key' }])).not.toThrow()
})
