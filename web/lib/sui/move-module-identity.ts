import { toHex } from '@mysten/sui/utils'
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`MOVE_MODULE_IDENTITY_${code}`)}
/** Bounded identity-table reader for the pinned Sui binary format. This is NOT
 * a bytecode verifier, linker, publication relocator or execution attestation.
 * Reference: MystenLabs/sui 2a0becb2, move-binary-format deserializer.rs. */
export function readMoveModuleIdentity(input:Uint8Array){
 check(input instanceof Uint8Array&&input.length>=10&&input.length<=4*1024*1024,'BOUNDS')
 const bytes=new Uint8Array(input)
 check(toHex(bytes.slice(0,4))==='a11ceb0b','MAGIC')
 const flavored=new DataView(bytes.buffer).getUint32(4,true),version=flavored&0xffffff
 check(version>=1&&version<=7&&(version<7?flavored===version:(flavored>>>24)===5),'VERSION')
 function cursor(start:number,end:number){
  let offset=start
  return {get offset(){return offset},uint(max:number){
   let n=0,factor=1,count=0,last=0
   do{check(offset<end&&count<5,'ULEB');last=bytes[offset++];n+=(last&127)*factor;factor*=128;count++}while(last&128)
   check(n<=max&&(count===1||(last&127)!==0),'ULEB');return n
  },take(n:number){check(n>0&&offset+n<=end,'TABLE_BOUNDS');const out=bytes.slice(offset,offset+n);offset+=n;return out}}
 }
 const header=cursor(8,bytes.length),count=header.uint(255),tables=new Map<number,{offset:number;size:number}>()
 const valid=new Set([1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17,18,19,20])
 for(let i=0;i<count;i++){
  const kind=header.take(1)[0],offset=header.uint(0xffffffff),size=header.uint(0xffffffff)
  check(valid.has(kind)&&!tables.has(kind)&&size>0&&(version>=7||kind<17),'TABLE_HEADER')
  tables.set(kind,{offset,size})
 }
 const dataStart=header.offset;let total=0
 for(const t of [...tables.values()].sort((a,b)=>a.offset-b.offset)){check(t.offset===total,'TABLE_PARTITION');total+=t.size;check(dataStart+total<bytes.length,'TABLE_BOUNDS')}
 const tail=cursor(dataStart+total,bytes.length),self=tail.uint(65535);check(tail.offset===bytes.length,'TRAILING_BYTES')
 function table(kind:number){const t=tables.get(kind);check(t,'REQUIRED_TABLE');return cursor(dataStart+t.offset,dataStart+t.offset+t.size)}
 const names:string[]=[],ids=table(7),nameEnd=dataStart+tables.get(7)!.offset+tables.get(7)!.size
 while(ids.offset<nameEnd){const size=ids.uint(65535),name=new TextDecoder('utf-8',{fatal:true}).decode(ids.take(size));check(/^(?:[A-Za-z][A-Za-z0-9_]*|_[A-Za-z0-9_]+)$/.test(name)&&name.length<=65535,'IDENTIFIER');names.push(name);check(names.length<=65536,'TABLE_COUNT')}
 const addressTable=tables.get(8)!;check(addressTable&&addressTable.size%32===0&&addressTable.size/32<=65536,'ADDRESS_TABLE')
 const addresses=table(8),values:string[]=[]
 for(let i=0;i<addressTable.size/32;i++)values.push(`0x${toHex(addresses.take(32))}`)
 function handles(kind:number){
  const h=table(kind),end=dataStart+tables.get(kind)!.offset+tables.get(kind)!.size,result:Array<{address:string;name:string}>=[]
  while(h.offset<end){const a=h.uint(65535),n=h.uint(65535);check(values[a]!==undefined&&names[n]!==undefined,'HANDLE_INDEX');result.push({address:values[a],name:names[n]});check(result.length<=65536,'TABLE_COUNT')}
  return result
 }
 const moduleAddresses=table(1),addressIndices:number[]=[]
 while(moduleAddresses.offset<dataStart+tables.get(1)!.offset+tables.get(1)!.size){addressIndices.push(moduleAddresses.uint(65535));moduleAddresses.uint(65535)}
 const modules=handles(1);check(modules[self],'SELF_INDEX')
 const friends=tables.has(15)?handles(15):[]
 return {version,self:modules[self],selfAddressByteOffset:dataStart+addressTable.offset+32*addressIndices[self],modules,friends,notBytecodeVerification:true as const}
}
