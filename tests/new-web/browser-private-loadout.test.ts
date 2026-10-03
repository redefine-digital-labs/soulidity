import { afterEach, expect, it, vi } from 'vitest'
import { fromHex, toBase58 } from '@mysten/sui/utils'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { SealClient, EncryptedObject } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { WalrusClient } from '../../web/node_modules/@mysten/walrus/dist/index.mjs'
import { readBrowserPrivateLoadout, readBrowserPrivateLoadoutHead, unlockBrowserPrivateLoadout,
  getBrowserPrivateLoadoutConfig, validateBrowserPrivateLoadoutConfig, encryptBrowserPrivateLoadout,
  decryptBrowserPrivateLoadoutCiphertext } from '../../web/lib/animacraft/browser-private-loadout'
import { emptyPrivateLoadoutLibrary, preparePrivateLoadoutMutation } from '../../web/lib/animacraft/private-loadout-library'
import { captureNamedLoadout } from '../../web/lib/animacraft/named-loadout'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { NativeSoulBindingBcs } from '../../web/lib/animacraft/native-receive'
import { EquipmentMakerBcs } from '../../web/lib/animacraft/native-equipment-source-bcs'
import { EquipmentSealPolicyBcs } from '../../web/lib/animacraft/native-equipment-seal'
import { browserPrivateLoadoutFixture } from './fixtures/browser-private-loadout'
import { artId as id } from './fixtures/browser-native-artwork'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })
function environment(f: ReturnType<typeof browserPrivateLoadoutFixture>) {
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet'); vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', f.target.soulidityCallablePackageId)
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID', f.target.soulidityOriginalPackageId)
  vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON', JSON.stringify(f.target))
  vi.stubEnv('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', JSON.stringify(f.config.aggregators.map(([objectId, aggregatorUrl]) => ({ objectId, aggregatorUrl }))))
  vi.stubEnv('NEXT_PUBLIC_WALRUS_BLOB_TYPE', f.storage.blobType); vi.stubEnv('NEXT_PUBLIC_WALRUS_AGGREGATOR_URL', f.storage.aggregatorUrl)
}
it('captures only public explicit config and detaches/freezes every nested field', () => {
  const f = browserPrivateLoadoutFixture(); environment(f)
  const result = getBrowserPrivateLoadoutConfig()
  expect(result).toEqual(f.config); expect(Object.isFrozen(result.target)).toBe(true); expect(Object.isFrozen(result.aggregators[0])).toBe(true)
  f.config.storage.aggregatorUrl = 'https://other.example'; expect(result.storage.aggregatorUrl).toBe('https://walrus.example.com')
})
it.each(['secret','url-user','url-query','url-http','localhost','blob-type','seal-secret','extra-target'])('rejects malformed or secret public config: %s', kind => {
  const f = browserPrivateLoadoutFixture(), c: any = f.config
  if (kind === 'secret') c.token = 'secret'
  if (kind === 'url-user') c.storage.aggregatorUrl = 'https://user:pass@walrus.example'
  if (kind === 'url-query') c.storage.aggregatorUrl += '?api-key=secret'
  if (kind === 'url-http') c.storage.aggregatorUrl = 'http://walrus.example'
  if (kind === 'localhost') c.storage.aggregatorUrl = 'https://localhost'
  if (kind === 'blob-type') c.storage.blobType = '0x1::blob::Blob'
  if (kind === 'seal-secret') c.aggregators[0].push('secret')
  if (kind === 'extra-target') c.target.apiKey = 'secret'
  expect(() => validateBrowserPrivateLoadoutConfig(c)).toThrow()
})
it.each(['network','private-fallback','storage'])('does not fall back to private/default configuration: %s', key => {
  const f = browserPrivateLoadoutFixture(); environment(f)
  if (key === 'network') vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'testnet')
  if (key === 'private-fallback') { vi.stubEnv('NEXT_PUBLIC_WALRUS_AGGREGATOR_URL', ''); vi.stubEnv('WALRUS_AGGREGATOR_URL', f.storage.aggregatorUrl) }
  if (key === 'storage') vi.stubEnv('NEXT_PUBLIC_WALRUS_BLOB_TYPE', '')
  expect(() => getBrowserPrivateLoadoutConfig()).toThrow()
})
it('queries exact raw head without current equipment, Seal policy or Walrus', async () => {
  const f = browserPrivateLoadoutFixture(); f.objects.delete(id(260)); f.config.aggregators = []
  const result = await readBrowserPrivateLoadoutHead({ scope: f.scope, config: f.config }, f.dependencies)
  expect(result.revision).toBe('1'); expect(f.walrusFactory).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it('empty scope requires no signature, download, Walrus or Seal service', async () => {
  const f = browserPrivateLoadoutFixture(true), sign = vi.fn(); vi.stubGlobal('fetch', f.fetcher)
  f.objects.delete(id(260)); f.config.aggregators = []
  const result = await unlockBrowserPrivateLoadout({ scope: f.scope, config: f.config, client: f.client, sealClient: f.client,
    getAddress: () => f.scope.owner, signPersonalMessage: sign, signal: new AbortController().signal }, f.dependencies)
  expect(result.library).toMatchObject({ revision: '0', entries: [], receipts: [], intent: null })
  expect(result.policy).toBeNull(); expect(sign).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.walrusFactory).not.toHaveBeenCalled()
})
it.each([true,false])('reads ciphertext with public original=%s and closed equipment', async publicOriginal => {
  const f = browserPrivateLoadoutFixture(false, publicOriginal); vi.stubGlobal('fetch', f.fetcher)
  const result = await readBrowserPrivateLoadout({ scope: f.scope, config: f.config }, f.dependencies)
  expect(result.snapshot.revision).toBe('1'); expect(result.ciphertext).toEqual(new Uint8Array([5,6,7])); expect(result.endEpoch).toBe(10)
  expect(result.policy?.threshold).toBe(f.policy.threshold); expect(result.policy?.keyServers.map(s => s.weight)).toEqual([2,3])
  expect(f.reset).toHaveBeenCalledTimes(2); expect(f.system).toHaveBeenCalledTimes(2); expect(f.blobType).toHaveBeenCalledTimes(2)
  expect(f.reset.mock.invocationCallOrder[0]).toBeLessThan(f.blobType.mock.invocationCallOrder[0])
  expect(f.blobType.mock.invocationCallOrder[0]).toBeLessThan(f.system.mock.invocationCallOrder[0])
  expect(f.walrusClient()).not.toBe(f.client); expect(f.execute).not.toHaveBeenCalled()
  expect(f.get.mock.calls.every(([r]) => r.objectId !== id(80))).toBe(true)
})
it.each(['chain','owner','epoch','pointer','head','binding','root','policy','certified','expiry','blobtype','walrus-epoch'])('fails closed for actual raw %s', kind => {
  const f = browserPrivateLoadoutFixture(); vi.stubGlobal('fetch', f.fetcher)
  if (kind === 'chain') f.chain.mockResolvedValue({ chainIdentifier: toBase58(new Uint8Array(32).fill(5)) })
  if (kind === 'owner') { f.state.current_owner = id(999); f.putState() }
  if (kind === 'epoch') { f.state.ownership_epoch = '999'; f.putState() }
  if (kind === 'pointer') f.objects.delete(f.pointerId)
  if (kind === 'head') { f.head.owner = id(999); f.putHead() }
  if (kind === 'binding') f.edit(id(13), NativeSoulBindingBcs, v => { v.soul_id = id(999) })
  if (kind === 'root') f.edit(id(10), EquipmentMakerBcs, v => { v.content.content_commitment[0] ^= 1 })
  if (kind === 'policy') f.edit(id(260), EquipmentSealPolicyBcs, v => { v.threshold = 1 })
  if (kind === 'certified') { f.blob.certified_epoch = null; f.putBlob() }
  if (kind === 'expiry') f.system.mockResolvedValue({ committee: { epoch: 10 } } as any)
  if (kind === 'blobtype') f.blobType.mockReturnValue(`${id(999)}::blob::Blob`)
  if (kind === 'walrus-epoch') f.system.mockResolvedValue({ committee: { epoch: -1 } } as any)
  return expect(readBrowserPrivateLoadout({ scope: f.scope, config: f.config }, f.dependencies)).rejects.toThrow()
})
it('captures config/scope before await and rereads immutable package bytes', async () => {
  const f = browserPrivateLoadoutFixture(); vi.stubGlobal('fetch', f.fetcher)
  const pending = readBrowserPrivateLoadout({ scope: f.scope, config: f.config }, f.dependencies)
  f.config.storage.aggregatorUrl = 'https://attacker.example'; f.scope.owner = id(999)
  await expect(pending).resolves.toMatchObject({ snapshot: { revision: '1' } })
  expect(String(f.fetcher.mock.calls[0][0])).toContain('walrus.example.com')
})
it('rejects raw drift during ciphertext download rather than returning stale evidence', async () => {
  const f = browserPrivateLoadoutFixture()
  vi.stubGlobal('fetch', vi.fn(async () => { f.state.is_listed = true; f.putState(); return new Response(new Uint8Array([5,6,7])) }))
  await expect(readBrowserPrivateLoadout({ scope: f.scope, config: f.config }, f.dependencies)).rejects.toThrow()
})
it.each(['timeout','abort'])('bounds non-cooperative transport by %s', async kind => {
  const f = browserPrivateLoadoutFixture(), controller = new AbortController()
  if (kind === 'timeout') {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const deadline = new AbortController(); setTimeout(() => deadline.abort(new Error('deadline')), ms); return deadline.signal
    })
  }
  f.get.mockImplementation((() => new Promise(() => {})) as any)
  const pending = readBrowserPrivateLoadoutHead({ scope: f.scope, config: f.config, signal: controller.signal }, f.dependencies)
  const observed = expect(pending).rejects.toThrow()
  if (kind === 'abort') controller.abort(new Error('cancelled'))
  else await vi.advanceTimersByTimeAsync(25001)
  await observed
})

/** Actual AES/Seal BLS plus actual SessionKey personal-message verification.
 * Only chain/key-server transport and Move ABI replies are local fixtures. */
async function cryptoFixture() {
  const f = browserPrivateLoadoutFixture(true), wallet = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9))
  f.scope.owner = wallet.toSuiAddress(); f.state.current_owner = f.scope.owner; f.putState(); f.head.owner = f.scope.owner
  const paths = ['bls12381','utils','decrypt','kdf'].map(name => `../../web/node_modules/@mysten/seal/dist/${name}.mjs`)
  const [bls, utils, decrypt, kdf] = await Promise.all(paths.map(path => import(path)))
  const keys = f.policy.key_servers.map((row: any) => ({ objectId: row.key_server_id, name: 'local test', url: 'https://seal.example.com',
    keyType: 0, serverType: 'Independent', pk: bls.G2Element.generator().toBytes() }))
  const getKeys = vi.spyOn(SealClient.prototype, 'getKeyServers').mockResolvedValue(new Map(keys.map((row: any) => [row.objectId, row])) as any)
  let unwrapped: Uint8Array | undefined, kind: any
  const decryptSpy = vi.spyOn(SealClient.prototype, 'decrypt').mockImplementation(async args => {
    expect(args.checkShareConsistency).toBe(true)
    expect(args.sessionKey.getPackageId()).toBe(f.target.soulidityOriginalPackageId)
    expect((await args.sessionKey.getCertificate()).user).toBe(f.scope.owner)
    kind = bcs.TransactionKind.parse(args.txBytes)
    const parsed = EncryptedObject.parse(args.data), fullId = utils.createFullId(parsed.packageId, parsed.id)
    unwrapped = await decrypt.decrypt({ encryptedObject: parsed,
      keys: new Map(keys.map((row: any) => [`${fullId}:${row.objectId}`, kdf.hashToG1(fromHex(fullId))])),
      publicKeys: parsed.services.map(() => bls.G2Element.generator()), checkLEEncoding: false })
    return unwrapped!
  })
  vi.spyOn(f.client.core, 'getObject').mockImplementation(async args => {
    expect(args.objectId).toBe(f.target.soulidityOriginalPackageId)
    return { object: { version: '1' } } as any
  })
  // Use SDK's local resolver against exact three-parameter approval ABI and
  // the actual fixture's shared State reference, not a fabricated tx byte blob.
  const path = '../../web/node_modules/@mysten/sui/dist/client/core-resolver.mjs'
  const resolver = await import(path)
  vi.spyOn(f.client.core, 'resolveTransactionPlugin').mockReturnValue(resolver.coreClientResolveTransactionPlugin)
  vi.spyOn(f.client.core, 'getMoveFunction').mockImplementation(async args => {
    expect(args).toEqual({ packageId: f.target.soulidityCallablePackageId, moduleName: 'named_loadout_v1', name: 'seal_approve' })
    return { function: { parameters: [ { body: { vector: 'u8' }, reference: null },
      { body: { datatype: { package: f.target.soulidityOriginalPackageId, module: 'soul', type: 'SoulState', typeParameters: [] } }, reference: 'immutable' },
      { body: 'u64', reference: null }] } } as any
  })
  vi.spyOn(f.client.core, 'getObjects').mockImplementation(async args => {
    expect(args.objectIds).toEqual([f.scope.stateId]); const raw = f.objects.get(f.scope.stateId)
    return { objects: [{ objectId: raw.objectId, version: String(raw.version), digest: raw.digest,
      owner: { $kind: 'Shared', Shared: { initialSharedVersion: String(raw.owner.version) } } }] } as any
  })
  const content = captureNamedLoadout(await nativeEquipmentSourceFixture().readBase())
  content.capturedOwner = f.scope.owner; content.capturedOwnershipEpoch = f.scope.ownershipEpoch
  const library = preparePrivateLoadoutMutation(emptyPrivateLoadoutLibrary(f.scope), { action: 'save', scope: f.scope,
    requestId: '01'.repeat(32), expectedRevision: '0', at: '2026-09-11T00:00:00.000Z', loadoutId: '00000000-0000-0000-0000-000000000001', name: 'Private test', content,
    capture: { equipmentId: content.capturedEquipmentId, revision: content.capturedEquipmentRevision, commitment: '02'.repeat(32) } }).library
  f.head.receipts[0].capture = { equipment_id: content.capturedEquipmentId, revision: content.capturedEquipmentRevision, commitment: Array(32).fill(2) }
  const signal = new AbortController(), sign = vi.fn(async (bytes: Uint8Array) => (await wallet.signPersonalMessage(bytes)).signature)
  const walletParams = { client: f.client, getAddress: () => f.scope.owner, signal: signal.signal }
  const decryptParams = { ...walletParams, sealClient: f.client, signPersonalMessage: sign, config: f.config,
    context: { scope: f.scope, revision: '1', requestId: '01'.repeat(32), originalPackageId: f.target.soulidityOriginalPackageId } }
  const encrypt = () => encryptBrowserPrivateLoadout({ ...walletParams, library, config: f.config }, f.dependencies)
  return { ...f, wallet, walletParams, decryptParams, library, sign, signal, encrypt, getKeys, decryptSpy,
    unwrapped: () => unwrapped, kind: () => kind }
}
it('encrypts with chain policy then explicitly unlocks a paid orphan via actual SO session and approval', async () => {
  const f = await cryptoFixture(), encrypted = await f.encrypt()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
  const result = await decryptBrowserPrivateLoadoutCiphertext({ ...f.decryptParams, bytes: encrypted.ciphertext }, f.dependencies)
  expect(result.library).toEqual(f.library); expect(f.sign).toHaveBeenCalledTimes(1)
  expect(f.unwrapped()?.every(x => x === 0)).toBe(true)
  expect(f.kind().ProgrammableTransaction.commands).toMatchObject([{ MoveCall: {
    package: f.target.soulidityCallablePackageId, module: 'named_loadout_v1', function: 'seal_approve' } }])
  expect(f.kind().ProgrammableTransaction.inputs[1].Object.SharedObject.mutable).toBe(false)
  expect(f.execute).not.toHaveBeenCalled()
})
it('reads and unlocks the exact committed ciphertext without equipment or protected original', async () => {
  const f = await cryptoFixture(), encrypted = await f.encrypt(); f.setCiphertext(encrypted.ciphertext); vi.stubGlobal('fetch', f.fetcher)
  const result = await unlockBrowserPrivateLoadout({ ...f.walletParams, scope: f.scope, config: f.config,
    sealClient: f.client, signPersonalMessage: f.sign }, f.dependencies)
  expect(result.library).toEqual(f.library); expect(result.snapshot.revision).toBe('1'); expect(result.endEpoch).toBe(10)
})
it('runs capture verification before and after encryption without a personal-message prompt', async () => {
  const f = await cryptoFixture(), verifyCapture = vi.fn(async () => {})
  await encryptBrowserPrivateLoadout({ ...f.walletParams, library: f.library, config: f.config, verifyCapture }, f.dependencies)
  expect(verifyCapture).toHaveBeenCalledTimes(2); expect(f.sign).not.toHaveBeenCalled()
})
it.each(['scope','policy','head','wallet'])('rejects %s changes before a session can publish plaintext', async kind => {
  const f = await cryptoFixture(), encrypted = await f.encrypt()
  f.sign.mockImplementation(async bytes => {
    if (kind === 'scope') { f.state.ownership_epoch = '100'; f.putState() }
    if (kind === 'policy') f.edit(id(260), EquipmentSealPolicyBcs, p => { p.threshold = 1 })
    if (kind === 'head') { f.head.owner = id(999); f.putHead() }
    if (kind === 'wallet') f.scope.owner = id(999)
    return (await f.wallet.signPersonalMessage(bytes)).signature
  })
  await expect(decryptBrowserPrivateLoadoutCiphertext({ ...f.decryptParams, bytes: encrypted.ciphertext }, f.dependencies)).rejects.toThrow()
  expect(f.decryptSpy).not.toHaveBeenCalled()
})
it('rejects signature refusal without decrypting or submitting a transaction', async () => {
  const f = await cryptoFixture(), encrypted = await f.encrypt(); f.sign.mockRejectedValue(new Error('User refused'))
  await expect(decryptBrowserPrivateLoadoutCiphertext({ ...f.decryptParams, bytes: encrypted.ciphertext }, f.dependencies)).rejects.toThrow('User refused')
  expect(f.decryptSpy).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it('queries changed ownership before asking to unlock an orphan', async () => {
  const f = await cryptoFixture(), encrypted = await f.encrypt(); f.state.current_owner = id(999); f.putState()
  await expect(decryptBrowserPrivateLoadoutCiphertext({ ...f.decryptParams, bytes: encrypted.ciphertext }, f.dependencies)).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled()
})
it('preflights a malformed envelope before key-server contact or a personal-message prompt', async () => {
  const f = await cryptoFixture()
  await expect(decryptBrowserPrivateLoadoutCiphertext({ ...f.decryptParams, bytes: new Uint8Array([1,2,3]) }, f.dependencies)).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.getKeys).not.toHaveBeenCalled()
})
it('rejects the AC Release namespace as a substitute for the SO private-library namespace', async () => {
  const f = await cryptoFixture(), encrypted = await f.encrypt()
  await expect(decryptBrowserPrivateLoadoutCiphertext({ ...f.decryptParams, bytes: encrypted.ciphertext,
    context: { ...f.decryptParams.context, originalPackageId: f.target.release.originalPackageId } }, f.dependencies)).rejects.toThrow('PACKAGE_MISMATCH')
  expect(f.sign).not.toHaveBeenCalled()
})
it('permits an orphan whose revision/request are not the live head while preserving the live scope', async () => {
  const f = await cryptoFixture(), encrypted = await f.encrypt()
  f.head.receipts[0].request_id = Array(32).fill(9); f.putHead()
  expect((await decryptBrowserPrivateLoadoutCiphertext({ ...f.decryptParams, bytes: encrypted.ciphertext }, f.dependencies)).library).toEqual(f.library)
})
it.each(['epoch','blob'])('rejects storage %s change during the wallet prompt', async kind => {
  const f = await cryptoFixture(), encrypted = await f.encrypt(); f.setCiphertext(encrypted.ciphertext); vi.stubGlobal('fetch', f.fetcher)
  f.sign.mockImplementation(async bytes => {
    if (kind === 'epoch') f.system.mockResolvedValue({ committee: { epoch: 10 } } as any)
    else { f.blob.certified_epoch = 3; f.putBlob() }
    return (await f.wallet.signPersonalMessage(bytes)).signature
  })
  await expect(unlockBrowserPrivateLoadout({ ...f.walletParams, scope: f.scope, config: f.config,
    sealClient: f.client, signPersonalMessage: f.sign }, f.dependencies)).rejects.toThrow()
  expect(f.decryptSpy).not.toHaveBeenCalled()
})
it('wipes a late unwrapped DEK after an aborted real SessionKey flow', async () => {
  const f = await cryptoFixture(), encrypted = await f.encrypt(); let resolve!: (bytes: Uint8Array) => void
  f.decryptSpy.mockImplementation(() => new Promise<Uint8Array>(r => { resolve = r }))
  const pending = decryptBrowserPrivateLoadoutCiphertext({ ...f.decryptParams, bytes: encrypted.ciphertext }, f.dependencies)
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  f.signal.abort(new Error('abort unwrap')); await expect(pending).rejects.toThrow('abort unwrap')
  const key = new Uint8Array(32).fill(29); resolve(key)
  await vi.waitFor(() => expect(key.every(v => v === 0)).toBe(true))
})
it('rejects a wallet switch after the signed request and wipes the decrypted key', async () => {
  const f = await cryptoFixture(), encrypted = await f.encrypt(), original = f.decryptSpy.getMockImplementation()!
  f.decryptSpy.mockImplementation(async args => { const bytes = await original(args); f.scope.owner = id(999); return bytes })
  await expect(decryptBrowserPrivateLoadoutCiphertext({ ...f.decryptParams, bytes: encrypted.ciphertext }, f.dependencies)).rejects.toThrow('WALLET_CHANGED')
  expect(f.unwrapped()?.every(v => v === 0)).toBe(true)
})
it('snapshots library and config before asynchronous encryption authorization', async () => {
  const f = await cryptoFixture(), pending = f.encrypt()
  f.library.entries[0].name = 'mutated while awaiting'; f.config.storage.aggregatorUrl = 'https://other.example'
  const encrypted = await pending
  const decoded = await decryptBrowserPrivateLoadoutCiphertext({ ...f.decryptParams, bytes: encrypted.ciphertext }, f.dependencies)
  expect(decoded.library.entries[0].name).toBe('Private test')
})
it('uses the production real Walrus SDK default factory when no capability is injected', async () => {
  const f = browserPrivateLoadoutFixture(); vi.stubGlobal('fetch', f.fetcher)
  const reset = vi.spyOn(WalrusClient.prototype, 'reset')
  vi.spyOn(WalrusClient.prototype, 'getBlobType').mockReturnValue(f.storage.blobType)
  vi.spyOn(WalrusClient.prototype, 'systemState').mockResolvedValue({ committee: { epoch: 3 } } as any)
  const result = await readBrowserPrivateLoadout({ scope: f.scope, config: f.config }, { client: f.factory })
  expect(result.endEpoch).toBe(10); expect(reset).toHaveBeenCalledTimes(2); expect(f.walrusFactory).not.toHaveBeenCalled()
})
it('preserves raw service this, exact full masks and abort forwarding', async () => {
  const f = browserPrivateLoadoutFixture(), original = f.get.getMockImplementation()!
  f.get.mockImplementation((function(this: unknown, request: any, options: any) {
    expect(this).toBe(f.client.ledgerService); expect(options.abort).toBeInstanceOf(AbortSignal)
    expect(request.readMask.paths).toContain('package'); expect(request.readMask.paths).toContain('contents')
    return original(request, options)
  }) as any)
  expect((await readBrowserPrivateLoadoutHead({ scope: f.scope, config: f.config }, f.dependencies)).revision).toBe('1')
})
it('runs actual browser AES/Seal and raw metadata without global Buffer', async () => {
  const f = await cryptoFixture(), original = globalThis.Buffer
  try {
    globalThis.Buffer = undefined as any
    const encrypted = await f.encrypt()
    const result = await decryptBrowserPrivateLoadoutCiphertext({ ...f.decryptParams, bytes: encrypted.ciphertext }, f.dependencies)
    expect(result.library.entries[0].name).toBe('Private test')
  } finally { globalThis.Buffer = original }
})
it('a prior epoch is empty without contacting old storage or reusing old Seal authorization', async () => {
  const f = browserPrivateLoadoutFixture(); f.state.ownership_epoch = '1'; f.scope.ownershipEpoch = '1'; f.putState()
  // The stored head remains a complete, valid older epoch document.
  f.head.ownership_epoch = '0'; f.putHead(); const sign = vi.fn()
  const result = await unlockBrowserPrivateLoadout({ scope: f.scope, config: f.config, client: f.client, sealClient: f.client,
    getAddress: () => f.scope.owner, signPersonalMessage: sign, signal: new AbortController().signal }, f.dependencies)
  expect(result.snapshot.emptyReason).toBe('PRIOR_EPOCH'); expect(result.library.revision).toBe('0')
  expect(sign).not.toHaveBeenCalled(); expect(f.walrusFactory).not.toHaveBeenCalled()
})
it('checks the wallet again after the final immutable evidence reread', async () => {
  const f = await cryptoFixture(), encrypted = await f.encrypt(); f.setCiphertext(encrypted.ciphertext); vi.stubGlobal('fetch', f.fetcher)
  const original = f.batch.getMockImplementation()!
  let injected = false
  f.batch.mockImplementation((function(request: any, options: any) {
    // Root crypto has already zeroed the returned DEK, hence this is the final
    // browser readset completion after successful decryption, not preflight.
    if (f.unwrapped()?.every(v => v === 0)) { injected = true; f.scope.owner = id(999) }
    return original(request, options)
  }) as any)
  await expect(unlockBrowserPrivateLoadout({ ...f.walletParams, scope: f.scope, config: f.config,
    sealClient: f.client, signPersonalMessage: f.sign }, f.dependencies)).rejects.toThrow('WALLET_CHANGED')
  expect(injected).toBe(true)
})
it.each(['equipment','revision','commitment','missing'])('rejects decoded Save capture drift from the public receipt: %s', async kind => {
  const f = await cryptoFixture(), encrypted = await f.encrypt(); f.setCiphertext(encrypted.ciphertext)
  const capture = f.head.receipts[0].capture!
  if (kind === 'equipment') capture.equipment_id = id(999)
  if (kind === 'revision') capture.revision = '999'
  if (kind === 'commitment') capture.commitment = Array(32).fill(99)
  if (kind === 'missing') f.head.receipts[0].capture = null
  f.putHead(); vi.stubGlobal('fetch', f.fetcher)
  await expect(unlockBrowserPrivateLoadout({ ...f.walletParams, scope: f.scope, config: f.config,
    sealClient: f.client, signPersonalMessage: f.sign }, f.dependencies)).rejects.toThrow()
  expect(f.decryptSpy).toHaveBeenCalledTimes(1)
  expect(f.unwrapped()?.every(v => v === 0)).toBe(true)
})
