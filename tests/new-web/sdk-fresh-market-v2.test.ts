import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { buildListSoulTx, buildListCollectionTx, buildBuySoulTx, buildBuyCollectionTx,
  buildUpdateListingPriceTx, buildUpdateCollectionListingPriceTx, buildPublishSoulWithListTx,
  buildPublishSoulWithCollectionAndListTx, buildCreateCollectionWithListTx,
  KIND_SOUL_DOC, KIND_MEMORY, CANONICAL_SOUL_DOC_NAME, CANONICAL_MEMORY_NAME,
  NO_DOWNLOAD_POLICY, READ_OWNER, READ_GRANT } from '@soulidity/sdk'
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
const base={currentKioskId:id(10),currentKioskCapOnChainId:id(11),stateObjectId:id(12),priceAtomic:100n}
const buy={sellerKioskId:id(10),stateObjectId:id(12),listingObjectId:id(13),totalAtomic:107n,
  paymentCoinObjectIds:[id(14),id(15)],buyerKioskId:id(16),buyerKioskCapOnChainId:id(17)}
const calls=(tx:Transaction)=>tx.getData().commands.flatMap(c=>c.MoveCall?[c.MoveCall]:[])
const objectId=(tx:Transaction,arg:any)=>tx.getData().inputs[arg.Input]?.UnresolvedObject?.objectId
const verify=(tx:Transaction,target:string,count:number)=>{
  const market=calls(tx).filter(c=>c.module==='market')
  const selected=market.find(c=>c.function===target)!
  expect(selected).toBeDefined();expect(selected.arguments).toHaveLength(count)
  expect(objectId(tx,selected.arguments[0])).toBe(id(2))
  expect(market.every(c=>!c.function.endsWith('_v6'))).toBe(true)
  expect(market.every(c=>c.package===id(1))).toBe(true)
  const register=market.find(c=>c.function==='ensure_personal_kiosk_registered_v2')!
  expect(register).toBeDefined();expect(objectId(tx,register.arguments[0])).toBe(id(2))
  return selected
}
beforeEach(()=>{
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK','mainnet')
  for(const [key,value] of Object.entries({CALLABLE_PACKAGE_ID:id(1),MARKET_CONFIG_V2_ID:id(2),
    KIOSK_REGISTRY_ID:id(3),SOUL_TRANSFER_POLICY_ID:id(4),COLLECTION_TRANSFER_POLICY_ID:id(5),KIND_REGISTRY_ID:id(6)})){
    vi.stubEnv(`NEXT_PUBLIC_SOULIDITY_${key}`,value)
  }
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID','')
})
afterEach(()=>vi.unstubAllEnvs())
it.each([false,true])('constructs ordinary Soul list and atomic repricing with collection=%s',collection=>{
  const extra=collection?{collectionObjectId:id(20)}:{}
  const target=collection?'list_soul_fixed_price_with_collection_v2':'list_soul_fixed_price_v2'
  const listed=buildListSoulTx({...base,...extra});const listing=verify(listed,target,collection?7:6)
  expect(calls(listed).at(-1)?.arguments).toEqual([{Result:1,$kind:'Result'}])
  const priceArg:any=listing.arguments.at(-1)
  expect(bcs.u64().parse(Buffer.from(listed.getData().inputs[priceArg.Input].Pure!.bytes,'base64'))).toBe('100')
  const updated=buildUpdateListingPriceTx({...base,...extra,listingObjectId:id(13),newPriceAtomic:200n})
  verify(updated,target,collection?7:6)
  expect(calls(updated).map(c=>c.function)).toEqual(['cancel_soul_listing','ensure_personal_kiosk_registered_v2',target,'finalize_soul_listing'])
})
it('constructs Collection listing and repricing on V2',()=>{
  verify(buildListCollectionTx({...base,collectionObjectId:id(20)}),'list_collection_right_fixed_price_v2',6)
  const tx=buildUpdateCollectionListingPriceTx({...base,collectionObjectId:id(20),listingObjectId:id(13),newPriceAtomic:200n})
  verify(tx,'list_collection_right_fixed_price_v2',6)
  expect(calls(tx)[0].function).toBe('cancel_collection_listing')
})
it.each([false,true])('buys ordinary Soul with exact payment and collection=%s',collection=>{
  const tx=buildBuySoulTx({...buy,...(collection?{collectionObjectId:id(20)}:{})})
  const call=verify(tx,collection?'buy_soul_fixed_price_with_collection_v2':'buy_soul_fixed_price_v2',collection?10:9)
  expect(objectId(tx,call.arguments[2])).toBe(id(4))
  expect(tx.getData().commands.filter(c=>c.MergeCoins)).toHaveLength(1)
  const split=tx.getData().commands.find(c=>c.SplitCoins)!.SplitCoins!
  const arg:any=split.amounts[0]
  expect(bcs.u64().parse(Buffer.from(tx.getData().inputs[arg.Input].Pure!.bytes,'base64'))).toBe('107')
})
it.each([false,true])('buys Collection with existing kiosk=%s',existing=>{
  const tx=buildBuyCollectionTx({...buy,collectionObjectId:id(20),
    buyerKioskId:existing?buy.buyerKioskId:null,buyerKioskCapOnChainId:existing?buy.buyerKioskCapOnChainId:null})
  verify(tx,'buy_collection_right_fixed_price_v2',9)
  if(!existing)expect(calls(tx).some(c=>c.module==='personal_kiosk'&&c.function==='transfer_to_sender')).toBe(true)
})
it.each([4,5,6,7,8])('rejects version %i in ordinary Soul builders before reading config',animacraftVersion=>{
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID','')
  expect(()=>buildListSoulTx({...base,animacraftVersion})).toThrow('native V8')
  expect(()=>buildBuySoulTx({...buy,animacraftVersion})).toThrow('native V8')
  expect(()=>buildUpdateListingPriceTx({...base,listingObjectId:id(13),newPriceAtomic:200n,animacraftVersion})).toThrow('native V8')
})
it.each([id(21),''])('rejects obsolete provenance %s instead of silently constructing an ordinary purchase',animacraftProvenanceObjectId=>{
  expect(()=>buildBuySoulTx({...buy,animacraftProvenanceObjectId})).toThrow('native V8')
})
const publish={...base,name:'Soul',description:'Description',imageUrl:'walrus://image',creatorRoyaltyBps:250,
  mintNonce:new Uint8Array(16).fill(1),expectedContentObjectId:id(40),
  initialStateConfig:[],initialContent:[{kind:KIND_SOUL_DOC,name:CANONICAL_SOUL_DOC_NAME,
    slotReadModeMask:READ_OWNER|READ_GRANT,downloadPolicy:NO_DOWNLOAD_POLICY,setActive:false,blobObjectId:id(22),expectedVersionIndex:0,encryptedEnvelope:new Uint8Array([1])},
    {kind:KIND_MEMORY,name:CANONICAL_MEMORY_NAME,slotReadModeMask:READ_OWNER|READ_GRANT,
      downloadPolicy:NO_DOWNLOAD_POLICY,setActive:false,blobObjectId:id(23),expectedVersionIndex:0,encryptedEnvelope:new Uint8Array([2])}],listingPriceAtomic:100n}
it.each([false,true])('mint-and-list uses one V2 config for mint and listing, collection=%s',async collection=>{
  const tx=collection?await buildPublishSoulWithCollectionAndListTx({...publish,collectionOnChainId:id(20)}):await buildPublishSoulWithListTx(publish)
  verify(tx,collection?'list_soul_fixed_price_with_collection_v2':'list_soul_fixed_price_v2',collection?7:6)
  expect(objectId(tx,calls(tx).find(c=>c.function==='mint_native_in_personal_kiosk_v2')!.arguments[0])).toBe(id(2))
})
it('create-and-list Collection uses V2 for both actual calls',async()=>{
  const tx=await buildCreateCollectionWithListTx({...base,name:'Collection',description:'Description',imageUrl:'walrus://image',
    extraRoyaltyBps:250,tradeable:true,collectionRightListingPriceAtomic:100n})
  verify(tx,'list_collection_right_fixed_price_v2',6)
  expect(objectId(tx,calls(tx).find(c=>c.function==='create_collection_in_personal_kiosk_v2')!.arguments[0])).toBe(id(2))
})
