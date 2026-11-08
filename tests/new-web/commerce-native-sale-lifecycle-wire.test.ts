import { expect, it } from 'vitest'
import { verifyNativeSaleLifecycle } from '../../web/lib/soulidity/commerce/native-sale-lifecycle'
import { nativeSaleLifecycleWireFixture as fixture } from './fixtures/commerce-native-sale-lifecycle-wire'

async function run(variant = '', withCollection = false) {
  const evidence = await fixture(variant, withCollection)
  return { evidence, result: verifyNativeSaleLifecycle({ ...evidence, client: evidence.client as never }) }
}

it.each(['', 'same-checkpoint'])('reads all three originals with the actual production verifiers (%s)', async variant => {
  const { evidence, result } = await run(variant)
  const { review, offer, listing, setupDigest, plan } = evidence
  await expect(result).resolves.toMatchObject({
    status: 'NATIVE_SALE_LIFECYCLE_CONFIRMED', currentWalletUseRequired: true,
    cancelDigest: review.cancelDigest, relistDigest: review.relistDigest, purchaseDigest: review.purchaseDigest,
    cancel: { status: 'CANCELLATION_CONFIRMED', checkpoint: '80' },
    relist: { status: 'RELIST_CONFIRMED', checkpoint: variant ? '80' : '90' },
    sale: { status: 'SETTLEMENT_CONFIRMED', checkpoint: variant ? '80' : '100', receipt: {
      listingExit: { offerInput: { digest: offer.digest, writer: review.relistDigest }, listingInput: { digest: listing.digest, writer: review.relistDigest } },
      money: { seller: review.seller, creator: evidence.creator, protocolIncome: '3', buyerGrossDebit: '107',
        payouts: expect.arrayContaining([
          { owner: review.seller, amount: '101', coinId: expect.any(String) },
          { owner: evidence.creator, amount: '3', coinId: expect.any(String) },
        ]),
        sourceBinding: { soulBinding: { soulId: review.soulId }, directoryHistory: { writerTransactionDigest: setupDigest } },
        transferPolicy: { ruleHistory: { writerTransactionDigest: setupDigest } }, gas: { netGasCharge: '3' } },
      custody: { soulId: review.soulId, buyerKioskId: plan.buyerKioskId, buyerAccountInput: plan.buyerAccount },
      cleanup: { nodes: [{ soulId: review.soulId, authorization: { oldGeneration: '0', newGeneration: '1' } }] },
      effectsReconciliation: { status: 'OBJECT_EFFECTS_ACCOUNTED', missingSubproofs: [], unclaimedEffectIds: [] },
    } },
  })
  expect(new Set(evidence.client.ledgerService.getTransaction.mock.calls.map(([request]) => request.digest)))
    .toEqual(new Set([review.cancelDigest, review.relistDigest, review.purchaseDigest, setupDigest]))
})

it.each([
  ['missing-directory', 'CHILD_NOT_FOUND_AT_ROOT_CREATION'],
  ['old-account-marker', 'CUSTODY_ACCOUNT'],
  ['substituted-listing', 'NATIVE_SALE_LIFECYCLE_RELIST_INPUT_MISMATCH'],
])('rejects %s through the actual historical readers', async (variant, error) => {
  const { result } = await run(variant)
  await expect(result).rejects.toThrow(error)
})

it.each(['', 'same-checkpoint'])('checks original Collection membership, reciprocal Native binding and all payouts (%s)', async variant => {
  const { evidence, result } = await run(variant, true)
  const { review, plan, setupDigest, memberId, nativeCollectionFieldId } = evidence
  await expect(result).resolves.toMatchObject({
    status: 'NATIVE_SALE_LIFECYCLE_CONFIRMED', currentWalletUseRequired: true,
    cancel: { status: 'CANCELLATION_CONFIRMED', checkpoint: '80' },
    relist: { status: 'RELIST_CONFIRMED', checkpoint: variant ? '80' : '90' },
    sale: { status: 'SETTLEMENT_CONFIRMED', checkpoint: variant ? '80' : '100', receipt: {
      money: { buyerGrossDebit: '113', protocolIncome: '3', gas: { netGasCharge: '3' },
        payouts: [
          { owner: review.seller, amount: '101', coinId: expect.any(String) },
          { owner: evidence.creator, amount: '3', coinId: expect.any(String) },
          { owner: evidence.collectionHolder, amount: '6', coinId: expect.any(String) },
        ],
        collectionMembership: { holder: evidence.collectionHolder, royaltyBps: 500,
          member: { objectId: memberId, ordinal: '1', writerTransactionDigest: setupDigest } },
        sourceBinding: { nativeCollectionBinding: { collectionId: plan.collectionId, fieldId: nativeCollectionFieldId, writerTransactionDigest: setupDigest } },
        reciprocalCollection: { collectionId: plan.collectionId, soulId: review.soulId, nativeFieldId: nativeCollectionFieldId, memberFieldId: memberId },
        requiresOriginalReciprocalCollectionProof: false,
      },
      custody: { soulId: review.soulId, buyerKioskId: plan.buyerKioskId },
      cleanup: { nodes: [{ soulId: review.soulId, authorization: { oldGeneration: '0', newGeneration: '1' } }] },
      effectsReconciliation: { status: 'OBJECT_EFFECTS_ACCOUNTED', unclaimedEffectIds: [] },
    } },
  })
})

it.each([
  ['wrong-member-ordinal', 'HIST_COLLECTION_MEMBER'],
  ['wrong-native-collection', 'SALE_ORIGINAL_SOURCE_COLLECTION_BINDING'],
  ['wrong-collection-payout', 'SALE_MONEY_PAYOUT_DISTRIBUTION'],
])('rejects %s through the actual Collection checkout readers', async (variant, error) => {
  const { result } = await run(variant, true)
  await expect(result).rejects.toThrow(error)
})
