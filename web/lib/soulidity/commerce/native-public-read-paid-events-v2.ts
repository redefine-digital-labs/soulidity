import {bcs} from '@mysten/sui/bcs'
import {toBase64,toHex} from '@mysten/sui/utils'
import {readPinnedMovePackage,type PinnedMovePackage} from '../../sui/pinned-move-package'
import {publicMutationCanonical} from '../../sui/public-mutation-journal'
import {commerceCheck,decodeCommerce} from './economics-read'
import {NativePaidUpdatedBcs,NativeSubscriptionPaidBcs} from './native-paid-content-history'
import type {proveNativePublicReadPaidReceiptV2} from './native-public-read-paid-receipt-v2'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
const Events = bcs.vector(bcs.struct('Event', { package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
  type_: bcs.StructTag, contents: bcs.byteVector() }))

/** Shared business event match only; caller supplies original finality OR labels simulation explicitly. No source/current access/delivery authority. */
export async function proveNativePublicReadPaidEventsV2(input:{client:SuiGrpcClient;content:PinnedMovePackage;foundation:PinnedMovePackage;soulId:string;buyer:string;kind:number;attempt:Uint8Array;receipt:Awaited<ReturnType<typeof proveNativePublicReadPaidReceiptV2>>;events:Uint8Array;signal:AbortSignal}){
 const saved=structuredClone({content:input.content,foundation:input.foundation,soulId:input.soulId,buyer:input.buyer,kind:input.kind,attempt:input.attempt,receipt:input.receipt,events:input.events}),signal=input.signal,source=input.client.ledgerService
 const client={ledgerService:{getObject:source.getObject.bind(source)}} as unknown as SuiGrpcClient
 commerceCheck(saved.events instanceof Uint8Array&&saved.events.length<=1024*1024,'PUBLIC_PAID_V2_HISTORY_EVENTS_BOUND')
  const content = await readPinnedMovePackage(client, saved.content, signal), foundation = await readPinnedMovePackage(client, saved.foundation, signal)
  const updatedOrigin = content.origins.get('paid_access::Updated'), paidOrigin = foundation.origins.get('economics::Paid')
  commerceCheck(updatedOrigin && paidOrigin, 'PUBLIC_PAID_V2_HISTORY_EVENT_ORIGINS')
  const events = decodeCommerce(Events, saved.events)
  commerceCheck(events.length <= 16384 && toBase64(Events.serialize(events).toBytes()) === toBase64(saved.events), 'PUBLIC_PAID_V2_HISTORY_EVENTS')
  const select = (origin: string, module: string, name: string) => events.filter(e => e.type_.address === origin && e.type_.module === module && e.type_.name === name)
  const updated = select(updatedOrigin, 'paid_access', 'Updated'), paid = select(paidOrigin, 'economics', 'Paid')
  commerceCheck(updated.length === 1 && paid.length === 1, 'PUBLIC_PAID_V2_HISTORY_EVENT_COUNT')
  for (const [event, pin, module] of [[updated[0], saved.content, 'paid_access'], [paid[0], saved.foundation, 'economics']] as const) {
    commerceCheck(event.package_id === pin.callablePackageId && event.transaction_module === module
      && event.sender === saved.buyer && event.type_.typeParams.length === 0, 'PUBLIC_PAID_V2_HISTORY_EVENT_AUTHORITY')
  }
  const change = decodeCommerce(NativePaidUpdatedBcs, updated[0].contents), payment = decodeCommerce(NativeSubscriptionPaidBcs, paid[0].contents)
  commerceCheck(publicMutationCanonical(change) === publicMutationCanonical({ root: saved.soulId, kind: saved.kind, buyer: saved.buyer,
    revision: saved.receipt.entry.revision, operation: 2, entry: saved.receipt.entry }), 'PUBLIC_PAID_V2_HISTORY_ENTRY_EVENT')
  commerceCheck(payment.subject === saved.soulId && payment.payer === saved.buyer && payment.beneficiary === saved.receipt.receipt.beneficiary
    && payment.gross === saved.receipt.receipt.total && payment.fee === saved.receipt.receipt.platform_fee
    && toHex(payment.attempt) === toHex(saved.attempt), 'PUBLIC_PAID_V2_HISTORY_PAYMENT_EVENT')
 return {change,payment}
}
