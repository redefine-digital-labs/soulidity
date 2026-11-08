import { expect, it, vi } from 'vitest'
import { verifyNativeSaleLifecycle } from '../../web/lib/soulidity/commerce/native-sale-lifecycle'
import { nativeSaleLifecycleFixture as fixture } from './fixtures/commerce-native-sale-lifecycle'

const readPurchase = vi.hoisted(() => vi.fn())
vi.mock('../../web/lib/soulidity/commerce/purchase-recovery-original', async importOriginal => ({
  ...await importOriginal<typeof import('../../web/lib/soulidity/commerce/purchase-recovery-original')>(),
  queryPurchaseRecoveryOriginal: readPurchase,
}))

async function run(variant = '') {
  const f = await fixture(variant)
  readPurchase.mockReset()
  readPurchase.mockResolvedValue(f.purchaseProof)
  return { f, result: verifyNativeSaleLifecycle({ ...f, client: f.client as never }) }
}

it.each(['', 'same-checkpoint', 'collection'])('joins actual cancel and relist proof to the exact original purchase inputs (%s)', async variant => {
  const { f, result } = await run(variant)
  await expect(result).resolves.toMatchObject({
    status: 'NATIVE_SALE_LIFECYCLE_CONFIRMED', currentWalletUseRequired: true, buyer: f.review.buyer,
    cancel: { status: 'CANCELLATION_CONFIRMED', checkpoint: '100' },
    relist: { status: 'RELIST_CONFIRMED', checkpoint: variant === 'same-checkpoint' ? '100' : '101',
      receipt: { offerId: f.plan.offerId, listingId: f.listingId, purchaseCapId: f.purchaseCapId, ask: '101', gas: { netGasCharge: '3' } } },
    sale: { status: 'SETTLEMENT_CONFIRMED' },
  })
  expect(readPurchase).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    text: f.purchaseText, soulId: f.review.soulId, proveSaleSource: true, proveSaleCustody: true, proveSaleCleanup: true,
  }))
})

it.each([
  ['wrong-account', 'RELIST_ACCOUNT'], ['wrong-offer-ask', 'RELIST_OFFER'], ['wrong-marker-owner', 'RELIST_RESERVATION'],
  ['extra-command', 'RELIST_GRAPH'], ['foreign-cancel-config', 'NATIVE_SALE_LIFECYCLE_CANCEL_MISMATCH'], ['reversed-checkpoint', 'NATIVE_SALE_LIFECYCLE_CANCEL_RELIST_ORDER'],
  ['old-kiosk', 'NATIVE_SALE_LIFECYCLE_CANCEL_RELIST_ORDER'],
  ['unbound-collection', 'NATIVE_SALE_LIFECYCLE_COLLECTION_BINDING'],
  ['substituted-offer', 'NATIVE_SALE_LIFECYCLE_RELIST_INPUT_MISMATCH'], ['substituted-marker', 'NATIVE_SALE_LIFECYCLE_RELIST_INPUT_MISMATCH'],
])('rejects %s', async (variant, error) => {
  const { result } = await run(variant)
  await expect(result).rejects.toThrow(error)
})

it('keeps the confirmed original cancellation when relist is missing and skips the sale query', async () => {
  const { f, result } = await run('missing-relist')
  await expect(result).resolves.toMatchObject({
    status: 'NATIVE_SALE_LIFECYCLE_PENDING', stage: 'RELIST', cancelDigest: f.review.cancelDigest,
    cancel: { status: 'CANCELLATION_CONFIRMED' }, relistDigest: f.review.relistDigest, relist: { status: 'MISSING' },
  })
  expect(readPurchase).not.toHaveBeenCalled()
})

it('keeps the two seller originals when the exact purchase is pending', async () => {
  const f = await fixture()
  readPurchase.mockResolvedValueOnce({ kind: 'native-sale-preparation.v1', history: { status: 'PENDING' } })
  await expect(verifyNativeSaleLifecycle({ ...f, client: f.client as never })).resolves.toMatchObject({
    status: 'NATIVE_SALE_LIFECYCLE_PENDING', stage: 'PURCHASE', purchaseDigest: f.review.purchaseDigest,
    cancel: { status: 'CANCELLATION_CONFIRMED' }, relist: { status: 'RELIST_CONFIRMED' }, sale: { status: 'PENDING' },
  })
})

it('requires the original Collection pin before querying a Collection checkout', async () => {
  const f = await fixture('collection')
  const original = JSON.parse(f.purchaseText)
  original.context.collection = null
  await expect(verifyNativeSaleLifecycle({ ...f, review: { ...f.review, collection: null }, purchaseText: JSON.stringify(original),
    client: f.client as never })).rejects.toThrow('NATIVE_SALE_LIFECYCLE_COLLECTION_PIN')
  expect(f.ledgerService.getTransaction).not.toHaveBeenCalled()
})

it('rejects different reviewed purchase terms before any ledger request', async () => {
  const f = await fixture()
  const review = { ...f.review, buyer: f.review.seller }
  await expect(verifyNativeSaleLifecycle({ ...f, review, client: f.client as never })).rejects.toThrow('NATIVE_SALE_LIFECYCLE_CASE')
  expect(f.ledgerService.getTransaction).not.toHaveBeenCalled()
})
