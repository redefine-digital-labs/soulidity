import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { singleUploadFixture, uid } from './fixtures/walrus-single-upload'
import { readWalrusSingleRecord, walrusSingleKey, writeWalrusSingleRecord } from '../../web/lib/upload/walrus-single-operation'
import { sha256Hex } from '../../web/lib/upload/client-seal'
import { buildWalrusUploadPlan, type WalrusUploadQuote } from '../../packages/soulidity-sdk/src/walrus-quote'
import { validatePrivateBookmarkUploadConfig, getBrowserPrivateBookmarkUploadConfig, uploadPrivateBookmarkCiphertext,
  recoverPrivateBookmarkStorage, queryPrivateBookmarkStorageRecord, acknowledgeWalrusSingleBlobUpload } from '../../web/lib/bookmarks/private-bookmark-storage'

const boundary = vi.hoisted(() => ({ active: null as any, created: [] as any[] }))
// Constructor/config is the boundary. The returned fixture still executes the
// real pinned Walrus flow, immutable Sui packets, signatures and recovery engine.
vi.mock('../../web/node_modules/@mysten/walrus/dist/index.mjs', async importOriginal => {
  const actual = await importOriginal<any>()
  return { ...actual, WalrusClient: class {
    constructor(options: any) {
      if (!boundary.active) return new actual.WalrusClient(options)
      boundary.created.push(options)
      const f = boundary.active
      f.client.cache.scope('@mysten/walrus').readSync(['upload-relay-tip-config'], () => ({ address: uid(200), kind: { const: 1n }, max: 1 }))
      return f.walrus
    }
  } }
})

beforeEach(() => {
  boundary.active = null; boundary.created = []
  const map = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value) } })
  vi.stubGlobal('navigator', { locks: { request: async (_key: string, _opts: unknown, work: (lock: object) => unknown) => work({}) } })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network') }))
})
afterEach(() => { boundary.active = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

const config = () => ({ network: 'mainnet' as const, relayUrl: 'https://upload-relay.mainnet.walrus.space',
  wasmUrl: '/walrus/walrus_wasm@0.3.5.wasm', storageEpochs: 3 })
async function fixture() {
  const f = await singleUploadFixture(null, true)
  // Only encrypted envelope bytes are handed to the adapter. No private file
  // names or decoded library object are arguments at this boundary.
  f.payload.fill(17)
  const currentState = await f.walrus.systemState()
  vi.mocked(f.walrus.systemState).mockResolvedValue({ ...currentState, future_accounting: { length: 26 } } as any)
  boundary.active = f
  const operationScope = `private-bookmark:35834a8a:${uid(1)}:${uid(2)}:${f.intent.owner}:${'ab'.repeat(32)}`
  const uploadConfig = config(), confirmQuote = vi.fn(async (_quote: WalrusUploadQuote) => true), verify = vi.fn(async () => {})
  const input = { bytes: f.payload, owner: f.intent.owner, operationScope, config: uploadConfig, execution: f.execution, confirmQuote, verify }
  const key = walrusSingleKey({ network: 'mainnet', owner: input.owner, operationScope })
  return { ...f, input, key, confirmQuote, verify, uploadConfig, operationScope,
    run: () => uploadPrivateBookmarkCiphertext(input), recover: () => recoverPrivateBookmarkStorage(input) }
}

it('requires explicit mainnet/relay and uses only pinned public WASM configuration', () => {
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet')
  vi.stubEnv('NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL', config().relayUrl)
  vi.stubEnv('NEXT_PUBLIC_WALRUS_WASM_VERSION', '0.3.5')
  vi.stubEnv('NEXT_PUBLIC_WALRUS_WASM_URL', '')
  expect(getBrowserPrivateBookmarkUploadConfig()).toEqual({ ...config(), storageEpochs: 26 })
  expect(Object.isFrozen(getBrowserPrivateBookmarkUploadConfig())).toBe(true)
  vi.stubEnv('NEXT_PUBLIC_WALRUS_WASM_URL', 'https://assets.example.com/pinned.wasm')
  expect(getBrowserPrivateBookmarkUploadConfig(5).wasmUrl).toBe('https://assets.example.com/pinned.wasm')
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', '')
  awaitRejectSync(() => getBrowserPrivateBookmarkUploadConfig(), 'MAINNET_REQUIRED')
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet'); vi.stubEnv('NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL', '')
  awaitRejectSync(() => getBrowserPrivateBookmarkUploadConfig(), 'RELAY_REQUIRED')
})
function awaitRejectSync(work: () => unknown, code: string) { expect(work).toThrow(code) }

it.each([
  { network: 'testnet' }, { storageEpochs: 0 }, { storageEpochs: -1 }, { storageEpochs: 0x1_0000_0000 }, { storageEpochs: 1.5 },
  { relayUrl: 'http://relay.example.com' }, { relayUrl: 'https://user:secret@relay.example.com' },
  { relayUrl: 'https://relay.example.com?apiKey=secret' }, { relayUrl: 'https://relay.example.com#secret' },
  { wasmUrl: '//cdn.example.com/asset.wasm' }, { wasmUrl: '/walrus/latest.wasm' },
  { wasmUrl: '/walrus/walrus_wasm@../../secret.wasm' }, { wasmUrl: 'https://assets.example.com/a.wasm?token=secret' },
  { token: 'secret' },
])('rejects unsafe or ambiguous public config %j', changed => {
  expect(() => validatePrivateBookmarkUploadConfig({ ...config(), ...changed } as any)).toThrow()
})

it('does not fall back to missing/malformed installed WASM version or private environment', () => {
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet'); vi.stubEnv('NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL', config().relayUrl)
  vi.stubEnv('NEXT_PUBLIC_WALRUS_WASM_URL', ''); vi.stubEnv('NEXT_PUBLIC_WALRUS_WASM_VERSION', '')
  vi.stubEnv('WALRUS_WASM_URL', 'https://private.example.com/secret')
  expect(() => getBrowserPrivateBookmarkUploadConfig()).toThrow('PINNED_WASM_REQUIRED')
  vi.stubEnv('NEXT_PUBLIC_WALRUS_WASM_VERSION', 'latest')
  expect(() => getBrowserPrivateBookmarkUploadConfig()).toThrow('PINNED_WASM_REQUIRED')
})

it('runs the real two-packet paid engine with only ciphertext hashes and no CAS attachment', async () => {
  const f = await fixture(), result = await f.run(), record = readWalrusSingleRecord(f.key)!
  expect(f.sign).toHaveBeenCalledTimes(2); expect(f.verify).toHaveBeenCalledTimes(3)
  expect(f.verify.mock.calls).toEqual([[false], [true], [true]])
  expect(record.intent.contentHash).toBe(await sha256Hex(f.payload))
  expect(record.intent.payloadHash).toBe(record.intent.contentHash)
  expect(record.intent.attachmentScope).toBeNull()
  expect(record.intent.operationScope).toBe(f.operationScope)
  expect(JSON.stringify(record)).not.toMatch(/Public profile|plaintext|dekBase64|privateKey|AES|rename|delete/)
  const certify = Transaction.from(fromBase64(record.certify!.bytes)).getData()
  expect(certify.commands.filter(command => command.MoveCall).map(command => command.MoveCall!.function)).toEqual(['certify_blob'])
  expect(result.blobId).toBe(f.blobId); expect(result.blobObjectId).toBe(f.blobObjectId)
  expect(boundary.created).toHaveLength(2)
  expect(boundary.created[0]).toEqual({ suiClient: f.client, network: 'mainnet', wasmUrl: f.uploadConfig.wasmUrl,
    uploadRelay: { host: f.uploadConfig.relayUrl, sendTip: { max: Number.MAX_SAFE_INTEGER } } })
  expect(boundary.created[1].uploadRelay.sendTip.max).toBe(1)
  const quote = f.confirmQuote.mock.calls[0][0] as any
  expect(quote).toMatchObject({ walletSignatureCount: 2, transactionCount: 2, gasBudgetMist: 100_000_000n,
    items: [{ label: 'Private encrypted library', payloadBytes: f.payload.length }] })
  const plan = buildWalrusUploadPlan({ files: [{ name: 'Private encrypted library', size: f.payload.length, encryptedSize: f.payload.length }],
    network: 'mainnet', relayUrl: f.uploadConfig.relayUrl, storageEpochs: 3, chunking: false, walletSignatureCount: 2 })
  expect(quote.id).toBe(plan.fingerprint); expect(record.approved?.quoteId).toBe(quote.id)
  expect(Object.isFrozen(quote)).toBe(true); expect(Object.isFrozen(quote.items[0])).toBe(true)
  expect(f.payload.every(value => value === 17)).toBe(true)
})

it('captures ciphertext/config/callbacks and same client before asynchronous work', async () => {
  const f = await fixture(), original = new Uint8Array(f.payload), relay = f.uploadConfig.relayUrl
  // The fixture chain's downloaded bytes are separately frozen so mutating the
  // caller buffer cannot alter simulated storage proof.
  f.read.mockImplementation(async () => original)
  const pending = f.run()
  f.payload.fill(22); f.uploadConfig.relayUrl = 'https://wrong.example.com'; f.uploadConfig.wasmUrl = 'https://wrong.example.com/a.wasm'
  f.input.verify = vi.fn(async () => { throw new Error('mutated callback') })
  await pending
  expect(readWalrusSingleRecord(f.key)?.intent.payloadHash).toBe(await sha256Hex(original))
  expect(boundary.created.every(value => value.suiClient === f.client && value.uploadRelay.host === relay
    && value.wasmUrl === config().wasmUrl)).toBe(true)
  expect(f.input.verify).not.toHaveBeenCalled()
})

it('declined or expired cost quote cannot register, certify or sign', async () => {
  const f = await fixture(); f.confirmQuote.mockResolvedValue(false)
  await expect(f.run()).rejects.toThrow('QUOTE_REJECTED')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  expect(readWalrusSingleRecord(f.key)).toBeNull()
  f.confirmQuote.mockImplementation(async () => { vi.spyOn(Date, 'now').mockReturnValue(500000); return true })
  const now = vi.spyOn(Date, 'now').mockReturnValue(1)
  await expect(f.run()).rejects.toThrow('QUOTE_EXPIRED')
  now.mockRestore(); expect(f.sign).not.toHaveBeenCalled()
})

it('checks the current accounting horizon before quoting an unsupported storage period', async () => {
  const f = await fixture(); f.uploadConfig.storageEpochs = 27
  await expect(f.run()).rejects.toThrow('CURRENT_EPOCH_LIMIT_EXCEEDED')
  expect(f.confirmQuote).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
})

it('propagates actual storageCost failure without quoting or paying', async () => {
  const f = await fixture()
  vi.mocked(f.walrus.storageCost).mockRejectedValue(new Error('current storage price unavailable'))
  await expect(f.run()).rejects.toThrow('current storage price unavailable')
  expect(f.walrus.storageCost).toHaveBeenCalledWith(f.payload.length, 3)
  expect(f.confirmQuote).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
})

it('rechecks the current scope before each new wallet signature', async () => {
  const f = await fixture()
  f.verify.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('epoch changed'))
  await expect(f.run()).rejects.toThrow('epoch changed')
  expect(f.sign).toHaveBeenCalledTimes(1)
  const record = readWalrusSingleRecord(f.key)!
  expect(record.register?.phase).toBe('SUCCEEDED'); expect(record.certify?.phase).toBe('SIGNING')
})

it('preserves paid registration across relay failure and resumes without repeating registration or quote', async () => {
  const f = await fixture(); f.relayWrite.mockRejectedValueOnce(new Error('relay unavailable'))
  await expect(f.run()).rejects.toThrow('relay unavailable')
  const registered = readWalrusSingleRecord(f.key)!.register!
  expect(registered.phase).toBe('SUCCEEDED'); expect(f.sign).toHaveBeenCalledTimes(1)
  expect((await f.recover()).status).toBe('SOURCE_REQUIRED')
  expect(f.sign).toHaveBeenCalledTimes(1)
  const result = await f.run()
  expect(result.storageTxDigest).toBe(registered.digest)
  expect(f.sign).toHaveBeenCalledTimes(2); expect(f.confirmQuote).toHaveBeenCalledTimes(1)
})

it('recovers an already certified packet without signing, reuploading or repeating payment', async () => {
  const f = await fixture(), original = await f.run()
  f.setOwner(null); f.verify.mockRejectedValue(new Error('no signing allowed'))
  const recovered = await f.recover()
  expect(recovered.status).toBe('CERTIFIED')
  if (recovered.status === 'CERTIFIED') expect(recovered.result).toEqual(original)
  expect(f.sign).toHaveBeenCalledTimes(2); expect(f.relayWrite).toHaveBeenCalledTimes(1)
  await acknowledgeWalrusSingleBlobUpload({ recoveryKey: f.key, certifyDigest: original.certifyTxDigest })
  expect(readWalrusSingleRecord(f.key)?.acknowledged).toBe(true)
  expect((await f.recover()).status).toBe('CERTIFIED')
})

it('keeps final paid receipts recoverable after a post-certification read fails', async () => {
  const f = await fixture(); f.client.core.getTransaction.mockRejectedValueOnce(new Error('read unavailable'))
  await expect(f.run()).rejects.toThrow('read unavailable')
  expect(readWalrusSingleRecord(f.key)?.certify?.phase).toBe('SUCCEEDED')
  expect((await f.recover()).status).toBe('CERTIFIED')
  expect(f.sign).toHaveBeenCalledTimes(2)
})

it.each(['relay', 'epochs', 'attachment', 'plaintext-hash', 'recipient'] as const)('rejects mismatched recovery %s', async problem => {
  const f = await fixture(); await f.run()
  const record = readWalrusSingleRecord(f.key)!
  if (problem === 'relay') record.intent.relayUrl = 'https://different.example.com'
  if (problem === 'epochs') record.intent.storageEpochs = 4
  if (problem === 'attachment') record.intent.attachmentScope = 'private-action'
  if (problem === 'plaintext-hash') record.intent.contentHash = 'bb'.repeat(32)
  if (problem === 'recipient') record.intent.recipient = uid(99)
  writeWalrusSingleRecord(f.key, record)
  await expect(f.recover()).rejects.toThrow('RECOVERY_')
  expect(f.sign).toHaveBeenCalledTimes(2)
})

it('does not silently replace changed ciphertext in the same unacknowledged operation', async () => {
  const f = await fixture(); f.relayWrite.mockRejectedValueOnce(new Error('relay unavailable'))
  await expect(f.run()).rejects.toThrow('relay unavailable')
  f.input.bytes = new Uint8Array(f.payload).fill(23)
  await expect(f.run()).rejects.toThrow('DIFFERENT_INTENT_QUERY_EXISTING_OPERATION')
  expect(f.sign).toHaveBeenCalledTimes(1)
})

it('rejects private names/actions in operation scope and invalid ciphertext before quote/payment', async () => {
  const f = await fixture()
  await expect(uploadPrivateBookmarkCiphertext({ ...f.input, operationScope: 'private-bookmark:rename:Secret name' })).rejects.toThrow('SCOPE_INVALID')
  await expect(uploadPrivateBookmarkCiphertext({ ...f.input, bytes: new Uint8Array() })).rejects.toThrow('CIPHERTEXT_BUDGET')
  expect(f.confirmQuote).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
})

it.each(['upload', 'recover', 'imported-query'] as const)('rejects non-mainnet and mismatched scope owner in %s before WAL/client/payment', async method => {
  const f = await fixture()
  const invoke = (input: any) => method === 'upload' ? uploadPrivateBookmarkCiphertext(input)
    : method === 'recover' ? recoverPrivateBookmarkStorage(input) : queryPrivateBookmarkStorageRecord({ ...input, record: {} as any })
  await expect(invoke({ ...f.input, operationScope: f.operationScope.replace(':35834a8a:', ':4c78adac:') })).rejects.toThrow('CHAIN_INVALID')
  await expect(invoke({ ...f.input, owner: uid(99) })).rejects.toThrow('OWNER_MISMATCH')
  expect(boundary.created).toHaveLength(0)
  expect(f.confirmQuote).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
  expect(readWalrusSingleRecord(f.key)).toBeNull()
})

it.each(['extra-soul-id', 'old-loadout-scope', 'private-action', 'extra-owner', 'zero-request', 'missing-registry'] as const)(
  'rejects leaking or ambiguous operation scope %s before payment', async problem => {
    const f = await fixture(), fields = f.operationScope.split(':'), soulId = uid(8800)
    if (problem === 'extra-soul-id') fields.push(soulId)
    if (problem === 'old-loadout-scope') fields[0] = 'private-loadout'
    if (problem === 'private-action') fields[5] = 'add-bookmark-Secret-Soul'
    if (problem === 'extra-owner') fields.push(f.input.owner)
    if (problem === 'zero-request') fields[5] = '00'.repeat(32)
    if (problem === 'missing-registry') fields.splice(3, 1)
    await expect(uploadPrivateBookmarkCiphertext({ ...f.input, operationScope: fields.join(':') })).rejects.toThrow()
    expect(f.confirmQuote).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
    expect(boundary.created).toHaveLength(0); expect(readWalrusSingleRecord(f.key)).toBeNull()
  })

it('stores only original package/registry/owner/random request scope and ciphertext commitments, not a bookmarked Soul', async () => {
  const f = await fixture(), secretSoulId = uid(8800), secretName = 'My private bookmarked Soul'
  const before = new Uint8Array(f.payload)
  await uploadPrivateBookmarkCiphertext({ ...f.input, soulId: secretSoulId, privateName: secretName } as any)
  const record = readWalrusSingleRecord(f.key)!
  expect(record.intent.operationScope?.split(':')).toEqual(['private-bookmark', '35834a8a', uid(1), uid(2), f.input.owner, 'ab'.repeat(32)])
  expect(record.intent.contentHash).toBe(await sha256Hex(before))
  expect(record.intent.payloadHash).toBe(record.intent.contentHash)
  expect(JSON.stringify(record)).not.toContain(secretSoulId)
  expect(JSON.stringify(record)).not.toContain(secretName)
  expect(record.intent.attachmentScope).toBeNull()
  expect(f.confirmQuote.mock.calls[0][0].items[0].label).toBe('Private encrypted library')
})

it('refuses an active-wallet mismatch before price approval despite an otherwise valid saved scope', async () => {
  const f = await fixture(); f.setOwner(uid(99))
  await expect(f.run()).rejects.toThrow('WALLET_CHANGED')
  expect(f.confirmQuote).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})

function noLocalWal() {
  const get = vi.fn(() => { throw Error('Unexpected local WAL read') }), set = vi.fn(() => { throw Error('Unexpected local WAL write') })
  vi.stubGlobal('window', { localStorage: { getItem: get, setItem: set } })
  vi.stubGlobal('navigator', { locks: { request: () => { throw Error('Unexpected local WAL lock') } } })
  return { get, set }
}
it('queries imported paid ciphertext with the real Walrus flow and no local WAL or connected owner', async () => {
  const f = await fixture(), original = await f.run(), record = readWalrusSingleRecord(f.key)!
  const before = structuredClone(record); f.setOwner(null); const storage = noLocalWal()
  f.sign.mockClear(); f.relayWrite.mockClear(); f.confirmQuote.mockClear(); f.verify.mockClear(); f.client.core.executeTransaction.mockClear()
  const result = await queryPrivateBookmarkStorageRecord({ ...f.input, record })
  expect(result.status).toBe('CERTIFIED'); expect(result.recoveryKey).toBe(f.key)
  if (result.status === 'CERTIFIED') expect(result.result).toEqual(original)
  expect(record).toEqual(before); expect(storage.get).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.relayWrite).not.toHaveBeenCalled(); expect(f.confirmQuote).not.toHaveBeenCalled()
  expect(f.verify).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
it.each(['relay', 'epochs', 'attachment', 'plaintext-hash', 'recipient', 'owner', 'scope'] as const)('rejects imported WAL %s mismatch without local journal access or payment', async problem => {
  const f = await fixture(); await f.run(); const record = readWalrusSingleRecord(f.key)!
  if (problem === 'relay') record.intent.relayUrl = 'https://different.example.com'
  if (problem === 'epochs') record.intent.storageEpochs = 4
  if (problem === 'attachment') record.intent.attachmentScope = 'private-action'
  if (problem === 'plaintext-hash') record.intent.contentHash = 'bb'.repeat(32)
  if (problem === 'recipient') record.intent.recipient = uid(99)
  const input = { ...f.input, record, ...(problem === 'owner' ? { owner: uid(99) } : {}),
    ...(problem === 'scope' ? { operationScope: f.operationScope.replace(uid(2), uid(3)) } : {}) }
  const storage = noLocalWal(); f.sign.mockClear(); f.relayWrite.mockClear()
  await expect(queryPrivateBookmarkStorageRecord(input)).rejects.toThrow(problem === 'owner' ? 'OWNER_MISMATCH' : 'RECOVERY_')
  expect(storage.get).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.relayWrite).not.toHaveBeenCalled()
})
it.each(['unknown', 'bytes', 'expiry'])('does not mistake imported %s evidence for usable paid ciphertext', async issue => {
  const f = await fixture(); await f.run(); const record = readWalrusSingleRecord(f.key)!
  if (issue === 'unknown') f.records.delete(record.certify!.digest)
  if (issue === 'bytes') f.read.mockResolvedValue(new Uint8Array(f.payload.length).fill(99))
  if (issue === 'expiry') f.setStorageEnd(9)
  const storage = noLocalWal(); f.sign.mockClear(); f.relayWrite.mockClear()
  const query = queryPrivateBookmarkStorageRecord({ ...f.input, record })
  if (issue === 'unknown') expect((await query).status).toBe('UNKNOWN')
  else await expect(query).rejects.toThrow(issue === 'bytes' ? 'RECOVERED_BYTES_MISMATCH' : 'NOT_CURRENTLY_CERTIFIED')
  expect(storage.get).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.relayWrite).not.toHaveBeenCalled()
})
it('freezes imported record, public config, scope, owner, and execution references before query awaits', async () => {
  const f = await fixture(), original = await f.run(), record = readWalrusSingleRecord(f.key)!
  const input = { ...f.input, record, config: { ...f.input.config }, execution: { ...f.execution } }
  noLocalWal(); f.sign.mockClear(); f.relayWrite.mockClear()
  const query = queryPrivateBookmarkStorageRecord(input)
  input.owner = uid(99); input.operationScope = 'mutated'; input.config.relayUrl = 'https://changed.example.com'
  input.record.intent.payloadHash = 'ff'.repeat(32); input.record.certify!.bytes = 'corrupt'
  input.execution.client = {} as any; input.execution.getAddress = () => { throw Error('No wallet access') }
  const result = await query
  expect(result.status).toBe('CERTIFIED'); if (result.status === 'CERTIFIED') expect(result.result).toEqual(original)
  expect(boundary.created.at(-1).uploadRelay.host).toBe(config().relayUrl)
  expect(f.sign).not.toHaveBeenCalled(); expect(f.relayWrite).not.toHaveBeenCalled()
})
