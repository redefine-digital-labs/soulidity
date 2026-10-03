import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { SoulPublicMarketConfigBcs } from '@soulidity/sdk'
import { uid } from './fixtures/walrus-single-upload'
import { contentAppendHistoryFixture } from './fixtures/content-append-history'
import { historicalWalrusFixture } from './fixtures/walrus-historical-completion'
import { contentAppendAttachment, contentAppendWalrusIntent, queryContentAppend } from '../../web/lib/soulidity/content-append-operation'
import { exportContentAppendRecovery, importContentAppendRecovery } from '../../web/lib/soulidity/content-append-recovery'
import { queryHistoricalWalrusBlobRecord } from '../../web/lib/upload/walrus-single-upload'

// Connected production query: actual AES/Seal preparation and author signature,
// real Walrus SDK + WASM, canonical original packet/effects/full Object BCS and
// actual historical/current Soul readers. RPC and BLS quorum are controlled;
// this is not live-chain execution or release acceptance.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
async function fixture(grantee = false, options: Parameters<typeof contentAppendHistoryFixture>[0] = {}) {
  const f = await contentAppendHistoryFixture({ grantee, ...options }), attachment = contentAppendAttachment(f.record)
  const storage = await historicalWalrusFixture(attachment, { signer: f.crypto.signer, payload: f.record.ciphertext,
    blobObjectId: f.result.blobObjectId, intent: contentAppendWalrusIntent(f.record) })
  const effects = storage.records.get(storage.record.certify!.digest)!.effects.V2!, digest = storage.record.certify!.digest
  for (const [label, id] of Object.entries(f.ids)) {
    if (label === 'blob') continue
    const original = f.rows.get(id)!, owner = f.objects.get(id)!.owner
    const row = storage.object(id, 12, original.objectType, original.contents.value, owner, digest)
    const change = structuredClone(f.change(label)); change.outputState.ObjectWrite![0] = row.digest
    effects.changedObjects = effects.changedObjects.filter(([key]) => key !== id)
    effects.changedObjects.push([id, change])
  }
  // Preserve the actual Walrus certificate fields while modelling dof::add's
  // owner change to the exact ContentBlobKey wrapper from the Soul fixture.
  const blob = storage.object(storage.blobObjectId, 12, storage.certifiedBlob.objectType, storage.certifiedBlob.contents.value,
    { ObjectOwner: f.ids.wrapper }, digest)
  const blobChange = effects.changedObjects.find(([id]) => id === storage.blobObjectId)![1]
  blobChange.outputState.ObjectWrite = [blob.digest, { $kind: 'ObjectOwner', ObjectOwner: f.ids.wrapper }]
  for (const shared of attachment.historicalSharedObjects ?? []) {
    if (shared.mutable) continue
    const raw = f.raw.rows.get(shared.objectId) ?? (shared.objectId === f.intent.marketConfigId ? {
      objectType: `${f.scope.originalPackageId}::market::MarketConfigV2`, contents: { value: SoulPublicMarketConfigBcs.serialize({
        id: f.intent.marketConfigId, version: '2', legacy_config_id: uid(7001), fee_recipient: uid(7002),
        platform_fee_bps: 100, primary_enabled: true, secondary_enabled: true }).toBytes() },
    } : undefined)
    if (!raw) throw Error('Missing genuine shared layout in connected fixture')
    const row = storage.object(shared.objectId, 9, raw.objectType, raw.contents.value,
      { Shared: { initialSharedVersion: '1' } }, toBase58(new Uint8Array(32).fill(4)))
    const reference = effects.unchangedConsensusObjects.find(([id]) => id === shared.objectId)![1]
    reference.ReadOnlyRoot![1] = row.digest
  }
  f.result.blobId = storage.record.uploaded!.blobId
  const recover = (params: Omit<Parameters<typeof queryHistoricalWalrusBlobRecord>[0], 'createClient'>) =>
    queryHistoricalWalrusBlobRecord({ ...params, createClient: storage.createClient })
  const query = (payment = storage.record) => queryContentAppend({ record: f.record, payment, config: f.config,
    execution: storage.execution, signal: storage.controller.signal }, { recover, read: f.read })
  return { ...f, storage, query }
}
it.each([false, true])('queries original %s grantee append across a cold encrypted export without wallet, WAL or current Grant', async grantee => {
  const f = await fixture(grantee), original = f.storage.record
  expect(Transaction.from(fromBase64(original.certify!.bytes)).getData().commands.some(c =>
    c.MoveCall?.function === (grantee ? 'append_version_as_granted_agent' : 'append_version_as_owner'))).toBe(true)
  const text = await exportContentAppendRecovery(f.record, f.crypto.client, () => original, async () => ({ history: [], pending: null }))
  vi.stubGlobal('window', undefined); vi.stubGlobal('navigator', undefined); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No network') }))
  const imported = await importContentAppendRecovery(text, f.crypto.client)
  const recovered = await f.query(imported.payment!)
  expect(recovered.recovery.status).toBe('CERTIFIED'); expect(recovered.historical?.versionIndex).toBe(f.scope.versionIndex)
  if (recovered.recovery.status === 'CERTIFIED') expect(recovered.recovery.result.certifyTxDigest).toBe(original.certify!.digest)
  expect(f.storage.execution.sign).not.toHaveBeenCalled(); expect(f.storage.readBlob).not.toHaveBeenCalled()
  expect(f.crypto.decryptCall).not.toHaveBeenCalled(); expect(f.storage.write).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
})
it.each([
  ['ownership', 'assert_mutation_scope', 2], ['capacity', 'assert_capacity', 1], ['scope', 'assert_preserves_active_scopes', 2],
].flatMap(([label, name, argument]) => ['missing', 'wrong value'].map(mode => ({ label, name, argument: Number(argument), mode }))))(
  'rejects a rehashed and locally signed append with $mode $label guard', async ({ name, argument, mode }) => {
  const f = await fixture(false, { intent: { autoGrantPlan: { capacityBefore: '3', capacityAfter: '4', targets: [
    { address: uid(1051), scopeMask: 13 }, { address: uid(6000), scopeMask: 8 }] } } })
  const original = f.storage.record.certify!, data = new TransactionDataBuilder(Transaction.from(original.bytes).getData())
  const n = data.commands.findIndex(command => command.MoveCall?.function === name)
  expect(n).toBeGreaterThanOrEqual(1)
  if (mode === 'missing') data.commands.splice(n, 1)
  else {
    const ref = data.commands[n].MoveCall!.arguments[argument] as { Input: number }
    data.inputs[ref.Input] = Inputs.Pure(bcs.u64().serialize('99').toBytes())
  }
  const bytes = data.build(), digest = TransactionDataBuilder.getDigestFromBytes(bytes), signed = await f.crypto.signer.signTransaction(bytes)
  const ledger = structuredClone(f.storage.records.get(original.digest)!)
  for (const row of [...f.storage.rows.values()]) {
    if (row.previousTransaction !== original.digest) continue
    const full = bcs.Object.parse(row.bcs.value)
    const replacement = f.storage.object(row.objectId, Number(row.version), row.objectType, row.contents.value, full.owner, digest)
    const output = ledger.effects.V2!.changedObjects.find(([id]) => id === row.objectId)?.[1].outputState.ObjectWrite
    if (output) output[0] = replacement.digest
  }
  ledger.bytes = bytes; ledger.effects.V2!.transactionDigest = digest; f.storage.records.set(digest, ledger)
  f.storage.record.certify = { ...original, bytes: toBase64(bytes), digest, signature: signed.signature }
  await expect(f.query()).rejects.toThrow('WALRUS_CERTIFY_ATTACHMENT_TEMPLATE_MISMATCH')
  expect(f.read).not.toHaveBeenCalled(); expect(f.storage.execution.sign).not.toHaveBeenCalled(); expect(f.storage.write).not.toHaveBeenCalled()
})
it('lost register outcome queries its original digest without certification, metadata or another payment', async () => {
  const f = await fixture(); f.storage.records.delete(f.storage.record.register!.digest)
  const result = await f.query()
  expect(result.recovery.status).toBe('UNKNOWN')
  expect(f.storage.createClient).not.toHaveBeenCalled(); expect(f.storage.execution.sign).not.toHaveBeenCalled()
  expect(f.storage.write).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled()
})
it('a confirmed Walrus receipt cannot substitute for missing original Soul output proof', async () => {
  const f = await fixture(), effects = f.storage.records.get(f.storage.record.certify!.digest)!.effects.V2!
  effects.changedObjects = effects.changedObjects.filter(([id]) => id !== f.ids.slots)
  await expect(f.query()).rejects.toThrow('HISTORICAL_OBJECT_OUTPUT_NOT_UNIQUE')
  expect(f.read).not.toHaveBeenCalled(); expect(f.storage.execution.sign).not.toHaveBeenCalled()
})
it('same-size corrupted historical encoded source is rejected without downloading or current readback', async () => {
  const f = await fixture(); f.storage.record.encoding!.rootHash = bcs.u256().serialize(42).toBase64()
  await expect(f.query()).rejects.toThrow('WALRUS_SOURCE_ENCODING_MISMATCH_QUERY_ONLY')
  expect(f.read).not.toHaveBeenCalled(); expect(f.storage.readBlob).not.toHaveBeenCalled()
})
it('current unavailable state cannot erase the proved original append', async () => {
  const f = await fixture(); f.read.mockRejectedValue(Error('current state unavailable'))
  const result = await f.query()
  expect(result.recovery.status).toBe('CERTIFIED'); expect(result.historical).not.toBeNull()
  expect(result.currentStatus).toBe('UNAVAILABLE')
})
it('proves the complete original sprite/active/capacity/rotated-and-new-grants graph including readonly Market after deployment drift', async () => {
  const f = await fixture(false, { intent: { spriteConfigJson: '{"frames":7}', setActive: true,
    autoGrantPlan: { capacityBefore: '3', capacityAfter: '4', targets: [
      { address: uid(1051), scopeMask: 13 }, { address: uid(6000), scopeMask: 8 }] } } })
  const data = Transaction.from(fromBase64(f.storage.record.certify!.bytes)).getData()
  expect(data.commands.map(command => command.MoveCall?.function)).toEqual(['certify_blob', 'assert_mutation_scope', 'assert_capacity', 'assert_preserves_active_scopes', 'assert_preserves_active_scopes', 'append_version_as_owner',
    'set_state_config_v2', 'set_active_content_v2', 'set_grant_capacity', 'issue_to_grantee', 'issue_to_grantee'])
  expect(data.inputs.some(input => input.Object?.SharedObject?.objectId === f.intent.marketConfigId && !input.Object.SharedObject.mutable)).toBe(true)
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', uid(999))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', uid(998))
  vi.stubEnv('NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL', 'https://changed-relay.example.com')
  vi.stubEnv('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', '[]')
  const result = await f.query()
  expect(result.recovery.status).toBe('CERTIFIED'); expect(result.historical?.blobWrapperId).toBe(f.ids.wrapper)
  expect(result.currentStatus).toBe('UNAVAILABLE')
  expect(f.read).not.toHaveBeenCalled(); expect(f.storage.execution.sign).not.toHaveBeenCalled(); expect(f.storage.readBlob).not.toHaveBeenCalled()
})
