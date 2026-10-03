import { afterEach, expect, it, vi } from 'vitest'
import { contentAppendOperationFixture } from './fixtures/content-append-operation'
import { contentAppendRebaseFixture } from './fixtures/content-append-rebase'
import { contentAppendPreparationFingerprint, contentAppendPreparedEnvelope, rewrapContentAppendPreparation } from '../../web/lib/soulidity/content-append-preparation'
import { contentAppendStorageRootHash, seedContentAppendRebasePayment } from '../../web/lib/soulidity/content-append-rebase-evidence'
import { contentAppendWalrusIntent, runContentAppend } from '../../web/lib/soulidity/content-append-operation'
import { parseWalrusSingleRecord } from '../../web/lib/upload/walrus-single-operation'
import { contentEnvelopeKey } from '../../web/lib/soulidity/content-envelope'

// Actual signed Seal/AES rewrap and raw BCS authority/final readers. The paid
// register is offline evidence and registered-only continuation/ACK are injected;
// this suite does not prove live Walrus registration, retirement or execution.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
async function fixture(grantee = false) {
  const paid = await contentAppendRebaseFixture(), f = await contentAppendOperationFixture({ grantee })
  const oldPayment = parseWalrusSingleRecord({ ...paid.previousPayment, intent: contentAppendWalrusIntent(f.record),
    encoding: { ...paid.previousPayment.encoding!, unencodedSize: f.record.ciphertext.length } })
  const record = await rewrapContentAppendPreparation({ record: f.record,
    nextScope: { ...f.record.scope, intentJson: JSON.stringify({ ...f.intent, rebase: {
      nonce: 'cd'.repeat(16), predecessor: contentAppendPreparationFingerprint(f.record),
      storageRootHash: contentAppendStorageRootHash(oldPayment), certifyGasBudgetMist: '750000', autoGrantTargets: [],
    } }) }, sealConfig: f.crypto.params.sealConfig, wallet: f.crypto.params.wallet })
  const payment = seedContentAppendRebasePayment(record, oldPayment)
  const verify = vi.fn(async () => {}), assertAuthority = vi.fn((_proof: any) => {})
  const finish = () => {
    f.finalize()
    f.setConfig(contentEnvelopeKey({ contentObjectId: record.scope.contentObjectId, kind: record.scope.kind,
      name: record.scope.name, versionIndex: record.scope.versionIndex, blobObjectId: f.result.blobObjectId }),
    contentAppendPreparedEnvelope(record, f.result.blobObjectId))
  }
  const continuePaid = vi.fn(async (args: any) => {
    await args.verify(); await args.execution.beforeWrite(); finish(); return f.result
  })
  const params = { record, config: f.config, execution: f.execution, signal: f.crypto.controller.signal,
    confirmQuote: f.confirmQuote, rebase: { payment, verify, assertAuthority } }
  const deps = { continuePaid, upload: f.upload, read: f.read as any, acknowledge: f.acknowledge }
  return { ...f, record, previous: f.record, payment, oldPayment, verify, assertAuthority, finish, continuePaid, params, deps,
    run: () => runContentAppend(params, deps) }
}
function noInitialUpload(f: Awaited<ReturnType<typeof fixture>>) {
  expect(f.upload).not.toHaveBeenCalled(); expect(f.confirmQuote).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
}
it('runs only registered-Blob continuation with fresh gas and verifies the new raw envelope before ACK', async () => {
  const f = await fixture(), result = await f.run(), args = f.continuePaid.mock.calls[0][0]
  expect(f.continuePaid).toHaveBeenCalledOnce(); expect(args.record).toEqual(f.payment); expect(args.record).not.toBe(f.payment)
  expect(args.record.register).toEqual(f.oldPayment.register); expect(args.payload).toEqual(f.record.ciphertext)
  expect(args.certifyGasBudget).toBe(750000n); expect(args.attachment.scope).toBe(f.payment.intent.attachmentScope)
  expect(f.verify).toHaveBeenCalledOnce(); expect(f.beforeWrite).toHaveBeenCalledOnce(); expect(f.assertAuthority).toHaveBeenCalledTimes(2)
  expect(f.assertAuthority.mock.calls[0][0].snapshot.contentVersions).toHaveLength(f.proof.snapshot.contentVersions.length)
  expect(f.assertAuthority.mock.calls[1][0].snapshot.contentVersions).toHaveLength(f.proof.snapshot.contentVersions.length + 1)
  expect(contentAppendPreparedEnvelope(f.record, f.result.blobObjectId)).not.toEqual(contentAppendPreparedEnvelope(f.previous, f.result.blobObjectId))
  expect(result.version.versionIndex).toBe(f.record.scope.versionIndex)
  expect(f.acknowledge).toHaveBeenCalledWith({ recoveryKey: f.result.recoveryKey, certifyDigest: f.result.certifyTxDigest })
  expect(f.assertAuthority.mock.invocationCallOrder[1]).toBeLessThan(f.acknowledge.mock.invocationCallOrder[0]); noInitialUpload(f)
})
it('refuses a rebased signed intent without its history continuation rather than entering initial upload', async () => {
  const f = await fixture(), { rebase: _missing, ...params } = f.params
  await expect(runContentAppend(params, f.deps)).rejects.toThrow('REBASE_HISTORY_REQUIRED')
  expect(f.continuePaid).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled(); noInitialUpload(f)
})
it('rejects a predecessor payment bound to the wrong preparation before continuation', async () => {
  const f = await fixture(); f.params.rebase.payment = f.oldPayment
  await expect(f.run()).rejects.toThrow('WALRUS_PREPARATION_MISMATCH')
  expect(f.continuePaid).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled(); noInitialUpload(f)
})
it('forwards ancestry verification failure without falling back to payment or reporting ACK', async () => {
  const f = await fixture(); f.verify.mockRejectedValueOnce(Error('ancestor transaction pending'))
  await expect(f.run()).rejects.toThrow('ancestor transaction pending')
  expect(f.beforeWrite).not.toHaveBeenCalled(); expect(f.assertAuthority).not.toHaveBeenCalled()
  expect(f.acknowledge).not.toHaveBeenCalled(); noInitialUpload(f)
})
it.each(['before-write', 'final'])('runs the retained-target authority assertion at %s and does not ACK refusal', async when => {
  const f = await fixture(); let checks = 0
  f.assertAuthority.mockImplementation(() => { if (++checks === (when === 'before-write' ? 1 : 2)) throw Error('original grant expired') })
  await expect(f.run()).rejects.toThrow('original grant expired')
  expect(f.assertAuthority).toHaveBeenCalledTimes(when === 'before-write' ? 1 : 2)
  expect(f.beforeWrite).toHaveBeenCalledTimes(when === 'before-write' ? 0 : 1)
  expect(f.acknowledge).not.toHaveBeenCalled(); noInitialUpload(f)
})
it('retains the external beforeWrite gate in the paid continuation branch', async () => {
  const f = await fixture(); f.beforeWrite.mockRejectedValueOnce(Error('writes paused'))
  await expect(f.run()).rejects.toThrow('writes paused')
  expect(f.verify).toHaveBeenCalledOnce(); expect(f.assertAuthority).toHaveBeenCalledOnce()
  expect(f.acknowledge).not.toHaveBeenCalled(); noInitialUpload(f)
})
it.each(['wallet', 'configuration'])('blocks a %s change during paid verification without ACK', async changed => {
  const f = await fixture()
  f.verify.mockImplementationOnce(async () => {
    if (changed === 'wallet') f.setWallet(null)
    else vi.stubEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', `0x${'ff'.repeat(32)}`)
  })
  await expect(f.run()).rejects.toThrow(changed === 'wallet' ? 'WALLET_CHANGED' : 'CONFIGURATION_CHANGED')
  expect(f.beforeWrite).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled(); noInitialUpload(f)
})
it('still enforces live protocol pure-argument limits before entering registered continuation', async () => {
  const f = await fixture(); f.attributes.max_pure_argument_size = '1'
  await expect(f.run()).rejects.toThrow('PURE_ARGUMENT_TOO_LARGE')
  expect(f.continuePaid).not.toHaveBeenCalled(); expect(f.verify).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled(); noInitialUpload(f)
})
it.each(['version', 'grant'])('an activated but stale %s still fails the actual raw beforeWrite gate without ACK', async changed => {
  const f = await fixture(changed === 'grant')
  f.verify.mockImplementationOnce(async () => {
    if (changed === 'version') { f.raw.slots.push({ ...f.raw.slots[0] }); f.raw.putSlots() }
    else f.raw.putClock('2000')
  })
  await expect(f.run()).rejects.toThrow(changed === 'version' ? 'VERSION_CHANGED_QUERY_OR_REBASE' : 'CURRENT_GRANT_INVALID')
  expect(f.continuePaid).toHaveBeenCalledOnce(); expect(f.beforeWrite).not.toHaveBeenCalled()
  expect(f.acknowledge).not.toHaveBeenCalled(); noInitialUpload(f)
})
