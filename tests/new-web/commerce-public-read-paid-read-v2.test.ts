import {nativeContentSealNamespace} from '../../web/lib/soulidity/native-creation-transaction'
import {TypeTagSerializer} from '@mysten/sui/bcs'
import {MAINNET_GENESIS_DIGEST} from '../../web/lib/animacraft/mainnet-chain'
import {historicalMoveObjectType} from '../../web/lib/sui/historical-object'
import {NativePaidAttemptFieldBcs,NativePaidAttemptKeyBcs,NativePaidEntryFieldBcs} from '../../web/lib/soulidity/commerce/native-paid-content-receipt'
import {NativePaidUpdatedBcs,NativeSubscriptionPaidBcs} from '../../web/lib/soulidity/commerce/native-paid-content-history'
import {preflightNewNativePublicReadPaidPurchaseV2} from '../../web/lib/soulidity/commerce/native-public-read-paid-preflight-v2'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import {publicReadPaidAbiV2Fixture} from './fixtures/commerce-public-read-paid-abi-v2'
import {prepareNewNativePublicReadPaidPurchaseV2} from '../../web/lib/soulidity/commerce/native-public-read-paid-preparation-v2'
import {readContractCheckedNativePublicReadPaidPreviewV2} from '../../web/lib/soulidity/commerce/native-public-read-paid-preview-v2'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, fromHex, toHex, toBase64 } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { expect, it, afterEach, vi } from 'vitest'
import { canonicalNativeWorkbenchFixture } from './fixtures/canonical-native-workbench'
import { activityEvidenceFixture, activityHash, aid } from './fixtures/activity-transaction-evidence'
import { CanonicalSoulBcs, CanonicalNativeLibraryBcs, CanonicalNativeRecordBcs } from '../../web/lib/soulidity/canonical-native-workbench'
import { nativePublicOwnerSourceKeyV2, readNativePublicReadOverviewV2, NativePublicReadHostV2Bcs, NativePublicReadLinkV2Bcs } from '../../web/lib/soulidity/native-public-read-record-v2'
import { NativeInitialAuthorizationBcs, NativeInitialPaidBcs } from '../../web/lib/soulidity/native-initial-children'
import { EconomicsConfigBcs, economicsConfigSnapshot, economicsOperationalSnapshotHash } from '../../web/lib/soulidity/commerce/economics-bcs'
import { PaidContentBuyerKeyBcs, PaidContentEntryBcs, PaidContentOfferBcs } from '../../web/lib/soulidity/commerce/paid-content-policy'
import { SoulPublicKioskBcs } from '@soulidity/sdk'
import { SealClient } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { contentAppendPreparationFixture } from './fixtures/content-append-preparation'
import { encryptNativeCreationEnvelope } from '../../web/lib/soulidity/native-creation-envelope'
import { openNativePublicPaidContentV2 } from '../../web/lib/soulidity/native-public-paid-content-open-v2'
import { openReusableNativePublicReadContentV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-delivery-v2'
import { readNativePublicReadPaidV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-read-v2'

// Real current Host/Record reader and full Object bytes; no simulated policy,
// deployed qualification or actual payment/delivery acceptance.
afterEach(()=>vi.restoreAllMocks())
async function fixture(variant = '', buyerOverride?:string, ownerOverride?:string) {
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
it('reuses an actual Entry after Offer removal without reading new-sale Config or any v1 State object', async () => {
  const x = await fixture(); x.f.rows.delete(x.cfg.id)
  expect(await readNativePublicReadPaidV2(x.params)).toMatchObject({ format: 'native-public-read-v2', decision: { action: 'REUSE_ENTRY' }, quote: null, coinType: null, purchaseBlockers: [], notAuthorization: true })
})
it('reuses owner qualification without an Account, service, Offer or fee snapshot', async () => {
  const x = await fixture('owner'); x.f.rows.delete(x.cfg.id)
  expect(await readNativePublicReadPaidV2(x.params)).toMatchObject({ decision: { action: 'REUSE_OWNER' }, purchaseBlockers: [] })
})
it.each(['new', 'stale-owner', 'stale-generation', 'expiry'])('requires a fresh entry with actual Host ownership/generation/Clock and additive quote: %s', async variant => {
  const x = await fixture(variant)
  expect(await readNativePublicReadPaidV2(x.params)).toMatchObject({ decision: { action: 'PURCHASE_REQUIRED' }, quote: { ask: '101', platformFee: '3', total: '104' }, feeRevision: '8', configSharedReference: { initialSharedVersion: '1' }, purchaseBlockers: [], requiresQualifiedSourceAndFormatAdoption: true })
})
it('blocks duplicate permanent purchase when the old scope is insufficient', async () => {
  const x = await fixture('scope'); x.f.rows.delete(x.cfg.id)
  expect(await readNativePublicReadPaidV2(x.params)).toMatchObject({ decision: { action: 'BLOCKED', reason: 'PERMANENT_ENTRY_SCOPE_MISMATCH' }, quote: null })
})
it('keeps a missing offer blocked rather than inventing one', async () => {
  const x = await fixture('missing-offer')
  expect(await readNativePublicReadPaidV2(x.params)).toMatchObject({ decision: { action: 'BLOCKED', reason: 'NO_SALE_OFFER' }, quote: null })
})
it.each([['paused', 'PROTOCOL_PAUSED'], ['primary-off', 'PRIMARY_MARKET_DISABLED']])('keeps new-sale %s blockers separate from existing qualification', async (variant, blocker) => {
  const x = await fixture(variant)
  expect(await readNativePublicReadPaidV2(x.params)).toMatchObject({ decision: { action: 'PURCHASE_REQUIRED' }, purchaseBlockers: expect.arrayContaining([blocker]) })
})
it.each(['corrupt-fee', 'entry-revision'])('rejects contradictory V2 qualification evidence: %s', async variant => {
  await expect(readNativePublicReadPaidV2((await fixture(variant)).params)).rejects.toThrow()
})
it('rejects a supplied scope that differs from the actual selected Record', async () => {
  const x = await fixture(); x.params.requiredScope = 2n
  await expect(readNativePublicReadPaidV2(x.params)).rejects.toThrow('SCOPE_CHANGED')
})
it('rejects an auth change during child observation instead of reusing a stale Entry', async () => {
  const x = await fixture(), get = x.f.client.ledgerService.getObject.getMockImplementation()!; let reads = 0
  x.f.client.ledgerService.getObject.mockImplementation(async (r: any) => {
    if (r.objectId === x.auth.id && ++reads === 2) { const object = x.f.rows.get(x.auth.id), owner = bcs.Object.parse(object.bcs.value).owner.ObjectOwner!; x.auth.generation = 3; x.f.object(x.auth.id, `${x.params.target.content!.originalPackageId}::authorization::Authorization`, NativeInitialAuthorizationBcs.serialize(x.auth).toBytes(), owner) }
    return get(r)
  })
  await expect(readNativePublicReadPaidV2(x.params)).rejects.toThrow('CHANGED')
})

it('uses the final post-recheck Clock rather than the earlier Host-reader Clock for expiry', async () => {
  const x = await fixture('expiry-fresh'), get = x.f.client.ledgerService.getObject.getMockImplementation()!; let clocks = 0
  x.f.client.ledgerService.getObject.mockImplementation(async (r: any) => { if (r.objectId === aid(6) && ++clocks === 5) x.clock(150); return get(r) })
  expect(await readNativePublicReadPaidV2(x.params)).toMatchObject({ observedAtMs: '150', decision: { action: 'PURCHASE_REQUIRED' }, quote: { total: '104' } })
})
it('does not consult unavailable sale Offer or fee Config while reusing valid qualification', async () => {
  const x = await fixture(), get = x.f.client.ledgerService.getObject.getMockImplementation()!
  x.f.client.ledgerService.getObject.mockImplementation(async (r: any) => { if ([x.offerId, x.cfg.id].includes(r.objectId)) throw { code: 'UNAVAILABLE' }; return get(r) })
  expect(await readNativePublicReadPaidV2(x.params)).toMatchObject({ decision: { action: 'REUSE_ENTRY' }, quote: null })
})
it('keeps an unavailable Entry read unknown instead of inventing a new purchase need', async () => {
  const x = await fixture(), get = x.f.client.ledgerService.getObject.getMockImplementation()!
  x.f.client.ledgerService.getObject.mockImplementation(async (r: any) => { if (r.objectId === x.entryId) throw { code: 'UNAVAILABLE' }; return get(r) })
  await expect(readNativePublicReadPaidV2(x.params)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
})
it('captures readonly observation methods before asynchronous chain checks', async () => {
  const x = await fixture(), chain = x.f.client.core.getChainIdentifier.getMockImplementation()!
  x.f.client.core.getChainIdentifier.mockImplementation(async () => { x.f.client.ledgerService.getObject = (() => { throw Error('REPLACED_READER') }) as any; return chain() })
  expect(await readNativePublicReadPaidV2(x.params)).toMatchObject({ decision: { action: 'REUSE_ENTRY' }, notAuthorization: true })
})

it('rejects a fee Config change after quote inputs were observed', async () => {
  const x = await fixture('new'), get = x.f.client.ledgerService.getObject.getMockImplementation()!; let reads = 0
  x.f.client.ledgerService.getObject.mockImplementation(async (r: any) => {
    if (r.objectId === x.cfg.id && ++reads === 3) { x.cfg.primary_bps = 500; x.cfg.commitment = economicsOperationalSnapshotHash({ domain: new TextEncoder().encode('soulidity-protocol-operational-v4'), config: economicsConfigSnapshot(x.cfg), gates: { primary: true, secondary: true } }); x.f.object(x.cfg.id, `${aid(140)}::economics::Config<0x2::sui::SUI>`, EconomicsConfigBcs.serialize(x.cfg).toBytes(), { Shared: { initialSharedVersion: '1' } }) }
    return get(r)
  })
  await expect(readNativePublicReadPaidV2(x.params)).rejects.toThrow('CONFIG_CHANGED')
})
it('rejects a legacy module format instead of retrying through the V1 State reader', async () => {
  const x = await fixture(); x.f.root.modules[0].schema = 1
  const owner = bcs.Object.parse(x.f.rows.get(x.f.root.id).bcs.value).owner.ObjectOwner!
  x.f.object(x.f.root.id, `${x.f.standardId}::soul::Soul`, CanonicalSoulBcs.serialize(x.f.root).toBytes(), owner)
  await expect(readNativePublicReadPaidV2(x.params)).rejects.toThrow('FORMAT')
})
it('bridges actual current Entry qualification with selected protected open without requiring an Offer or sale Config',async()=>{
 const {openReusableNativePublicReadContentV2}=await import('../../web/lib/soulidity/commerce/native-public-read-paid-delivery-v2')
 const x=await fixture();x.f.rows.delete(x.cfg.id);const bytes=new Uint8Array([1,2,3]);let calls=0
 const result=await openReusableNativePublicReadContentV2({qualification:x.params,protected:{sealClient:x.f.client as any,blobBaseUrl:'https://walrus.example.com',sealConfig:{} as any,getAddress:()=>x.buyer,signPersonalMessage:async()=>{throw Error('STUB_MUST_NOT_SIGN')}}},
 {openPaid:async input=>{calls++;expect(input.viewerAddress).toBe(x.buyer);expect(input.soulId).toBe(x.f.root.id);return {bytes,fileName:'test',mimeType:'text/plain'}},openOwner:async()=>{throw Error('WRONG_POLICY')}})
 expect(result).toMatchObject({status:'CONTENT_OPENED',accessPath:'REUSE_ENTRY',notDurablePurchaseCompletion:true,requiresQualifiedSourceAndFormatAdoption:true});expect(calls).toBe(1);bytes.fill(0)
})
it('withholds and clears opened bytes after actual Entry expiry advances during delivery',async()=>{
 const {openReusableNativePublicReadContentV2}=await import('../../web/lib/soulidity/commerce/native-public-read-paid-delivery-v2')
 const x=await fixture('expiry-fresh'),bytes=new Uint8Array([1])
 await expect(openReusableNativePublicReadContentV2({qualification:x.params,protected:{sealClient:x.f.client as any,blobBaseUrl:'https://walrus.example.com',sealConfig:{} as any,getAddress:()=>x.buyer,signPersonalMessage:async()=>{throw Error('STUB_MUST_NOT_SIGN')}}},
 {openPaid:async()=>{x.clock(150);return {bytes,fileName:'test',mimeType:'text/plain'}},openOwner:async()=>{throw Error('WRONG_POLICY')}})).rejects.toThrow('QUALIFICATION_CHANGED')
 expect(bytes[0]).toBe(0)
})

// One composed controlled integration: actual current full-object readers,
// actual pinned/interface verifier, actual protected opener and AES. RPC and
// Seal keyserver execution remain controlled; no payment/deployment acceptance.
async function integratedProtectedFixture(expiring=false,appended=false){
 const cryptoFixture=await contentAppendPreparationFixture(),buyer=cryptoFixture.signer.toSuiAddress(),x=await fixture(expiring?'expiry-fresh':'',buyer,aid(7070)),client=x.f.client as any
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
 const run=(qualification:Parameters<typeof openReusableNativePublicReadContentV2>[0]['qualification']=x.params)=>openReusableNativePublicReadContentV2({qualification,protected:{sealClient:cryptoFixture.client,blobBaseUrl:'https://walrus.example.com',sealConfig:cryptoFixture.params.sealConfig,getAddress:cryptoFixture.params.wallet.getAddress,signPersonalMessage:cryptoFixture.sign}},
 {openPaid:async input=>{const result=await openNativePublicPaidContentV2(input,{fetcher});opened=result.bytes;return result},openOwner:async()=>{throw Error('WRONG_OWNER_POLICY')}})
 return {x,cryptoFixture,plaintext,envelope,rewrite,fetcher,run,opened:()=>opened}
}
it('composes actual current Host/Record/Auth/Entry, actual interface/Seal kind and actual AES in one protected content call',async()=>{
 const f=await integratedProtectedFixture(),result=await f.run();expect(result).toMatchObject({status:'CONTENT_OPENED',accessPath:'REUSE_ENTRY',notDurablePurchaseCompletion:true,requiresQualifiedSourceAndFormatAdoption:true})
 if(result.status!=='CONTENT_OPENED')throw Error('NOT_OPENED')
 expect(result.content.bytes).toEqual(f.plaintext);expect(f.x.f.client.core.getMoveFunction).toHaveBeenCalledOnce();expect(f.cryptoFixture.sign).toHaveBeenCalledOnce();expect(f.fetcher).toHaveBeenCalledOnce()
 const kind=bcs.TransactionKind.parse(f.cryptoFixture.decryptCall.mock.calls[0][0].txBytes).ProgrammableTransaction!
 expect(kind.commands[0].MoveCall!.function).toBe('seal_approve_content_paid_v2');expect(kind.commands).toHaveLength(1)
 expect(kind.inputs.flatMap(i=>i.Object?.SharedObject?[i.Object.SharedObject.mutable]:[])).toEqual([false,false,false])
 expect(f.cryptoFixture.unwrapped.every(v=>v.every(b=>b===0))).toBe(true);result.content.bytes.fill(0)
})
it('clears actual AES plaintext if the actual current Entry expires during controlled keyserver decryption',async()=>{
 const f=await integratedProtectedFixture(true),decrypt=f.cryptoFixture.decryptCall.getMockImplementation()!
 f.cryptoFixture.decryptCall.mockImplementation(async(...args)=>{const result=await decrypt(...args);f.x.clock(150);return result})
 await expect(f.run()).rejects.toThrow('QUALIFICATION_CHANGED');expect(f.opened()).toBeInstanceOf(Uint8Array);expect(f.opened()!.every(v=>v===0)).toBe(true)
})
it('rejects actual current Record changes before session signing in the composed protected flow',async()=>{
 const f=await integratedProtectedFixture(),fetch=f.fetcher.getMockImplementation()!
 f.fetcher.mockImplementation(async(...args)=>{const result=await fetch(...args);f.x.record.name='changed';f.rewrite();return result})
 await expect(f.run()).rejects.toThrow();expect(f.cryptoFixture.sign).not.toHaveBeenCalled();expect(f.cryptoFixture.decryptCall).not.toHaveBeenCalled()
})
it('rejects an actual callable policy ABI mismatch before signing in the composed flow',async()=>{
 const f=await integratedProtectedFixture(),core=f.x.f.client.core as any,read=core.getMoveFunction.getMockImplementation()!
 core.getMoveFunction.mockImplementation(async(...args:any[])=>{const result=await read(...args);result.function.parameters[2].reference='mutable';return result})
 await expect(f.run()).rejects.toThrow('INTERFACE');expect(f.cryptoFixture.sign).not.toHaveBeenCalled();expect(f.cryptoFixture.decryptCall).not.toHaveBeenCalled()
})
it('rejects ciphertext integrity failure before signing in the actual current-object composed flow',async()=>{
 const f=await integratedProtectedFixture();f.fetcher.mockImplementation(async()=>new Response(new Uint8Array(Number(f.x.record.reference.bytes))))
 await expect(f.run()).rejects.toThrow('CIPHERTEXT_HASH');expect(f.cryptoFixture.sign).not.toHaveBeenCalled();expect(f.cryptoFixture.decryptCall).not.toHaveBeenCalled()
})
it('does not open or sign after actual Auth generation invalidates the existing Entry',async()=>{
 const f=await integratedProtectedFixture(),row=f.x.f.rows.get(f.x.auth.id),owner=bcs.Object.parse(row.bcs.value).owner.ObjectOwner!
 f.x.auth.generation=3;f.x.f.object(f.x.auth.id,`${f.x.params.target.content!.originalPackageId}::authorization::Authorization`,NativeInitialAuthorizationBcs.serialize(f.x.auth).toBytes(),owner)
 expect(await f.run()).toMatchObject({status:'CURRENT_ACCESS_NOT_REUSABLE',notContentDelivered:true});expect(f.fetcher).not.toHaveBeenCalled();expect(f.cryptoFixture.sign).not.toHaveBeenCalled();expect(f.cryptoFixture.decryptCall).not.toHaveBeenCalled()
})

async function contractCheckedPreviewFixture(variant=''){
 const x=await fixture('new'),abi=await publicReadPaidAbiV2Fixture(),client=x.f.client as any,expected=(await readNativePublicReadPaidV2(x.params)).quote!
 const normalized=(fn:any)=>{const value=JSON.parse(JSON.stringify(fn).replaceAll(aid(42),x.f.nativeId).replaceAll(aid(44),x.params.economics.foundation.originalPackageId));value.packageId=x.params.target.native.callablePackageId;return value}
 client.core.getMoveFunction=vi.fn(async(r:any)=>({function:normalized([abi.quote,abi.buy,abi.approval].find(fn=>fn.name===r.name))}))
 client.core.simulateTransaction=vi.fn(async(request:any)=>{
  const kind=bcs.TransactionKind.parse(await request.transaction.build({onlyTransactionKind:true})),sender=x.buyer,raw=bcs.TransactionData.serialize({V1:{kind,sender,gasData:{owner:sender,payment:[],price:0,budget:0},expiration:{None:true}}}).toBytes(),digest=TransactionDataBuilder.getDigestFromBytes(raw)
  const shared=request.transaction.getData().inputs.flatMap((i:any)=>i.Object?.SharedObject?[i.Object.SharedObject]:[])
  const effects=bcs.TransactionEffects.serialize({V2:{transactionDigest:digest,status:{Success:true},executedEpoch:1,gasUsed:{computationCost:0,storageCost:0,storageRebate:0,nonRefundableStorageFee:0},lamportVersion:11,changedObjects:[],unchangedConsensusObjects:shared.map((r:any)=>{const object=x.f.rows.get(r.objectId);return [r.objectId,{ReadOnlyRoot:[String(object.version),object.digest]}]}),gasObjectIndex:null,eventsDigest:null,dependencies:[],auxDataDigest:null}}).toBytes()
  if(variant==='entry-added'){
   x.ledger.entries.size=1;const key={kind:x.record.kind,buyer:x.buyer},wrapped=`0x2::dynamic_object_field::Wrapper<${x.f.nativeId}::birth::PaidKey>`,owner=deriveDynamicFieldID(x.f.state.id,wrapped,new Uint8Array([0]))
   x.f.object(x.ledger.id,`${x.params.target.content!.originalPackageId}::paid_access::Ledger`,NativeInitialPaidBcs.serialize(x.ledger).toBytes(),owner)
   x.f.object(x.entryId,`0x2::dynamic_field::Field<${x.params.target.content!.originalPackageId}::paid_access::BuyerKey,${x.params.target.content!.originalPackageId}::paid_access::Entry>`,bcs.struct('Field',{id:bcs.Address,name:PaidContentBuyerKeyBcs,value:PaidContentEntryBcs}).serialize({id:x.entryId,name:key,value:{issuer:x.owner,generation:2,scope:1,expiry:null,revision:3}}).toBytes(),x.ledger.entries.id)
  }
  if(variant==='clock')x.clock(101)
  return {$kind:'Transaction',Transaction:{digest,status:{success:true},bcs:raw,effects:{status:{success:true},transactionDigest:digest,bcs:effects}},commandResults:[{mutatedReferences:[],returnValues:[{bcs:bcs.byteVector().serialize(expected.hash).toBytes()},{bcs:bcs.u64().serialize(variant==='wrong-total'?'103':expected.total).toBytes()}]}]}
 })
 return {...x,client,runPreview:()=>readContractCheckedNativePublicReadPaidPreviewV2(x.params)}
}
it('composes actual new-purchase Record/Entry/fee qualification with actual pinned ABI and readonly contract quote adapter',async()=>{
 const x=await contractCheckedPreviewFixture(),result=await x.runPreview()
 expect(result).toMatchObject({status:'CONTRACT_QUOTE_CHECKED',qualification:{decision:{action:'PURCHASE_REQUIRED'},quote:{ask:'101',platformFee:'3',total:'104'}},contractQuote:{contractQuote:{total:'104'},queryChecks:'DISABLED_READONLY_DEV_INSPECT'},requiresFullPurchaseFundingAndCheckedSimulation:true,notSigningQualification:true})
 expect(x.client.core.simulateTransaction).toHaveBeenCalledOnce()
})
it.each(['','owner','scope','missing-offer'])('does not invoke new-sale ABI or simulation for reusable/blocked current qualification: %s',async variant=>{
 const x=await fixture(variant);x.f.rows.delete(x.cfg.id)
 expect(await readContractCheckedNativePublicReadPaidPreviewV2(x.params)).toMatchObject({status:'NO_NEW_PURCHASE_QUOTE',contractQuote:null,notSigningQualification:true})
})
it('refuses to return a stale purchase quote if actual current Entry becomes reusable during the query',async()=>{
 await expect((await contractCheckedPreviewFixture('entry-added')).runPreview()).rejects.toThrow('PREVIEW_CHANGED')
})
it('propagates contract total mismatch instead of falling back to the local price',async()=>{
 await expect((await contractCheckedPreviewFixture('wrong-total')).runPreview()).rejects.toThrow('MISMATCH')
})
it('allows normal chain Clock advancement without making the same contract quote stale',async()=>{
 expect(await(await contractCheckedPreviewFixture('clock')).runPreview()).toMatchObject({status:'CONTRACT_QUOTE_CHECKED',qualification:{observedAtMs:'101'},notSigningQualification:true})
})
it('captures quote and current-read capabilities before the first awaited observation',async()=>{
 const x=await contractCheckedPreviewFixture(),source=x.client.core,chain=source.getChainIdentifier.getMockImplementation()!
 source.getChainIdentifier.mockImplementation(async()=>{source.getMoveFunction=()=>{throw Error('REPLACED_QUERY_ABI')};source.simulateTransaction=()=>{throw Error('REPLACED_QUERY')};return chain()})
 expect(await x.runPreview()).toMatchObject({status:'CONTRACT_QUOTE_CHECKED'})
})

async function purchasePreparationFixture(variant=''){
 const x=await contractCheckedPreviewFixture(),client=x.client,coinCodec=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()}),paymentId=aid(8800),gasId=aid(8801)
 const coin=(id:string,balance:number,owner=x.buyer)=>x.f.object(id,'0x2::coin::Coin<0x2::sui::SUI>',coinCodec.serialize({id,balance}).toBytes(),{AddressOwner:owner})
 const payment=coin(paymentId,variant==='payment-low'?103:1000,variant==='payment-owner'?aid(999):x.buyer),gasCoin=coin(gasId,variant==='gas-low'?9:100)
 const ref=(row:any)=>({objectId:row.objectId,version:String(row.version),digest:row.digest})
 x.f.object(x.params.target.registryId,`${x.f.nativeId}::registry::Registry`,bcs.Address.serialize(x.params.target.registryId).toBytes(),{Shared:{initialSharedVersion:'5'}})
 client.ledgerService.getEpoch=vi.fn(async()=>({response:{epoch:{epoch:variant==='epoch'?7n:5n,referenceGasPrice:variant==='gas-price'?2n:1n}}}))
 const reviewed=await readNativePublicReadPaidV2(x.params);if(variant==='review-total')reviewed.quote!.total='105'
 const input={qualification:x.params,reviewed,paymentCoin:ref(payment),gas:{budget:'10',price:'1',coins:[ref(gasCoin)]},expirationEpoch:'6',quoteExpiryMs:variant==='expiry'?'99':'200',attempt:new Uint8Array(32).fill(1),getBuyerAddress:()=>x.buyer}
 if(variant==='gas-alias')input.gas.coins=[ref(payment)]
 if(variant==='attempt')input.attempt.fill(0)
 return {...x,input,runPrepare:()=>prepareNewNativePublicReadPaidPurchaseV2(input)}
}
it('prepares exact unsigned V2 packet from actual reviewed qualification, contract quote and current payment/Gas Coins',async()=>{
 const x=await purchasePreparationFixture(),result=await x.runPrepare()
 expect(result).toMatchObject({format:'native-public-read-v2',packet:{phase:'PREPARED',signature:null},intent:{quote:{total:'104'},paymentCoin:{balance:'1000'}},context:{originalQuotedOffer:{price:'101',scope:'1',duration:'100',revision:'2'},originalReceiptContext:{soulId:x.params.soulId,ledgerId:x.ledger.id,offer:{price:'101',scope:'1',duration:'100',revision:'2'}}},funding:{verifiedBalance:'1000',notReservedOrPaid:true},gasFunding:{verifiedBalance:'100'},requiresMainDurableJournalAndOldOperationExclusion:true,requiresCurrentRegistrySourceAndPhysicalEconomicsQualification:true,requiresFullPacketCheckedSimulationAndFinalWallet:true,notSignedOrExecuted:true})
 const raw=bcs.TransactionData.parse((await import('@mysten/sui/utils')).fromBase64(result.packet.bytes)).V1!
 const graph=raw.kind.ProgrammableTransaction!,calls=graph.commands
 expect(calls).toHaveLength(3)
 expect(calls[1].MoveCall!.function).toBe('buy_public_read_paid_v2')
 const buy=calls[1].MoveCall!,approval=calls[2].MoveCall!
 expect(approval.function).toBe('seal_approve_content_paid_v2')
 expect(approval.package).toBe(buy.package)
 expect([approval.arguments[1],approval.arguments[2],approval.arguments[4]]).toEqual([buy.arguments[2],buy.arguments[3],buy.arguments[11]])
 expect(graph.inputs[approval.arguments[3].Input!].Pure!.bytes).toBe(toBase64(bcs.u64().serialize(x.params.recordIndex).toBytes()))
 expect(graph.inputs[approval.arguments[0].Input!].Pure!.bytes).toBe(toBase64(bcs.byteVector().serialize(fromHex(result.qualification.namespace!)).toBytes()))
 expect(raw.gasData.payment).toHaveLength(1)
 expect(x.client.core.simulateTransaction).toHaveBeenCalledTimes(2)
})
it.each(['payment-low','payment-owner','gas-low','epoch','gas-price','review-total','expiry','gas-alias','attempt'])('rejects new V2 preparation with %s',async variant=>{
 await expect((await purchasePreparationFixture(variant)).runPrepare()).rejects.toThrow()
})
it('rejects a selected payment Coin changed after unsigned bytes were built instead of reselecting',async()=>{
 const x=await purchasePreparationFixture(),read=x.client.ledgerService.getObject.getMockImplementation()!;let count=0
 x.client.ledgerService.getObject.mockImplementation(async(r:any)=>{if(r.objectId===x.input.paymentCoin.objectId&&++count===3){const row=x.f.rows.get(r.objectId),raw=bcs.Object.parse(row.bcs.value);raw.data.Move!.version='11';row.bcs.value=bcs.Object.serialize(raw).toBytes();row.version=11n;row.digest=activityHash('Object',row.bcs.value)}return read(r)})
 await expect(x.runPrepare()).rejects.toThrow('FUNDING_COIN');expect(count).toBe(3)
})
it('rejects quote expiry advancing during final contract query before allowing any signing',async()=>{
 const x=await purchasePreparationFixture(),simulate=x.client.core.simulateTransaction.getMockImplementation()!;let count=0
 x.client.core.simulateTransaction.mockImplementation(async(r:any)=>{const result=await simulate(r);if(++count===2)x.clock(201);return result})
 await expect(x.runPrepare()).rejects.toThrow('PREPARE_CHANGED')
})
it('guards wallet changes after the first asynchronous observation',async()=>{
 const x=await purchasePreparationFixture(),epoch=x.client.ledgerService.getEpoch.getMockImplementation()!;let address=x.buyer
 x.input.getBuyerAddress=()=>address;x.client.ledgerService.getEpoch.mockImplementation(async()=>{address=aid(999);return epoch()})
 await expect(x.runPrepare()).rejects.toThrow('WALLET_CHANGED')
})
it('captures epoch/current-query/funding capabilities and independent review before first await',async()=>{
 const x=await purchasePreparationFixture(),epoch=x.client.ledgerService.getEpoch.getMockImplementation()!
 x.client.ledgerService.getEpoch.mockImplementation(async()=>{x.input.reviewed.quote!.total='999';x.client.ledgerService.getObject=()=>{throw Error('REPLACED_PREPARE_RPC')};x.client.core.simulateTransaction=()=>{throw Error('REPLACED_PREPARE_QUERY')};return epoch()})
 expect(await x.runPrepare()).toMatchObject({intent:{quote:{total:'104'}},notSignedOrExecuted:true})
})
it('verifies multiple actual Gas Coins as a separate budget without spending the payment Coin twice',async()=>{
 const x=await purchasePreparationFixture(),Coin=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()}),ref=(r:any)=>({objectId:r.objectId,version:String(r.version),digest:r.digest})
 const a=x.f.object(aid(8801),'0x2::coin::Coin<0x2::sui::SUI>',Coin.serialize({id:aid(8801),balance:6}).toBytes(),{AddressOwner:x.buyer}),b=x.f.object(aid(8802),'0x2::coin::Coin<0x2::sui::SUI>',Coin.serialize({id:aid(8802),balance:6}).toBytes(),{AddressOwner:x.buyer})
 x.input.gas.coins=[ref(a),ref(b)];const result=await x.runPrepare()
 expect(result.gasFunding.verifiedBalance).toBe('12');expect(result.intent.paymentCoin.objectId).toBe(x.input.paymentCoin.objectId)
 expect(bcs.TransactionData.parse((await import('@mysten/sui/utils')).fromBase64(result.packet.bytes)).V1!.gasData.payment.map(r=>r.objectId)).toEqual([aid(8801),aid(8802)])
})
it('rejects actual Gas ownership even if the reviewed version/digest match',async()=>{
 const x=await purchasePreparationFixture(),id=aid(8801),Coin=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()}),r=x.f.object(id,'0x2::coin::Coin<0x2::sui::SUI>',Coin.serialize({id,balance:100}).toBytes(),{AddressOwner:aid(999)})
 x.input.gas.coins=[{objectId:id,version:String(r.version),digest:r.digest}];await expect(x.runPrepare()).rejects.toThrow('FUNDING_COIN')
})
it('rechecks epoch validity after exact unsigned packet construction',async()=>{
 const x=await purchasePreparationFixture();let count=0
 x.client.ledgerService.getEpoch.mockImplementation(async()=>({response:{epoch:{epoch:++count===1?5n:7n,referenceGasPrice:1n}}}))
 await expect(x.runPrepare()).rejects.toThrow('EPOCH_GAS');expect(count).toBe(2)
})

// One complete local dataflow, not actual VM/node payment acceptance: current
// objects -> reviewed unsigned packet -> checks-enabled RPC request -> modeled
// full ObjectSet/events. Production business verifiers run on that witness.
async function completePreflightFixture(variant=''){
 const x=await purchasePreparationFixture(),client=x.client,expected=x.input.reviewed,offer=expected.offer!,content=x.params.target.content!.originalPackageId
 client.ledgerService.getServiceInfo=vi.fn(async()=>({response:{chainId:MAINNET_GENESIS_DIGEST}}))
 client.transactionExecutionService={simulateTransaction:vi.fn(async(request:any)=>{
  expect(request.checks).toBe(0);expect(request.doGasSelection).toBe(false)
  const bytes=request.transaction.bcs.value as Uint8Array,tx=bcs.TransactionData.parse(bytes).V1!,digest=TransactionDataBuilder.getDigestFromBytes(bytes),version='11',pool:any[]=[],changes:any[]=[]
  const project=(id:string,object:any)=>{const raw=bcs.Object.serialize(object).toBytes(),move=object.data.Move,owner=object.owner
   return {objectId:id,version:BigInt(move.version),digest:activityHash('Object',raw),bcs:{value:raw},contents:{value:move.contents},objectType:historicalMoveObjectType(move.type),previousTransaction:object.previousTransaction,
    owner:owner.AddressOwner?{kind:1,address:owner.AddressOwner}:owner.ObjectOwner?{kind:2,address:owner.ObjectOwner}:{kind:3,version:BigInt(owner.Shared.initialSharedVersion)}}}
  const before=(id:string)=>{const row=x.f.rows.get(id);const value=project(id,bcs.Object.parse(row.bcs.value));if(!pool.some(r=>r.objectId===id&&r.version===value.version))pool.push(value);return value}
  const write=(id:string,type:string,contents:Uint8Array,owner:any,created=false)=>{
   const old=created?null:before(id),data={data:{Move:{type:{Other:TypeTagSerializer.parseFromStr(type).struct!},hasPublicTransfer:true,version,contents}},owner,previousTransaction:digest,storageRebate:'0'},row=project(id,data)
   pool.push(row);changes.push([id,{inputState:old?{Exist:[[String(old.version),old.digest],owner]}:{NotExist:true},outputState:{ObjectWrite:[row.digest,owner]},idOperation:created?{Created:true}:{None:true}}]);return row}
  const body=(id:string)=>bcs.Object.parse(x.f.rows.get(id).bcs.value).data.Move!.contents
  write(x.host.id,`${x.f.nativeId}::birth::PublicReadHostV2`,body(x.host.id),{Shared:{initialSharedVersion:'5'}})
  const paidOwner=deriveDynamicFieldID(x.f.state.id,`0x2::dynamic_object_field::Wrapper<${x.f.nativeId}::birth::PaidKey>`,new Uint8Array([0]))
  write(x.ledger.id,`${content}::paid_access::Ledger`,NativeInitialPaidBcs.serialize({...x.ledger,revision:4,entries:{...x.ledger.entries,size:1},attempts:{...x.ledger.attempts,size:1}}).toBytes(),{ObjectOwner:paidOwner})
  const nextConfig=structuredClone(x.cfg);nextConfig.income.funds='3';nextConfig.income.collected='3';nextConfig.income.revision='1'
  write(x.cfg.id,`${x.params.economics.foundation.originalPackageId}::economics::Config<0x2::sui::SUI>`,EconomicsConfigBcs.serialize(nextConfig).toBytes(),{Shared:{initialSharedVersion:'1'}})
  const entry={issuer:x.owner,generation:'2',scope:'1',expiry:'200',revision:'4'},buyerKey={kind:x.record.kind,buyer:x.buyer}
  write(x.entryId,`0x2::dynamic_field::Field<${content}::paid_access::BuyerKey,${content}::paid_access::Entry>`,NativePaidEntryFieldBcs.serialize({id:x.entryId,name:buyerKey,value:entry}).toBytes(),{ObjectOwner:x.ledger.entries.id},true)
  const attempt=x.input.attempt,key={buyer:x.buyer,attempt},attemptId=deriveDynamicFieldID(x.ledger.attempts.id,`${content}::paid_access::AttemptKey`,NativePaidAttemptKeyBcs.serialize(key).toBytes())
  const receipt={kind:x.record.kind,quote:expected.quote!.hash,entry_hash:sha256(PaidContentEntryBcs.serialize(entry).toBytes()),price:offer.price,total:'104',platform_fee:'3',fee_revision:x.cfg.revision,platform_recipient:x.cfg.recipient,beneficiary:x.owner}
  write(attemptId,`0x2::dynamic_field::Field<${content}::paid_access::AttemptKey,${content}::paid_access::Receipt>`,NativePaidAttemptFieldBcs.serialize({id:attemptId,name:key,value:receipt}).toBytes(),{ObjectOwner:x.ledger.attempts.id},true)
  const Coin=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()}),coinType='0x2::coin::Coin<0x2::sui::SUI>'
  write(x.input.paymentCoin.objectId,coinType,Coin.serialize({id:x.input.paymentCoin.objectId,balance:variant==='debit'?897:896}).toBytes(),{AddressOwner:x.buyer})
  write(aid(8810),coinType,Coin.serialize({id:aid(8810),balance:101}).toBytes(),{AddressOwner:x.owner},true)
  const gasIndex=changes.length;write(x.input.gas.coins[0].objectId,coinType,Coin.serialize({id:x.input.gas.coins[0].objectId,balance:98}).toBytes(),{AddressOwner:x.buyer})
  const readonly=[x.params.target.registryId,x.f.kiosk!.id,aid(6)].map(id=>{const row=before(id);return [id,{ReadOnlyRoot:[String(row.version),row.digest]}]})
  const Events=bcs.vector(bcs.struct('Event',{package_id:bcs.Address,transaction_module:bcs.string(),sender:bcs.Address,type_:bcs.StructTag,contents:bcs.byteVector()}))
  const eventBytes=Events.serialize([{package_id:x.params.target.content!.callablePackageId,transaction_module:'paid_access',sender:x.buyer,type_:{address:content,module:'paid_access',name:'Updated',typeParams:[]},contents:NativePaidUpdatedBcs.serialize({root:x.params.soulId,kind:x.record.kind,buyer:x.buyer,revision:4,operation:2,entry}).toBytes()},
   {package_id:x.params.economics.foundation.callablePackageId,transaction_module:'economics',sender:x.buyer,type_:{address:x.params.economics.foundation.originalPackageId,module:'economics',name:'Paid',typeParams:[]},contents:NativeSubscriptionPaidBcs.serialize({subject:x.params.soulId,attempt,payer:x.buyer,gross:104,fee:3,beneficiary:x.owner}).toBytes()}]).toBytes()
  const effects=bcs.TransactionEffects.serialize({V2:{transactionDigest:digest,status:{Success:true},executedEpoch:5,gasUsed:{computationCost:1,storageCost:1,storageRebate:0,nonRefundableStorageFee:0},lamportVersion:version,changedObjects:changes,unchangedConsensusObjects:readonly,gasObjectIndex:gasIndex,eventsDigest:activityHash('TransactionEvents',eventBytes),dependencies:[],auxDataDigest:null}}).toBytes()
  return {response:{transaction:{digest,transaction:{bcs:{value:bytes}},effects:{bcs:{value:effects},transactionDigest:digest,status:{success:true}},events:{bcs:{value:eventBytes}},objects:{objects:pool},signatures:[]},commandOutputs:[]}}
 })}
 return {...x,runComplete:()=>preflightNewNativePublicReadPaidPurchaseV2(x.input)}
}
it('composes real current qualification, exact prepared packet and full simulated business witnesses in one NEW preflight',async()=>{
 const x=await completePreflightFixture(),result=await x.runComplete()
 expect(result).toMatchObject({prepared:{intent:{quote:{total:'104'}},context:{originalQuotedOffer:{price:'101',scope:'1',duration:'100'}}},checkedSimulation:{checksRequested:'ENABLED',transactionDigest:result.prepared.packet.digest,simulation:{money:{buyerGrossDebit:'104',protocolIncome:'3'},receipt:{receipt:{total:'104'}}}},notSignedOrExecuted:true,notFinalizedReceipt:true,notContentDelivered:true,requiresMainDurableJournalAndOldOperationExclusion:true})
 expect(result.checkedSimulation.simulation.inventory.unexplainedConsensusIds).not.toContain(x.params.target.registryId)
 expect(result.checkedSimulation.simulation.registryIdentity.notAuthorityProof).toBe(true)
 expect(result.checkedSimulation.simulation.inventory.missingSubproofs).toContain('originalRegistrySourceAuthorityAndEconomicFields')
 expect(x.client.core.simulateTransaction).toHaveBeenCalledTimes(2);expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
 const sent=x.client.transactionExecutionService.simulateTransaction.mock.calls[0][0].transaction.bcs.value
 expect((await import('@mysten/sui/utils')).toBase64(sent)).toBe(result.prepared.packet.bytes)
})
it('does not treat valid readonly quote/preparation as success when full simulated Coin debit contradicts original price',async()=>{
 const x=await completePreflightFixture('debit');await expect(x.runComplete()).rejects.toThrow('MONEY_BUYER_DEBIT');expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
})
it('captures full simulation/service-info methods before asynchronous preparation begins',async()=>{
 const x=await completePreflightFixture(),epoch=x.client.ledgerService.getEpoch.getMockImplementation()!
 x.client.ledgerService.getEpoch.mockImplementation(async()=>{x.client.transactionExecutionService.simulateTransaction=()=>{throw Error('REPLACED_FULL_SIM')};x.client.ledgerService.getServiceInfo=()=>{throw Error('REPLACED_SERVICE_INFO')};return epoch()})
 expect(await x.runComplete()).toMatchObject({checkedSimulation:{checksRequested:'ENABLED'},notContentDelivered:true})
})

// A controlled post-append full Object state, not an executed append transaction.
function appendPaidRecord(x:Awaited<ReturnType<typeof fixture>>,options:{kind?:number;scope?:string;readMask?:string}={}){
 const index=x.f.library.entries.length,record=structuredClone(x.record);record.name=record.kind===0?'soul':record.kind===1?'default':`appended-${index}`;record.version=String(BigInt(record.version)+1n);record.nonce=new Uint8Array(16).fill(9);record.seal_namespace=null
 if(options.kind!==undefined&&options.kind!==record.kind){record.kind=options.kind;record.name=`appended-${index}`;record.version='0'}record.scope=options.scope??record.scope;record.read_mask=options.readMask??'5'
 const bytes=CanonicalNativeRecordBcs.serialize(record).toBytes(),id=deriveDynamicFieldID(x.f.library.records.id,'u64',bcs.u64().serialize(index).toBytes())
 x.f.library.records.size=String(BigInt(x.f.library.records.size)+1n);x.f.library.revision=String(BigInt(x.f.library.revision)+1n);x.f.library.entries.push({index:String(index),hash:sha256(bytes)})
 x.f.object(id,`0x2::dynamic_field::Field<u64,${x.params.target.content!.originalPackageId}::document::Record>`,bcs.struct('Field',{id:bcs.Address,name:bcs.u64(),value:CanonicalNativeRecordBcs}).serialize({id,name:index,value:record}).toBytes(),x.f.library.records.id)
 x.f.object(x.f.library.id,`${x.params.target.content!.originalPackageId}::founding_library::Library`,CanonicalNativeLibraryBcs.serialize(x.f.library).toBytes(),x.f.libraryFieldId)
 x.record=record;x.params.recordIndex=index;x.params.kind=record.kind;x.params.requiredScope=BigInt(record.scope)
 return {id,index,record}
}
it('reuses an unchanged current per-kind Entry for newly appended compatible content without Offer or Config',async()=>{
 const x=await fixture(),before=await readNativePublicReadPaidV2(x.params);x.f.rows.delete(x.cfg.id);const added=appendPaidRecord(x)
 const after=await readContractCheckedNativePublicReadPaidPreviewV2(x.params)
 expect(after).toMatchObject({status:'NO_NEW_PURCHASE_QUOTE',contractQuote:null,qualification:{recordIndex:added.index,contentName:x.record.name,contentVersion:x.record.version,decision:{action:'REUSE_ENTRY'},entryHash:before.entryHash,quote:null,authReference:before.authReference,ledgerReference:before.ledgerReference}})
 expect(after.qualification.recordReference.objectId).toBe(added.id);expect(after.qualification.recordReference.objectId).not.toBe(before.recordReference.objectId)
})
it('rejects a first Entry miss before quoting an appended version that the Entry covers', async () => {
 const x = await fixture(), added = appendPaidRecord(x)
 const ledger = x.f.client.ledgerService, get = ledger.getObject.getMockImplementation()!
 let entryReads = 0
 ledger.getObject.mockImplementation(async (r: any) => {
  if (r.objectId === x.entryId && ++entryReads === 1) throw { code: 'NOT_FOUND' }
  return get(r)
 })
 await expect(readContractCheckedNativePublicReadPaidPreviewV2(x.params)).rejects.toThrow('PUBLIC_PAID_V2_READ_CHANGED')
 expect(entryReads).toBe(2)
 expect(ledger.getObject.mock.calls.some(([r]) => [x.offerId, x.cfg.id].includes(r.objectId))).toBe(false)
 expect(await readContractCheckedNativePublicReadPaidPreviewV2(x.params)).toMatchObject({
  status: 'NO_NEW_PURCHASE_QUOTE', contractQuote: null, qualification: { recordIndex: added.index, decision: { action: 'REUSE_ENTRY' } },
 })
})

it('refuses to finalize a blocked decision after the previously absent Offer appears', async () => {
 const x = await contractCheckedPreviewFixture()
 const ledger = x.client.ledgerService, get = ledger.getObject.getMockImplementation()!
 let offerReads = 0
 ledger.getObject.mockImplementation(async (r: any, opts: any) => {
  if (r.objectId === x.offerId && ++offerReads === 1) throw { code: 'NOT_FOUND' }
  return get(r, opts)
 })
 await expect(x.runPreview()).rejects.toThrow('PUBLIC_PAID_V2_READ_CHANGED')
 expect(offerReads).toBe(2)
 expect(x.client.core.simulateTransaction).not.toHaveBeenCalled()
 expect(await x.runPreview()).toMatchObject({ status: 'CONTRACT_QUOTE_CHECKED', contractQuote: { contractQuote: { total: '104' } } })
})

it('opens newly appended compatible Record with real full-object qualification/ABI/Seal/AES and the actual new index',async()=>{
 const x=await integratedProtectedFixture(false,true),params=x.x.params
 const view=await readNativePublicReadOverviewV2(params)
 const selected=view.recordSummaries.find(row=>row.index===params.recordIndex)!
 x.x.f.rows.delete(x.x.cfg.id)
 const result=await x.run({...params,economics:undefined,expectedSourceKey:nativePublicOwnerSourceKeyV2(view,selected)})
 expect(result).toMatchObject({status:'CONTENT_OPENED',accessPath:'REUSE_ENTRY',qualification:{recordIndex:2,contentName:'soul',contentVersion:'1'}})
 if(result.status!=='CONTENT_OPENED')throw Error('NOT_OPENED')
 expect(result.content.bytes).toEqual(x.plaintext)
 const ptb=bcs.TransactionKind.parse(x.cryptoFixture.decryptCall.mock.calls[0][0].txBytes).ProgrammableTransaction!,index=ptb.commands[0].MoveCall!.arguments[3].Input!
 expect(ptb.inputs[index].Pure!.bytes).toBe(toBase64(bcs.u64().serialize(2).toBytes()));result.content.bytes.fill(0)
})
it('blocks a new Record outside an existing permanent Entry scope without offering duplicate purchase',async()=>{
 const x=await fixture();appendPaidRecord(x,{scope:'2'});x.f.rows.delete(x.cfg.id)
 expect(await readContractCheckedNativePublicReadPaidPreviewV2(x.params)).toMatchObject({status:'NO_NEW_PURCHASE_QUOTE',qualification:{decision:{action:'BLOCKED',reason:'PERMANENT_ENTRY_SCOPE_MISMATCH'}},contractQuote:null})
})
it('does not reuse a different kind Entry for newly appended content',async()=>{
 const x=await fixture();appendPaidRecord(x,{kind:99});x.f.rows.delete(x.cfg.id)
 expect(await readNativePublicReadPaidV2(x.params)).toMatchObject({decision:{action:'BLOCKED',reason:'NO_SALE_OFFER'},entryHash:null,quote:null})
})
it('checks the same additive contract total for new content requiring the per-kind purchase',async()=>{
 const x=await contractCheckedPreviewFixture();appendPaidRecord(x)
 expect(await x.runPreview()).toMatchObject({status:'CONTRACT_QUOTE_CHECKED',qualification:{recordIndex:2,contentName:'soul',contentVersion:'1',decision:{action:'PURCHASE_REQUIRED'},quote:{ask:'101',platformFee:'3',total:'104'}},contractQuote:{contractQuote:{total:'104'}}})
 expect(x.client.core.simulateTransaction).toHaveBeenCalledOnce()
})
it('does not reuse compatible newly appended content after actual authorization generation invalidation',async()=>{
 const x=await fixture();appendPaidRecord(x);x.auth.generation=3
 const owner=bcs.Object.parse(x.f.rows.get(x.auth.id).bcs.value).owner.ObjectOwner!
 x.f.object(x.auth.id,`${x.params.target.content!.originalPackageId}::authorization::Authorization`,NativeInitialAuthorizationBcs.serialize(x.auth).toBytes(),owner)
 expect(await readNativePublicReadPaidV2(x.params)).toMatchObject({decision:{action:'BLOCKED',reason:'NO_SALE_OFFER'},quote:null})
})
it('rejects new Record bytes not committed by the actual updated Library',async()=>{
 const x=await fixture(),added=appendPaidRecord(x);x.f.library.entries[added.index].hash[0]^=1
 x.f.object(x.f.library.id,`${x.params.target.content!.originalPackageId}::founding_library::Library`,CanonicalNativeLibraryBcs.serialize(x.f.library).toBytes(),x.f.libraryFieldId)
 await expect(readNativePublicReadPaidV2(x.params)).rejects.toThrow('RECORD_COMMITMENT')
})
it('does not let an existing subscription bypass the new Record paid-read mask',async()=>{
 const x=await fixture();appendPaidRecord(x,{readMask:'1'})
 await expect(readNativePublicReadPaidV2(x.params)).rejects.toThrow('PAID_RECORD')
})

it('awaits host retention of exact original V2 purchase bytes and context before full simulation, isolating callback mutation',async()=>{
 const x=await completePreflightFixture();let original:any,release!:()=>void
 const result=preflightNewNativePublicReadPaidPurchaseV2({...x.input,onPreparedOriginal:async value=>{original=structuredClone(value);value.intent.quote.total='999';await new Promise<void>(r=>release=r)}})
 for(let i=0;i<200&&!original;i++)await new Promise(r=>setTimeout(r,0));expect(original.packet.phase).toBe('PREPARED');expect(original.packet.signature).toBeNull();expect(x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
 release();const checked=await result;expect(checked.prepared.packet).toEqual(original.packet);expect(checked.prepared.intent.quote.total).toBe('104');expect(checked.prepared.context).toEqual(original.context)
})
it('does not simulate or rebuild a prepared original after host persistence failure',async()=>{
 const x=await completePreflightFixture();let original:any
 await expect(preflightNewNativePublicReadPaidPurchaseV2({...x.input,onPreparedOriginal:async value=>{original=structuredClone(value);throw Error('ORIGINAL_WRITE_FAILED')}})).rejects.toThrow('ORIGINAL_WRITE_FAILED')
 expect(original.packet.bytes).toBeTruthy();expect(x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
})
it('waits for an in-flight original V2 purchase write to settle after cancellation and never starts simulation',async()=>{
 const x=await completePreflightFixture(),controller=new AbortController();let entered=false,settled=false,release!:()=>void
 const result=preflightNewNativePublicReadPaidPurchaseV2({...x.input,qualification:{...x.input.qualification,signal:controller.signal},onPreparedOriginal:async()=>{entered=true;await new Promise<void>(r=>release=r)}})
 const observed=result.then(()=>{settled=true;return null},error=>{settled=true;return error})
 for(let i=0;i<200&&!entered;i++)await new Promise(r=>setTimeout(r,0));expect(entered).toBe(true);controller.abort();await Promise.resolve();expect(settled).toBe(false)
 release();expect(await observed).toBeInstanceOf(Error);expect(x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
})


it('binds an appended reuse preview to its current committed overview without fee configuration', async () => {
 const x=await fixture(),added=appendPaidRecord(x);x.f.rows.delete(x.cfg.id)
 const view=await readNativePublicReadOverviewV2(x.params)
 const selected=view.recordSummaries.find(row=>row.index===added.index)!
 const expectedSourceKey=nativePublicOwnerSourceKeyV2(view,selected)
 const params={...x.params,economics:undefined,expectedSourceKey}
 expect(await readContractCheckedNativePublicReadPaidPreviewV2(params)).toMatchObject({
  status:'NO_NEW_PURCHASE_QUOTE',qualification:{recordIndex:added.index,decision:{action:'REUSE_ENTRY'},quote:null},
 })
 appendPaidRecord(x)
 await expect(readContractCheckedNativePublicReadPaidPreviewV2(params)).rejects.toThrow('READ_OVERVIEW_CHANGED_REFRESH')
})
it('keeps a new quote unavailable without configured economics, while confirming the offer needs purchase', async () => {
 const x=await fixture('new');appendPaidRecord(x);x.f.rows.delete(x.cfg.id)
 const simulate=vi.fn()
 const client={...x.params.client,core:{...x.params.client.core,simulateTransaction:simulate}}
 expect(await readContractCheckedNativePublicReadPaidPreviewV2({...x.params,client,economics:undefined})).toMatchObject({
  status:'QUOTE_UNAVAILABLE',contractQuote:null,qualification:{decision:{action:'PURCHASE_REQUIRED'},purchaseBlockers:['FEE_RELEASE_NOT_CONFIGURED'],quote:null},
 })
 expect(simulate).not.toHaveBeenCalled()
})
it('blocks the current owner on an appended paid-only version, consistent with both Seal policies', async () => {
 const x=await fixture('owner');appendPaidRecord(x,{readMask:'4'})
 expect(await readContractCheckedNativePublicReadPaidPreviewV2({...x.params,economics:undefined})).toMatchObject({
  status:'NO_NEW_PURCHASE_QUOTE',contractQuote:null,qualification:{decision:{action:'BLOCKED',reason:'OWNER_READ_DISABLED'}},
 })
})
it('rejects paid opening against an outdated library snapshot before requesting Seal or wallet access',async()=>{
 const f=await integratedProtectedFixture(false,true),q=f.x.params,p=f.cryptoFixture.params
 await expect(openNativePublicPaidContentV2({client:q.client,sealClient:f.cryptoFixture.client,target:q.target,soulId:q.soulId,
  recordIndex:q.recordIndex,viewerAddress:q.buyer,expectedSourceKey:'stale-source',blobBaseUrl:'https://walrus.example.com',
  sealConfig:p.sealConfig,signal:q.signal,getAddress:p.wallet.getAddress,signPersonalMessage:f.cryptoFixture.sign},{fetcher:f.fetcher}))
  .rejects.toThrow('OVERVIEW_CHANGED_REFRESH')
 expect(f.cryptoFixture.sign).not.toHaveBeenCalled()
 expect(f.fetcher).not.toHaveBeenCalled()
})
