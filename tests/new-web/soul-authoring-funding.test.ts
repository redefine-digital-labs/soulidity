import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { batchHistoryFixture } from './fixtures/walrus-batch-history'
import { uid } from './fixtures/walrus-single-upload'
import { resolveSoulAuthoringFunding } from '../../web/lib/soulidity/soul-authoring-funding'

afterEach(() => vi.restoreAllMocks())
async function fixture(mode: true | 'address' | 'mixed' | 'exact' | 'merge') {
  const f = await batchHistoryFixture(1, mode), author = f.preparation.manifest.scope.owner
  const core = f.base.client.core as any, selected = (await core.listCoins()).objects
  const data = Transaction.from(f.register.bytes).getData(), coinType = `${uid(6)}::wal::WAL`
  for (const coin of selected) {
    const bytes = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() }).serialize({ id: coin.objectId, balance: coin.balance }).toBytes()
    const row = f.base.object(coin.objectId, 9, `0x2::coin::Coin<${coinType}>`, bytes, { AddressOwner: author }, f.base.registeredBlob.digest)
    data.inputs.forEach(input => { const ref = input.Object?.ImmOrOwnedObject; if (ref && ref.objectId === coin.objectId) ref.digest = row.digest })
  }
  const candidate = Transaction.from(TransactionDataBuilder.restore(data).build()), expected = new Transaction()
  expected.setSender(author)
  const file = f.preparation.manifest.files[0]
  const blob = expected.add(f.base.walrus.registerBlob({ size: file.payloadByteLength, epochs: 3, blobId: file.encoding.blobId,
    rootHash: fromBase64(file.encoding.rootHash), deletable: true }))
  expected.transferObjects([blob], author)
  expected.moveCall({ target: `${uid(400)}::fixture::commit_manifest`, arguments: [expected.pure.vector('u8', new Uint8Array(32).fill(3))] })
  await expected.prepareForSerialization({ supportedIntents: ['CoinWithBalance'] })
  core.listCoins.mockClear(); core.listCoins.mockRejectedValue(Error('Do not reselect new incoming coins'))
  core.getBalance.mockClear(); core.getBalance.mockRejectedValue(Error('Do not substitute increased account balance'))
  const run = () => resolveSoulAuthoringFunding({ expected, candidate, client: f.transport as any, author, signal: f.controller.signal })
  return { ...f, core, candidate, expected, selected, author, run }
}
it.each([true, 'address', 'mixed', 'exact', 'merge'] as const)('preserves exact SDK funding after balance/list drift: %s', async mode => {
  const f = await fixture(mode); await f.run()
  const rebuilt = await f.expected.build({ client: f.base.client as any, onlyTransactionKind: true })
  expect(toBase64(rebuilt)).toBe(toBase64(TransactionDataBuilder.restore(f.candidate.getData()).build({ onlyTransactionKind: true })))
  expect(f.core.listCoins).not.toHaveBeenCalled(); expect(f.core.getBalance).not.toHaveBeenCalled()
})
it('rejects arbitrary BCS under a frozen funding coin digest', async () => {
  const f = await fixture(true), ref = f.selected[0]
  const row = f.rows.get(`${ref.objectId}:9`); row.bcs.value[row.bcs.value.length - 1] ^= 1
  await expect(f.run()).rejects.toThrow('FUNDING_COIN_BYTES_OR_OWNER')
})
it('rejects an authenticated coin belonging to a different owner', async () => {
  const f = await fixture(true), ref = f.selected[0], row = f.rows.get(`${ref.objectId}:9`)
  const raw = bcs.Object.parse(row.bcs.value)
  const changed = f.base.object(ref.objectId, 9, row.objectType, raw.data.Move!.contents, { AddressOwner: uid(999) }, raw.previousTransaction)
  const data = f.candidate.getData()
  data.inputs.forEach(input => { const owned = input.Object?.ImmOrOwnedObject; if (owned && owned.objectId === ref.objectId) owned.digest = changed.digest })
  await expect(resolveSoulAuthoringFunding({ expected: f.expected, candidate: Transaction.from(TransactionDataBuilder.restore(data).build()),
    client: f.transport as any, author: f.author, signal: f.controller.signal })).rejects.toThrow('FUNDING_COIN_BYTES_OR_OWNER')
})
it('rejects a withdrawal larger than independently reconstructed storage charges', async () => {
  const f = await fixture('address'), data = f.candidate.getData()
  const withdrawal = data.inputs.find(input => input.FundsWithdrawal)!.FundsWithdrawal!
  withdrawal.reservation.MaxAmountU64 = '9999'
  await expect(resolveSoulAuthoringFunding({ expected: f.expected, candidate: Transaction.from(TransactionDataBuilder.restore(data).build()),
    client: f.transport as any, author: f.author, signal: f.controller.signal })).rejects.toThrow('FUNDING_AMOUNT_INVALID')
})
