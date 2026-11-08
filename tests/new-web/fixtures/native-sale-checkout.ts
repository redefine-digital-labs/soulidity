import { bcs } from '@mysten/sui/bcs'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, normalizeStructTag } from '@mysten/sui/utils'
import { SoulPublicKioskBcs } from '@soulidity/sdk'
import { vi } from 'vitest'
import { canonicalNativeWorkbenchFixture } from './canonical-native-workbench'
import { activityEvidenceFixture, activityHash, aid } from './activity-transaction-evidence'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../../web/lib/sui/move-empty-struct'
import { CanonicalOwnedAccountBcs, CanonicalSoulBcs } from '../../../web/lib/soulidity/canonical-native-workbench'
import { NativeInitialAuthorizationBcs, NativeInitialConfigurationBcs } from '../../../web/lib/soulidity/native-initial-children'
import { EconomicsConfigBcs, economicsConfigSnapshot, economicsOperationalSnapshotHash, NativeOfferBcs } from '../../../web/lib/soulidity/commerce/economics-bcs'
import { NativeMarketGatesFieldBcs, NativeMarketRuleFieldBcs, NativeTransferPolicyBcs } from '../../../web/lib/soulidity/commerce/native-sale-conditions'
import { NativeSaleRegistryBcs, NativeSaleSourceLocationBcs } from '../../../web/lib/soulidity/commerce/native-sale-source-binding'
import { nativeSaleSoulManifest } from '../../../web/lib/soulidity/commerce/native-sale-tree'

export async function nativeSaleCheckoutFixture(buyer: string) {
  const seller = aid(1200), f = await canonicalNativeWorkbenchFixture(true, 2, true, true, seller)
  const { root, object, rows, nativeId, standardId } = f, target = f.input.target
  const { native, standard, content, custody } = target
  const state = f.state, offerId = aid(1201), policyId = aid(1202), buyerKiosk = aid(1203), buyerAccountId = aid(1204)
  const payment = aid(1206), gas = aid(1207), coinType = normalizeStructTag('0x2::sui::SUI')
  const foundationEvidence = await activityEvidenceFixture()
  const foundation = { originalPackageId: aid(140), callablePackageId: aid(141), callableDigest: '' }
  Object.assign(foundationEvidence.deployment, foundation)
  const feePackage = foundationEvidence.packageData.data.Package!
  feePackage.id = foundation.callablePackageId
  feePackage.moduleMap = new Map([['economics', new Uint8Array([1])]])
  feePackage.typeOriginTable = ['Config', 'MarketGatesKey', 'MarketGates', 'SourceRegistryKey', 'SourceRegistryLocation']
    .map(datatypeName => ({ moduleName: 'economics', datatypeName, package: foundation.originalPackageId }))
  foundationEvidence.rehashPackage()
  foundation.callableDigest = foundationEvidence.pkg.digest
  rows.set(foundation.callablePackageId, foundationEvidence.pkg)
  function extend(pin: typeof native, moduleName: string, names: string[], dependencies = false) {
    const row = rows.get(pin.callablePackageId), raw = bcs.Object.parse(row.bcs.value), pkg = raw.data.Package!
    pkg.moduleMap.set(moduleName, new Uint8Array([1]))
    pkg.typeOriginTable.push(...names.map(datatypeName => ({ moduleName, datatypeName,
      package: datatypeName === 'MarketRevision1' ? pin.callablePackageId : pin.originalPackageId })))
    if (dependencies) pkg.linkageTable.set(foundation.originalPackageId, { upgradedId: foundation.callablePackageId, upgradedVersion: String(foundationEvidence.pkg.version) })
    const bytes = bcs.Object.serialize(raw).toBytes()
    Object.assign(row, { bcs: { value: bytes }, digest: activityHash('Object', bytes) }); pin.callableDigest = row.digest
  }
  extend(standard, 'soul', ['NestedSoulWitness', 'NestingVersionKey', 'ModuleAnnotationKey', 'ModuleVersionKey', 'ModuleVersion'])
  extend(native, 'birth', ['CollectionKey'])
  extend(native, 'market', ['Offer', 'MarketAuthority1', 'MarketRevision1', 'Rule', 'RuleConfig'], true)
  const economics = { chainIdentifier: '35834a8a', configId: target.configId, foundation, coinType }
  const release = { target, economics, collection: null }
  const shared = { Shared: { initialSharedVersion: '1' } }, dummy = { dummy_field: false }
  const A = bcs.Address, U = bcs.u64(), V = bcs.byteVector()
  const buyerOwner = { AddressOwner: buyer }
  object(buyerKiosk, '0x2::kiosk::Kiosk', SoulPublicKioskBcs.serialize({ id: buyerKiosk, profits: '0',
    owner: buyer, item_count: 0, allow_extensions: false }).toBytes(), shared)
  object(buyerAccountId, custody!.originalPackageId + '::account::Account', CanonicalOwnedAccountBcs.serialize({ id: buyerAccountId,
    kiosk: buyerKiosk, owner: buyer, authority: { cap: { id: aid(1205), for: buyerKiosk }, kiosk: buyerKiosk, owner: buyer, closed_digest: new Uint8Array() } }).toBytes(), buyerOwner)
  const coin = bcs.struct('Coin', { id: A, balance: U })
  for (const id of [payment, gas]) object(id, '0x2::coin::Coin<' + coinType + '>', coin.serialize({ id, balance: 10000 }).toBytes(), buyerOwner)
  object(aid(6), '0x2::clock::Clock', bcs.struct('Clock', { id: A, timestamp_ms: U }).serialize({ id: aid(6), timestamp_ms: 100 }).toBytes(), shared)

  const controller = { operator: { name: nativeId + '::birth::ContentOperator' }, parent: state.id, root: root.id }
  function child(key: string, id: string, type: string, bytes: Uint8Array) {
    const wrapper = '0x2::dynamic_object_field::Wrapper<' + nativeId + '::birth::' + key + '>'
    const fieldId = deriveDynamicFieldID(state.id, wrapper, moveEmptyStructBytes())
    const field = bcs.struct('Field', { id: A, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: A })
    object(fieldId, '0x2::dynamic_field::Field<' + wrapper + ',0x2::object::ID>',
      field.serialize({ id: fieldId, name: { name: dummy }, value: id }).toBytes(), state.id)
    object(id, content!.originalPackageId + '::' + type, bytes, fieldId)
  }
  child('AuthorizationKey', aid(1210), 'authorization::Authorization', NativeInitialAuthorizationBcs.serialize({ id: aid(1210), controller,
    root: root.id, generation: 2, capacity: 10, count: 0, next_sequence: 0, grants: { id: aid(1211), size: 0 } }).toBytes())
  child('ConfigurationKey', aid(1212), 'state_configuration::Configuration', NativeInitialConfigurationBcs.serialize({ id: aid(1212), controller,
    root: root.id, revision: 1, values: { id: aid(1213), size: 0 }, entries: [] }).toBytes())

  function field(parent: string, key: string, valueType: string, valueCodec: any, value: unknown) {
    const id = deriveDynamicFieldID(parent, key, moveEmptyStructBytes())
    const codec = bcs.struct('Field', { id: A, name: MoveEmptyStructBcs, value: valueCodec })
    object(id, '0x2::dynamic_field::Field<' + key + ',' + valueType + '>', codec.serialize({ id, name: dummy, value }).toBytes(), parent)
    return id
  }
  field(root.id, standardId + '::soul::NestingVersionKey', 'u64', U, 0)
  const keyCodec = bcs.struct('Key', { namespace: bcs.struct('TypeName', { name: bcs.string() }), name: V })
  const keyValue = { namespace: root.modules[0].namespace, name: root.modules[0].name }
  function moduleField(name: string, valueType: string, codec: any, value: unknown) {
    const key = standardId + '::soul::' + name, id = deriveDynamicFieldID(root.id, key, keyCodec.serialize(keyValue).toBytes())
    const field = bcs.struct('Field', { id: A, name: keyCodec, value: codec })
    object(id, '0x2::dynamic_field::Field<' + key + ',' + valueType + '>', field.serialize({ id, name: keyValue, value }).toBytes(), root.id)
  }
  moduleField('ModuleAnnotationKey', 'vector<u8>', V, new Uint8Array([...new TextEncoder().encode('soulidity.lifecycle/handover:v1'), 1]))
  moduleField('ModuleVersionKey', standardId + '::soul::ModuleVersion', bcs.struct('ModuleVersion', { installed: U, updated: U }), { installed: 1, updated: 1 })

  const eo = foundation.originalPackageId + '::economics::', registryType = nativeId + '::registry::Registry'
  object(target.registryId, registryType, NativeSaleRegistryBcs.serialize({ id: target.registryId, protocol: target.configId,
    schema: 1, kiosks: { id: aid(1214), size: 2 } }).toBytes(), shared)
  const sourceKey = eo + 'SourceRegistryKey<' + registryType + '>', sourceId = deriveDynamicFieldID(target.configId, sourceKey, moveEmptyStructBytes())
  object(sourceId, '0x2::dynamic_field::Field<' + sourceKey + ',' + eo + 'SourceRegistryLocation>',
    NativeSaleSourceLocationBcs.serialize({ id: sourceId, name: dummy, value: { id: target.registryId } }).toBytes(), target.configId)
  const marketRole = { original: nativeId, callable: native.callablePackageId, marker: { name: native.callablePackageId + '::market::MarketRevision1' },
    version: String(rows.get(native.callablePackageId).version), pinned: true, frozen: false }
  const cfg = EconomicsConfigBcs.parse(EconomicsConfigBcs.serialize({ id: target.configId, revision: 8, primary_bps: 250, secondary_bps: 250,
    complete_fee: 0, recipient: aid(1215), paused: false, income: { root: target.configId, revision: 0, funds: 0, collected: 0, withdrawn: 0,
      requests: { id: aid(1216), size: 0 } }, schema: 3, enabled: true, payment_coin: { name: coinType }, original_package: foundation.originalPackageId,
    callable_package: foundation.callablePackageId, commitment: new Uint8Array(32), native_binding: null, release_binding: null, minimum_release: 2,
    roles: { roles: Array.from({ length: 6 }, () => marketRole) } }).toBytes())
  const gates = { primary: true, secondary: true }
  cfg.commitment = economicsOperationalSnapshotHash({ domain: new TextEncoder().encode('soulidity-protocol-operational-v4'),
    config: economicsConfigSnapshot(cfg), gates })
  object(cfg.id, eo + 'Config<' + coinType + '>', EconomicsConfigBcs.serialize(cfg).toBytes(), shared)
  const gateKey = eo + 'MarketGatesKey', gateId = deriveDynamicFieldID(cfg.id, gateKey, moveEmptyStructBytes())
  object(gateId, '0x2::dynamic_field::Field<' + gateKey + ',' + eo + 'MarketGates>',
    NativeMarketGatesFieldBcs.serialize({ id: gateId, name: dummy, value: gates }).toBytes(), cfg.id)
  const rule = nativeId + '::market::Rule', ruleKey = '0x2::transfer_policy::RuleKey<' + rule + '>'
  object(policyId, '0x2::transfer_policy::TransferPolicy<' + standardId + '::soul::Soul>',
    NativeTransferPolicyBcs.serialize({ id: policyId, balance: 0, rules: { contents: [{ name: rule }] } }).toBytes(), shared)
  const ruleId = deriveDynamicFieldID(policyId, ruleKey, moveEmptyStructBytes())
  object(ruleId, '0x2::dynamic_field::Field<' + ruleKey + ',' + nativeId + '::market::RuleConfig>',
    NativeMarketRuleFieldBcs.serialize({ id: ruleId, name: dummy, value: { config: cfg.id, currency: { name: coinType } } }).toBytes(), policyId)
  const terms = { id: offerId, root: root.id, state: state.id, registry: target.registryId, config: cfg.id, config_revision: cfg.revision,
    policy: policyId, seller, kiosk: f.kiosk!.id, creator: state.creator, royalty: state.creator_royalty_bps,
    generation: 2, root_revision: root.revision, manifest: nativeSaleSoulManifest(CanonicalSoulBcs.serialize(root).toBytes()),
    collection: null, ask: 101, active: true, purchase: { id: aid(1217), kiosk_id: f.kiosk!.id, item_id: root.id, min_price: 0 } }
  const updateOffer = () => object(offerId, nativeId + '::market::Offer', NativeOfferBcs.serialize(terms).toBytes(), shared)
  updateOffer()
  const client = f.client as any
  client.ledgerService.getObject.mockImplementation(async ({ objectId }: { objectId: string }) => {
    if (!rows.has(objectId)) throw { code: 'NOT_FOUND' }
    return { response: { object: rows.get(objectId) } }
  })
  client.ledgerService.getServiceInfo = vi.fn(async () => ({ response: { chainId: MAINNET_GENESIS_DIGEST } }))
  client.ledgerService.getEpoch = vi.fn(async () => ({ response: { epoch: { epoch: 5n, referenceGasPrice: 1n } } }))
  client.ledgerService.getCheckpoint = vi.fn()
  client.ledgerService.getTransaction = vi.fn(async () => { throw { code: 'NOT_FOUND' } })
  client.core.executeTransaction = vi.fn(async () => {})
  client.transactionExecutionService = { simulateTransaction: vi.fn(async ({ transaction }) => {
    const value = transaction.bcs.value, digest = TransactionDataBuilder.getDigestFromBytes(value)
    const gasUsed = { computationCost: 1, storageCost: 1, storageRebate: 0, nonRefundableStorageFee: 0 }
    const raw = bcs.TransactionEffects.serialize({ V2: { status: { Success: true }, executedEpoch: 5,
      gasUsed, transactionDigest: digest, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: 11,
      changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null } }).toBytes()
    return { response: { transaction: { digest, transaction: { bcs: { value } }, signatures: [],
      effects: { bcs: { value: raw }, transactionDigest: digest, status: { success: true } } } } }
  }) }
  return { client, release, soulId: root.id, offerId, buyer, buyerAccountId, payment, gas, terms, updateOffer }
}
