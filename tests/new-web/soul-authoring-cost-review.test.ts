import { afterEach, expect, it, vi } from 'vitest'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { soulAuthoringCostReview } from '../../web/lib/soulidity/soul-authoring-cost-review'
import { authoringPaidCoverVerifierFixture, authoringZeroFileVerifierFixture } from './fixtures/soul-authoring-verifier'

afterEach(() => vi.restoreAllMocks())
it('shows actual SDK registration payments and the saved gas budget, not a new quote', async () => {
  const f = await authoringPaidCoverVerifierFixture(), record = f.register
  const review = soulAuthoringCostReview(record)
  expect(review.wal).toBeGreaterThan(0n)
  const { storageCost, writeCost } = await f.w.base.walrus.storageCost(f.p.preparation.manifest.files[0].payloadByteLength, f.p.manifest.request.storageEpochs)
  expect(review.wal).toBe(storageCost + writeCost)
  expect(review.gasBudgetMist).toBe(BigInt(Transaction.from(record.packet.bytes).getData().gasData.budget!))
  expect(review.digest).toBe(record.packet.digest)
  expect(soulAuthoringCostReview(f.consume).wal).toBe(0n)
})
it('does not count unrelated funding splits a second time', async () => {
  const f = await authoringPaidCoverVerifierFixture(), expected = soulAuthoringCostReview(f.register)
  const tx = Transaction.from(f.register.packet.bytes)
  tx.splitCoins(tx.gas, [tx.pure.u64(999999n)])
  const bytes = TransactionDataBuilder.restore(tx.getData()).build()
  expect(soulAuthoringCostReview({ ...f.register, packet: { ...f.register.packet, bytes: toBase64(bytes) } }).wal).toBe(expected.wal)
})
it('shows zero storage cost for a zero-file collection registration', async () => {
  const f = await authoringZeroFileVerifierFixture()
  expect(soulAuthoringCostReview(f.record).wal).toBe(0n)
})
