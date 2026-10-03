import {expect,it} from 'vitest'
import {Inputs,Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {toBase58,toBase64} from '@mysten/sui/utils'
import {buildBuyAnimacraftEquipmentV8Tx,buildCancelAnimacraftEquipmentV8Tx,
  buildRecoverAnimacraftEquipmentV8Tx} from '@soulidity/sdk'
import {validateListingTransactionBytes} from '../../web/lib/animacraft/listing-transaction-validation'

const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
const ref={objectId:id(10),version:'9007199254740994',digest:'1'.repeat(32)}
async function fixture(action:'buy'|'cancel'|'recover'='cancel',kind:'base'|'external'='base'){
  const input={target:{marketCallablePackageId:id(1),paymentCoinType:'0x2::sui::SUI',
    registryId:id(2),treasuryId:id(3),rootId:id(4),protocolConfigId:id(5),catalogId:id(6),replacementId:id(7),packageConfigId:id(8)},
    listingId:id(9),expectedRevision:'9007199254740993',receiving:ref,
    ...(kind==='base'?{kind,packRegistryId:id(11),definitionRegistryId:id(12)}:{kind})}
  const expected=action==='buy'?buildBuyAnimacraftEquipmentV8Tx({...input,protocolTreasuryId:id(15),priceAtomic:10000n,paymentCoinObjectIds:[id(16),id(17)]})
    :(action==='cancel'?buildCancelAnimacraftEquipmentV8Tx:buildRecoverAnimacraftEquipmentV8Tx)(input)
  const owned=new Set([id(16),id(17)]),mutable=new Set([id(9),id(2),id(3),id(15),id(11),id(12)])
  const data=expected.getData()
  data.inputs=data.inputs.map(i=>i.UnresolvedObject?(owned.has(i.UnresolvedObject.objectId)
    ?Inputs.ObjectRef({...ref,objectId:i.UnresolvedObject.objectId})
    :Inputs.SharedObjectRef({objectId:i.UnresolvedObject.objectId,initialSharedVersion:'1',mutable:mutable.has(i.UnresolvedObject.objectId)})):i)
  const tx=Transaction.from(JSON.stringify(data))
  tx.setSender(id(99));tx.setGasOwner(id(99));tx.setGasPrice(1);tx.setGasBudget(100000)
  tx.setGasPayment([{...ref,objectId:id(100)}]);tx.setExpiration({Epoch:9})
  const params={owner:id(99),expected,owned,mutable,forbidden:[id(1)]}
  async function check(t=tx){const bytes=await t.build();validateListingTransactionBytes({bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch:'9'},params)}
  return {tx,params,check}
}
it.each(['buy','cancel','recover'] as const)('accepts exact equipment %s bytes for both instance kinds',async action=>{
  for(const kind of ['base','external'] as const)await (await fixture(action,kind)).check()
})
it.each(['id','version','digest','owned-kind','gas'] as const)('rejects Receiving %s substitution even with a fresh transaction digest',async change=>{
  const f=await fixture(),data=f.tx.getData(),index=data.inputs.findIndex(i=>i.Object?.Receiving)
  const receiving={...ref}
  if(change==='id')receiving.objectId=id(101)
  if(change==='version')receiving.version='9007199254740995'
  if(change==='digest')receiving.digest=toBase58(new Uint8Array(32).fill(2))
  if(change==='gas')data.gasData.payment=[ref]
  else data.inputs[index]=change==='owned-kind'?Inputs.ObjectRef(receiving):Inputs.ReceivingRef(receiving)
  await expect(f.check(Transaction.from(JSON.stringify(data)))).rejects.toThrow(/Receiving|gas overlaps/)
})
it.each(['owned','mutable'] as const)('rejects conflicting Receiving %s role',async role=>{
  const f=await fixture();f.params[role].add(ref.objectId)
  await expect(f.check()).rejects.toThrow('Receiving input mismatch')
})
it('fails closed for unsupported pre-resolved expected object kinds',async()=>{
  const f=await fixture(),data=f.params.expected.getData()
  const index=data.inputs.findIndex(i=>i.Object?.Receiving)
  data.inputs[index]=Inputs.ObjectRef(ref)
  f.params.expected=Transaction.from(JSON.stringify(data))
  await expect(f.check()).rejects.toThrow('Unsupported listing expected object input')
})
