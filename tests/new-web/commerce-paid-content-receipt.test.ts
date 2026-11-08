import { bcs } from '@mysten/sui/bcs'
import { SoulPublicKioskBcs, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE, deriveKioskItemFieldId } from '@soulidity/sdk'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { CanonicalSoulBcs, CanonicalNativeStateBcs, CanonicalOwnedAccountBcs } from '../../web/lib/soulidity/canonical-native-workbench'
import { proveNativePaidContentTreeHistory, NativePaidPointerFieldBcs, NativePaidVersionKeyBcs, NativePaidVersionFieldBcs, NativePaidKioskLockBcs } from '../../web/lib/soulidity/commerce/native-paid-content-tree-history'
import { sha256 } from '@noble/hashes/sha2.js'
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils'
import { proveNativePaidServiceOpeningHistory } from '../../web/lib/soulidity/commerce/native-paid-service-opening-history'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { expect, it, vi } from 'vitest'
import { batchHistoryFixture } from './fixtures/walrus-batch-history'
import { activityEvidenceFixture, aid, adigest } from './fixtures/activity-transaction-evidence'
import { NativeInitialPaidBcs } from '../../web/lib/soulidity/native-initial-children'
import { EconomicsConfigBcs, economicsConfigSnapshot, economicsOperationalSnapshotHash } from '../../web/lib/soulidity/commerce/economics-bcs'
import { PaidContentOfferBcs, PaidContentEntryBcs, PaidContentBuyerKeyBcs, quoteNativePaidContent } from '../../web/lib/soulidity/commerce/paid-content-policy'
import { buildNativePaidContentPurchase, type NativePaidContentPurchase } from '../../web/lib/soulidity/commerce/native-paid-content-transaction'
import { proveNativePaidContentReceipt, NativePaidAttemptKeyBcs, NativePaidAttemptFieldBcs, NativePaidEntryFieldBcs } from '../../web/lib/soulidity/commerce/native-paid-content-receipt'
import { proveNativePaidContentOfferHistory, NativePaidOfferFieldBcs } from '../../web/lib/soulidity/commerce/native-paid-content-offer-history'
import { proveNativePaidContentServiceHistory } from '../../web/lib/soulidity/commerce/native-paid-content-service-history'
import { NativePaidServiceBcs, NativePaidServiceBindingBcs } from '../../web/lib/soulidity/commerce/native-paid-service-read'
import { proveNativePaidContentMoney } from '../../web/lib/soulidity/commerce/native-paid-content-money'
import { readNativePaidContentHistory, NativePaidUpdatedBcs, NativeSubscriptionPaidBcs } from '../../web/lib/soulidity/commerce/native-paid-content-history'
import {readNativePaidServiceBeneficiaryFunds} from '../../web/lib/soulidity/commerce/native-paid-service-beneficiary-funds'
import { verifyNativePaidServiceRecovery } from '../../web/lib/soulidity/commerce/native-paid-service-recovery'
// Controlled original effects, not executed payment/finality or independent ABI golden.
async function fixture(variant = '') {
  const h = await batchHistoryFixture(0), n = await activityEvidenceFixture(), c = await activityEvidenceFixture(), f = await activityEvidenceFixture(), std = await activityEvidenceFixture(), cust = await activityEvidenceFixture()
  function pin(x: typeof n, original: number, callable: number, definitions: string[]) {
    x.deployment.originalPackageId = aid(original); x.deployment.callablePackageId = aid(callable)
    const p = x.packageData.data.Package!; p.id = aid(callable); p.moduleMap = new Map(definitions.map(d => [d.split('::')[0], new Uint8Array([1])]))
    p.typeOriginTable = definitions.map(d => ({ moduleName: d.split('::')[0], datatypeName: d.split('::')[1], package: aid(original) })); x.rehashPackage()
  }
  pin(n, 40, 41, ['birth::PaidKey', 'birth::ContentOperator', 'birth::NativeModule', 'birth::State', 'registry::Registry', 'registry::SoulProducer']); pin(c, 42, 43, ['paid_access::Ledger', 'paid_access::Offer', 'paid_access::BuyerKey', 'paid_access::Entry', 'paid_access::AttemptKey', 'paid_access::Receipt', 'paid_access::Updated', 'paid_access::PaidAuthority1', 'paid_access::PaidRevision1']); pin(f, 44, 45, ['economics::Config', 'economics::Paid'])
  n.packageData.data.Package!.linkageTable.set(aid(42), { upgradedId: aid(43), upgradedVersion: '2' }); n.rehashPackage()
  c.packageData.data.Package!.linkageTable.set(aid(44), { upgradedId: aid(45), upgradedVersion: '2' }); c.rehashPackage()
  pin(std, 50, 51, ['soul::SourceService', 'soul::Soul', 'soul::ModuleKey', 'soul::ModuleVersionKey', 'soul::ModuleVersion']); pin(cust, 52, 53, ['account::AccountServiceWitness', 'account::Account'])
  for (const pkg of [std, cust]) n.packageData.data.Package!.linkageTable.set(pkg.deployment.originalPackageId, { upgradedId: pkg.deployment.callablePackageId, upgradedVersion: '2' })
  n.rehashPackage()
  const owner = aid(70), buyer = aid(71), soulId = aid(72), stateId = aid(73), ledgerId = aid(74), cfgId = aid(75)
  const revisionOrigin = variant === 'policy-upgrade' ? aid(42) : aid(43)
  c.packageData.data.Package!.typeOriginTable.find(x => x.datatypeName === 'PaidRevision1')!.package = revisionOrigin; c.rehashPackage()
  const cfg = { id: cfgId, revision: '8', primary_bps: 250, secondary_bps: 250, complete_fee: '0', recipient: aid(76), paused: false,
    income: { root: cfgId, revision: '0', funds: '0', collected: '0', withdrawn: '0', requests: { id: aid(77), size: '0' } }, schema: 3, enabled: true,
    payment_coin: { name: '0x2::sui::SUI' }, original_package: aid(44), callable_package: aid(45), commitment: new Uint8Array(32), native_binding: null, release_binding: null,
    minimum_release: '2', roles: { roles: Array.from({ length: 6 }, () => ({ original: aid(42), callable: revisionOrigin, marker: { name: `${revisionOrigin}::paid_access::PaidRevision1` }, version: '2', pinned: true, frozen: false })) } }
  if (variant === 'money-zero-fee') cfg.primary_bps = 0
  if (variant === 'policy-disabled') cfg.enabled = false
  if (variant === 'policy-paused') cfg.paused = true
  if (variant === 'policy-release') cfg.minimum_release = '3'
  if (variant === 'policy-unpinned') cfg.roles.roles[5].pinned = false
  if (variant === 'policy-original') cfg.roles.roles[5].original = aid(99)
  if (variant === 'policy-callable') cfg.roles.roles[5].callable = aid(99)
  if (variant === 'policy-marker') cfg.roles.roles[5].marker.name = `${revisionOrigin}::paid_access::PaidRevision2`
  if (variant === 'policy-frozen') cfg.roles.roles[5].frozen = true
  cfg.commitment = economicsOperationalSnapshotHash({ domain: new TextEncoder().encode('soulidity-protocol-operational-v4'), config: economicsConfigSnapshot(cfg), gates: { primary: variant !== 'policy-primary', secondary: true } })
  if (variant === 'policy-corrupt') cfg.commitment[0] ^= 1
  const offer = PaidContentOfferBcs.parse(PaidContentOfferBcs.serialize({ issuer: owner, generation: 2, price: 101, scope: 1, duration: 100, revision: 3 }).toBytes())
  const quote = quoteNativePaidContent({ root: soulId, protocol: cfgId, kind: 1, offer, feeRevision: '8', primaryBps: cfg.primary_bps, platformRecipient: cfg.recipient })
  const shared = (id: number) => ({ objectId: aid(id), initialSharedVersion: '1' })
  const renewing = variant.startsWith('renew')
  const previousEntry = renewing ? { issuer: variant === 'renew-stale' ? aid(99) : owner, generation: variant === 'renew-stale' ? '1' : '2', scope: '1', expiry: variant === 'renew-permanent' || variant === 'renew-stale' ? null : '1500', revision: '3' } : null
  const priorHash = previousEntry ? sha256(PaidContentEntryBcs.serialize(previousEntry).toBytes()) : null
  const intent: NativePaidContentPurchase = { buyer, nativeCallablePackageId: aid(41), coinType: '0x2::sui::SUI', registry: shared(78), config: shared(75), service: shared(79), kiosk: shared(80), kind: 1,
    quote: { hash: quote.hash, total: quote.total }, entryHash: variant === 'renew-hash' ? new Uint8Array(32) : priorHash, feeRevision: '8', quoteExpiryMs: '2000', attempt: new Uint8Array(32).fill(1), rootRevision: '9', paymentCoin: { objectId: aid(81), version: '9', digest: adigest(81), balance: '1000' } }
  const money = variant.startsWith('money'), Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
  const funding = money ? h.base.object(aid(81), 9, '0x2::coin::Coin<0x2::sui::SUI>', Coin.serialize({ id: aid(81), balance: 1000 }).toBytes(), { AddressOwner: buyer }, adigest(1)) : null
  const gasInput = money ? h.base.object(aid(82), 9, '0x2::coin::Coin<0x2::sui::SUI>', Coin.serialize({ id: aid(82), balance: 2000 }).toBytes(), { AddressOwner: buyer }, adigest(1)) : null
  if (funding) intent.paymentCoin.digest = funding.digest
  const fullReadback = variant === 'money-service-offer-tree-opening'
  const withOpening = variant.startsWith('opening') || fullReadback
  const multiOpening = variant === 'opening-multihop'
  if (withOpening) intent.service.initialSharedVersion = multiOpening ? '8' : '9'
  const tx = buildNativePaidContentPurchase(intent); tx.setGasOwner(buyer); tx.setGasPrice(1); tx.setGasBudget(1000); tx.setGasPayment([{ objectId: aid(82), version: 9, digest: gasInput?.digest ?? adigest(82) }]); tx.setExpiration({ Epoch: 6 })
  const bytes = await tx.build(), digest = TransactionDataBuilder.getDigestFromBytes(bytes), changes: any[] = []
  const withOfferHistory = fullReadback || variant.startsWith('offer') || variant === 'money-service-offer' || variant === 'money-service-offer-tree'
  const withTree = fullReadback || variant.startsWith('tree') || variant === 'money-service-offer-tree'
  let openingDigest = adigest(1)
  const write = (id: string, type: string, codec: any, a: any | null, z: any, owner: any) => {
    const before = a === null ? null : h.base.object(id, 9, type, codec.serialize(a).toBytes(), owner, withOpening && id === aid(79) ? openingDigest : (withOfferHistory && id === ledgerId || withTree && (id === stateId || id === aid(80))) ? h.register.digest : adigest(1))
    const after = h.base.object(id, 10, type, codec.serialize(z).toBytes(), owner, digest); changes.push(h.base.change(after, !before, before)); return before
  }
  const paidField = deriveDynamicFieldID(stateId, `0x2::dynamic_object_field::Wrapper<${aid(40)}::birth::PaidKey>`, new Uint8Array([0]))
  const ledger = { id: ledgerId, controller: { operator: { name: `${aid(40)}::birth::ContentOperator` }, parent: stateId, root: soulId }, root: soulId, protocol: cfgId, revision: '3', offers: { id: variant === 'offer-table-alias' ? ledgerId : aid(83), size: '1' }, entries: { id: aid(84), size: renewing ? '1' : '0' }, attempts: { id: aid(85), size: '0' } }
  write(ledgerId, `${aid(42)}::paid_access::Ledger`, NativeInitialPaidBcs, ledger, { ...ledger, revision: '4', entries: { ...ledger.entries, size: '1' }, attempts: { ...ledger.attempts, size: variant === 'ledger' ? '2' : '1' } }, { ObjectOwner: paidField })
  if (withOfferHistory) {
    const originalLedger = h.base.rows.get(`${ledgerId}:9`)!
    const fieldId = deriveDynamicFieldID(ledger.offers.id, 'u32', bcs.u32().serialize(1).toBytes())
    const value = { ...offer, scope: variant === 'offer-value' ? '2' : offer.scope }
    const field = h.base.object(fieldId, 9, `0x2::dynamic_field::Field<u32,${aid(42)}::paid_access::Offer>`, NativePaidOfferFieldBcs.serialize({ id: fieldId, name: variant === 'offer-key' ? 2 : 1, value }).toBytes(), { ObjectOwner: variant === 'offer-owner' ? ledgerId : ledger.offers.id }, h.register.digest)
    h.ledgers.get(h.register.digest)!.effects = h.base.effects(h.register.digest, 9, [originalLedger, ...(variant === 'offer-missing' ? [] : [field])].map(row => h.base.change(row, true)))
    h.ledgers.get(h.register.digest)!.effects.V2!.executedEpoch = '4'
    if (variant === 'offer-future') h.ledgers.get(h.register.digest)!.checkpoint = 101n
    // Newer field is deliberately contradictory and must never be consulted.
    h.base.object(fieldId, 10, `0x2::dynamic_field::Field<u32,${aid(42)}::paid_access::Offer>`, NativePaidOfferFieldBcs.serialize({ id: fieldId, name: 2, value: { ...offer, price: '999' } }).toBytes(), { ObjectOwner: aid(99) }, adigest(99))
  }
  const afterConfig = structuredClone(cfg)
  if (money) { afterConfig.income.funds = variant === 'money-income' ? '2' : quote.platformFee; afterConfig.income.collected = quote.platformFee; afterConfig.income.revision = BigInt(quote.platformFee) > 0n ? '1' : '0' }
  write(cfgId, `${aid(44)}::economics::Config<0x2::sui::SUI>`, EconomicsConfigBcs, cfg, afterConfig, { Shared: { initialSharedVersion: 1 } })
  const key = { kind: 1, buyer }, entryId = deriveDynamicFieldID(ledger.entries.id, `${aid(42)}::paid_access::BuyerKey`, PaidContentBuyerKeyBcs.serialize(key).toBytes())
  const entry = { issuer: owner, generation: '2', scope: variant === 'scope' ? '2' : '1', expiry: variant === 'expiry' ? '1101' : renewing && variant !== 'renew-stale' && variant !== 'renew-permanent' ? '1600' : '1100', revision: '4' }
  write(entryId, `0x2::dynamic_field::Field<${aid(42)}::paid_access::BuyerKey,${aid(42)}::paid_access::Entry>`, NativePaidEntryFieldBcs, previousEntry ? { id: entryId, name: key, value: previousEntry } : null, { id: entryId, name: key, value: entry }, { ObjectOwner: ledger.entries.id })
  const attempt = { buyer, attempt: intent.attempt }, attemptId = deriveDynamicFieldID(ledger.attempts.id, `${aid(42)}::paid_access::AttemptKey`, NativePaidAttemptKeyBcs.serialize(attempt).toBytes())
  const receipt = { kind: 1, quote: intent.quote.hash, entry_hash: sha256(PaidContentEntryBcs.serialize(entry).toBytes()), price: '101', total: quote.total, platform_fee: quote.platformFee, fee_revision: '8', platform_recipient: cfg.recipient, beneficiary: variant === 'beneficiary' ? aid(99) : owner }
  if (variant === 'entry-hash') receipt.entry_hash = new Uint8Array(32)
  write(attemptId, `0x2::dynamic_field::Field<${aid(42)}::paid_access::AttemptKey,${aid(42)}::paid_access::Receipt>`, NativePaidAttemptFieldBcs, null, { id: attemptId, name: attempt, value: receipt }, { ObjectOwner: ledger.attempts.id })
  const clock = h.base.object(aid(6), 9, '0x2::clock::Clock', bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() }).serialize({ id: aid(6), timestamp_ms: 1000 }).toBytes(), { Shared: { initialSharedVersion: 1 } }, adigest(1))
  if (withTree) {
    const moduleField = deriveDynamicFieldID(soulId, `0x2::dynamic_object_field::Wrapper<${aid(50)}::soul::ModuleKey<${aid(40)}::birth::NativeModule>>`, bcs.byteVector().serialize(new TextEncoder().encode('native')).toBytes())
    const state = { id: stateId, root: soulId, protocol: cfgId, registry: aid(78), schema: 1, creator: variant === 'tree-creator' ? aid(99) : owner, description: '', image: '', creator_royalty_bps: 250, created_at: '0', provenance: { kind: 0, origin: null, joined: null }, mint_nonce: new Uint8Array([1]), content: aid(90), issuer: { original: aid(40), callable: aid(41), marker: { name: `${aid(41)}::birth::SourceRevision2` }, version: '2' } }
    const stateBytes = CanonicalNativeStateBcs.serialize(state).toBytes()
    write(stateId, `${aid(40)}::birth::State`, CanonicalNativeStateBcs, state, variant === 'tree-state-change' ? { ...state, description: 'changed' } : state, { ObjectOwner: variant === 'tree-state-owner' ? aid(99) : moduleField })
    const origin = { producer: { name: `${aid(40)}::registry::SoulProducer` }, source_type: { name: `${aid(40)}::registry::Registry` }, source: aid(78), source_version: '2', source_hash: new Uint8Array(32), minted_by: owner }
    const descriptor = { namespace: { name: `${aid(40)}::birth::NativeModule` }, name: new TextEncoder().encode('native'), value_type: { name: `${aid(40)}::birth::State` }, object: stateId, schema: 1, removable: false, body_hash: variant === 'tree-body' ? new Uint8Array(32) : sha3_256(stateBytes), semantic_hash: new Uint8Array(32) }
    const root = { id: soulId, schema: 1, name: 'Original Soul', revision: '9', origin, modules: [descriptor], editing: false }
    const after = { ...root, revision: variant === 'tree-revision' ? '11' : '10', modules: [{ ...descriptor, semantic_hash: new Uint8Array(32).fill(1) }] }
    write(soulId, `${aid(50)}::soul::Soul`, CanonicalSoulBcs, root, after, { ObjectOwner: variant === 'tree-custody' ? aid(99) : deriveKioskItemFieldId(aid(80), soulId) })
    const versionKey = { namespace: { name: `${aid(40)}::birth::NativeModule` }, name: new TextEncoder().encode('native') }, versionId = deriveDynamicFieldID(soulId, `${aid(50)}::soul::ModuleVersionKey`, NativePaidVersionKeyBcs.serialize(versionKey).toBytes())
    const version = { id: versionId, name: versionKey, value: { installed: variant === 'tree-version-zero' ? '0' : '1', updated: variant === 'tree-version-future' ? '11' : '7' } }
    const versionAfter = { ...version, value: { installed: variant === 'tree-version-installed' ? '2' : variant === 'tree-version-created' ? '0' : version.value.installed, updated: variant === 'tree-version-stale' ? '9' : '10' } }
    if (variant === 'tree-version-key') versionAfter.name = { ...versionKey, name: new TextEncoder().encode('other') }
    if (variant !== 'tree-version-missing') write(versionId, `0x2::dynamic_field::Field<${aid(50)}::soul::ModuleVersionKey,${aid(50)}::soul::ModuleVersion>`, NativePaidVersionFieldBcs, variant === 'tree-version-created' ? null : version, versionAfter, { ObjectOwner: variant === 'tree-version-owner' ? aid(99) : soulId })
    const wrapper = `0x2::dynamic_object_field::Wrapper<${aid(40)}::birth::PaidKey>`, fieldId = deriveDynamicFieldID(stateId, wrapper, new Uint8Array([0]))
    const pointer = h.base.object(fieldId, 9, `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`, NativePaidPointerFieldBcs.serialize({ id: fieldId, name: { name: { dummy_field: false } }, value: variant === 'tree-ledger-pointer' ? aid(99) : ledgerId }).toBytes(), { ObjectOwner: variant === 'tree-pointer-owner' ? aid(99) : stateId }, h.register.digest)
    const row = h.ledgers.get(h.register.digest)!
    row.effects = h.base.effects(h.register.digest, 9, [...(withOfferHistory ? row.effects.V2!.changedObjects : []), h.base.change(h.base.rows.get(`${stateId}:9`)!, true), ...(variant === 'tree-pointer-missing' ? [] : [h.base.change(pointer, true)])])
    row.effects.V2!.executedEpoch = '4'
  }
  if (withOpening || withTree || variant.startsWith('service') || variant === 'money-service' || variant === 'money-service-offer') {
    const kiosk = { id: aid(80), profits: '13', owner: variant === 'service-kiosk-owner' ? aid(99) : owner, item_count: variant === 'service-kiosk-empty' ? 0 : 1, allow_extensions: variant === 'service-kiosk-extensions' }
    const kioskOutput = { ...kiosk, profits: variant === 'service-kiosk-profits' ? '14' : kiosk.profits, item_count: variant === 'service-kiosk-count' ? 2 : kiosk.item_count }
    write(aid(80), '0x2::kiosk::Kiosk', SoulPublicKioskBcs, kiosk, kioskOutput, { Shared: { initialSharedVersion: variant === 'service-kiosk-birth' ? 2 : 1 } })
    if (withTree) {
      const itemId = deriveKioskItemFieldId(aid(80), soulId), lockId = deriveDynamicFieldID(aid(80), '0x2::kiosk::Lock', bcs.Address.serialize(soulId).toBytes())
      const item = h.base.object(itemId, 9, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs.serialize({ id: itemId, name: { name: { id: variant === 'tree-item-key' ? aid(99) : soulId } }, value: variant === 'tree-item-value' ? aid(99) : soulId }).toBytes(), { ObjectOwner: variant === 'tree-item-owner' ? aid(99) : aid(80) }, h.register.digest)
      const lock = h.base.object(lockId, 9, '0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>', NativePaidKioskLockBcs.serialize({ id: lockId, name: { id: variant === 'tree-lock-key' ? aid(99) : soulId }, value: variant !== 'tree-lock-false' }).toBytes(), { ObjectOwner: variant === 'tree-lock-owner' ? aid(99) : aid(80) }, h.register.digest)
      const row = h.ledgers.get(h.register.digest)!
      row.effects = h.base.effects(h.register.digest, 9, [...row.effects.V2!.changedObjects, h.base.change(h.base.rows.get(`${aid(80)}:9`)!, true), h.base.change(item, true), ...(variant === 'tree-lock-missing' ? [] : [h.base.change(lock, true)])])
      row.effects.V2!.executedEpoch = '4'
      h.base.object(itemId, 10, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs.serialize({ id: itemId, name: { name: { id: aid(99) } }, value: aid(99) }).toBytes(), { ObjectOwner: aid(99) }, adigest(99))
    }
    const service = { id: aid(79), authority: { cap: { id: aid(88), for: aid(80) }, kiosk: aid(80), owner: variant === 'service-owner' ? aid(99) : owner, closed_digest: new Uint8Array(32) }, account: aid(89), return_witness: { name: `${aid(52)}::account::AccountServiceWitness` }, root: soulId, value: stateId, name: new TextEncoder().encode('native'), schema: 1, origin: { producer: { name: `${aid(40)}::registry::SoulProducer` }, source_type: { name: `${aid(40)}::registry::Registry` }, source: aid(78), source_version: '2', source_hash: new Uint8Array(32).fill(variant === 'tree-service-origin' ? 1 : 0), minted_by: owner }, revision: '9', expires: variant === 'service-expired' ? '1000' : '2000', binding: NativePaidServiceBindingBcs.serialize({ state: stateId, ledger: variant === 'service-ledger' ? aid(99) : ledgerId, protocol: cfgId, registry: aid(78), generation: variant === 'service-generation' ? '1' : '2' }).toBytes(), busy: variant === 'service-busy' }
    let openingPacket: { bytes: string; digest: string; expirationEpoch: string } | null = null, accountBefore: any = null, accountAfter: any = null
    if (withOpening) {
      const account = { id: aid(89), kiosk: aid(80), owner, authority: { ...service.authority, cap: { ...service.authority.cap, id: variant === 'opening-cap' ? aid(99) : service.authority.cap.id } } }
      const accountType = `${aid(52)}::account::Account`
      accountBefore = h.base.object(account.id, multiOpening ? 7 : 8, accountType, CanonicalOwnedAccountBcs.serialize(account).toBytes(), { AddressOwner: variant === 'opening-account-owner' ? aid(99) : owner }, adigest(1))
      const open = new Transaction(); open.setSender(variant === 'opening-sender' ? aid(99) : owner); open.setGasOwner(owner); open.setGasPrice(1); open.setGasBudget(1000); open.setGasPayment([{ objectId: aid(93), version: 8, digest: adigest(93) }]); open.setExpiration({ Epoch: 6 })
      const shared = (id: number, mutable: boolean) => open.sharedObjectRef({ objectId: aid(id), initialSharedVersion: 1, mutable })
      open.moveCall({ target: `${aid(41)}::birth::open_paid_service`, typeArguments: ['0x2::sui::SUI'], arguments: [shared(78, false), shared(75, false), shared(80, true), open.objectRef({ objectId: account.id, version: multiOpening ? 7 : 8, digest: accountBefore.digest }), open.pure.id(variant === 'opening-call-root' ? aid(99) : soulId), open.pure.u64(variant === 'opening-call-revision' ? 10 : multiOpening ? 8 : 9), open.pure.u64(variant === 'opening-call-expiry' ? 2001 : 2000), shared(6, false)] })
      if (variant === 'opening-call-extra') open.moveCall({ target: `${aid(41)}::birth::noop`, arguments: [] })
      const bytes = await open.build(); openingDigest = TransactionDataBuilder.getDigestFromBytes(bytes); openingPacket = { bytes: toBase64(bytes), digest: openingDigest, expirationEpoch: '6' }
      accountAfter = h.base.object(account.id, multiOpening ? 8 : 9, accountType, CanonicalOwnedAccountBcs.serialize({ ...account, authority: variant === 'opening-retained' ? account.authority : null }).toBytes(), { AddressOwner: owner }, openingDigest)
    }
    const after = { ...service, revision: variant === 'service-revision' ? '9' : '10', busy: false }
    if (variant === 'service-rebound') after.account = aid(99)
    write(aid(79), `${aid(50)}::soul::SourceService<${aid(40)}::birth::NativeModule,${aid(40)}::birth::State>`, NativePaidServiceBcs, service, after, { Shared: { initialSharedVersion: withOpening ? (multiOpening ? 8 : 9) : variant === 'service-birth' ? 2 : 1 } })
    if (openingPacket) {
      let originalService = h.base.rows.get(`${aid(79)}:9`)!
      if (multiOpening) {
        const serviceType = `${aid(50)}::soul::SourceService<${aid(40)}::birth::NativeModule,${aid(40)}::birth::State>`
        const created = h.base.object(aid(79), 8, serviceType, NativePaidServiceBcs.serialize({ ...service, revision: '8' }).toBytes(), { Shared: { initialSharedVersion: 8 } }, openingDigest)
        const priorTx = buildNativePaidContentPurchase({ ...intent, rootRevision: '8', attempt: new Uint8Array(32).fill(2), paymentCoin: { ...intent.paymentCoin, version: '7' } }); priorTx.setGasOwner(buyer); priorTx.setGasPrice(1); priorTx.setGasBudget(1000); priorTx.setGasPayment([{ objectId: aid(82), version: 7, digest: adigest(82) }]); priorTx.setExpiration({ Epoch: 6 })
        const priorBytes = await priorTx.build(), priorDigest = TransactionDataBuilder.getDigestFromBytes(priorBytes)
        const current = h.base.object(aid(79), 9, serviceType, NativePaidServiceBcs.serialize(service).toBytes(), { Shared: { initialSharedVersion: 8 } }, priorDigest)
        const currentChange = changes.find(([id]) => id === aid(79))![1]; currentChange.inputState.Exist[0] = ['9', current.digest]
        const priorEffects = h.base.effects(priorDigest, 9, [h.base.change(current, false, created)]); priorEffects.V2!.executedEpoch = '4'
        h.ledgers.set(priorDigest, { packet: { bytes: toBase64(priorBytes), digest: priorDigest, expirationEpoch: '6' } as any, effects: priorEffects, events: [], checkpoint: 3n })
        originalService = created
      }
      const openingEffects = h.base.effects(openingDigest, multiOpening ? 8 : 9, [h.base.change(originalService, true), h.base.change(accountAfter, false, accountBefore)])
      openingEffects.V2!.executedEpoch = multiOpening ? '3' : '4'
      h.ledgers.set(openingDigest, { packet: openingPacket as any, effects: openingEffects, events: [], checkpoint: variant === 'opening-future' ? 101n : 2n })
    }
  }
  const effects = h.base.effects(digest, 10, changes, [[aid(6), { ReadOnlyRoot: ['9', clock.digest] }]])
  if (money) {
    write(aid(81), '0x2::coin::Coin<0x2::sui::SUI>', Coin, { id: aid(81), balance: 1000 }, { id: aid(81), balance: String(1000n - BigInt(quote.total) + (variant === 'money-debit' ? 1n : 0n)) }, { AddressOwner: buyer })
    write(aid(86), '0x2::coin::Coin<0x2::sui::SUI>', Coin, null, { id: aid(86), balance: variant === 'money-payout' ? 100 : 101 }, { AddressOwner: variant === 'money-recipient' ? aid(99) : owner })
    const gasIndex = changes.length
    write(aid(82), '0x2::coin::Coin<0x2::sui::SUI>', Coin, { id: aid(82), balance: 2000 }, { id: aid(82), balance: variant === 'money-gas' ? 1999 : 1998 }, { AddressOwner: buyer })
    effects.V2!.changedObjects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(h.base.effects(digest, 10, changes)).toBytes()).V2!.changedObjects
    effects.V2!.gasObjectIndex = gasIndex
  }
  effects.V2!.executedEpoch = '5'
  const packages = new Map([n, c, f, std, cust].map(x => [x.pkg.objectId, x.pkg])), get = h.transport.ledgerService.getObject
  n.transactionData.V1 = bcs.TransactionData.parse(bytes).V1
  n.effectsData.V2 = structuredClone(effects.V2)
  n.eventsData.data = [{ package_id: aid(43), transaction_module: 'paid_access', sender: buyer, type_: { address: aid(42), module: 'paid_access', name: 'Updated', typeParams: [] }, contents: NativePaidUpdatedBcs.serialize({ root: soulId, kind: 1, buyer, revision: '4', operation: 2, entry }).toBytes() },
    { package_id: aid(45), transaction_module: 'economics', sender: buyer, type_: { address: aid(44), module: 'economics', name: 'Paid', typeParams: [] }, contents: NativeSubscriptionPaidBcs.serialize({ subject: soulId, attempt: intent.attempt, payer: buyer, gross: quote.total, fee: quote.platformFee, beneficiary: owner }).toBytes() }]
  n.rehashTransaction()
  const client: any = { ...h.transport, ledgerService: { ...h.transport.ledgerService, getServiceInfo: n.client.ledgerService.getServiceInfo, getTransaction: (r: any, o: any) => r.digest === digest ? n.client.ledgerService.getTransaction(r, o) : h.transport.ledgerService.getTransaction(r), getCheckpoint: (r: any, o: any) => String(r.checkpointId?.sequenceNumber) === '100' ? n.client.ledgerService.getCheckpoint(r, o) : h.transport.ledgerService.getCheckpoint(r), getObject: (r: any, o: any) => r.version === undefined && packages.has(r.objectId) ? Promise.resolve({ response: { object: packages.get(r.objectId) } }) : get(r, o) } }
  return { checkpoint: '100', standard: std.deployment, custody: cust.deployment, finality: n, client, intent, packet: { bytes: toBase64(bytes), digest, expirationEpoch: '6' }, gas: { budget: '1000', price: '1', coins: [{ objectId: aid(82), version: '9', digest: gasInput?.digest ?? adigest(82) }] }, effects, offer, soulId, stateId, ledgerId, native: n.deployment, content: c.deployment, foundation: f.deployment, signal: h.controller.signal }
}
it('proves original new entry, durable attempt receipt and ledger transition without claiming money or content delivery', async () => {
  expect(await proveNativePaidContentReceipt(await fixture())).toMatchObject({ entry: { scope: '1', expiry: '1100' }, receipt: { total: '104' }, notMoneySettlementProof: true, notContentDeliveryProof: true })
})
it.each(['ledger', 'scope', 'expiry', 'beneficiary', 'entry-hash'])('rejects contradictory original subscription evidence: %s', async variant => {
  await expect(proveNativePaidContentReceipt(await fixture(variant))).rejects.toThrow()
})

it.each([['renew', '1600'], ['renew-stale', '1100']])('proves renewal/replacement from the correct original expiry base: %s', async (variant, expiry) => {
  expect(await proveNativePaidContentReceipt(await fixture(variant))).toMatchObject({ entry: { expiry }, notContentDeliveryProof: true })
})
it.each(['renew-permanent', 'renew-hash'])('rejects impossible original renewal evidence: %s', async variant => {
  await expect(proveNativePaidContentReceipt(await fixture(variant))).rejects.toThrow()
})

const originalHistory = async () => { const f = await fixture(); return { ...f, packet: { ...f.packet, phase: 'SIGNED' as const, signature: 'synthetic' } } }
it('composes original finalized packet/checkpoint, actual Entry/Receipt and exact Updated/Paid while preserving delivery gaps', async () => {
  expect(await readNativePaidContentHistory(await originalHistory())).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', checkpoint: '100', receipt: {
    requiresOriginalFinalityAndEvents: false, requiresOriginalServiceStateAndOfferProof: true, notMoneySettlementProof: true, notContentDeliveryProof: true } })
})
it.each(['duplicate', 'authority', 'scope', 'operation', 'payment', 'checkpoint', 'eventless'] as const)('rejects original subscription history contradiction: %s', async variant => {
  const f = await originalHistory(), n = f.finality
  if (variant === 'duplicate') n.eventsData.data.push(n.eventsData.data[0])
  if (variant === 'authority') n.eventsData.data[0].package_id = aid(99)
  if (variant === 'scope' || variant === 'operation') { const e = NativePaidUpdatedBcs.parse(n.eventsData.data[0].contents); if (variant === 'scope') e.entry!.scope = '2'; else e.operation = 3; n.eventsData.data[0].contents = NativePaidUpdatedBcs.serialize(e).toBytes() }
  if (variant === 'payment') { const e = NativeSubscriptionPaidBcs.parse(n.eventsData.data[1].contents); e.gross = '103'; n.eventsData.data[1].contents = NativeSubscriptionPaidBcs.serialize(e).toBytes() }
  if (variant === 'eventless') n.eventsData.data = []
  n.rehashEvents()
  if (variant === 'checkpoint') { n.contentsData.V2!.transactions.pop(); n.rehashContents() }
  await expect(readNativePaidContentHistory(f)).rejects.toThrow()
})
it('retains original subscription unknown/pending results without synthesizing eligibility', async () => {
  const f = await originalHistory(); delete f.finality.ledger.checkpoint
  expect(await readNativePaidContentHistory(f)).toEqual({ status: 'PENDING' })
  f.finality.client.ledgerService.getTransaction.mockRejectedValue({ code: 'NOT_FOUND' })
  expect(await readNativePaidContentHistory(f)).toEqual({ status: 'MISSING' })
})

it('proves actual original subscription Coin debit, owner payout, platform income and independent Gas', async () => {
  expect(await proveNativePaidContentMoney(await fixture('money'))).toMatchObject({ buyerGrossDebit: '104', buyerChange: '896', payout: { amount: '101', owner: aid(70) }, protocolIncome: '3', gas: { netGasCharge: '2' }, notContentDeliveryProof: true })
})
it.each(['money-income', 'money-debit', 'money-payout', 'money-recipient', 'money-gas'])('rejects contradictory actual subscription money: %s', async variant => {
  await expect(proveNativePaidContentMoney(await fixture(variant))).rejects.toThrow()
})
it('composes original finalized receipt and actual money without marking content delivery complete', async () => {
  const f = await fixture('money')
  expect(await readNativePaidContentHistory({ ...f, packet: { ...f.packet, phase: 'SIGNED', signature: 'synthetic' }, proveMoney: true })).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', receipt: { notMoneySettlementProof: false, notContentDeliveryProof: true, requiresOriginalServiceStateAndOfferProof: true, money: { protocolIncome: '3' } } })
})

it('preserves platform income revision and funds when the original subscription fee is zero', async () => {
  expect(await proveNativePaidContentMoney(await fixture('money-zero-fee'))).toMatchObject({ buyerGrossDebit: '101', buyerChange: '899', payout: { amount: '101' }, protocolIncome: '0' })
})

it.each(['policy-disabled', 'policy-paused', 'policy-release', 'policy-unpinned', 'policy-original', 'policy-callable', 'policy-marker', 'policy-primary', 'policy-corrupt'])('rejects contradictory original paid economic policy: %s', async variant => {
  await expect(proveNativePaidContentReceipt(await fixture(variant))).rejects.toThrow()
})
it.each(['policy-frozen', 'policy-upgrade'])('accepts lawful original role identity despite freeze or retained revision defining origin: %s', async variant => {
  expect(await proveNativePaidContentReceipt(await fixture(variant))).toMatchObject({ originalPolicy: { gates: { primary: true }, requiresOriginalNativeBindingAndGateFieldProof: true } })
})

it('proves the original Shared service binding and complete revision-only output transition', async () => {
  expect(await proveNativePaidContentServiceHistory(await fixture('service'))).toMatchObject({ beforeRevision: '9', afterRevision: '10', owner: aid(70), generation: '2', requiresOriginalSoulStateAndLedgerTreeProof: true, notCurrentAuthority: true })
})
it.each(['service-owner', 'service-expired', 'service-ledger', 'service-generation', 'service-busy', 'service-revision', 'service-rebound', 'service-birth'])('rejects original service contradiction: %s', async variant => {
  await expect(proveNativePaidContentServiceHistory(await fixture(variant))).rejects.toThrow()
})
it('composes service and actual money with finalized original receipt without completing delivery', async () => {
  const f = await fixture('money-service')
  expect(await readNativePaidContentHistory({ ...f, packet: { ...f.packet, phase: 'SIGNED', signature: 'synthetic' }, proveMoney: true, serviceContext: { standard: f.standard, custody: f.custody } })).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', receipt: { service: { afterRevision: '10', requiresOriginalOfferMembershipProof: true }, money: { protocolIncome: '3' }, notContentDeliveryProof: true } })
})

it('reads original typed Offer through exact owned Ledger/table lineage and ignores newer contradictory data', async () => {
  expect(await proveNativePaidContentOfferHistory(await fixture('offer'))).toMatchObject({ offer: { price: '101', scope: '1' }, offersTableId: aid(83), requiresQualifiedParentCommitInvariant: true, requiresOriginalLedgerTreeMembership: true })
})
it.each(['offer-key', 'offer-owner', 'offer-value', 'offer-missing', 'offer-future', 'offer-table-alias'])('rejects original Offer history contradiction: %s', async variant => {
  await expect(proveNativePaidContentOfferHistory(await fixture(variant))).rejects.toThrow()
})
it('composes original Offer lineage, service, money and finalized receipt while retaining source qualification and delivery gaps', async () => {
  const f = await fixture('money-service-offer')
  expect(await readNativePaidContentHistory({ ...f, packet: { ...f.packet, phase: 'SIGNED', signature: 'synthetic' }, proveMoney: true, proveOfferHistory: true, serviceContext: { standard: f.standard, custody: f.custody } })).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', receipt: { offerHistory: { offer: { price: '101' }, requiresQualifiedParentCommitInvariant: true }, service: { afterRevision: '10' }, money: { protocolIncome: '3' }, notContentDeliveryProof: true } })
})

it('binds original Soul/State body and historical PaidKey pointer to original service and Ledger', async () => {
  expect(await proveNativePaidContentTreeHistory(await fixture('tree'))).toMatchObject({ soulId: aid(72), stateId: aid(73), ledgerId: aid(74), requiresOriginalSemanticCommitmentProof: true, requiresOriginalModulePointerAndAnnotationProof: true, notContentDeliveryProof: true })
})
it.each(['tree-creator', 'tree-state-change', 'tree-state-owner', 'tree-body', 'tree-revision', 'tree-custody', 'tree-ledger-pointer', 'tree-pointer-owner', 'tree-pointer-missing', 'tree-service-origin'])('rejects original paid tree contradiction: %s', async variant => {
  await expect(proveNativePaidContentTreeHistory(await fixture(variant))).rejects.toThrow()
})
it('composes tree/Offer/service/money/finality without discarding source/semantic qualification gaps', async () => {
  const f = await fixture('money-service-offer-tree')
  expect(await readNativePaidContentHistory({ ...f, packet: { ...f.packet, phase: 'SIGNED', signature: 'synthetic' }, proveMoney: true, proveOfferHistory: true, proveTreeHistory: true, serviceContext: { standard: f.standard, custody: f.custody } })).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', receipt: { treeHistory: { ledgerId: aid(74), requiresOriginalSemanticCommitmentProof: true }, offerHistory: { offer: { price: '101' } }, notContentDeliveryProof: true } })
})

it('preserves proven Native install version and updates only last-updated to the original Soul commit revision', async () => {
  expect(await proveNativePaidContentTreeHistory(await fixture('tree'))).toMatchObject({ nativeVersion: { installed: '1', beforeUpdated: '7', afterUpdated: '10', requiresExactInstallationHistoryProof: false } })
})
it.each(['tree-version-zero', 'tree-version-created'])('keeps legacy unknown installation history explicit while proving the current update: %s', async variant => {
  expect(await proveNativePaidContentTreeHistory(await fixture(variant))).toMatchObject({ nativeVersion: { installed: '0', afterUpdated: '10', requiresExactInstallationHistoryProof: true } })
})
it.each(['tree-version-future', 'tree-version-installed', 'tree-version-stale', 'tree-version-key', 'tree-version-missing', 'tree-version-owner'])('rejects contradictory original Native module version: %s', async variant => {
  await expect(proveNativePaidContentTreeHistory(await fixture(variant))).rejects.toThrow()
})

it('reports original effect coverage separately from incomplete protected delivery and source proof', async () => {
  const f = await fixture('money-service-offer-tree')
  const result = await readNativePaidContentHistory({ ...f, packet: { ...f.packet, phase: 'SIGNED', signature: 'synthetic' }, proveMoney: true, proveOfferHistory: true, proveTreeHistory: true, serviceContext: { standard: f.standard, custody: f.custody } })
  expect(result).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', receipt: { effectsReconciliation: { status: 'INCOMPLETE_SUBPROOFS', unclaimedEffectIds: [], missingSubproofs: expect.arrayContaining(['remainingModuleFields']), notCompleteSubscriptionProof: true }, notContentDeliveryProof: true } })
})

it('reads original Kiosk body and proves paid service leaves owner, profits, item count and restrictions unchanged', async () => {
  expect(await proveNativePaidContentServiceHistory(await fixture('service'))).toMatchObject({ kioskProof: { kioskId: aid(80), owner: aid(70), profits: '13', itemCount: 1, requiresOriginalKioskItemAndLockProof: true, notCurrentCustody: true }, claimedEffectIds: [aid(79), aid(80)] })
})
it.each(['service-kiosk-owner', 'service-kiosk-empty', 'service-kiosk-extensions', 'service-kiosk-profits', 'service-kiosk-count', 'service-kiosk-birth'])('rejects contradictory original paid service Kiosk: %s', async variant => {
  await expect(proveNativePaidContentServiceHistory(await fixture(variant))).rejects.toThrow()
})

it('reads original Kiosk Item and true Lock through Shared Kiosk history, ignoring contradictory newer Item data', async () => {
  expect(await proveNativePaidContentTreeHistory(await fixture('tree'))).toMatchObject({ kioskCustody: { kioskId: aid(80), soulId: aid(72), requiresOriginalNoListingProof: true, notCurrentCustody: true } })
})
it.each(['tree-item-key', 'tree-item-value', 'tree-item-owner', 'tree-lock-key', 'tree-lock-false', 'tree-lock-owner', 'tree-lock-missing'])('rejects original Kiosk custody field contradiction: %s', async variant => {
  await expect(proveNativePaidContentTreeHistory(await fixture(variant))).rejects.toThrow()
})

it('proves original Shared service creation consumed the original owner Account authority', async () => {
  expect(await proveNativePaidServiceOpeningHistory(await fixture('opening'))).toMatchObject({ accountId: aid(89), owner: aid(70), capId: aid(88), openingCheckpoint: '2', openingRevision: '9', openingCallMatched: true, requiresOriginalOpeningSourceQualification: true, notCurrentAuthority: true })
})
it.each(['opening-cap', 'opening-account-owner', 'opening-retained', 'opening-sender', 'opening-future'])('rejects contradictory original service opening authority history: %s', async variant => {
  await expect(proveNativePaidServiceOpeningHistory(await fixture(variant))).rejects.toThrow()
})
it('composes original service opening handoff with original finalized subscription recovery', async () => {
  const f = await fixture('opening')
  expect(await readNativePaidContentHistory({ ...f, packet: { ...f.packet, phase: 'SIGNED', signature: 'synthetic' }, proveOpeningHistory: true, serviceContext: { standard: f.standard, custody: f.custody } })).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', receipt: { openingHistory: { openingCheckpoint: '2', requiresCompleteOpeningEffectsProof: true }, notContentDeliveryProof: true } })
})

it('walks an intervening original paid-service revision before proving its creation Account handoff', async () => {
  const proof = await proveNativePaidServiceOpeningHistory(await fixture('opening-multihop'))
  expect(proof).toMatchObject({ openingRevision: '8', openingCheckpoint: '2', owner: aid(70), openingCallMatched: true, requiresOriginalOpeningSourceQualification: true })
  expect(proof.trail.map(row => row.version)).toEqual(['9', '8'])
})

it.each(['opening-call-root', 'opening-call-revision', 'opening-call-expiry', 'opening-call-extra'])('rejects an original opening kind inconsistent with the independently authenticated service/Account: %s', async variant => {
  await expect(proveNativePaidServiceOpeningHistory(await fixture(variant))).rejects.toThrow('PAID_OPENING_WHOLE_KIND')
})

async function serviceFundsFixture(other=false, variant='money-service-offer'){
 const f=await fixture(variant),viewer=other?aid(999):aid(70);let address:string|null=viewer
 const read=f.client.ledgerService.getObject.bind(f.client.ledgerService)
 f.client.ledgerService.getObject=async(r:any)=>read(r.version===undefined&&r.objectId===aid(86)?{...r,version:10n}:r)
 f.client.core={getChainIdentifier:vi.fn(async()=>({chainIdentifier:'4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S'})),listOwnedObjects:vi.fn(async()=>({objects:[{objectId:aid(86)}],hasNextPage:false,cursor:null}))} as any
 const input={...f,packet:{...f.packet,phase:'SIGNED' as const,signature:'synthetic'},serviceContext:{standard:f.standard,custody:f.custody},viewerAddress:viewer,getViewerAddress:()=>address}
 return {f,input,setAddress:(v:string|null)=>{address=v},run:()=>readNativePaidServiceBeneficiaryFunds(input)}
}
it('composes actual original V1 service/Offer/payment proof with beneficiary full Coin readback without inventing a service fee',async()=>{
 const x=await serviceFundsFixture();Object.assign(x.input,{proveMoney:false,proveOfferHistory:false});expect(await x.run()).toMatchObject({status:'ORIGINAL_SERVICE_BACKED_PROCEEDS_WITH_CURRENT_OBSERVATIONS',original:{status:'SUBSCRIPTION_RECORDED',receipt:{service:{owner:aid(70)},money:{protocolIncome:'3'}}},originalProceeds:{owner:aid(70),amount:'101',serviceId:aid(79)},inventory:{status:'OBSERVED',value:{observedCoinBalance:'101'}},notSeparateServiceFee:true,notProtocolIncomeWithdrawalAuthority:true,notPermissionToRetryPayment:true})
})
it('does not read current funds for a different wallet even though original service and payment are verified',async()=>{
 const x=await serviceFundsFixture(true);expect(await x.run()).toMatchObject({status:'OTHER_BENEFICIARY',originalProceeds:{amount:'101'}});expect(x.f.client.core.listOwnedObjects).not.toHaveBeenCalled()
})
it('retains original service-backed proceeds when current recipient inventory is unavailable',async()=>{
 const x=await serviceFundsFixture();vi.mocked(x.f.client.core.listOwnedObjects).mockRejectedValue({code:14})
 expect(await x.run()).toMatchObject({originalProceeds:{amount:'101'},payout:{status:'OBSERVED'},inventory:{status:'UNAVAILABLE',code:14},notSeparateServiceFee:true})
})
it('rejects wallet changes during current service-backed proceeds observation',async()=>{
 const x=await serviceFundsFixture();vi.mocked(x.f.client.core.listOwnedObjects).mockImplementation(async()=>{x.setAddress(null);throw {code:14}})
 await expect(x.run()).rejects.toThrow('WALLET_CHANGED')
})
it('does not read recipient coins before original subscription finality',async()=>{
 const x=await serviceFundsFixture();delete x.f.finality.ledger.checkpoint
 expect(await x.run()).toMatchObject({status:'ORIGINAL_PROCEEDS_NOT_CONFIRMED',original:{status:'PENDING'}});expect(x.f.client.core.listOwnedObjects).not.toHaveBeenCalled()
})
it('preserves original proceeds when the current payout Coin is missing and the observed Coin set is empty',async()=>{
 const x=await serviceFundsFixture(),read=x.f.client.ledgerService.getObject.bind(x.f.client.ledgerService)
 x.f.client.ledgerService.getObject=async(r:any)=>{if(r.version===undefined&&r.objectId===aid(86))throw {code:5};return read(r)}
 vi.mocked(x.f.client.core.listOwnedObjects).mockResolvedValue({objects:[],hasNextPage:false,cursor:null} as any)
 expect(await x.run()).toMatchObject({originalProceeds:{amount:'101'},payout:{status:'OBSERVED',value:{observations:[{status:'UNAVAILABLE',originalAmount:'101'}]}},inventory:{status:'OBSERVED',value:{observedCoinBalance:'0',notTotalWalletBalance:true}},notPermissionToRetryPayment:true})
})
it('requires original service context before reading subscription history',async()=>{
 const x=await serviceFundsFixture();delete (x.input as any).serviceContext
 await expect(x.run()).rejects.toThrow('CONTEXT');expect(x.f.client.core.listOwnedObjects).not.toHaveBeenCalled()
})
it('captures original and current read methods before asynchronous finalized history',async()=>{
 const x=await serviceFundsFixture(),ledger=x.f.client.ledgerService,info=ledger.getServiceInfo.bind(ledger)
 ledger.getServiceInfo=async(...args:any[])=>{await Promise.resolve();ledger.getObject=()=>{throw Error('REPLACED_SERVICE_FUNDS_READER')};x.f.client.core.listOwnedObjects=()=>{throw Error('REPLACED_INVENTORY')};return info(...args)}
 expect(await x.run()).toMatchObject({originalProceeds:{amount:'101'},inventory:{status:'OBSERVED'},payout:{status:'OBSERVED'}})
})

async function serviceRecoveryCase() {
  const { f, input } = await serviceFundsFixture(false, 'money-service-offer-tree-opening')
  const pin = ({ originalPackageId, callablePackageId, callableDigest }: typeof f.native) =>
    ({ originalPackageId, callablePackageId, callableDigest })
  const review = {
    schema: 'soulidity.native-paid-service-recovery.v1',
    genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',
    transactionDigest: input.packet.digest,
    beneficiary: f.offer.issuer,
    intent: f.intent, gas: f.gas, offer: f.offer, soulId: f.soulId, stateId: f.stateId, ledgerId: f.ledgerId,
    native: pin(f.native), content: pin(f.content), foundation: pin(f.foundation),
    serviceContext: { standard: pin(f.standard), custody: pin(f.custody) },
  }
  const packet = { ...input.packet }
  const run = () => verifyNativePaidServiceRecovery({
    client: f.client, signal: f.signal,
    reviewText: JSON.stringify(review, (_key, value) => value instanceof Uint8Array ? Array.from(value) : value),
    packetText: JSON.stringify(packet),
  })
  return { f, review, packet, run }
}

it('recovers the reviewed original V1 payment and both service lineage proofs by digest', async () => {
  const x = await serviceRecoveryCase()
  const result = await x.run()
  expect(result).toMatchObject({
    status: 'ORIGINAL_SERVICE_BACKED_PROCEEDS_WITH_CURRENT_OBSERVATIONS',
    transactionDigest: x.packet.digest,
    beneficiary: x.review.beneficiary,
    original: { status: 'SUBSCRIPTION_RECORDED', checkpoint: '100', receipt: {
      offerHistory: expect.any(Object), treeHistory: expect.any(Object), openingHistory: expect.any(Object),
      money: { protocolIncome: '3' },
    } },
    originalProceeds: { owner: aid(70), amount: '101', serviceId: aid(79) },
    payout: { status: 'OBSERVED', value: { observations: [{ status: 'CURRENTLY_OWNED', currentCoinBalance: '101' }] } },
    inventory: { status: 'OBSERVED', value: { observedCoinBalance: '101' } },
  })
  expect(JSON.stringify(result)).not.toContain(x.packet.signature)
})

it('rejects an original from another reviewed case before the ledger is read', async () => {
  const x = await serviceRecoveryCase()
  const ledger = vi.spyOn(x.f.client.ledgerService, 'getServiceInfo')
  x.review.transactionDigest = adigest(99)
  await expect(x.run()).rejects.toThrow('PAID_SERVICE_RECOVERY_PACKET')
  expect(ledger).not.toHaveBeenCalled()
})

it('rejects a substituted service beneficiary before the ledger is read', async () => {
  const x = await serviceRecoveryCase()
  const ledger = vi.spyOn(x.f.client.ledgerService, 'getServiceInfo')
  x.review.beneficiary = aid(99)
  await expect(x.run()).rejects.toThrow('PAID_SERVICE_RECOVERY_BENEFICIARY')
  expect(ledger).not.toHaveBeenCalled()
})

it('queries the original digest without inventory reads when its checkpoint is pending', async () => {
  const x = await serviceRecoveryCase()
  const tx = vi.spyOn(x.f.client.ledgerService, 'getTransaction')
  delete x.f.finality.ledger.checkpoint
  expect(await x.run()).toMatchObject({
    transactionDigest: x.packet.digest, original: { status: 'PENDING' }, notPermissionToRetryPayment: true,
  })
  expect(tx).toHaveBeenCalledTimes(1)
  expect(tx).toHaveBeenCalledWith(expect.objectContaining({ digest: x.packet.digest }), expect.anything())
  expect(x.f.client.core.listOwnedObjects).not.toHaveBeenCalled()
})

it('rejects tampered bytes even when the saved digest matches the review', async () => {
  const x = await serviceRecoveryCase()
  const ledger = vi.spyOn(x.f.client.ledgerService, 'getServiceInfo')
  const data = Transaction.from(x.packet.bytes)
  data.setGasBudget(1001)
  x.packet.bytes = toBase64(await data.build())
  await expect(x.run()).rejects.toThrow('PAID_PACKET_CANONICAL_DIGEST')
  expect(ledger).not.toHaveBeenCalled()
})

it('keeps a missing original recoverable by the same digest without current Coin reads', async () => {
  const x = await serviceRecoveryCase()
  const tx = vi.spyOn(x.f.client.ledgerService, 'getTransaction').mockRejectedValue({ code: 'NOT_FOUND' })
  expect(await x.run()).toMatchObject({
    transactionDigest: x.packet.digest, original: { status: 'MISSING' }, notPermissionToRetryPayment: true,
  })
  expect(tx).toHaveBeenCalledTimes(1)
  expect(tx).toHaveBeenCalledWith(expect.objectContaining({ digest: x.packet.digest }), expect.anything())
  expect(x.f.client.core.listOwnedObjects).not.toHaveBeenCalled()
})
