import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { singleUploadFixture, uid } from './fixtures/walrus-single-upload'
import { readWalrusSingleRecord, writeWalrusSingleRecord } from '../../web/lib/upload/walrus-single-operation'
import { acknowledgeWalrusSingleBlobUpload, recoverDurableWalrusBlob, queryDurableWalrusBlobRecord, uploadDurableWalrusBlob } from '../../web/lib/upload/walrus-single-upload'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
beforeEach(() => {
  const map = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value) } })
  vi.stubGlobal('navigator', { locks: { request: async (_key: string, _opts: unknown, fn: (lock: object) => unknown) => fn({}) } })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network') }))
})
afterEach(() => vi.unstubAllGlobals())
it('executes real Walrus SDK registration/certification graphs with durable exact packets and full receipt', async () => {
  const f = await singleUploadFixture(); const result = await f.run()
  expect(result.blobObjectId).toBe(f.blobObjectId); expect(result.certifyTxResult.events).toHaveLength(1)
  expect(f.sign).toHaveBeenCalledTimes(2); expect(f.approve).toHaveBeenCalledOnce()
  const saved = readWalrusSingleRecord(f.key)!
  const register = Transaction.from(fromBase64(saved.register!.bytes)).getData()
  expect(register.commands.filter(c => c.MoveCall).map(c => c.MoveCall!.function)).toEqual(['reserve_space', 'destroy_zero', 'register_blob', 'destroy_zero'])
  expect(Transaction.from(fromBase64(saved.certify!.bytes)).getData().commands[0].MoveCall?.function).toBe('certify_blob')
  expect(saved.acknowledged).toBe(false); expect(saved.certify?.phase).toBe('SUCCEEDED')
  expect(JSON.stringify(saved)).not.toMatch(/privateKey|dekBase64|ivBase64/)
  expect(fetch).not.toHaveBeenCalled()
})
it('preserves registration on relay failure and resumes real flow without register/sign/approval again', async () => {
  const f = await singleUploadFixture(); f.write.mockRejectedValueOnce(new Error('relay failed'))
  await expect(f.run()).rejects.toThrow('relay failed')
  const prior = readWalrusSingleRecord(f.key)!.register!
  expect(prior.phase).toBe('SUCCEEDED'); expect(f.sign).toHaveBeenCalledOnce()
  const result = await f.run()
  expect(result.storageTxDigest).toBe(prior.digest); expect(f.sign).toHaveBeenCalledTimes(2); expect(f.approve).toHaveBeenCalledOnce()
})
it('attachment is part of the certified exact graph and cannot be changed on recovery', async () => {
  const attachment = { scope: 'soul-content:target:version1', append: (tx: Transaction, blob: string) => { tx.moveCall({ target: '0x7::content::append', arguments: [tx.object(blob), tx.pure.u64(1)] }) } }
  const f = await singleUploadFixture(attachment); await f.run()
  attachment.append = (tx, blob) => { tx.moveCall({ target: '0x7::content::append', arguments: [tx.object(blob), tx.pure.u64(2)] }) }
  await expect(f.recover()).rejects.toThrow('ATTACHMENT_TEMPLATE_MISMATCH')
  expect(f.sign).toHaveBeenCalledTimes(2)
})
it('a certified public pointer recovers without original File or wallet and verifies actual public bytes', async () => {
  const f = await singleUploadFixture(); const original = await f.run(); f.setOwner(null)
  const recovered = await f.recover()
  expect(recovered.status).toBe('CERTIFIED')
  if (recovered.status === 'CERTIFIED') expect(recovered.result).toEqual(original)
  expect(f.read).toHaveBeenCalledOnce(); expect(f.sign).toHaveBeenCalledTimes(2); expect(f.write).toHaveBeenCalledOnce()
})
it('retains final pointer until explicit exact downstream receipt acknowledgment and afterward', async () => {
  const f = await singleUploadFixture(); const result = await f.run()
  await expect(acknowledgeWalrusSingleBlobUpload({ recoveryKey: f.key, certifyDigest: result.storageTxDigest })).rejects.toThrow('ACK_RECEIPT_MISMATCH')
  expect(readWalrusSingleRecord(f.key)?.acknowledged).toBe(false)
  await acknowledgeWalrusSingleBlobUpload({ recoveryKey: f.key, certifyDigest: result.certifyTxDigest })
  expect(readWalrusSingleRecord(f.key)?.acknowledged).toBe(true)
  expect(readWalrusSingleRecord(f.key)?.certify?.bytes).toBeTruthy()
  expect((await f.recover()).status).toBe('CERTIFIED')
})
it('a post-certify receipt callback/read failure cannot lose the final pointer or re-sign', async () => {
  const f = await singleUploadFixture(); f.client.core.getTransaction.mockRejectedValueOnce(new Error('receipt read unavailable'))
  await expect(f.run()).rejects.toThrow('receipt read unavailable')
  expect(readWalrusSingleRecord(f.key)?.certify?.phase).toBe('SUCCEEDED')
  expect((await f.recover()).status).toBe('CERTIFIED'); expect(f.sign).toHaveBeenCalledTimes(2)
})
it('a corrupt read-back payload cannot be presented as recovered profile metadata', async () => {
  const f = await singleUploadFixture(); await f.run(); f.read.mockResolvedValue(new Uint8Array(f.payload.length).fill(1))
  await expect(f.recover()).rejects.toThrow('RECOVERED_BYTES_MISMATCH')
  expect(readWalrusSingleRecord(f.key)?.certify?.phase).toBe('SUCCEEDED')
})
it('expired blob remains recorded but is not offered as a usable pointer', async () => {
  const f = await singleUploadFixture(); await f.run(); f.setStorageEnd(9)
  await expect(f.recover()).rejects.toThrow('NOT_CURRENTLY_CERTIFIED')
  expect(f.sign).toHaveBeenCalledTimes(2)
})
it('does not trust registered Blob recipient from a matching self-reported intent', async () => {
  const f = await singleUploadFixture(); f.setRegisterOwner(uid(999))
  await expect(f.run()).rejects.toThrow('REGISTER_RECIPIENT_MISMATCH'); expect(f.write).not.toHaveBeenCalled()
})
it('changed bytes in same unacknowledged scope cannot start another paid registration', async () => {
  const f = await singleUploadFixture(); f.write.mockRejectedValueOnce(new Error('relay failed'))
  await expect(f.run()).rejects.toThrow('relay failed')
  const modified = { ...f, intent: { ...f.intent, contentHash: 'b'.repeat(64) } }
  await expect(uploadDurableWalrusBlob(modified)).rejects.toThrow('DIFFERENT_INTENT_QUERY_EXISTING')
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.approve).toHaveBeenCalledOnce()
})
it('missing original source after register returns SOURCE_REQUIRED without uploading or signing', async () => {
  const f = await singleUploadFixture(); f.write.mockRejectedValueOnce(new Error('relay failed'))
  await expect(f.run()).rejects.toThrow('relay failed')
  expect((await f.recover()).status).toBe('SOURCE_REQUIRED')
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.write).toHaveBeenCalledOnce()
})
it('unknown registration reads the original packet but cannot start certification in no-file recovery', async () => {
  const f = await singleUploadFixture(); f.client.core.executeTransaction.mockRejectedValueOnce(new Error('broadcast unknown'))
  await expect(f.run()).rejects.toThrow('broadcast unknown')
  expect((await f.recover()).status).toBe('UNKNOWN'); expect(f.write).not.toHaveBeenCalled(); expect(f.sign).toHaveBeenCalledOnce()
})
it('attachment scope mismatch fails before approval or any transaction', async () => {
  const f = await singleUploadFixture()
  await expect(uploadDurableWalrusBlob({ ...f, attachment: { scope: 'other', append: () => {} } })).rejects.toThrow('ATTACHMENT_SCOPE_MISMATCH')
  expect(f.approve).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
})
it('storage price increase cannot silently exceed the retained approved quote', async () => {
  const f = await singleUploadFixture(); vi.mocked(f.walrus.storageCost).mockResolvedValue({ storageCost: 4n, writeCost: 2n, totalCost: 6n })
  await expect(f.run()).rejects.toThrow('APPROVED_STORAGE_COST_EXCEEDED'); expect(f.sign).not.toHaveBeenCalled()
})
it('no record read returns NONE, not a new upload', async () => {
  const f = await singleUploadFixture(); expect((await f.recover()).status).toBe('NONE')
  expect(f.approve).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
})
it('ACK alone cannot replace an unconfirmed paid result, even when journal flags claim success', async () => {
  const f = await singleUploadFixture(); const result = await f.run()
  await acknowledgeWalrusSingleBlobUpload({ recoveryKey: f.key, certifyDigest: result.certifyTxDigest })
  f.records.delete(result.certifyTxDigest)
  await expect(uploadDurableWalrusBlob({ ...f, intent: { ...f.intent, contentHash: 'b'.repeat(64) } })).rejects.toThrow('ACKNOWLEDGED_RESULT_UNCONFIRMED')
  expect(readWalrusSingleRecord(f.key)?.certify?.digest).toBe(result.certifyTxDigest)
  expect(f.sign).toHaveBeenCalledTimes(2)
})
it('an archive storage failure preserves the acknowledged pointer and prevents new payment', async () => {
  const f = await singleUploadFixture(); const result = await f.run()
  await acknowledgeWalrusSingleBlobUpload({ recoveryKey: f.key, certifyDigest: result.certifyTxDigest })
  const set = window.localStorage.setItem.bind(window.localStorage)
  vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
    if (key.includes(':receipt:')) throw new Error('archive quota')
    set(key, value)
  })
  await expect(uploadDurableWalrusBlob({ ...f, intent: { ...f.intent, contentHash: 'b'.repeat(64) } })).rejects.toThrow('archive quota')
  expect(readWalrusSingleRecord(f.key)?.certify?.digest).toBe(result.certifyTxDigest)
  expect(f.sign).toHaveBeenCalledTimes(2)
})
it('production relay SDK preserves nonce/auth payload/tip and rebroadcasts only the missing original bytes', async () => {
  const f = await singleUploadFixture(null, true)
  f.client.core.executeTransaction.mockRejectedValueOnce(new Error('lost register response'))
  await expect(f.run()).rejects.toThrow('lost register response')
  const prior = readWalrusSingleRecord(f.key)!
  expect(prior.register?.phase).toBe('SIGNED'); expect(prior.encoding?.nonce).toBeTruthy()
  const data = Transaction.from(fromBase64(prior.register!.bytes)).getData()
  // Tip transfer is present in addition to the actual final Blob transfer.
  expect(data.commands.filter(command => command.TransferObjects)).toHaveLength(2)
  expect(data.inputs.some(input => input.Pure && fromBase64(input.Pure.bytes).length === 72)).toBe(true)
  await f.run()
  expect(f.metadata.mock.calls[1][0].nonce).toEqual(fromBase64(prior.encoding!.nonce!))
  expect(f.client.core.executeTransaction.mock.calls[1][0].transaction).toEqual(fromBase64(prior.register!.bytes))
  expect(f.sign).toHaveBeenCalledTimes(2); expect(f.relayWrite).toHaveBeenCalledOnce(); expect(f.write).not.toHaveBeenCalled()
  expect(f.relayWrite).toHaveBeenCalledWith(expect.objectContaining({ nonce: fromBase64(prior.encoding!.nonce!),
    txDigest: prior.register!.digest, blobObjectId: f.blobObjectId }))
})
it('relay transport failure retains payment and nonce for an SDK resume with no new register', async () => {
  const f = await singleUploadFixture(null, true); f.relayWrite.mockRejectedValueOnce(new Error('relay offline'))
  await expect(f.run()).rejects.toThrow('relay offline')
  const prior = readWalrusSingleRecord(f.key)!
  await f.run()
  expect(f.sign).toHaveBeenCalledTimes(2); expect(f.approve).toHaveBeenCalledOnce()
  expect(f.metadata.mock.calls[1][0].nonce).toEqual(fromBase64(prior.encoding!.nonce!))
  expect(f.relayWrite.mock.calls[1][0].txDigest).toBe(prior.register!.digest)
})

function forbidLocalJournal() {
  const get = vi.fn(() => { throw Error('Query must not read localStorage') }), set = vi.fn(() => { throw Error('Query must not write localStorage') })
  vi.stubGlobal('window', { localStorage: { getItem: get, setItem: set } })
  vi.stubGlobal('navigator', { locks: { request: () => { throw Error('Query must not acquire a write lock') } } })
  return { get, set }
}
it('queries exported exact register/certify packets with no local WAL, wallet, storage access, or input mutation', async () => {
  const f = await singleUploadFixture(), original = await f.run(), record = readWalrusSingleRecord(f.key)!
  record.certify!.phase = 'SIGNED'
  const before = structuredClone(record); f.setOwner(null); const storage = forbidLocalJournal()
  f.sign.mockClear(); f.write.mockClear(); f.approve.mockClear(); f.client.core.executeTransaction.mockClear()
  const result = await queryDurableWalrusBlobRecord({ ...f, record, operationScope: f.intent.operationScope })
  expect(result.status).toBe('CERTIFIED'); expect(result.recoveryKey).toBe(f.key)
  if (result.status === 'CERTIFIED') expect(result.result).toEqual(original)
  expect(record).toEqual(before); expect(result.record.register?.phase).toBe('SUCCEEDED')
  expect(storage.get).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled(); expect(f.approve).not.toHaveBeenCalled()
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
it.each(['register', 'certify'] as const)('returns UNKNOWN for missing exported %s proof instead of trusting successful flags', async stage => {
  const f = await singleUploadFixture(); await f.run(); const record = readWalrusSingleRecord(f.key)!
  f.records.delete(record[stage]!.digest); const storage = forbidLocalJournal(); f.sign.mockClear(); f.write.mockClear()
  const result = await queryDurableWalrusBlobRecord({ ...f, record, operationScope: f.intent.operationScope })
  expect(result.status).toBe('UNKNOWN'); expect(storage.get).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled()
})
it.each(['bytes', 'expiry', 'recipient'])('retains full %s validation in non-persistent exported WAL queries', async issue => {
  const f = await singleUploadFixture(); await f.run(); const record = readWalrusSingleRecord(f.key)!
  if (issue === 'bytes') f.read.mockResolvedValue(new Uint8Array(f.payload.length).fill(1))
  if (issue === 'expiry') f.setStorageEnd(9)
  if (issue === 'recipient') record.intent.recipient = uid(999)
  const storage = forbidLocalJournal(); f.sign.mockClear(); f.write.mockClear()
  await expect(queryDurableWalrusBlobRecord({ ...f, record, operationScope: f.intent.operationScope }))
    .rejects.toThrow(issue === 'bytes' ? 'RECOVERED_BYTES_MISMATCH' : issue === 'expiry' ? 'NOT_CURRENTLY_CERTIFIED' : 'REGISTER_RECIPIENT_MISMATCH')
  expect(storage.get).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled()
})
it('requires the exact exported operation and attachment before querying chain proof', async () => {
  const f = await singleUploadFixture(); await f.run(); const record = readWalrusSingleRecord(f.key)!
  forbidLocalJournal(); f.sign.mockClear()
  await expect(queryDurableWalrusBlobRecord({ ...f, record, operationScope: 'other' })).rejects.toThrow('RECOVERY_SCOPE_MISMATCH')
  await expect(queryDurableWalrusBlobRecord({ ...f, record, operationScope: f.intent.operationScope,
    attachment: { scope: 'other', append: () => {} } })).rejects.toThrow('ATTACHMENT_SCOPE_MISMATCH')
  expect(f.sign).not.toHaveBeenCalled()
})
it('returns SOURCE_REQUIRED for exported register-only proof without trying to upload missing bytes', async () => {
  const f = await singleUploadFixture(); f.write.mockRejectedValueOnce(Error('relay unavailable'))
  await expect(f.run()).rejects.toThrow('relay unavailable'); const record = readWalrusSingleRecord(f.key)!
  const storage = forbidLocalJournal(); f.sign.mockClear(); f.write.mockClear()
  const result = await queryDurableWalrusBlobRecord({ ...f, record, operationScope: f.intent.operationScope })
  expect(result.status).toBe('SOURCE_REQUIRED'); expect(storage.set).not.toHaveBeenCalled()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled()
})
