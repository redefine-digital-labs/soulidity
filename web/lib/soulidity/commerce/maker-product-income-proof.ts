import { assertSimulatedEventFrameV1 } from '../../sui/simulated-execution-frame-v1'
import { assertIncomeExecutionSourceFrameV1, type IncomeExecutionFrameV1 } from './income-execution-source-v1'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { assertHistoricalEventFrameV1 } from '../../sui/historical-execution-frame-v1'
import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readMakerProductIncomeGasWindow } from './maker-product-income-gas'
import { proveSuiAddressGas } from '../../sui/address-balance-effects'
import { readSuiGasSettlement } from '../../sui/gas-settlement'
import { commerceCheck, commerceId, decodeCommerce } from './economics-read'
import { CurrentMakerProductBcs } from '../../animacraft/current-maker-product-bcs'
import { MakerProductControlBcs, parseMakerProductIncomeTarget, type MakerProductIncomeTarget } from './maker-product-income-read'
import { IncomeRequestBcs, IncomeReceiptBcs, IncomeReceiptFieldBcs } from './economics-bcs'

const Events = bcs.vector(bcs.struct('Event', { package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
  type_: bcs.StructTag, contents: bcs.byteVector() }))
export const IncomeWithdrawnBcs = bcs.struct('Withdrawn', { receipt: IncomeReceiptBcs })
const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
export interface MakerProductIncomeIntent { actor: string; controlId: string; recipient: string; amount: string; revision: string; attempt: Uint8Array }

/** Pure packet constraints; no finality, current authority or payment claim. */
export function assertMakerProductIncomePacket(input:{target:MakerProductIncomeTarget;packet:PublicMutationPacket;intent:MakerProductIncomeIntent}){
 const target=parseMakerProductIncomeTarget(input.target),{packet,intent}=input
  commerceCheck(target.chainIdentifier === '35834a8a' && [intent.actor, intent.controlId, intent.recipient, target.productId].every(commerceId)
    && /^(0|[1-9][0-9]{0,19})$/.test(intent.revision) && BigInt(intent.revision) < 18446744073709551615n
    && /^[1-9][0-9]{0,19}$/.test(intent.amount) && BigInt(intent.amount) <= 18446744073709551615n
    && intent.attempt instanceof Uint8Array && intent.attempt.length === 32 && intent.attempt.some(v => v !== 0), 'MAKER_INCOME_HISTORY_INTENT')
  commerceCheck(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 180000, 'MAKER_INCOME_HISTORY_PACKET_BOUND')
  const bytes = fromBase64(packet.bytes), raw = bcs.TransactionData.parse(bytes), data = Transaction.from(bytes).getData()
  const gasWindow = readMakerProductIncomeGasWindow(data, intent.actor, packet.expirationEpoch)
  commerceCheck(bytes.length <= 128 * 1024 && toBase64(bytes) === packet.bytes
    && toBase64(bcs.TransactionData.serialize(raw).toBytes()) === packet.bytes && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest
    && data.sender === intent.actor && gasWindow, 'MAKER_INCOME_HISTORY_PACKET')
  const call = data.commands[0]?.MoveCall, coinType = normalizeStructTag(target.coinType)
  commerceCheck(data.commands.length === 1 && data.inputs.length === 6 && call
    && call.package === target.manufacturing.callablePackageId && call.module === 'maker_catalog' && call.function === 'withdraw_income'
    && call.typeArguments.length === 1 && normalizeStructTag(call.typeArguments[0]) === coinType && call.arguments.length === 6
    && call.arguments.every((arg, index) => arg.$kind === 'Input' && arg.Input === index), 'MAKER_INCOME_HISTORY_GRAPH')
  commerceCheck(data.inputs[0].Object?.SharedObject?.objectId === target.productId && data.inputs[0].Object.SharedObject.mutable
    && data.inputs[1].Object?.ImmOrOwnedObject?.objectId === intent.controlId, 'MAKER_INCOME_HISTORY_INPUTS')
  const pure = [bcs.u64().serialize(intent.revision), bcs.u64().serialize(intent.amount), bcs.Address.serialize(intent.recipient), bcs.byteVector().serialize(intent.attempt)]
  commerceCheck(pure.every((value, index) => data.inputs[index + 2].Pure?.bytes === toBase64(value.toBytes())), 'MAKER_INCOME_HISTORY_ARGUMENTS')
 return {data,coinType,gasWindow}
}
/** Scoped full Object/effect/event proof used for ORIGINAL finalized recovery
 * or explicitly simulated witnesses. It NEVER proves checkpoint/finality. */
async function inspectMakerProductIncomeEffectsInternal(input:{client:SuiGrpcClient;target:MakerProductIncomeTarget;packet:PublicMutationPacket;intent:MakerProductIncomeIntent;effects:ReturnType<typeof bcs.TransactionEffects.parse>;events:Uint8Array;signal:AbortSignal;executionFrame?:IncomeExecutionFrameV1;executionCheckpoint?:string}){
 const {target,packet,intent,effects}=structuredClone({target:input.target,packet:input.packet,intent:input.intent,effects:input.effects}),eventsBytes=new Uint8Array(input.events),signal=input.signal
 const executionFrame=input.executionFrame,executionCheckpoint=input.executionCheckpoint
 if(executionFrame) assertIncomeExecutionSourceFrameV1(executionFrame)
 const ledger=input.client.ledgerService,client={ledgerService:{getObject:ledger.getObject.bind(ledger)}} as unknown as SuiGrpcClient
 const {data,coinType,gasWindow}=assertMakerProductIncomePacket({target,packet,intent})
 commerceCheck(effects.V2?.status.$kind==='Success'&&effects.V2.transactionDigest===packet.digest&&effects.V2.changedObjects.length<=4096
  &&BigInt(effects.V2.executedEpoch)>=BigInt(gasWindow.min)&&BigInt(effects.V2.executedEpoch)<=BigInt(gasWindow.max)
  &&new Set(effects.V2.changedObjects.map(([id])=>id)).size===effects.V2.changedObjects.length,'MAKER_INCOME_EFFECTS_CONTEXT')
      const pkg = await readPinnedMovePackage(client, target.foundation, signal)
      const manufacturing = await readPinnedMovePackage(client, target.manufacturing, signal)
      const link = manufacturing.linkage.get(target.foundation.originalPackageId)
      commerceCheck(link?.upgradedId === target.foundation.callablePackageId && link.upgradedVersion === String(pkg.version), 'MAKER_INCOME_REVENUE_DEPENDENCY')
      const type = (module: string, name: string) => { const origin = (module === 'maker_catalog' ? manufacturing : pkg).origins.get(`${module}::${name}`)
        commerceCheck(origin, 'MAKER_INCOME_HISTORY_ORIGIN'); return `${origin}::${module}::${name}` }
      const events = decodeCommerce(Events, eventsBytes), withdrawnType = type('revenue', 'Withdrawn')
      commerceCheck(events.length === 1, 'MAKER_INCOME_HISTORY_EVENT_COUNT')
      const event = events[0]
      commerceCheck(`${event.type_.address}::${event.type_.module}::${event.type_.name}` === withdrawnType
        && event.type_.typeParams.length === 0 && event.sender === intent.actor, 'MAKER_INCOME_HISTORY_EVENT_AUTHORITY')
      if(executionFrame){
        const topCall={commandIndex:0,packageId:target.manufacturing.callablePackageId,module:'maker_catalog',function:'withdraw_income'}
        if(executionFrame.status==='QUALIFIED_EVENT_FRAME'){
          commerceCheck(executionCheckpoint!==undefined,'MAKER_INCOME_EXECUTION_CHECKPOINT_REQUIRED')
          assertHistoricalEventFrameV1({frame:executionFrame,context:{kind:'HISTORICAL_FINALIZED',genesisDigest:MAINNET_GENESIS_DIGEST,transactionBytes:packet.bytes,transactionDigest:packet.digest,effects,checkpoint:executionCheckpoint},event,topCall})
        } else assertSimulatedEventFrameV1({frame:executionFrame,context:{kind:'SIMULATED',genesisDigest:MAINNET_GENESIS_DIGEST,transactionBytes:packet.bytes,transactionDigest:packet.digest,effects},event,topCall})
      }
      const receipt = decodeCommerce(IncomeWithdrawnBcs, event.contents).receipt
      commerceCheck(receipt.root === target.productId && receipt.actor === intent.actor && receipt.recipient === intent.recipient
        && receipt.amount === intent.amount && receipt.before_revision === intent.revision
        && BigInt(receipt.after_revision) === BigInt(intent.revision) + 1n
        && receipt.attempt.length === 32 && receipt.attempt.every((v, i) => v === intent.attempt[i]), 'MAKER_INCOME_HISTORY_RECEIPT')
      const read = (id: string, expectedType: string, mode: 'input' | 'mutated' | 'created') => readHistoricalMoveObject({
        client, effects: effects, transactionDigest: packet.digest, objectId: id, type: expectedType, mode, signal })
      const productType = `${type('maker_catalog', 'Product')}<${coinType}>`
      const before = await read(target.productId, productType, 'input'), after = await read(target.productId, productType, 'mutated')
      const a = decodeCommerce(CurrentMakerProductBcs, before.bytes), b = decodeCommerce(CurrentMakerProductBcs, after.bytes)
      commerceCheck(before.object.owner.$kind === 'Shared' && after.object.owner.$kind === 'Shared'
        && a.id === target.productId && b.id === target.productId && a.income.root === a.id && b.income.root === b.id
        && a.protocol === target.protocolId && b.protocol === target.protocolId
        && a.market.config === target.protocolId && a.primary.config === target.protocolId
        && before.object.owner.Shared!.initialSharedVersion === after.object.owner.Shared!.initialSharedVersion
        && before.object.owner.Shared!.initialSharedVersion === String(data.inputs[0].Object!.SharedObject!.initialSharedVersion)
        && a.income.revision === intent.revision && b.income.revision === receipt.after_revision
        && BigInt(a.income.funds) - BigInt(b.income.funds) === BigInt(intent.amount)
        && b.income.funds === receipt.balance && a.income.collected === b.income.collected && b.income.collected === receipt.total_collected
        && BigInt(b.income.withdrawn) - BigInt(a.income.withdrawn) === BigInt(intent.amount)
        && b.income.withdrawn === receipt.total_withdrawn && BigInt(b.income.collected) - BigInt(b.income.withdrawn) === BigInt(b.income.funds)
        && a.income.requests.id === b.income.requests.id && BigInt(b.income.requests.size) === BigInt(a.income.requests.size) + 1n
        && JSON.stringify({ ...a, income: null }) === JSON.stringify({ ...b, income: null }), 'MAKER_INCOME_HISTORY_LEDGER')
      const control = await read(intent.controlId, type('maker_catalog', 'Control'), 'input'), cap = decodeCommerce(MakerProductControlBcs, control.bytes)
      const controlAfter = await read(intent.controlId, type('maker_catalog', 'Control'), 'mutated')
      const ref = data.inputs[1].Object!.ImmOrOwnedObject!
      commerceCheck(control.object.owner.AddressOwner === intent.actor && cap.product === target.productId && cap.id === intent.controlId
        && control.reference.version === BigInt(ref.version) && control.reference.digest === ref.digest
        && controlAfter.object.owner.AddressOwner === intent.actor && toBase64(control.bytes) === toBase64(controlAfter.bytes), 'MAKER_INCOME_HISTORY_CONTROL')
      const requestType = type('revenue', 'Request'), receiptType = type('revenue', 'Receipt')
      const fieldId = deriveDynamicFieldID(b.income.requests.id, requestType, IncomeRequestBcs.serialize({ actor: intent.actor, attempt: intent.attempt }).toBytes())
      const fieldObject = await read(fieldId, `0x2::dynamic_field::Field<${requestType},${receiptType}>`, 'created')
      const field = decodeCommerce(IncomeReceiptFieldBcs, fieldObject.bytes)
      commerceCheck(fieldObject.object.owner.ObjectOwner === b.income.requests.id && field.id === fieldId
        && field.name.actor === intent.actor && toBase64(field.name.attempt) === toBase64(intent.attempt)
        && toBase64(IncomeReceiptBcs.serialize(field.value).toBytes()) === toBase64(IncomeReceiptBcs.serialize(receipt).toBytes()), 'MAKER_INCOME_HISTORY_DURABLE_RECEIPT')
      const payments = effects.V2!.changedObjects.filter(([, change]) => change.idOperation.$kind === 'Created'
        && change.outputState.ObjectWrite?.[1].AddressOwner === intent.recipient)
      commerceCheck(payments.length === 1, 'MAKER_INCOME_HISTORY_PAYMENT_COUNT')
      const payment = await read(payments[0][0], `0x2::coin::Coin<${coinType}>`, 'created'), coin = decodeCommerce(Coin, payment.bytes)
      commerceCheck(payment.object.owner.AddressOwner === intent.recipient && coin.id === payments[0][0] && coin.balance === intent.amount, 'MAKER_INCOME_HISTORY_PAYMENT')
      const gas = gasWindow.addressGas
        ? proveSuiAddressGas({ effects, transactionDigest: packet.digest, owner: intent.actor, budget: data.gasData.budget! })
        : await readSuiGasSettlement({ client, packet, effects, signal })
      const gasEffectIds = 'accumulatorIds' in gas ? gas.accumulatorIds : gas.gasCoinIds
      const claimed = new Set([target.productId, intent.controlId, fieldId, coin.id, ...gasEffectIds])
      commerceCheck(claimed.size === 4 + gasEffectIds.length && effects.V2!.changedObjects.length === claimed.size
        && effects.V2!.changedObjects.every(([id]) => claimed.has(id)), 'MAKER_INCOME_HISTORY_EXTRA_EFFECTS')
      return { proof: 'maker-product-withdrawal-ledger-control-payment-gas-subproof' as const, requiresOriginalFinalityAndCheckpoint: true as const, transactionDigest: packet.digest, receipt, gas,
        inputProduct:{objectId:target.productId,version:String(before.reference.version),digest:before.reference.digest},
        inputControl:{objectId:intent.controlId,version:String(control.reference.version),digest:control.reference.digest},
        coinType, paymentCoinId: coin.id, notCurrentBalance: true as const }
}

/** Full domain proof needs both independently qualified source and an actual
 * historical or simulated frame capability bound to these exact effects. */
export function proveMakerProductIncomeEffects(input:Parameters<typeof inspectMakerProductIncomeEffectsInternal>[0]){
 commerceCheck(input.executionFrame,'MAKER_INCOME_EXECUTION_FRAME_REQUIRED')
 return inspectMakerProductIncomeEffectsInternal(input)
}
/** Run every object/receipt/payment/Gas check even when simulation has no
 * qualified model. This inspection cannot confirm business output or payment. */
export async function inspectUnqualifiedMakerProductIncomeEffects(input:Omit<Parameters<typeof inspectMakerProductIncomeEffectsInternal>[0],'executionFrame'|'executionCheckpoint'>){
 const value=await inspectMakerProductIncomeEffectsInternal({client:input.client,signal:input.signal,target:input.target,packet:input.packet,intent:input.intent,effects:input.effects,events:input.events})
 return {...value,proof:'unqualified-withdrawal-effects-inspection' as const,completeBusinessOutputVerified:false as const,requiresQualifiedExecutionFrame:true as const}
}
