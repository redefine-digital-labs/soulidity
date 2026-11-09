import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toHex } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readFinalizedMutation, type FinalizedMutationContext } from '../../sui/finalized-mutation'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { publicMutationCanonical as canonical, type PublicMutationPacket } from '../../sui/public-mutation-journal'
import { commerceCheck as check, decodeCommerce } from './economics-read'
import type { NativeSaleGraphPlan } from './native-sale-graph'
import { proveNativeSaleMoney } from './native-sale-money'
import { proveNativeSaleListingExit } from './native-sale-listing-exit'
import { proveNativeSaleCustody } from './native-sale-custody'
import { proveNativeSaleCleanupTree } from './native-sale-cleanup-tree'
import { reconcileNativeSaleEffects } from './native-sale-effects'
import { NativeSoldBcs } from './native-sale-receipt'
import { NativeSalePaidBcs } from './native-sale-history'
import type { prepareNativeSalePurchase } from './native-sale-preparation'

const Events = bcs.vector(bcs.struct('Event', {
  package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
  type_: bcs.StructTag, contents: bcs.byteVector(),
}))

/** Shared receipt proof for a retained portable plan or ledger-derived inputs. */
export async function readNativeSaleFinalized(input: {
  client: SuiGrpcClient; signal: AbortSignal; packet: PublicMutationPacket; buyer: string
  context: Pick<Awaited<ReturnType<typeof prepareNativeSalePurchase>>['context'], 'target' | 'economics' | 'collection'>
  plan: NativeSaleGraphPlan | ((evidence: FinalizedMutationContext, total: string) => Promise<NativeSaleGraphPlan>)
  proveSaleSource: boolean; proveSaleCustody: boolean; proveSaleCleanup: boolean
}) {
  const { client, signal, buyer, proveSaleSource, proveSaleCustody, proveSaleCleanup } = input
  const { packet, context } = structuredClone({ packet: input.packet, context: input.context })
  const planSource = typeof input.plan === 'function' ? input.plan : structuredClone(input.plan)
  const { native, standard } = context.target, { foundation } = context.economics
  check(!proveSaleCustody || context.target.custody, 'PURCHASE_ORIGINAL_CUSTODY_PIN_REQUIRED')
  check(!proveSaleCleanup || context.target.content, 'PURCHASE_ORIGINAL_CLEANUP_PIN_REQUIRED')
  const result = await readFinalizedMutation({
    client, packet, signal, chainIdentifier: '35834a8a', genesisDigest: MAINNET_GENESIS_DIGEST, errorPrefix: 'PURCHASE_ORIGINAL_SALE',
    proveSuccess: async evidence => {
      const { effects, checkpoint } = evidence, transactionDigest = packet.digest
      const [nativePackage, foundationPackage] = await Promise.all([
        readPinnedMovePackage(client, native, signal), readPinnedMovePackage(client, foundation, signal),
      ])
      const events = decodeCommerce(Events, evidence.events)
      check(events.length <= 16384, 'PURCHASE_ORIGINAL_EVENTS')
      const typed = (address: string | undefined, module: string, name: string) =>
        events.filter(event => event.type_.address === address && event.type_.module === module && event.type_.name === name)
      const sold = typed(nativePackage.origins.get('market::Sold'), 'market', 'Sold')
      const paid = typed(foundationPackage.origins.get('economics::Paid'), 'economics', 'Paid')
      check(sold.length === 1 && paid.length === 1, 'PURCHASE_ORIGINAL_EVENT_COUNT')
      for (const [event, pin, module] of [[sold[0], native, 'market'], [paid[0], foundation, 'economics']] as const) {
        check(event.package_id === pin.callablePackageId && event.transaction_module === module
          && event.sender === buyer && event.type_.typeParams.length === 0, 'PURCHASE_ORIGINAL_EVENT_AUTHORITY')
      }

      const sale = decodeCommerce(NativeSoldBcs, sold[0].contents), payment = decodeCommerce(NativeSalePaidBcs, paid[0].contents)
      const plan = typeof planSource === 'function' ? await planSource(evidence, sale.total) : planSource
      check(plan.buyer === buyer, 'PURCHASE_ORIGINAL_BUYER')
      const money = await proveNativeSaleMoney({ client, plan, packet, effects, native, foundation,
        collection: context.collection ?? undefined, checkpoint, standard: proveSaleSource ? standard : undefined, sourceBinding: proveSaleSource, signal })
      const quote = money.quote
      const collectionSnapshot = money.collectionSnapshot === null ? null : toHex(money.collectionSnapshot)
      check(sale.offer === plan.offerId && sale.root === plan.soulId && sale.buyer === buyer
        && sale.seller === money.seller && sale.seller_kiosk === plan.sellerKioskId && sale.buyer_kiosk === plan.buyerKioskId
        && sale.old_generation === plan.generation && toHex(Uint8Array.from(sale.attempt)) === plan.attemptHex
        && sale.collection === plan.collectionId && sale.collection_holder === money.collectionHolder
        && (sale.collection_snapshot === null ? null : toHex(Uint8Array.from(sale.collection_snapshot))) === collectionSnapshot
        && sale.ask === String(quote.ask) && sale.platform === String(quote.platform) && sale.creator === String(quote.creator)
        && sale.collection_amount === String(quote.collection) && sale.total === String(quote.total), 'PURCHASE_ORIGINAL_MONEY_EVENT_BINDING')
      check(payment.subject === plan.soulId && payment.payer === buyer && payment.beneficiary === money.seller
        && payment.gross === sale.total && payment.fee === sale.platform && toHex(payment.attempt) === plan.attemptHex,
      'PURCHASE_ORIGINAL_PAYMENT_EVENT')

      const listingExit = await proveNativeSaleListingExit({ client, plan, effects, transactionDigest, native, signal })
      const custody = proveSaleCustody ? await proveNativeSaleCustody({ client, effects, transactionDigest,
        expected: { root: plan.soulId, seller: money.seller, buyer, sellerKiosk: plan.sellerKioskId, buyerKiosk: plan.buyerKioskId },
        buyerAccountId: plan.buyerAccount.objectId, native, standard, custody: context.target.custody!, signal }) : null
      if (custody) {
        check(canonical(custody.buyerAccountInput) === canonical(plan.buyerAccount), 'PURCHASE_ORIGINAL_CUSTODY_ACCOUNT_REFERENCE')
        check(custody.kioskInputs.every(kiosk => plan.shared.some(ref => ref.objectId === kiosk.objectId
          && ref.mutable && ref.initialSharedVersion === kiosk.initialSharedVersion)), 'PURCHASE_ORIGINAL_CUSTODY_KIOSK_REFERENCE')
      }
      const cleanup = proveSaleCleanup ? await proveNativeSaleCleanupTree({ client, plan, effects, events: evidence.events,
        transactionDigest, checkpoint, native, standard, content: context.target.content!, signal }) : null
      const effectsReconciliation = reconcileNativeSaleEffects({ transactionDigest, soulId: plan.soulId, effects, money, listingExit, custody, cleanup })
      return { money, listingExit, custody, cleanup, effectsReconciliation, checkpointProof: evidence.checkpointProof, notCompleteSaleProof: true as const,
        notDeliveryProof: true as const, notCurrentAuthority: true as const }
    },
  })
  return result.status === 'SUCCEEDED' ? { ...result, status: 'SETTLEMENT_CONFIRMED' as const } : result
}
