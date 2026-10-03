import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromHex, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { SealClient } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { derivePrivateWalletBookmarksSealId } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'
import { decryptBrowserPrivateBookmarkCiphertext, encryptBrowserPrivateBookmarks, readBrowserPrivateBookmarkHead,
  unlockBrowserPrivateBookmarks, validateBrowserPrivateBookmarkConfig } from '../../web/lib/bookmarks/browser-private-bookmarks'
import { emptyPrivateBookmarkLibrary, preparePrivateBookmarkMutation } from '../../web/lib/bookmarks/private-bookmark-library'
import { PrivateBookmarkEnvelopeBcs } from '../../web/lib/bookmarks/private-bookmark-crypto'
import { privateWalletBookmarksFixture, bookmarkId as id } from './fixtures/private-wallet-bookmarks'
import { bookmarkCryptoFixture } from './fixtures/private-bookmark-crypto'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

/** Real raw Object/package/head/Blob verification, real AES/Seal BLS and real
 * SessionKey personal-signature verification. Only chain/storage/key transport
 * and a deterministic local test wallet are controlled; no deployed policy,
 * quorum certificate or live wallet is represented by these fixtures. */
async function fixture() {
  const encrypted = await bookmarkCryptoFixture()
  const wallet = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8))
  encrypted.scope.owner = wallet.toSuiAddress()
  Object.assign(encrypted.library, preparePrivateBookmarkMutation(emptyPrivateBookmarkLibrary(encrypted.scope), {
    ...encrypted.library.intent!, scope: encrypted.scope,
  }).library)
  const raw = privateWalletBookmarksFixture(encrypted.scope)
  raw.deployment.chainIdentifier = '35834a8a'
  raw.chain.mockResolvedValue({ chainIdentifier: MAINNET_GENESIS_DIGEST })
  let bytes = await encrypted.encryptBytes()
  function installCiphertext(value: Uint8Array) {
    bytes = new Uint8Array(value)
    Object.assign(raw.ref, { sha256: toHex(sha256(bytes)), byteLength: String(bytes.length) })
    const wire = { blob_object_id: raw.ref.blobObjectId, blob_id: raw.ref.blobId,
      sha256: [...fromHex(raw.ref.sha256)], byte_length: raw.ref.byteLength }
    raw.head.revision = '1'; raw.head.ciphertext = structuredClone(wire)
    raw.head.receipts.splice(0, raw.head.receipts.length, { request_id: [...fromHex(encrypted.context.requestId)],
      revision: '1', ciphertext: structuredClone(wire) })
    raw.blob.size = raw.ref.byteLength; raw.putHead(); raw.putBlob()
  }
  installCiphertext(bytes)
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new Uint8Array(bytes)))
  vi.stubGlobal('fetch', fetcher)
  const reset = vi.fn(), blobType = vi.fn(async () => raw.storage.blobType)
  const state = vi.fn(async () => ({ committee: { epoch: 3 } }))
  const walrus = vi.fn(() => ({ reset, getBlobType: blobType, systemState: state }) as any)
  const keyServers = vi.spyOn(SealClient.prototype, 'getKeyServers').mockImplementation(() => encrypted.seal.getKeyServers())
  const client = raw.client
  vi.spyOn(client.core, 'getObject').mockResolvedValue({ object: { version: '1' } } as any)
  const resolverPath = '../../web/node_modules/@mysten/sui/dist/client/core-resolver.mjs'
  const resolver = await import(resolverPath)
  vi.spyOn(client.core, 'resolveTransactionPlugin').mockReturnValue(resolver.coreClientResolveTransactionPlugin)
  vi.spyOn(client.core, 'getMoveFunction').mockResolvedValue({ function: { parameters: [
    { body: { vector: 'u8' }, reference: null },
    { body: { datatype: { package: raw.deployment.originalPackageId, module: 'profile', type: 'ProfileRegistryV1',
      typeParameters: [] } }, reference: 'immutable' },
  ] } } as any)
  vi.spyOn(client.core, 'getObjects').mockImplementation(async args => ({ objects: args.objectIds.map(objectId => ({ objectId,
    version: '3', digest: raw.rows.get(objectId)?.digest ?? toBase58(new Uint8Array(32).fill(3)),
    owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
  })) }) as any)
  const execute = vi.spyOn(client.core, 'executeTransaction').mockRejectedValue(new Error('Read flow must never execute'))
  let transaction: ReturnType<typeof bcs.TransactionKind.parse> | undefined
  const unwrap = vi.spyOn(SealClient.prototype, 'decrypt').mockImplementation(async args => {
    expect(args.checkShareConsistency).toBe(true)
    expect((await args.sessionKey.getCertificate()).user).toBe(wallet.toSuiAddress())
    transaction = bcs.TransactionKind.parse(args.txBytes)
    return encrypted.unwrap(args.data)
  })
  const controller = new AbortController()
  let address: string | null = wallet.toSuiAddress()
  const sign = vi.fn(async (message: Uint8Array) => (await wallet.signPersonalMessage(message)).signature)
  const config = { deployment: { ...raw.deployment }, registryId: raw.scope.registryId, storage: { ...raw.storage },
    sealConfig: structuredClone(encrypted.sealConfig), writesEnabled: false }
  const params = { owner: address, config, signal: controller.signal, client, sealClient: client,
    getAddress: () => address, signPersonalMessage: sign }
  const dependencies = { client: vi.fn(() => client), walrus }
  return { encrypted, raw, wallet, params, config, dependencies, controller, sign, unwrap, keyServers, execute,
    fetcher, reset, blobType, state, installCiphertext, bytes: () => new Uint8Array(bytes), transaction: () => transaction,
    changeWallet: (next: string | null = id(99)) => { address = next },
    absent: () => { raw.rows.delete(raw.headFieldId) },
    driftHead: () => { raw.head.receipts[0].request_id[0] ^= 1; raw.putHead() },
    read: () => readBrowserPrivateBookmarkHead(params, dependencies),
    run: () => unlockBrowserPrivateBookmarks(params, dependencies) }
}

it('discovers a locked raw head without public Profile creation, Seal, signing or storage access', async () => {
  const f = await fixture(), head = await f.read()
  expect(head.revision).toBe('1'); expect(head.head?.scope).toEqual(f.raw.scope)
  expect(f.raw.registry.profile_count).toBe('0')
  expect(f.keyServers).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
  expect(f.fetcher).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it('proves an absent owner-keyed head empty without creating a Profile or requesting Seal approval', async () => {
  const f = await fixture(); f.absent()
  const result = await f.run()
  expect(result.snapshot.emptyReason).toBe('ABSENT')
  expect(result.library).toEqual(emptyPrivateBookmarkLibrary(f.raw.scope))
  expect(result.ciphertext).toBeNull(); expect(result.endEpoch).toBeNull()
  expect(f.raw.registry.profile_count).toBe('0'); expect(f.raw.batch.mock.calls.length).toBeGreaterThan(1)
  expect(f.keyServers).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
  expect(f.fetcher).not.toHaveBeenCalled(); expect(f.dependencies.walrus).not.toHaveBeenCalled()
})
it('unlocks actual raw head/Blob ciphertext with real SessionKey and exact wallet-scoped approval', async () => {
  const f = await fixture(), result = await f.run()
  expect(result.library).toEqual(f.encrypted.library); expect(result.endEpoch).toBe(10)
  expect(result.ciphertext).toEqual(f.bytes()); expect(f.sign).toHaveBeenCalledOnce(); expect(f.unwrap).toHaveBeenCalledOnce()
  const tx = f.transaction()!.ProgrammableTransaction!
  expect(tx.commands[0].MoveCall).toMatchObject({ package: f.raw.deployment.callablePackageId,
    module: 'profile', function: 'seal_approve_bookmarks' })
  expect(tx.commands).toHaveLength(1)
  expect(tx.inputs[0].Pure?.bytes).toBe(toBase64(bcs.vector(bcs.u8()).serialize(await derivePrivateWalletBookmarksSealId(f.raw.scope)).toBytes()))
  expect(tx.inputs[1].Object?.SharedObject?.objectId).toBe(f.raw.scope.registryId)
  expect(f.fetcher).toHaveBeenCalledWith(`${f.raw.storage.aggregatorUrl}/v1/blobs/${f.raw.ref.blobId}`,
    expect.objectContaining({ credentials: 'omit', redirect: 'error', cache: 'no-store' }))
  expect(f.reset.mock.calls.length).toBeGreaterThanOrEqual(4)
  expect(f.execute).not.toHaveBeenCalled()
  for (const key of f.encrypted.keys) expect(key.every(v => v === 0)).toBe(true)
})
it('permits explicit decryption of same-owner orphan ciphertext without claiming a committed bookmark', async () => {
  const f = await fixture(); f.absent(); const verify = vi.fn(async () => {})
  const result = await decryptBrowserPrivateBookmarkCiphertext({ ...f.params, bytes: f.bytes(), context: f.encrypted.context, verify })
  expect(result).toEqual(f.encrypted.library); expect(f.sign).toHaveBeenCalledOnce(); expect(verify).toHaveBeenCalled()
  expect(f.fetcher).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
  expect((await f.read()).head).toBeNull()
})
it('public-key preparation performs no signature, storage payment or head write', async () => {
  const f = await fixture(); f.absent()
  const bytes = await encryptBrowserPrivateBookmarks({ ...f.params, library: f.encrypted.library })
  expect(await f.encrypted.decryptBytes(bytes)).toEqual(f.encrypted.library)
  expect(f.sign).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
  expect((await f.read()).head).toBeNull()
})
it('rejects encryption against a stale predecessor before contacting key servers', async () => {
  const f = await fixture()
  await expect(encryptBrowserPrivateBookmarks({ ...f.params, library: f.encrypted.library })).rejects.toThrow('REVISION_CONFLICT')
  expect(f.keyServers).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
})
it('rejects a head committed by another device during public-key preparation', async () => {
  const f = await fixture(); f.absent(); const original = f.keyServers.getMockImplementation()!
  f.keyServers.mockImplementationOnce(async () => { f.raw.putHead(); return original() })
  await expect(encryptBrowserPrivateBookmarks({ ...f.params, library: f.encrypted.library })).rejects.toThrow('HEAD_CHANGED')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it('captures a proposed private document before asynchronous key discovery', async () => {
  const f = await fixture(); f.absent(); const expected = structuredClone(f.encrypted.library)
  const original = f.keyServers.getMockImplementation()!
  f.keyServers.mockImplementationOnce(async () => {
    f.encrypted.library.entries[0].soulId = id(99)
    return original()
  })
  const bytes = await encryptBrowserPrivateBookmarks({ ...f.params, library: f.encrypted.library })
  expect(await f.encrypted.decryptBytes(bytes)).toEqual(expected)
  expect(f.sign).not.toHaveBeenCalled()
})
it('checks the independent Seal client chain before its key lookup or any wallet prompt', async () => {
  const f = await fixture(), chain = vi.fn(async () => ({ chainIdentifier: toBase58(new Uint8Array(32).fill(2)) }))
  f.params.sealClient = { core: { getChainIdentifier: chain } } as any
  await expect(f.run()).rejects.toThrow('SEAL_NETWORK_MISMATCH')
  expect(chain).toHaveBeenCalledOnce(); expect(f.keyServers).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
})
it('rejects a disconnected wallet before any raw read or key request', async () => {
  const f = await fixture(); f.changeWallet(null)
  await expect(f.run()).rejects.toThrow('WALLET_CHANGED')
  expect(f.raw.batch).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.keyServers).not.toHaveBeenCalled()
})
it.each(['chain', 'scope', 'registry-unavailable', 'invalid-head-digest'] as const)('does not turn %s failure into empty bookmarks', async fault => {
  const f = await fixture()
  if (fault === 'chain') f.raw.chain.mockResolvedValue({ chainIdentifier: toBase58(new Uint8Array(32).fill(2)) })
  if (fault === 'scope') { f.raw.head.owner = id(99); f.raw.putHead() }
  if (fault === 'registry-unavailable') f.raw.rows.delete(f.raw.scope.registryId)
  if (fault === 'invalid-head-digest') f.raw.rows.get(f.raw.headFieldId).bcs.value[0] ^= 1
  await expect(f.run()).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.unwrap).not.toHaveBeenCalled()
})
it.each(['owner', 'registry', 'chain', 'package'] as const)('rejects orphan %s transplantation before any signature', async fault => {
  const f = await fixture(), context = structuredClone(f.encrypted.context)
  if (fault === 'owner') context.scope.owner = id(99)
  if (fault === 'registry') context.scope.registryId = id(99)
  if (fault === 'chain') context.chainIdentifier = '00000001'
  if (fault === 'package') context.originalPackageId = id(99)
  await expect(decryptBrowserPrivateBookmarkCiphertext({ ...f.params, context, bytes: f.bytes(), verify: async () => {} }))
    .rejects.toThrow('RECOVERY_SCOPE_MISMATCH')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.unwrap).not.toHaveBeenCalled()
})
it.each(['wallet', 'head', 'chain', 'expired', 'epoch-regression', 'signature', 'refused'] as const)(
  'rejects %s changes while the explicit signature is pending', async fault => {
    const f = await fixture()
    f.sign.mockImplementation(async message => {
      if (fault === 'wallet') f.changeWallet()
      if (fault === 'head') f.driftHead()
      if (fault === 'chain') f.raw.chain.mockResolvedValue({ chainIdentifier: toBase58(new Uint8Array(32).fill(2)) })
      if (fault === 'expired') f.state.mockResolvedValue({ committee: { epoch: 10 } })
      if (fault === 'epoch-regression') f.state.mockResolvedValue({ committee: { epoch: 2 } })
      if (fault === 'refused') throw new Error('Local test wallet declined')
      const signer = fault === 'signature' ? Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(17)) : f.wallet
      return (await signer.signPersonalMessage(message)).signature
    })
    await expect(f.run()).rejects.toThrow()
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.unwrap).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
  })
it('rejects a final head change after actual decryption rather than publishing stale plaintext', async () => {
  const f = await fixture(), unwrap = f.unwrap.getMockImplementation()!
  f.unwrap.mockImplementation(async args => { const key = await unwrap(args); f.driftHead(); return key })
  await expect(f.run()).rejects.toThrow('HEAD_CHANGED')
  expect(f.unwrap).toHaveBeenCalledOnce()
  for (const key of f.encrypted.keys) expect(key.every(v => v === 0)).toBe(true)
})
it('keeps original owner, clients, release and signature callback when the request object changes during transport', async () => {
  const f = await fixture(), replacement = vi.fn(async () => { throw new Error('Replacement signer must never run') })
  f.fetcher.mockImplementationOnce(async () => {
    f.params.owner = id(99); f.params.client = null as any; f.params.sealClient = null as any
    f.params.getAddress = () => id(99); f.params.signPersonalMessage = replacement
    f.config.registryId = id(99); f.config.sealConfig.threshold = 1
    return new Response(f.bytes())
  })
  expect((await f.run()).library).toEqual(f.encrypted.library)
  expect(f.sign).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled()
})
it.each(['blob-network', 'storage-expired', 'ciphertext', 'storage-unavailable'] as const)('rejects %s before prompting the wallet', async fault => {
  const f = await fixture()
  if (fault === 'blob-network') f.blobType.mockResolvedValue(`${id(99)}::blob::Blob`)
  if (fault === 'storage-expired') f.state.mockResolvedValue({ committee: { epoch: 10 } })
  if (fault === 'ciphertext') f.fetcher.mockImplementation(async () => { const bytes = f.bytes(); bytes[0] ^= 1; return new Response(bytes) })
  if (fault === 'storage-unavailable') f.fetcher.mockResolvedValue(new Response('unavailable', { status: 503 }))
  await expect(f.run()).rejects.toThrow(); expect(f.sign).not.toHaveBeenCalled(); expect(f.unwrap).not.toHaveBeenCalled()
})
it('checks a malformed but storage-certified envelope before key-server contact or signing', async () => {
  const f = await fixture(), envelope = PrivateBookmarkEnvelopeBcs.parse(f.bytes())
  envelope.aad[0] ^= 1; f.installCiphertext(PrivateBookmarkEnvelopeBcs.serialize(envelope).toBytes())
  await expect(f.run()).rejects.toThrow('ENVELOPE_INVALID')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.keyServers).not.toHaveBeenCalled()
})
it('cancels a hanging raw head read without advancing to Seal or silently returning empty', async () => {
  const f = await fixture(); let resolve!: (value: any) => void
  const original = f.raw.batch.getMockImplementation()!
  f.raw.batch.mockImplementationOnce(((...args: any[]) => new Promise(done => { resolve = () => { void (original as any)(...args).then(done) } })) as any)
  const pending = f.run(), rejected = expect(pending).rejects.toThrow('Wallet generation replaced')
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  f.controller.abort(new Error('Wallet generation replaced')); await rejected
  resolve(undefined); await new Promise(done => setTimeout(done, 0))
  expect(f.sign).not.toHaveBeenCalled(); expect(f.keyServers).not.toHaveBeenCalled()
})
it('never adopts a late signature after wallet away-and-back cancellation', async () => {
  const f = await fixture(); let resolve!: (value: string) => void, message!: Uint8Array
  f.sign.mockImplementation(value => { message = value; return new Promise(done => { resolve = done }) })
  const pending = f.run(), rejected = expect(pending).rejects.toThrow('Wallet generation replaced')
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  f.changeWallet(); f.changeWallet(f.wallet.toSuiAddress()); f.controller.abort(new Error('Wallet generation replaced')); await rejected
  resolve((await f.wallet.signPersonalMessage(message)).signature); await new Promise(done => setTimeout(done, 0))
  expect(f.unwrap).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it('wipes a late decrypted key after cancellation even when key transport ignores abort', async () => {
  const f = await fixture(); let resolve!: (value: Uint8Array) => void
  f.unwrap.mockImplementation(() => new Promise(done => { resolve = done }))
  const pending = f.run(), rejected = expect(pending).rejects.toThrow('Wallet generation replaced')
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  f.controller.abort(new Error('Wallet generation replaced')); await rejected
  const late = new Uint8Array(32).fill(7); resolve(late)
  await vi.waitFor(() => expect(late.every(v => v === 0)).toBe(true))
})
it.each(['chain', 'secret', 'http', 'quota-field', 'registry'] as const)('rejects invalid public config %s', async fault => {
  const f = await fixture(), config: any = structuredClone(f.config)
  if (fault === 'chain') config.deployment.chainIdentifier = '01010101'
  if (fault === 'secret') config.sealConfig.serverConfigs[0].apiKey = 'PRIVATE'
  if (fault === 'http') config.storage.aggregatorUrl = 'http://walrus.example.com'
  if (fault === 'quota-field') config.maxBookmarks = 50
  if (fault === 'registry') config.registryId = id(0)
  expect(() => validateBrowserPrivateBookmarkConfig(config)).toThrow()
})
