import {bcs} from '@mysten/sui/bcs'
import {Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {fromBase58,toBase58,fromBase64,toBase64} from '@mysten/sui/utils'

function check(value:unknown,message:string):asserts value {if(!value)throw new Error(message)}
const positive=(v:unknown)=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n
const id=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&!/^0x0+$/.test(v)
const digest=(v:unknown)=>{try{return typeof v==='string'&&v.length<=44&&fromBase58(v).length===32&&toBase58(fromBase58(v))===v}catch{return false}}

/** The entire PTB must equal the authenticated plan. Shared objects are deduped
 * by the SDK; no extra commands, pure values, object inputs or asset gas allowed. */
export function validateListingTransactionBytes(value:{bytes:string;digest:string;expirationEpoch:string},params:{
  owner:string;expected:Transaction;owned:Set<string>;mutable:Set<string>;forbidden:Iterable<string>
}) {
  check(typeof value.bytes==='string'&&value.bytes.length>0&&value.bytes.length<=180000&&digest(value.digest),'Invalid native listing bytes')
  const bytes=fromBase64(value.bytes),data=bcs.TransactionData.parse(bytes)
  check(toBase64(bytes)===value.bytes&&toBase64(bcs.TransactionData.serialize(data).toBytes())===value.bytes
    &&TransactionDataBuilder.getDigestFromBytes(bytes)===value.digest,'Listing bytes/digest mismatch')
  const tx=Transaction.from(bytes).getData(),expected=params.expected.getData()
  check(tx.sender===params.owner&&tx.gasData.owner===params.owner&&positive(tx.gasData.budget)&&positive(tx.gasData.price)
    &&tx.gasData.payment?.length&&String(data.V1?.expiration.Epoch)===value.expirationEpoch,'Listing sender/gas/expiration mismatch')
  const commandBytes=(commands:typeof tx.commands)=>toBase64(bcs.vector(bcs.Command).serialize(commands.map(command=>{
    check(command.$kind!=='$Intent','Unresolved listing command is forbidden');return command
  })).toBytes())
  check(tx.inputs.length===expected.inputs.length&&commandBytes(tx.commands)===commandBytes(expected.commands),'Unexpected native listing command graph')
  const expectedIds=expected.inputs.flatMap(input=>{
    if(input.Pure)return []
    const objectId=input.UnresolvedObject?.objectId??input.Object?.Receiving?.objectId
    check(id(objectId),'Unsupported listing expected object input')
    return [objectId!]
  })
  check(new Set(expectedIds).size===expectedIds.length,'Ambiguous listing inputs')
  expected.inputs.forEach((wanted,index)=>{
    const input=tx.inputs[index]
    if(wanted.Pure){check(input.Pure?.bytes===wanted.Pure.bytes,'Listing exact price argument mismatch');return}
    if(wanted.Object?.Receiving){
      const expectedRef=wanted.Object.Receiving,ref=input.Object?.Receiving
      check(positive(expectedRef.version)&&digest(expectedRef.digest)
        &&!params.owned.has(expectedRef.objectId)&&!params.mutable.has(expectedRef.objectId)
        &&ref?.objectId===expectedRef.objectId&&ref.version===expectedRef.version&&ref.digest===expectedRef.digest,
      'Listing Receiving input mismatch')
      return
    }
    const objectId=wanted.UnresolvedObject!.objectId,object=input.Object
    if(params.owned.has(objectId)){
      const ref=object?.ImmOrOwnedObject
      check(ref?.objectId===objectId&&positive(ref.version)&&digest(ref.digest),'Listing owned/immutable input mismatch')
    }else{
      check(object?.SharedObject?.objectId===objectId&&positive(object.SharedObject.initialSharedVersion)
        &&object.SharedObject.mutable===params.mutable.has(objectId),'Listing shared input mismatch')
    }
  })
  const forbidden=new Set([...expectedIds,...params.forbidden]),gas=tx.gasData.payment!
  check(new Set(gas.map(ref=>ref.objectId)).size===gas.length
    &&gas.every(ref=>id(ref.objectId)&&positive(ref.version)&&digest(ref.digest)&&!forbidden.has(ref.objectId)),
  'Listing gas overlaps assets')
}
