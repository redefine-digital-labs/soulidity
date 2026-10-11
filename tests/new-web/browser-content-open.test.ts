import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromBase64, fromHex, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { generateContentDocumentIdHex } from '@soulidity/sdk'
import { EncryptedObject, SealClient } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { buildBrowserContentApproval, fetchBrowserContentBytes, getBrowserContentSealConfig,
  openBrowserSoulContent, validateBrowserContentSealConfig } from '../../web/lib/soulidity/browser-content-open'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'
import { readBrowserContentAccess, type BrowserContentAccess } from '../../web/lib/soulidity/browser-content-access'
import { browserContentAccessFixture } from './fixtures/browser-content-access-raw'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })
/** Real Seal BLS/AES + actual SessionKey signature verification; only raw-chain
 * access transport (covered separately) and local test key transport are doubles. */
async function fixture(kind: BrowserContentAccess['accessKind'] = 'owner', empty = false) {
  const wallet = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8)), controller = new AbortController()
  let address: string | null = wallet.toSuiAddress()
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://sui.example.com' })
  vi.spyOn(client.core, 'getObject').mockResolvedValue({ object: { version: '1' } } as any)
  const chain = vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: MAINNET_GENESIS_DIGEST })
  const resolverPath = '../../web/node_modules/@mysten/sui/dist/client/core-resolver.mjs'
  const resolver = await import(resolverPath)
  vi.spyOn(client.core, 'resolveTransactionPlugin').mockReturnValue(resolver.coreClientResolveTransactionPlugin)
  const ref = (type: string, module = 'content') => ({ body: { datatype: { package: id(1), module, type, typeParameters: [] } }, reference: 'immutable' })
  vi.spyOn(client.core, 'getMoveFunction').mockImplementation(async () => ({ function: { parameters: [
    { body: { vector: 'u8' }, reference: null }, ref('SoulState', 'soul'),
    ...(kind === 'paid' ? [ref('SoulPaidAccessList', 'paid_access')] : []), ref('SoulContent'),
    ...(kind === 'granted-agent' ? [ref('SoulGrant', 'grant')] : []), { body: 'u32', reference: null },
    ref('String', 'string'), { body: 'u64', reference: null },
    ...(['paid', 'granted-agent'].includes(kind) ? [ref('Clock', 'clock')] : []),
  ] } }) as any)
  vi.spyOn(client.core, 'getObjects').mockImplementation(async args => ({ objects: args.objectIds.map(objectId => ({ objectId,
    version: '4', digest: toBase58(new Uint8Array(32).fill(3)), owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } } })) }) as any)
  const paths = ['bls12381', 'utils', 'decrypt', 'kdf'].map(n => `../../web/node_modules/@mysten/seal/dist/${n}.mjs`)
  const [bls, utils, decrypt, kdf] = await Promise.all(paths.map(p => import(p)))
  const servers = [{ objectId: id(50), weight: 1, aggregatorUrl: 'https://seal.example.com/' }]
  const keys = servers.map(s => ({ objectId: s.objectId, name: 'local', url: s.aggregatorUrl, keyType: 0, serverType: 'Independent', pk: bls.G2Element.generator().toBytes() }))
  const keyServers = vi.spyOn(SealClient.prototype, 'getKeyServers').mockResolvedValue(new Map(keys.map(k => [k.objectId, k])) as any)
  const plain = new TextEncoder().encode(empty ? '' : 'PRIVATE content fixture'), hash = toHex(sha256(plain)), dek = new Uint8Array(32).fill(9), iv = new Uint8Array(12).fill(7)
  const aes = await crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt'])
  let ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, plain))
  const documentId = generateContentDocumentIdHex({ contentObjectId: id(4), kind: 2, name: 'skill', versionIndex: 9007199254740993n, nonce: new Uint8Array(16).fill(1) })
  const material = new Uint8Array([...dek, ...fromHex(hash)])
  const seal = new SealClient({ suiClient: client, serverConfigs: servers, verifyKeyServers: true })
  const wrapped = await seal.encrypt({ threshold: 1, packageId: id(1), id: documentId, data: material }); wrapped.key.fill(0); material.fill(0)
  keyServers.mockClear()
  const access: BrowserContentAccess = { visibility: 'sealed', soulId: id(2), stateId: id(3), contentId: id(4), kind: 2,
    kindName: 'skill', name: 'skill', versionIndex: '9007199254740993', owner: kind === 'owner' ? address : id(99), ownershipEpoch: '2',
    viewerAddress: address, accessKind: kind, slot: { readModeMask: '15', opMask: '0', grantScopeMask: '4', downloadPolicy: 'public' },
    artifact: { walrusBlobUrl: 'https://walrus.example.com/v1/blobs/blob', walrusBlobId: 'blob', blobObjectId: id(8), byteLength: String(ciphertext.length), endEpoch: 10 },
    accessPolicy: { packageId: id(1), sealPackageId: id(1), callablePackageId: id(10), stateObjectId: id(3), contentObjectId: id(4),
      kind: 2, name: 'skill', versionIndex: '9007199254740993', moduleName: kind === 'paid' ? 'paid_access' : 'content',
      functionName: kind === 'owner' ? 'seal_approve_content_owner' : kind === 'paid' ? 'seal_approve_content_paid_access'
        : kind === 'public' ? 'seal_approve_content_public' : 'seal_approve_content_granted_agent',
      soulGrantObjectId: kind === 'granted-agent' ? id(6) : null, paidAccessListOnChainId: kind === 'paid' ? id(7) : null, documentIdHex: documentId },
    sealSidecar: { version: 1, mode: 'seal-envelope', cipher: 'AES-GCM-256', sealPackageId: id(1), documentId,
      encryptedDek: toBase64(wrapped.encryptedObject), iv: toBase64(iv), contentHash: hash, fileName: 'skill.zip', mimeType: 'application/zip' } }
  const recheck = vi.fn(async () => {}), read = vi.fn(async () => ({ access, recheck }))
  const sign = vi.fn(async (message: Uint8Array) => (await wallet.signPersonalMessage(message)).signature)
  let unwrapped: Uint8Array | undefined, transaction: any
  const unwrap = vi.spyOn(SealClient.prototype, 'decrypt').mockImplementation(async args => {
    expect(args.checkShareConsistency).toBe(true); expect((await args.sessionKey.getCertificate()).user).toBe(wallet.toSuiAddress())
    transaction = bcs.TransactionKind.parse(args.txBytes)
    const parsed = EncryptedObject.parse(args.data), fullId = utils.createFullId(parsed.packageId, parsed.id)
    unwrapped = await decrypt.decrypt({ encryptedObject: parsed, keys: new Map(keys.map(k => [`${fullId}:${k.objectId}`, kdf.hashToG1(fromHex(fullId))])),
      publicKeys: parsed.services.map(() => bls.G2Element.generator()), checkLEEncoding: false })
    return unwrapped!
  })
  const fetcher = vi.fn(async () => new Response(new Uint8Array(ciphertext)))
  const params = { request: { soulId: id(2), stateId: id(3), contentId: id(4), kind: 2, name: 'skill', versionIndex: access.versionIndex,
    viewerAddress: address, config: { target: { soulidityOriginalPackageId: id(1), soulidityCallablePackageId: id(10) } } as any },
    sealConfig: { threshold: 1, ttlMin: 10, serverConfigs: servers }, client, sealClient: client, signal: controller.signal,
    getAddress: () => address, signPersonalMessage: sign }
  return { access, plain, params, recheck, read, sign, unwrap, keyServers, controller, chain, wallet, fetcher,
    dependencies: { read, fetcher }, run: () => openBrowserSoulContent(params, { read, fetcher }),
    changeWallet: () => { address = id(99) }, corrupt: () => { ciphertext[0] ^= 1 }, unwrapped: () => unwrapped, transaction: () => transaction }
}

it.each(['owner', 'granted-agent', 'paid', 'public'] as const)('opens %s with real local Seal/AES and exact u64 approval', async kind => {
  const f = await fixture(kind), result = await f.run()
  expect(result.bytes).toEqual(f.plain); expect(f.sign).toHaveBeenCalledOnce(); expect(f.recheck).toHaveBeenCalledTimes(4)
  expect(f.unwrap.mock.calls[0][0].sessionKey.getPackageId()).toBe(id(1))
  expect(f.unwrapped()?.every(v => v === 0)).toBe(true)
  const tx = f.transaction().ProgrammableTransaction
  expect(tx.commands[0].MoveCall).toMatchObject({ package: id(10), module: f.access.accessPolicy.moduleName, function: f.access.accessPolicy.functionName })
  expect(tx.inputs.filter((v: any) => v.Pure).at(-1).Pure.bytes).toBe(toBase64(bcs.u64().serialize('9007199254740993').toBytes()))
  expect(f.fetcher).toHaveBeenCalledWith(f.access.artifact.walrusBlobUrl, expect.objectContaining({ credentials: 'omit', redirect: 'error' }))
})
it('decrypts valid empty content through its certified 16-byte AES-GCM tag', async () => {
  const f = await fixture('owner', true)
  expect(f.access.artifact.byteLength).toBe('16'); expect((await f.run()).bytes).toHaveLength(0)
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.unwrapped()?.every(v => v === 0)).toBe(true)
})
it('connects actual raw Soul/slot/Blob/envelope proofs through actual local Seal/AES and final readback', async () => {
  const f = await fixture(), raw = browserContentAccessFixture(), client = f.params.client
  raw.state.current_owner = f.wallet.toSuiAddress(); raw.putState()
  raw.grant.issued_by = f.wallet.toSuiAddress(); raw.putGrant()
  vi.spyOn(client.ledgerService, 'getObject').mockImplementation(raw.client.ledgerService.getObject.bind(raw.client.ledgerService))
  vi.spyOn(client.ledgerService, 'batchGetObjects').mockImplementation(raw.client.ledgerService.batchGetObjects.bind(raw.client.ledgerService))
  vi.spyOn(client.stateService, 'listDynamicFields').mockImplementation(raw.client.stateService.listDynamicFields.bind(raw.client.stateService))
  vi.spyOn(client.core, 'getDynamicField').mockImplementation(raw.client.core.getDynamicField.bind(raw.client.core))
  const doc = raw.envelope.sidecar.documentId, pkg = raw.config.target.soulidityOriginalPackageId
  const seal = new SealClient({ suiClient: client, serverConfigs: f.params.sealConfig.serverConfigs, verifyKeyServers: true })
  const wrapped = await seal.encrypt({ threshold: 1, packageId: pkg, id: doc,
    data: new Uint8Array([...new Uint8Array(32).fill(9), ...sha256(f.plain)]) })
  wrapped.key.fill(0)
  raw.envelope.sidecar = { ...f.access.sealSidecar, sealPackageId: pkg, documentId: doc, encryptedDek: toBase64(wrapped.encryptedObject) }
  raw.putEnvelope(); raw.blob.size = f.access.artifact.byteLength; raw.putBlob()
  const result = await openBrowserSoulContent({ ...f.params, request: { ...raw.params, viewerAddress: f.wallet.toSuiAddress() } }, { fetcher: f.fetcher })
  expect(result.bytes).toEqual(f.plain); expect(f.sign).toHaveBeenCalledOnce(); expect(raw.execute).not.toHaveBeenCalled()
  expect(f.unwrap.mock.calls[0][0].sessionKey.getPackageId()).toBe(pkg)
  expect(f.transaction().ProgrammableTransaction.commands[0].MoveCall).toMatchObject({ package: raw.config.target.soulidityCallablePackageId,
    module: 'content', function: 'seal_approve_content_owner' })
  expect(raw.reset.mock.calls.length).toBeGreaterThanOrEqual(5)
})
it.each(['wallet', 'chain', 'readback', 'signature'])('refuses %s change before decrypting', async mode => {
  const f = await fixture()
  f.sign.mockImplementation(async message => {
    if (mode === 'wallet') f.changeWallet()
    if (mode === 'chain') f.chain.mockResolvedValue({ chainIdentifier: 'other' })
    if (mode === 'readback') f.recheck.mockRejectedValue(new Error('ownership changed'))
    return (await (mode === 'signature' ? Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(17)) : f.wallet).signPersonalMessage(message)).signature
  })
  await expect(f.run()).rejects.toThrow(); expect(f.unwrap).not.toHaveBeenCalled()
})
it.each(['threshold', 'services', 'document', 'package', 'share-index', 'cipher'])('rejects malformed wrapped key %s before requesting a signature', async mode => {
  const f = await fixture(), p = EncryptedObject.parse(fromBase64(f.access.sealSidecar.encryptedDek))
  if (mode === 'threshold') p.threshold = 2
  if (mode === 'services') p.services[0][0] = id(77)
  if (mode === 'document') p.id = '00'
  if (mode === 'package') p.packageId = id(88)
  if (mode === 'share-index') p.services[0][1] = 0
  if (mode === 'cipher') (p as any).ciphertext = { Plain: {} }
  f.access.sealSidecar.encryptedDek = toBase64(EncryptedObject.serialize(p).toBytes())
  await expect(f.run()).rejects.toThrow(); expect(f.sign).not.toHaveBeenCalled(); expect(f.keyServers).not.toHaveBeenCalled()
})
it('rejects modified ciphertext and wipes the decrypted key', async () => {
  const f = await fixture(); f.corrupt(); await expect(f.run()).rejects.toThrow(); expect(f.unwrapped()?.every(v => v === 0)).toBe(true)
})
it('keeps final plaintext private if the last readback fails', async () => {
  const f = await fixture(); f.recheck.mockImplementation(async () => { if (f.unwrap.mock.calls.length) throw new Error('Content revoked') })
  await expect(f.run()).rejects.toThrow('Content revoked'); expect(f.unwrapped()?.every(v => v === 0)).toBe(true)
})
it('clears late decrypted key material after cancellation', async () => {
  const f = await fixture(); let resolve!: (bytes: Uint8Array) => void
  f.unwrap.mockImplementation(() => new Promise(r => { resolve = r }))
  const pending = f.run(), observed = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(f.unwrap).toHaveBeenCalledOnce()); f.controller.abort(); await observed
  const key = new Uint8Array(64).fill(3); resolve(key); await Promise.resolve(); await Promise.resolve()
  expect(key.every(v => v === 0)).toBe(true)
})
it.each(['refused', 'no-wallet'])('does not silently continue after %s', async mode => {
  const f = await fixture(); if (mode === 'refused') f.sign.mockRejectedValue(new Error('Refused')); else f.changeWallet()
  await expect(f.run()).rejects.toThrow(); expect(f.unwrap).not.toHaveBeenCalled()
})
it.each(['secret', 'http', 'query', 'duplicate', 'weight', 'threshold', 'ttl'])('rejects unsafe public Seal config %s', mode => {
  const c: any = { threshold: 1, ttlMin: 10, serverConfigs: [{ objectId: id(50), weight: 1, aggregatorUrl: 'https://seal.example.com' }] }
  if (mode === 'secret') c.serverConfigs[0].apiKey = 'private'
  if (mode === 'http') c.serverConfigs[0].aggregatorUrl = 'http://seal.example.com'
  if (mode === 'query') c.serverConfigs[0].aggregatorUrl += '?key=private'
  if (mode === 'duplicate') c.serverConfigs.push({ ...c.serverConfigs[0] })
  if (mode === 'weight') c.serverConfigs[0].weight = 0
  if (mode === 'threshold') c.threshold = 2
  if (mode === 'ttl') c.ttlMin = 31
  expect(() => validateBrowserContentSealConfig(c)).toThrow()
})
it('does not use testnet/default/private Seal configuration or disable verification', () => {
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'testnet'); expect(() => getBrowserContentSealConfig()).toThrow()
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet'); vi.stubEnv('NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS', 'false')
  expect(() => getBrowserContentSealConfig()).toThrow()
})
it.each(['length', 'oversize', 'truncated', 'status'])('bounds storage transport: %s', async mode => {
  const f = await fixture(), size = Number(f.access.artifact.byteLength)
  const response = new Response(new Uint8Array(mode === 'oversize' ? size + 1 : mode === 'truncated' ? size - 1 : size),
    { status: mode === 'status' ? 500 : 200, headers: mode === 'length' ? { 'content-length': '2' } : {} })
  await expect(fetchBrowserContentBytes(f.access, f.controller.signal, vi.fn(async () => response))).rejects.toThrow()
})
it('rejects mismatched approval objects rather than fabricating an owner call', async () => {
  const f = await fixture(); f.access.accessPolicy.contentObjectId = id(66)
  expect(() => buildBrowserContentApproval(f.access)).toThrow()
})
