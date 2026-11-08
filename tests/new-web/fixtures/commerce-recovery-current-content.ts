import {nativeContentSealNamespace} from '../../../web/lib/soulidity/native-creation-transaction'
import {bcs} from '@mysten/sui/bcs'
import {deriveDynamicFieldID,normalizeStructTag,fromHex,toHex,toBase64} from '@mysten/sui/utils'
import {sha256} from '@noble/hashes/sha2.js'
import {sha3_256} from '@noble/hashes/sha3.js'
import {vi} from 'vitest'
import {canonicalNativeWorkbenchFixture} from './canonical-native-workbench'
import {activityEvidenceFixture,activityHash,aid} from './activity-transaction-evidence'
import {CanonicalSoulBcs,CanonicalNativeLibraryBcs,CanonicalNativeRecordBcs} from '../../../web/lib/soulidity/canonical-native-workbench'
import {NativePublicReadHostV2Bcs,NativePublicReadLinkV2Bcs} from '../../../web/lib/soulidity/native-public-read-record-v2'
import {NativeInitialAuthorizationBcs,NativeInitialPaidBcs} from '../../../web/lib/soulidity/native-initial-children'
import {EconomicsConfigBcs,economicsConfigSnapshot,economicsOperationalSnapshotHash} from '../../../web/lib/soulidity/commerce/economics-bcs'
import {PaidContentBuyerKeyBcs,PaidContentEntryBcs,PaidContentOfferBcs} from '../../../web/lib/soulidity/commerce/paid-content-policy'
import {SoulPublicKioskBcs} from '@soulidity/sdk'
import {SealClient} from '../../../web/node_modules/@mysten/seal/dist/index.mjs'
import {contentAppendPreparationFixture} from './content-append-preparation'
import {encryptNativeCreationEnvelope} from '../../../web/lib/soulidity/native-creation-envelope'
import {openNativePublicPaidContentV2} from '../../../web/lib/soulidity/native-public-paid-content-open-v2'
import {openReusableNativePublicReadContentV2} from '../../../web/lib/soulidity/commerce/native-public-read-paid-delivery-v2'

// Controlled full Object + Seal/AES fixture extracted from current paid-read tests.
export async function fixture(variant = '', buyerOverride?:string, ownerOverride?:string) {
  const f = await canonicalNativeWorkbenchFixture(true, 2, true, true), fee = await activityEvidenceFixture(), target = f.input.target, content = target.content!
  fee.deployment.originalPackageId = aid(140); fee.deployment.callablePackageId = aid(141)
  const fp = fee.packageData.data.Package!; fp.id = aid(141); fp.moduleMap = new Map([['economics', new Uint8Array([1])]])
  fp.typeOriginTable = ['Config','Paid'].map(datatypeName=>({ moduleName:'economics',datatypeName,package:aid(140) })); fee.rehashPackage(); f.rows.set(fee.pkg.objectId, fee.pkg)
  const nativeRow = f.rows.get(target.native.callablePackageId), nativeRaw = bcs.Object.parse(nativeRow.bcs.value), np = nativeRaw.data.Package!
  np.typeOriginTable.push(...['PublicReadHostV2', 'PublicReadLinkV2'].map(datatypeName => ({ moduleName: 'birth', datatypeName, package: f.nativeId })))
  np.linkageTable.set(aid(140), { upgradedId: aid(141), upgradedVersion: '2' })
  nativeRow.bcs.value = bcs.Object.serialize(nativeRaw).toBytes(); nativeRow.digest = activityHash('Object', nativeRow.bcs.value); target.native.callableDigest = nativeRow.digest
  const contentRow = f.rows.get(content.callablePackageId), contentRaw = bcs.Object.parse(contentRow.bcs.value), cp = contentRaw.data.Package!
  cp.typeOriginTable.push(...['Offer', 'Entry', 'BuyerKey', 'PaidAuthority1', 'PaidRevision1', 'AttemptKey', 'Receipt', 'Updated'].map(datatypeName => ({ moduleName: 'paid_access', datatypeName, package: content.originalPackageId })))
  cp.linkageTable.set(aid(140), { upgradedId: aid(141), upgradedVersion: '2' })
  contentRow.bcs.value = bcs.Object.serialize(contentRaw).toBytes(); contentRow.digest = activityHash('Object', contentRow.bcs.value); content.callableDigest = contentRow.digest
  if(ownerOverride){f.kiosk!.owner=ownerOverride;f.object(f.kiosk!.id,'0x2::kiosk::Kiosk',SoulPublicKioskBcs.serialize(f.kiosk).toBytes(),{Shared:{initialSharedVersion:'5'}})}
  const buyer = buyerOverride ?? (variant === 'owner' ? f.kiosk!.owner : aid(7000)), owner = f.kiosk!.owner, link = { id: aid(720), root: f.root.id, host: aid(721) }, host = { id: link.host, root: f.root.id, state: structuredClone(f.state) }
  const bytes = NativePublicReadLinkV2Bcs.serialize(link).toBytes(), d = f.root.modules[0]; d.object = link.id; d.value_type.name = `${f.nativeId}::birth::PublicReadLinkV2`; d.schema = 2; d.body_hash = sha3_256(bytes); d.semantic_hash = sha256(bytes)
  const rootOwner = bcs.Object.parse(f.rows.get(f.root.id).bcs.value).owner.ObjectOwner!
  f.object(f.root.id, `${f.standardId}::soul::Soul`, CanonicalSoulBcs.serialize(f.root).toBytes(), rootOwner)
  const ModuleField = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: bcs.struct('Key', { name: bcs.byteVector() }) }), value: bcs.Address })
  const mf = ModuleField.parse(bcs.Object.parse(f.rows.get(f.fieldId).bcs.value).data.Move!.contents); mf.value = link.id
  f.object(f.fieldId, `0x2::dynamic_field::Field<0x2::dynamic_object_field::Wrapper<${f.standardId}::soul::ModuleKey<${f.nativeId}::birth::NativeModule>>,0x2::object::ID>`, ModuleField.serialize(mf).toBytes(), f.root.id)
  f.rows.delete(f.state.id); f.object(link.id, `${f.nativeId}::birth::PublicReadLinkV2`, bytes, f.fieldId)
  const rewriteHost = () => f.object(host.id, `${f.nativeId}::birth::PublicReadHostV2`, NativePublicReadHostV2Bcs.serialize(host).toBytes(), { Shared: { initialSharedVersion: '5' } }); rewriteHost()
  const lockId = deriveDynamicFieldID(f.kiosk!.id, '0x2::kiosk::Lock', bcs.Address.serialize(f.root.id).toBytes())
  f.object(lockId, '0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>', bcs.struct('LockField', { id: bcs.Address, name: bcs.struct('Lock', { id: bcs.Address }), value: bcs.bool() }).serialize({ id: lockId, name: { id: f.root.id }, value: true }).toBytes(), f.kiosk!.id)
  const record = f.records[0].value; record.read_mask = '5'; const rb = CanonicalNativeRecordBcs.serialize(record).toBytes(); f.library.entries[0].hash = sha256(rb)
  f.object(f.records[0].objectId, `0x2::dynamic_field::Field<u64,${content.originalPackageId}::document::Record>`, bcs.struct('Field', { id: bcs.Address, name: bcs.u64(), value: CanonicalNativeRecordBcs }).serialize({ id: f.records[0].objectId, name: 0, value: record }).toBytes(), f.library.records.id)
  f.object(f.library.id, `${content.originalPackageId}::founding_library::Library`, CanonicalNativeLibraryBcs.serialize(f.library).toBytes(), f.libraryFieldId)
  const controller = { root: f.root.id, parent: f.state.id, operator: { name: `${f.nativeId}::birth::ContentOperator` } }
  const pointerCodec = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: bcs.struct('Key', { dummy_field: bcs.bool() }) }), value: bcs.Address })
  const child = (name: string, id: string, module: string, type: string, value: Uint8Array) => {
    const wrapper = `0x2::dynamic_object_field::Wrapper<${f.nativeId}::birth::${name}>`, fieldId = deriveDynamicFieldID(f.state.id, wrapper, new Uint8Array([0]))
    f.object(fieldId, `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`, pointerCodec.serialize({ id: fieldId, name: { name: { dummy_field: false } }, value: id }).toBytes(), f.state.id)
    f.object(id, `${content.originalPackageId}::${module}::${type}`, value, fieldId)
  }
  const auth = { id: aid(7200), controller, root: f.root.id, generation: 2, capacity: 1, count: 0, next_sequence: 0, grants: { id: aid(7201), size: 0 } }
  child('AuthorizationKey', auth.id, 'authorization', 'Authorization', NativeInitialAuthorizationBcs.serialize(auth).toBytes())
  const noEntry = ['new', 'missing-offer', 'paused', 'primary-off', 'corrupt-fee', 'owner'].includes(variant), noOffer = variant === '' || variant === 'missing-offer' || variant === 'owner'
  const ledger = { id: aid(7202), controller, root: f.root.id, protocol: target.configId, revision: 3, offers: { id: aid(7203), size: noOffer ? 0 : 1 }, entries: { id: aid(7204), size: noEntry ? 0 : 1 }, attempts: { id: aid(7205), size: 0 } }
  child('PaidKey', ledger.id, 'paid_access', 'Ledger', NativeInitialPaidBcs.serialize(ledger).toBytes())
  const offerId = deriveDynamicFieldID(ledger.offers.id, 'u32', bcs.u32().serialize(record.kind).toBytes())
  if (!noOffer) f.object(offerId, `0x2::dynamic_field::Field<u32,${content.originalPackageId}::paid_access::Offer>`, bcs.struct('Field', { id: bcs.Address, name: bcs.u32(), value: PaidContentOfferBcs }).serialize({ id: offerId, name: record.kind, value: { issuer: owner, generation: 2, price: 101, scope: 1, duration: 100, revision: 2 } }).toBytes(), ledger.offers.id)
  const key = { kind: record.kind, buyer }, entryId = deriveDynamicFieldID(ledger.entries.id, `${content.originalPackageId}::paid_access::BuyerKey`, PaidContentBuyerKeyBcs.serialize(key).toBytes())
  const entry = { issuer: variant === 'stale-owner' ? aid(999) : owner, generation: variant === 'stale-generation' ? 1 : 2, scope: variant === 'scope' ? 2 : 1, expiry: variant === 'expiry' ? '100' : variant === 'expiry-fresh' ? '150' : null, revision: variant === 'entry-revision' ? 4 : 3 }
  if (!noEntry) f.object(entryId, `0x2::dynamic_field::Field<${content.originalPackageId}::paid_access::BuyerKey,${content.originalPackageId}::paid_access::Entry>`, bcs.struct('Field', { id: bcs.Address, name: PaidContentBuyerKeyBcs, value: PaidContentEntryBcs }).serialize({ id: entryId, name: key, value: entry }).toBytes(), ledger.entries.id)
  const coinType = normalizeStructTag('0x2::sui::SUI'), cfg = EconomicsConfigBcs.parse(EconomicsConfigBcs.serialize({ id: target.configId, revision: 8, primary_bps: 250, secondary_bps: 250, complete_fee: 0, recipient: aid(7100), paused: variant === 'paused',
    income: { root: target.configId, revision: 0, funds: 0, collected: 0, withdrawn: 0, requests: { id: aid(7101), size: 0 } }, schema: 3, enabled: true, payment_coin: { name: coinType }, original_package: aid(140), callable_package: aid(141), commitment: new Uint8Array(32), native_binding: null, release_binding: null, minimum_release: 2,
    roles: { roles: Array.from({ length: 6 }, () => ({ original: content.originalPackageId, callable: content.originalPackageId, marker: { name: `${content.originalPackageId}::paid_access::PaidRevision1` }, version: 1, pinned: true, frozen: false })) } }).toBytes())
  cfg.commitment = economicsOperationalSnapshotHash({ domain: new TextEncoder().encode('soulidity-protocol-operational-v4'), config: economicsConfigSnapshot(cfg), gates: { primary: variant !== 'primary-off', secondary: true } })
  if (variant === 'corrupt-fee') cfg.commitment[0] ^= 1
  f.object(cfg.id, `${aid(140)}::economics::Config<${coinType}>`, EconomicsConfigBcs.serialize(cfg).toBytes(), { Shared: { initialSharedVersion: '1' } })
  const clock = (timestamp: number) => f.object(aid(6), '0x2::clock::Clock', bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() }).serialize({ id: aid(6), timestamp_ms: timestamp }).toBytes(), { Shared: { initialSharedVersion: '1' } }); clock(100)
  f.client.ledgerService.getObject.mockImplementation(async ({ objectId }: any) => { if (objectId === f.state.id) throw Error('NO_V1_STATE_OBJECT'); if (!f.rows.has(objectId)) throw { code: 'NOT_FOUND' }; return { response: { object: f.rows.get(objectId) } } })
  return { f, buyer, owner, host, record, auth, ledger, cfg, entryId, offerId, rewriteHost, clock, params: { ...f.input, format: 'native-public-read-v2' as const, buyer, recordIndex: 0, kind: record.kind, requiredScope: 1n, economics: { chainIdentifier: '35834a8a', foundation: fee.deployment, configId: cfg.id, coinType } } }
}
export function appendPaidRecord(x:Awaited<ReturnType<typeof fixture>>,options:{kind?:number;scope?:string;readMask?:string}={}){
 const index=x.f.library.entries.length,record=structuredClone(x.record);record.name=record.kind===0?'soul':record.kind===1?'default':`appended-${index}`;record.version=String(BigInt(record.version)+1n);record.nonce=new Uint8Array(16).fill(9);record.seal_namespace=null
 if(options.kind!==undefined&&options.kind!==record.kind){record.kind=options.kind;record.name=`appended-${index}`;record.version='0'}record.scope=options.scope??record.scope;record.read_mask=options.readMask??'5'
 const bytes=CanonicalNativeRecordBcs.serialize(record).toBytes(),id=deriveDynamicFieldID(x.f.library.records.id,'u64',bcs.u64().serialize(index).toBytes())
 x.f.library.records.size=String(BigInt(x.f.library.records.size)+1n);x.f.library.revision=String(BigInt(x.f.library.revision)+1n);x.f.library.entries.push({index:String(index),hash:sha256(bytes)})
 x.f.object(id,`0x2::dynamic_field::Field<u64,${x.params.target.content!.originalPackageId}::document::Record>`,bcs.struct('Field',{id:bcs.Address,name:bcs.u64(),value:CanonicalNativeRecordBcs}).serialize({id,name:index,value:record}).toBytes(),x.f.library.records.id)
 x.f.object(x.f.library.id,`${x.params.target.content!.originalPackageId}::founding_library::Library`,CanonicalNativeLibraryBcs.serialize(x.f.library).toBytes(),x.f.libraryFieldId)
 x.record=record;x.params.recordIndex=index;x.params.kind=record.kind;x.params.requiredScope=BigInt(record.scope)
 return {id,index,record}
}
export async function integratedProtectedFixture(expiring=false,appended=false,unpaid=false){
 const cryptoFixture=await contentAppendPreparationFixture(),buyer=cryptoFixture.signer.toSuiAddress(),x=await fixture(unpaid?'new':expiring?'expiry-fresh':'',buyer,aid(7070)),client=x.f.client as any
 if(appended)appendPaidRecord(x)
 const plaintext=new TextEncoder().encode('Actual current Entry and protected ciphertext agree.'),dek=new Uint8Array(32).fill(5),iv=new Uint8Array(12).fill(6)
 const key=await crypto.subtle.importKey('raw',dek,{name:'AES-GCM'},false,['encrypt']),ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plaintext))
 const seal=new SealClient({suiClient:cryptoFixture.client,serverConfigs:cryptoFixture.params.sealConfig.serverConfigs,verifyKeyServers:true})
 const envelope=appended?{schema:'soulidity.native-content-envelope.v1' as const,sealPackageId:x.f.nativeId,contentId:x.f.library.id,kind:x.record.kind,name:x.record.name,nonce:toHex(x.record.nonce),contentHash:toHex(sha256(plaintext)),mimeType:'text/plain',fileName:'content.txt',iv:toBase64(iv),documentId:'',encryptedDek:''}:await encryptNativeCreationEnvelope({sealPackageId:x.f.nativeId,contentId:x.f.library.id,kind:x.record.kind,name:x.record.name,nonce:toHex(x.record.nonce),contentHash:toHex(sha256(plaintext)),mimeType:'text/plain',fileName:'content.txt',dek,iv,config:cryptoFixture.params.sealConfig,signal:cryptoFixture.controller.signal,encrypt:args=>seal.encrypt(args)})
 if(appended){const documentId=toHex(nativeContentSealNamespace(x.f.library.id,x.record.kind,x.record.name,toHex(x.record.nonce),x.record.version)),material=new Uint8Array(64);material.set(dek);material.set(sha256(plaintext),32)
  try{const wrapped=await seal.encrypt({packageId:x.f.nativeId,id:documentId,threshold:cryptoFixture.params.sealConfig.threshold,data:material});try{envelope.documentId=documentId;envelope.encryptedDek=toBase64(wrapped.encryptedObject)}finally{wrapped.key.fill(0)}}finally{material.fill(0)}}
 x.record.envelope=new TextEncoder().encode(JSON.stringify(envelope));x.record.seal_namespace=fromHex(envelope.documentId);x.record.reference.sha256=sha256(ciphertext);x.record.reference.bytes=String(ciphertext.length)
 const rewrite=()=>{const bytes=CanonicalNativeRecordBcs.serialize(x.record).toBytes();x.f.library.entries[x.params.recordIndex].hash=sha256(bytes);const selectedId=deriveDynamicFieldID(x.f.library.records.id,'u64',bcs.u64().serialize(x.params.recordIndex).toBytes());x.f.object(selectedId,`0x2::dynamic_field::Field<u64,${x.params.target.content!.originalPackageId}::document::Record>`,bcs.struct('Field',{id:bcs.Address,name:bcs.u64(),value:CanonicalNativeRecordBcs}).serialize({id:selectedId,name:x.params.recordIndex,value:x.record}).toBytes(),x.f.library.records.id);x.f.object(x.f.library.id,`${x.params.target.content!.originalPackageId}::founding_library::Library`,CanonicalNativeLibraryBcs.serialize(x.f.library).toBytes(),x.f.libraryFieldId)};rewrite()
 const datatype=(name:string)=>({reference:'immutable',body:{$kind:'datatype',datatype:{typeName:name,typeParameters:[]}}})
 client.core.getMoveFunction=vi.fn(async()=>({function:{packageId:x.params.target.native.callablePackageId,moduleName:'birth',name:'seal_approve_content_paid_v2',visibility:'public',typeParameters:[],returns:[],parameters:[{reference:null,body:{$kind:'vector',vector:{$kind:'u8'}}},datatype('0x2::kiosk::Kiosk'),datatype(`${x.f.nativeId}::birth::PublicReadHostV2`),{reference:null,body:{$kind:'u64'}},datatype('0x2::clock::Clock'),datatype('0x2::tx_context::TxContext')]}}))
 client.core.resolveTransactionPlugin=cryptoFixture.client.core.resolveTransactionPlugin.bind(cryptoFixture.client.core)
 const fetcher=vi.fn(async()=>new Response(new Uint8Array(ciphertext)));let opened:Uint8Array|undefined
 const run=()=>openReusableNativePublicReadContentV2({qualification:x.params,protected:{sealClient:cryptoFixture.client,blobBaseUrl:'https://walrus.example.com',sealConfig:cryptoFixture.params.sealConfig,getAddress:cryptoFixture.params.wallet.getAddress,signPersonalMessage:cryptoFixture.sign}},
 {openPaid:async input=>{const result=await openNativePublicPaidContentV2(input,{fetcher});opened=result.bytes;return result},openOwner:async()=>{throw Error('WRONG_OWNER_POLICY')}})
 return {x,cryptoFixture,plaintext,envelope,rewrite,fetcher,run,opened:()=>opened}
}
