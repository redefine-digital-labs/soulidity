import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, fromHex } from '@mysten/sui/utils'
import { commerceSaleMoneyFixture } from './commerce-sale-money'
import { batchHistoryFixture } from './walrus-batch-history'
import { activityEvidenceFixture, aid } from './activity-transaction-evidence'
import vm from './commerce-native-market-vm.json'
import { CanonicalNativeStateBcs, CanonicalSoulBcs } from '../../../web/lib/soulidity/canonical-native-workbench'
import { EconomicsConfigBcs, NativeOfferBcs } from '../../../web/lib/soulidity/commerce/economics-bcs'
import { NativeSaleRegistryBcs, NativeSaleSourceLocationBcs } from '../../../web/lib/soulidity/commerce/native-sale-source-binding'
import { nativeSaleSoulManifest } from '../../../web/lib/soulidity/commerce/native-sale-tree'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { proveHistoricalSaleSourceBinding } from '../../../web/lib/soulidity/commerce/historical-sale-source-binding'
import { SaleCollectionBcs, SaleCollectionMemberBcs, saleCollectionSnapshotHash } from '../../../web/lib/soulidity/commerce/collection-sale-proof'
import { NativeTransferPolicyBcs, NativeMarketRuleFieldBcs } from '../../../web/lib/soulidity/commerce/native-sale-conditions'
import { NativeSoldBcs } from '../../../web/lib/soulidity/commerce/native-sale-receipt'
import { NativeSalePaidBcs, readNativeSaleSettlementHistory } from '../../../web/lib/soulidity/commerce/native-sale-history'
import { proveNativeSaleMoney } from '../../../web/lib/soulidity/commerce/native-sale-money'


// Controlled original full BCS/history only; not node execution/source adoption.
async function saleSourceFixture(variant = '') {
  const x = await commerceSaleMoneyFixture(variant==='module-creator-seller'?'creator-seller':variant.startsWith('collection-') ? 'collection' : ''), h = await batchHistoryFixture(0), p = x.params, f = x.f
  const withCollection = variant.startsWith('collection-'), withModule = variant.startsWith('module-') || withCollection, standard = await activityEvidenceFixture()
  standard.deployment.originalPackageId = aid(84); standard.deployment.callablePackageId = aid(85)
  const sp = standard.packageData.data.Package!; sp.id = aid(85); sp.moduleMap = new Map([['soul', new Uint8Array([1])]])
  sp.typeOriginTable = ['Soul', 'ModuleKey'].map(datatypeName => ({ moduleName: 'soul', datatypeName, package: aid(84) })); standard.rehashPackage()
  const n = f.packageData.data.Package!
  n.typeOriginTable.push(...['NativeModule', 'CollectionKey'].map(datatypeName => ({ moduleName: 'birth', datatypeName, package: p.native.originalPackageId })))
  n.linkageTable.set(aid(84), { upgradedId: aid(85), upgradedVersion: variant === 'module-link' ? '3' : '2' })
  n.typeOriginTable.push(...['Rule', 'RuleConfig'].map(datatypeName => ({ moduleName: 'market', datatypeName, package: p.native.originalPackageId })))
  n.moduleMap.set('registry', new Uint8Array([1])); n.moduleMap.set('birth', new Uint8Array([1]))
  n.typeOriginTable.push(...[['registry', 'Registry'], ['registry', 'SoulProducer'], ['birth', 'State']].map(([moduleName, datatypeName]) => ({ moduleName, datatypeName, package: p.native.originalPackageId }))); f.rehashPackage()
  const originalGet = p.client.ledgerService.getObject.getMockImplementation()!
  const foundation = (await originalGet({ objectId: p.foundation.callablePackageId })).response.object
  const foundationRaw = bcs.Object.parse(foundation.bcs.value), fp = foundationRaw.data.Package!
  fp.typeOriginTable.push(...['SourceRegistryKey', 'SourceRegistryLocation'].map(datatypeName => ({ moduleName: 'economics', datatypeName, package: p.foundation.originalPackageId })))
  // Preserve authentic immutable full Object identity after controlled origin additions.
  const { activityHash } = await import('./activity-transaction-evidence')
  foundation.bcs.value = bcs.Object.serialize(foundationRaw).toBytes(); foundation.digest = activityHash('Object', foundation.bcs.value); p.foundation.callableDigest = foundation.digest
  const oldConfig = (await originalGet({ objectId: p.plan.configId, version: 9n })).response.object
  const c = EconomicsConfigBcs.parse(oldConfig.contents.value), configType = oldConfig.objectType
  const config = h.base.object(c.id, 9, configType, oldConfig.contents.value, { Shared: { initialSharedVersion: 1 } }, h.register.digest)
  const registryType = `${p.native.originalPackageId}::registry::Registry`
  const registry = x.object(p.plan.registryId, registryType, NativeSaleRegistryBcs.serialize({ id: p.plan.registryId, protocol: variant === 'registry' ? aid(99) : c.id, schema: 1, kiosks: { id: aid(130), size: 1 } }).toBytes(), { Shared: { initialSharedVersion: 1 } }, 9).row
  const state = CanonicalNativeStateBcs.parse(fromHex(vm.sections.BEFORE_ROOT.state))
  Object.assign(state, { id: x.offer.state, root: p.plan.soulId, protocol: variant === 'state' ? aid(99) : c.id, registry: p.plan.registryId, creator: x.offer.creator, creator_royalty_bps: x.offer.royalty })
  if (variant === 'module-provenance') state.provenance.kind = 3
  const stateType = `${p.native.originalPackageId}::birth::State`, bytes = CanonicalNativeStateBcs.serialize(state).toBytes()
  const stateOwner = withModule && variant !== 'module-owner' ? deriveDynamicFieldID(p.plan.soulId, `0x2::dynamic_object_field::Wrapper<${aid(84)}::soul::ModuleKey<${p.native.originalPackageId}::birth::NativeModule>>`, bcs.byteVector().serialize(new TextEncoder().encode('native')).toBytes()) : aid(131)
  const stateBefore = h.base.object(state.id, 9, stateType, bytes, { ObjectOwner: stateOwner }, h.register.digest)
  x.effect(state.id, { row: stateBefore, owner: bcs.Object.parse(stateBefore.bcs.value).owner }, x.object(state.id, stateType, bytes, { ObjectOwner: stateOwner }, 10))
  const collectionFields: any[] = []
  let collectionFieldId: string | null = null
  if (withCollection) {
    const keyType = `${p.native.originalPackageId}::birth::CollectionKey`
    collectionFieldId = deriveDynamicFieldID(state.id, keyType, new Uint8Array([0]))
    const Field = bcs.struct('NativeCollectionField', { id: bcs.Address, name: bcs.struct('Key', { dummy_field: bcs.bool() }), value: bcs.Address })
    const fieldType = `0x2::dynamic_field::Field<${keyType},0x2::object::ID>`
    const field = h.base.object(collectionFieldId, 9, fieldType, Field.serialize({ id: collectionFieldId, name: { dummy_field: variant === 'collection-key' }, value: variant === 'collection-binding' ? aid(99) : p.plan.collectionId! }).toBytes(), { ObjectOwner: variant === 'collection-owner' ? aid(99) : state.id }, h.register.digest)
    if (variant !== 'collection-missing') collectionFields.push(field)
    h.base.object(collectionFieldId, 10, fieldType, Field.serialize({ id: collectionFieldId, name: { dummy_field: false }, value: aid(99) }).toBytes(), { ObjectOwner: state.id }, h.register.digest)
  }
  if (withModule) {
    const soul = CanonicalSoulBcs.parse(fromHex(vm.sections.BEFORE_ROOT.soul)), nativeDescriptor = soul.modules.find(d => d.namespace.name.includes('NativeModule'))!
    soul.id = p.plan.soulId; soul.origin.source = variant === 'module-origin-source' ? aid(99) : p.plan.registryId
    soul.origin.source_type.name = variant === 'module-origin-type' ? `${p.native.originalPackageId}::registry::Other` : registryType
    soul.origin.producer.name = `${p.native.originalPackageId}::registry::${variant === 'module-origin-producer' ? 'Other' : 'SoulProducer'}`
    soul.origin.minted_by = variant === 'module-minter' ? aid(99) : state.creator; soul.modules = [nativeDescriptor]
    nativeDescriptor.namespace.name = `${p.native.originalPackageId}::birth::NativeModule`; nativeDescriptor.value_type.name = stateType
    nativeDescriptor.object = variant === 'module-state' ? aid(99) : state.id
    nativeDescriptor.body_hash = variant === 'module-body' ? new Uint8Array(32) : sha3_256(bytes)
    nativeDescriptor.removable = variant === 'module-removable'; nativeDescriptor.schema = variant === 'module-schema' ? 2 : 1
    if (variant === 'module-duplicate') soul.modules.push(structuredClone(nativeDescriptor))
    x.offer.root_revision = variant === 'module-revision' ? Number(soul.revision) + 1 : Number(soul.revision)
    x.offer.manifest = variant === 'module-manifest' ? new Uint8Array(32) : nativeSaleSoulManifest(CanonicalSoulBcs.serialize(soul).toBytes())
    if (variant === 'module-name') soul.name = 'Altered after listing'
    const offerType = `${p.native.originalPackageId}::market::Offer`, offerIndex = x.changes.findIndex(([id]) => id === p.plan.offerId)
    x.effect(p.plan.offerId, x.object(p.plan.offerId, offerType, NativeOfferBcs.serialize(x.offer).toBytes(), { Shared: { initialSharedVersion: 1 } }, 9),
      x.object(p.plan.offerId, offerType, NativeOfferBcs.serialize({ ...x.offer, active: false, purchase: null }).toBytes(), { Shared: { initialSharedVersion: 1 } }, 10))
    x.changes[offerIndex] = x.changes.pop()!
    const soulBytes = CanonicalSoulBcs.serialize(soul).toBytes(), soulType = `${aid(84)}::soul::Soul`
    x.effect(soul.id, x.object(soul.id, soulType, soulBytes, { ObjectOwner: aid(132) }, 9), x.object(soul.id, soulType, soulBytes, { ObjectOwner: aid(132) }, 10))
  }
  const key = `${p.foundation.originalPackageId}::economics::SourceRegistryKey<${registryType}>`, directoryId = deriveDynamicFieldID(c.id, key, new Uint8Array([0]))
  const directory = h.base.object(directoryId, 9, `0x2::dynamic_field::Field<${key},${p.foundation.originalPackageId}::economics::SourceRegistryLocation>`, NativeSaleSourceLocationBcs.serialize({ id: directoryId, name: { dummy_field: variant === 'key' }, value: { id: variant === 'directory' ? aid(99) : p.plan.registryId } }).toBytes(), { ObjectOwner: variant === 'owner' ? aid(99) : c.id }, h.register.digest)
  const policyRows: any[] = [], rule = `${p.native.originalPackageId}::market::Rule`, ruleKey = `0x2::transfer_policy::RuleKey<${rule}>`
  const ruleId = deriveDynamicFieldID(p.plan.policyId, ruleKey, new Uint8Array([0]))
  if (withModule) {
    policyRows.push(h.base.object(p.plan.policyId, 9, `0x2::transfer_policy::TransferPolicy<${aid(84)}::soul::Soul>`, NativeTransferPolicyBcs.serialize({ id: p.plan.policyId, balance: 0, rules: { contents: [{ name: rule }] } }).toBytes(), { Shared: { initialSharedVersion: 1 } }, h.register.digest))
    policyRows.push(h.base.object(ruleId, 9, `0x2::dynamic_field::Field<${ruleKey},${p.native.originalPackageId}::market::RuleConfig>`, NativeMarketRuleFieldBcs.serialize({ id: ruleId, name: { dummy_field: false }, value: { config: p.plan.configId, currency: { name: p.plan.coinType } } }).toBytes(), { ObjectOwner: p.plan.policyId }, h.register.digest))
  }
  const collectionObjects: any[] = []
  let memberFieldId: string | null = null, collectionSnapshot: Uint8Array | null = null
  if (withCollection) {
    const original = (await originalGet({ objectId: p.plan.collectionId, version: 9n })).response.object
    const value = SaleCollectionBcs.parse(original.contents.value); collectionSnapshot = saleCollectionSnapshotHash(value)
    collectionObjects.push(h.base.object(value.id, 9, original.objectType, original.contents.value, { Shared: { initialSharedVersion: 1 } }, h.register.digest))
    memberFieldId = deriveDynamicFieldID(value.members.id, '0x2::object::ID', bcs.Address.serialize(p.plan.soulId).toBytes())
    collectionObjects.push(h.base.object(memberFieldId, 9, '0x2::dynamic_field::Field<0x2::object::ID,u64>', SaleCollectionMemberBcs.serialize({ id: memberFieldId, name: p.plan.soulId, value: 1 }).toBytes(), { ObjectOwner: value.members.id }, h.register.digest))
  }
  h.ledgers.get(h.register.digest)!.effects = h.base.effects(h.register.digest, 9, [config, stateBefore, ...policyRows, ...collectionObjects, ...collectionFields, ...(variant === 'missing' ? [] : [directory])].map(r => h.base.change(r, true)))
  h.base.object(directoryId, 10, directory.objectType, NativeSaleSourceLocationBcs.serialize({ id: directoryId, name: { dummy_field: false }, value: { id: aid(99) } }).toBytes(), { ObjectOwner: c.id }, h.register.digest)
  const effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { ...f.effectsData.V2!, changedObjects: x.changes,
    unchangedConsensusObjects: [registry, ...collectionObjects.filter(r => r.objectId === p.plan.collectionId), ...policyRows.filter(r => r.objectId === p.plan.policyId)].map(r => [r.objectId, { ReadOnlyRoot: [String(r.version), r.digest] }]) } }).toBytes())
  effects.V2!.changedObjects.find(([id]) => id === c.id)![1].inputState.Exist![0][1] = config.digest
  const client: any = { ...h.transport, ledgerService: { ...h.transport.ledgerService,
    getTransaction: (r: any, options: any) => r.digest === p.packet.digest ? f.client.ledgerService.getTransaction(r, options) : h.transport.ledgerService.getTransaction(r, options),
    getCheckpoint: (r: any, options: any) => String(r.checkpointId?.sequenceNumber) === '100' ? f.client.ledgerService.getCheckpoint(r, options) : h.transport.ledgerService.getCheckpoint(r, options),
    getObject: (r: any, options: any) =>
    r.objectId === aid(85) && r.version === undefined ? Promise.resolve({ response: { object: standard.pkg } })
      : r.objectId === p.foundation.callablePackageId && r.version === undefined ? Promise.resolve({ response: { object: foundation } })
      : [p.plan.policyId, ruleId, p.plan.collectionId, memberFieldId].includes(r.objectId) && r.version !== undefined || r.objectId === directoryId || r.objectId === collectionFieldId || [c.id, state.id].includes(r.objectId) && String(r.version) === '9' ? h.transport.ledgerService.getObject(r, options) : originalGet(r, options) } }
  const result = { ...p, client, effects, checkpoint: '100', sourceBinding: true, ...(withModule ? { standard: standard.deployment } : {}) }
  async function history(verify=true) {
    const o = x.offer, q = x.quote
    const expected = { offer: o.id, root: o.root, seller: o.seller, buyer: p.plan.buyer, sellerKiosk: o.kiosk, buyerKiosk: p.plan.buyerKioskId,
      ask: q.ask, secondaryBps: 250, creatorBps: 250, collectionBps: withCollection ? 500 : 0, collection: p.plan.collectionId, collectionHolder: withCollection ? x.collectionHolder : o.seller, collectionSnapshot, generation: 0n, attempt: new Uint8Array(32).fill(1) }
    const sale = { offer: o.id, root: o.root, seller: o.seller, buyer: p.plan.buyer, seller_kiosk: o.kiosk, buyer_kiosk: p.plan.buyerKioskId, ask: String(q.ask), platform: String(q.platform), creator: String(q.creator), collection: p.plan.collectionId,
      collection_amount: String(q.collection), collection_holder: expected.collectionHolder, collection_snapshot: collectionSnapshot ? Array.from(collectionSnapshot) : null, total: String(q.total), old_generation: '0', attempt: Array.from(expected.attempt) }
    f.effectsData.V2 = effects.V2
    f.eventsData.data = [{ package_id: p.native.callablePackageId, transaction_module: 'market', sender: p.plan.buyer,
      type_: { address: p.native.originalPackageId, module: 'market', name: 'Sold', typeParams: [] }, contents: NativeSoldBcs.serialize(sale).toBytes() },
    { package_id: p.foundation.callablePackageId, transaction_module: 'economics', sender: p.plan.buyer,
      type_: { address: p.foundation.originalPackageId, module: 'economics', name: 'Paid', typeParams: [] }, contents: NativeSalePaidBcs.serialize({ subject: o.root, attempt: sale.attempt, payer: p.plan.buyer, gross: sale.total, fee: sale.platform, beneficiary: o.seller }).toBytes() }]
    f.rehashEvents()
    if(!verify)return null
    return readNativeSaleSettlementHistory({ client, packet: { ...p.packet, expirationEpoch: '6', phase: 'SIGNED', signature: 'synthetic' },
      native: p.native, foundation: p.foundation, expected, signal: p.signal, moneySettlement: { plan: p.plan, collection: p.collection, standard: result.standard, sourceBinding: true } })
  }
  return { ...result, history,writerDigest:h.register.digest }
}

export async function purchaseRecoveryAuthorFixture(variant='module-bound'){
 const x=await saleSourceFixture(variant)
 // Initialize modeled original events/checkpoint only. Every route query
 // authenticates the full history independently; no fixture proof is returned.
 await x.history(false)
 const pin=(p:any)=>({originalPackageId:p.originalPackageId,callablePackageId:p.callablePackageId,callableDigest:p.callableDigest})
 const original={schema:'soulidity.native-sale-preparation.v1',plan:x.plan,packet:{...x.packet,expirationEpoch:'6',phase:'PREPARED',signature:null},
  context:{target:{chainIdentifier:'35834a8a',standard:pin(x.standard),native:pin(x.native),registryId:x.plan.registryId,configId:x.plan.configId},economics:{chainIdentifier:'35834a8a',foundation:pin(x.foundation),configId:x.plan.configId,coinType:x.plan.coinType},collection:x.collection?pin(x.collection):null,reviewedSoulId:x.plan.soulId,reviewedTotal:x.plan.reviewedTotal},
  notSignedOrExecuted:true,requiresDurableJournalBeforeSigning:true,remaining:['WALLET_FINAL_PREFLIGHT','EXECUTED_QUALIFICATION','COMPLETE_ORIGINAL_SALE_PROOF','ACTUAL_POST_SALE_USE']}
 return {text:JSON.stringify(original),original,soulId:x.plan.soulId,client:x.client,finality:null,source:x}
}
