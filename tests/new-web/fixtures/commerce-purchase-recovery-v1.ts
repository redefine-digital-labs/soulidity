import { commerceSaleMoneyFixture } from './commerce-sale-money'
import { NativeSoldBcs } from '../../../web/lib/soulidity/commerce/native-sale-receipt'
import { NativeSalePaidBcs, readNativeSaleSettlementHistory } from '../../../web/lib/soulidity/commerce/native-sale-history'
import { proveNativeSaleMoney } from '../../../web/lib/soulidity/commerce/native-sale-money'

export async function salePurchaseHistoryFixture(variant = '') {
  const source = await commerceSaleMoneyFixture(variant), { f, params: money, offer: o, quote: q } = source
  const proof = money.plan.collectionId ? await proveNativeSaleMoney(money) : null
  const expected = { offer: o.id, root: o.root, seller: o.seller, buyer: money.plan.buyer,
    sellerKiosk: o.kiosk, buyerKiosk: money.plan.buyerKioskId, ask: q.ask, secondaryBps: 250, creatorBps: 250,
    collectionBps: money.plan.collectionId ? 500 : 0, collection: o.collection,
    collectionHolder: proof?.collectionHolder ?? o.seller, collectionSnapshot: proof?.collectionSnapshot ?? null,
    generation: 0n, attempt: new Uint8Array(32).fill(1) }
  const sale = { offer: o.id, root: o.root, seller: o.seller, buyer: expected.buyer, seller_kiosk: o.kiosk,
    buyer_kiosk: expected.buyerKiosk, ask: String(q.ask), platform: String(q.platform), creator: String(q.creator),
    collection: o.collection, collection_amount: String(q.collection), collection_holder: expected.collectionHolder,
    collection_snapshot: expected.collectionSnapshot ? Array.from(expected.collectionSnapshot) : null,
    total: String(q.total), old_generation: '0', attempt: Array.from(expected.attempt) }
  const payment = { subject: o.root, attempt: sale.attempt, payer: expected.buyer, gross: sale.total, fee: sale.platform, beneficiary: o.seller }
  function rehash() {
    f.eventsData.data = [{ package_id: money.native.callablePackageId, transaction_module: 'market', sender: expected.buyer,
      type_: { address: money.native.originalPackageId, module: 'market', name: 'Sold', typeParams: [] }, contents: NativeSoldBcs.serialize(sale).toBytes() },
    { package_id: money.foundation.callablePackageId, transaction_module: 'economics', sender: expected.buyer,
      type_: { address: money.foundation.originalPackageId, module: 'economics', name: 'Paid', typeParams: [] }, contents: NativeSalePaidBcs.serialize(payment).toBytes() }]
    f.rehashEvents()
  }
  rehash()
  return { f, expected, sale, payment, rehash, params: { client: money.client, packet: { ...money.packet,
    expirationEpoch: '6', phase: 'SIGNED' as const, signature: 'synthetic' }, native: money.native, foundation: money.foundation,
    expected, signal: money.signal, moneySettlement: { plan: money.plan, collection: money.collection } } }
}
