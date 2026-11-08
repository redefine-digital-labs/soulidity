import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { readFinalizedMutation } from '../../sui/finalized-mutation'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { NativeSoldBcs, validateNativeSoldPayload, type NativeSoldExpectation } from './native-sale-receipt'
import { commerceCheck } from './economics-read'
import { proveNativeSaleCustody } from './native-sale-custody'
import { proveNativeSaleMoney } from './native-sale-money'
import { reconcileNativeSaleEffects } from './native-sale-effects'
import type { NativeSaleGraphPlan } from './native-sale-graph'
import { proveNativeSaleListingExit } from './native-sale-listing-exit'
import { proveNativeSaleCleanupTree } from './native-sale-cleanup-tree'

const Events = bcs.vector(bcs.struct('Event', { package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
  type_: bcs.StructTag, contents: bcs.byteVector() }))
export const NativeSalePaidBcs = bcs.struct('Paid', { subject: bcs.Address, attempt: bcs.byteVector(), payer: bcs.Address,
  gross: bcs.u64(), fee: bcs.u64(), beneficiary: bcs.Address })
const MAINNET_GENESIS = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S'

/** Original transaction + canonical effects + checkpoint membership + linked
 * package event identities + exact Sold and Paid settlement. This evidence
 * optionally composes original custody and actual-money subproofs. Source
 * cleanup, complete effects coverage and current holder access remain unproved;
 * even combined evidence cannot mark the whole purchase SUCCEEDED.
 * Query uses saved bytes and identity, never rebuilds or signs an old operation.
 */
export async function readNativeSaleSettlementHistory(input: { client: SuiGrpcClient; packet: PublicMutationPacket;
  native: PinnedMovePackage; foundation: PinnedMovePackage; expected: NativeSoldExpectation; signal: AbortSignal;
  moneySettlement?: { plan: NativeSaleGraphPlan; collection?: PinnedMovePackage; standard?: PinnedMovePackage; sourceBinding?: boolean };
  sourceCleanup?: { standard: PinnedMovePackage; content: PinnedMovePackage };
  custodyDelivery?: { standard: PinnedMovePackage; custody: PinnedMovePackage; buyerAccountId: string } }) {
  const packet = structuredClone(input.packet), native = structuredClone(input.native), foundation = structuredClone(input.foundation)
  const expected = structuredClone(input.expected), ledger = input.client.ledgerService
  // Finality and every settlement/custody subproof use one captured read facade.
  const client = { ledgerService: { getServiceInfo: ledger.getServiceInfo.bind(ledger), getTransaction: ledger.getTransaction.bind(ledger),
    getCheckpoint: ledger.getCheckpoint.bind(ledger), getObject: ledger.getObject.bind(ledger) } } as unknown as SuiGrpcClient
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  const bytes = fromBase64(packet.bytes)
  commerceCheck(bytes.length > 0 && bytes.length <= 128 * 1024 && toBase64(bytes) === packet.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest, 'SALE_PACKET_DIGEST')
  const transaction = bcs.TransactionData.parse(bytes)
  const epoch = transaction.V1.expiration.Epoch
  commerceCheck(toBase64(bcs.TransactionData.serialize(transaction).toBytes()) === packet.bytes
    && transaction.V1.sender === expected.buyer && Number.isSafeInteger(epoch)
    && String(epoch) === packet.expirationEpoch, 'SALE_PACKET_IDENTITY')
  const custodyDelivery = input.custodyDelivery && structuredClone(input.custodyDelivery)
  const moneySettlement = input.moneySettlement && structuredClone(input.moneySettlement)
  const sourceCleanup = input.sourceCleanup && structuredClone(input.sourceCleanup)
  commerceCheck(!sourceCleanup || moneySettlement, 'SALE_HISTORY_CLEANUP_GRAPH_REQUIRED')
  commerceCheck(!moneySettlement || !custodyDelivery || custodyDelivery.buyerAccountId === moneySettlement.plan.buyerAccount.objectId,
    'SALE_HISTORY_ACCOUNT_GRAPH_BINDING')
  const result = await readFinalizedMutation({ client, packet, chainIdentifier: '35834a8a', genesisDigest: MAINNET_GENESIS,
    signal, errorPrefix: 'COMMERCE_SALE_HISTORY', proveSuccess: async context => {
      const nativePackage = await readPinnedMovePackage(client, native, signal)
      const foundationPackage = await readPinnedMovePackage(client, foundation, signal)
      const link = nativePackage.linkage.get(foundation.originalPackageId)
      commerceCheck(link?.upgradedId === foundation.callablePackageId && link.upgradedVersion === String(foundationPackage.version), 'SALE_HISTORY_LINK')
      const soldOrigin = nativePackage.origins.get('market::Sold'), paidOrigin = foundationPackage.origins.get('economics::Paid')
      commerceCheck(soldOrigin && paidOrigin, 'SALE_HISTORY_ORIGINS')
      const events = Events.parse(context.events)
      commerceCheck(events.length <= 16384 && toBase64(Events.serialize(events).toBytes()) === toBase64(context.events), 'SALE_HISTORY_EVENTS')
      const typed = (address: string, module: string, name: string) => events.filter(event => event.type_.address === address
        && event.type_.module === module && event.type_.name === name)
      const sold = typed(soldOrigin, 'market', 'Sold'), paid = typed(paidOrigin, 'economics', 'Paid')
      commerceCheck(sold.length === 1 && paid.length === 1, 'SALE_HISTORY_EVENT_COUNT')
      for (const [event, pin, module] of [[sold[0], native, 'market'], [paid[0], foundation, 'economics']] as const) {
        commerceCheck(event.package_id === pin.callablePackageId && event.transaction_module === module
          && event.sender === expected.buyer && event.type_.typeParams.length === 0, 'SALE_HISTORY_EVENT_AUTHORITY')
      }
      const sale = validateNativeSoldPayload(sold[0].contents, expected), payment = NativeSalePaidBcs.parse(paid[0].contents)
      commerceCheck(toBase64(NativeSalePaidBcs.serialize(payment).toBytes()) === toBase64(paid[0].contents)
        && payment.subject === expected.root && payment.payer === expected.buyer && payment.beneficiary === expected.seller
        && payment.gross === sale.total && payment.fee === sale.platform
        && payment.attempt.length === expected.attempt.length && payment.attempt.every((v, i) => v === expected.attempt[i]), 'SALE_HISTORY_PAYMENT')
      const money = moneySettlement ? await proveNativeSaleMoney({ client, packet, effects: context.effects,
        plan: moneySettlement.plan, native, foundation, collection: moneySettlement.collection,
        checkpoint: context.checkpoint, standard: moneySettlement.standard ?? custodyDelivery?.standard ?? sourceCleanup?.standard,
        sourceBinding: moneySettlement.sourceBinding, signal }) : null
      if (money && moneySettlement) {
        const plan = moneySettlement.plan, q = money.quote
        commerceCheck(plan.offerId === sale.offer && plan.soulId === sale.root && plan.buyer === sale.buyer
          && plan.sellerKioskId === sale.seller_kiosk && plan.buyerKioskId === sale.buyer_kiosk
          && plan.generation === sale.old_generation && plan.collectionId === sale.collection
          && plan.attemptHex === Array.from(sale.attempt, byte => byte.toString(16).padStart(2, '0')).join('')
          && money.seller === sale.seller && String(q.ask) === sale.ask && String(q.platform) === sale.platform
          && String(q.creator) === sale.creator && String(q.collection) === sale.collection_amount && String(q.total) === sale.total
          && money.collectionHolder === sale.collection_holder
          && (money.collectionSnapshot === null ? sale.collection_snapshot === null : sale.collection_snapshot !== null
            && toBase64(money.collectionSnapshot) === toBase64(Uint8Array.from(sale.collection_snapshot))), 'SALE_HISTORY_MONEY_EVENT_BINDING')
      }
      const custody = custodyDelivery ? await proveNativeSaleCustody({ client, effects: context.effects,
        transactionDigest: packet.digest, expected, buyerAccountId: custodyDelivery.buyerAccountId,
        native, standard: custodyDelivery.standard, custody: custodyDelivery.custody, signal }) : null
      if (custody && moneySettlement) commerceCheck(custody.buyerAccountInput.objectId === moneySettlement.plan.buyerAccount.objectId
        && custody.buyerAccountInput.version === moneySettlement.plan.buyerAccount.version
        && custody.buyerAccountInput.digest === moneySettlement.plan.buyerAccount.digest, 'SALE_HISTORY_ACCOUNT_REFERENCE_BINDING')
      const listingExit = moneySettlement ? await proveNativeSaleListingExit({ client, plan: moneySettlement.plan,
        effects: context.effects, transactionDigest: packet.digest, native, signal }) : null
      const cleanup = sourceCleanup && moneySettlement ? await proveNativeSaleCleanupTree({ client, plan: moneySettlement.plan,
        effects: context.effects, events: context.events, transactionDigest: packet.digest, checkpoint: context.checkpoint,
        native, standard: sourceCleanup.standard, content: sourceCleanup.content, signal }) : null
      const effectsReconciliation = reconcileNativeSaleEffects({ transactionDigest: packet.digest, soulId: expected.root,
        effects: context.effects, money, custody, listingExit, cleanup })
      return { proof: money ? 'native-sale-settlement-events-and-original-money' as const : 'native-sale-settlement-events-only' as const,
        transactionDigest: packet.digest, custody, money, listingExit, cleanup, effectsReconciliation,
        checkpoint: context.checkpoint, sale: NativeSoldBcs.parse(NativeSoldBcs.serialize(sale).toBytes()), payment,
        notDeliveryProof: true as const, notCurrentAuthority: true as const }
    } })
  // A settlement subproof must not satisfy runPublicMutation's SUCCEEDED branch
  // and mark an unfinished purchase/delivery operation terminal.
  return result.status === 'SUCCEEDED' ? { ...result, status: 'SETTLEMENT_CONFIRMED' as const } : result
}
