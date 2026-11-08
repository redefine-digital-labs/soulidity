import { bcs } from '@mysten/sui/bcs'
import { toBase64, toHex } from '@mysten/sui/utils'
import { readFinalizedMutation } from '../../sui/finalized-mutation'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { commerceCheck } from './economics-read'
import { PaidContentEntryBcs } from './paid-content-policy'
import { assertNativePaidContentPacket } from './native-paid-content-packet'
import { proveNativePaidServiceOpeningHistory } from './native-paid-service-opening-history'
import { reconcileNativePaidContentEffects } from './native-paid-content-effects'
import { proveNativePaidContentTreeHistory } from './native-paid-content-tree-history'
import { proveNativePaidContentOfferHistory } from './native-paid-content-offer-history'
import { proveNativePaidContentServiceHistory } from './native-paid-content-service-history'
import type { PinnedMovePackage } from '../../sui/pinned-move-package'
import { proveNativePaidContentMoney } from './native-paid-content-money'
import { proveNativePaidContentReceipt } from './native-paid-content-receipt'

const Events = bcs.vector(bcs.struct('Event', { package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
  type_: bcs.StructTag, contents: bcs.byteVector() }))
export const NativePaidUpdatedBcs = bcs.struct('Updated', { root: bcs.Address, kind: bcs.u32(), buyer: bcs.option(bcs.Address),
  revision: bcs.u64(), operation: bcs.u8(), entry: bcs.option(PaidContentEntryBcs) })
export const NativeSubscriptionPaidBcs = bcs.struct('Paid', { subject: bcs.Address, attempt: bcs.byteVector(), payer: bcs.Address,
  gross: bcs.u64(), fee: bcs.u64(), beneficiary: bcs.Address })

/** Frozen current-ABI subscription recovery query. Authenticates the original
 * transaction/checkpoint, durable entry and business events; it cannot complete
 * delivery or substitute for original service/offer and actual money proofs.
 * No saved operation is rebuilt, signed, broadcast or marked SUCCEEDED here.
 */
export async function readNativePaidContentHistory(input: Omit<Parameters<typeof proveNativePaidContentReceipt>[0], 'effects' | 'packet'> & { packet: PublicMutationPacket; proveMoney?: boolean; proveOfferHistory?: boolean; proveTreeHistory?: boolean; proveOpeningHistory?: boolean; serviceContext?: { standard: PinnedMovePackage; custody: PinnedMovePackage } }) {
  const saved = structuredClone({ intent: input.intent, packet: input.packet, gas: input.gas, offer: input.offer,
    soulId: input.soulId, stateId: input.stateId, ledgerId: input.ledgerId, native: input.native, content: input.content, foundation: input.foundation })
  const serviceContext = input.serviceContext && structuredClone(input.serviceContext)
  const proveOpeningHistory = input.proveOpeningHistory === true
  commerceCheck(!proveOpeningHistory || serviceContext, 'PAID_HISTORY_OPENING_SERVICE_CONTEXT')
  const proveTreeHistory = input.proveTreeHistory === true
  commerceCheck(!proveTreeHistory || serviceContext, 'PAID_HISTORY_TREE_SERVICE_CONTEXT')
  const proveOfferHistory = input.proveOfferHistory === true
  const proveMoney = input.proveMoney === true
  const client = input.client, signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  await assertNativePaidContentPacket(saved.intent, saved.packet, saved.gas)
  const result = await readFinalizedMutation({ client, packet: saved.packet, signal, chainIdentifier: '35834a8a',
    genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', errorPrefix: 'COMMERCE_PAID_HISTORY', proveSuccess: async context => {
      const receipt = await proveNativePaidContentReceipt({ ...saved, client, signal, effects: context.effects })
      const content = await readPinnedMovePackage(client, saved.content, signal), foundation = await readPinnedMovePackage(client, saved.foundation, signal)
      const updatedOrigin = content.origins.get('paid_access::Updated'), paidOrigin = foundation.origins.get('economics::Paid')
      commerceCheck(updatedOrigin && paidOrigin, 'PAID_HISTORY_EVENT_ORIGINS')
      const events = Events.parse(context.events)
      commerceCheck(events.length <= 16384 && toBase64(Events.serialize(events).toBytes()) === toBase64(context.events), 'PAID_HISTORY_EVENTS')
      const select = (origin: string, module: string, name: string) => events.filter(e => e.type_.address === origin && e.type_.module === module && e.type_.name === name)
      const updated = select(updatedOrigin, 'paid_access', 'Updated'), paid = select(paidOrigin, 'economics', 'Paid')
      commerceCheck(updated.length === 1 && paid.length === 1, 'PAID_HISTORY_EVENT_COUNT')
      for (const [event, pin, module] of [[updated[0], saved.content, 'paid_access'], [paid[0], saved.foundation, 'economics']] as const) {
        commerceCheck(event.package_id === pin.callablePackageId && event.transaction_module === module
          && event.sender === saved.intent.buyer && event.type_.typeParams.length === 0, 'PAID_HISTORY_EVENT_AUTHORITY')
      }
      const change = NativePaidUpdatedBcs.parse(updated[0].contents), payment = NativeSubscriptionPaidBcs.parse(paid[0].contents)
      commerceCheck(toBase64(NativePaidUpdatedBcs.serialize(change).toBytes()) === toBase64(updated[0].contents)
        && publicMutationCanonical(change) === publicMutationCanonical({ root: saved.soulId, kind: saved.intent.kind, buyer: saved.intent.buyer,
          revision: receipt.entry.revision, operation: 2, entry: receipt.entry }), 'PAID_HISTORY_ENTRY_EVENT')
      commerceCheck(toBase64(NativeSubscriptionPaidBcs.serialize(payment).toBytes()) === toBase64(paid[0].contents)
        && payment.subject === saved.soulId && payment.payer === saved.intent.buyer && payment.beneficiary === receipt.receipt.beneficiary
        && payment.gross === receipt.receipt.total && payment.fee === receipt.receipt.platform_fee
        && toHex(payment.attempt) === toHex(saved.intent.attempt), 'PAID_HISTORY_PAYMENT_EVENT')
      const money = proveMoney ? await proveNativePaidContentMoney({ ...saved, client, signal, effects: context.effects }) : null
      const service = serviceContext ? await proveNativePaidContentServiceHistory({ ...saved, ...serviceContext, client, signal, effects: context.effects }) : null
      const offerHistory = proveOfferHistory ? await proveNativePaidContentOfferHistory({ ...saved, client, signal, effects: context.effects, checkpoint: context.checkpoint }) : null
      const treeHistory = proveTreeHistory && serviceContext ? await proveNativePaidContentTreeHistory({ ...saved, ...serviceContext, client, signal, effects: context.effects, checkpoint: context.checkpoint }) : null
      const openingHistory = proveOpeningHistory && serviceContext ? await proveNativePaidServiceOpeningHistory({ ...saved, ...serviceContext, client, signal, effects: context.effects, checkpoint: context.checkpoint }) : null
      const effectsReconciliation = reconcileNativePaidContentEffects({ transactionDigest: saved.packet.digest, effects: context.effects, receipt, money, service, tree: treeHistory })
      return { ...receipt, proof: 'native-paid-finalized-entry-receipt-events' as const, checkpoint: context.checkpoint,
        requiresOriginalFinalityAndEvents: false as const, notMoneySettlementProof: money === null, requiresOriginalPolicyProof: true as const, openingHistory, effectsReconciliation, treeHistory, offerHistory, service, money, payment, change }
    } })
  return result.status === 'SUCCEEDED' ? { ...result, status: 'SUBSCRIPTION_RECORDED' as const } : result
}
