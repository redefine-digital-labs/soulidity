import { bcs } from '@mysten/sui/bcs'
import { SoulPublicKioskBcs, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE, deriveKioskItemFieldId } from '@soulidity/sdk'
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { CanonicalSoulBcs } from '../../../web/lib/soulidity/canonical-native-workbench'
import { sha256 } from '@noble/hashes/sha2.js'
import { vi } from 'vitest'
import { batchHistoryFixture } from './walrus-batch-history'
import { activityEvidenceFixture, aid as fixtureAid, adigest } from './activity-transaction-evidence'
import { NativePublicReadHostV2Bcs, NativePublicReadLinkV2Bcs } from '../../../web/lib/soulidity/native-public-read-record-v2'
import { NativeInitialPaidBcs, NativeInitialAuthorizationBcs } from '../../../web/lib/soulidity/native-initial-children'
import { EconomicsConfigBcs, economicsConfigSnapshot, economicsOperationalSnapshotHash } from '../../../web/lib/soulidity/commerce/economics-bcs'
import { PaidContentOfferBcs, PaidContentEntryBcs, PaidContentBuyerKeyBcs, quoteNativePaidContent } from '../../../web/lib/soulidity/commerce/paid-content-policy'
import { NativePaidAttemptKeyBcs, NativePaidAttemptFieldBcs, NativePaidEntryFieldBcs } from '../../../web/lib/soulidity/commerce/native-paid-content-receipt'
import { buildNativePublicReadPaidPurchaseV2, type NativePublicReadPaidPurchaseV2 } from '../../../web/lib/soulidity/commerce/native-public-read-paid-transaction-v2'
import { readNativePublicReadPaidHistoryV2 } from '../../../web/lib/soulidity/commerce/native-public-read-paid-history-v2'
import { NativePaidUpdatedBcs, NativeSubscriptionPaidBcs } from '../../../web/lib/soulidity/commerce/native-paid-content-history'
import {readNativePublicReadPaidBeneficiaryFundsV2} from '../../../web/lib/soulidity/commerce/native-public-read-paid-beneficiary-funds-v2'
import {proveNativePublicReadPaidRegistryIdentityV2} from '../../../web/lib/soulidity/commerce/native-public-read-paid-registry-identity-v2'
import { simulateNativePublicReadPaidPurchaseV2 } from '../../../web/lib/soulidity/commerce/native-public-read-paid-simulation-v2'
import { proveNativePublicReadPaidLinkHistoryV2 } from '../../../web/lib/soulidity/commerce/native-public-read-paid-link-history-v2'
import { proveNativePublicReadPaidModulePointerHistoryV2 } from '../../../web/lib/soulidity/commerce/native-public-read-paid-module-pointer-history-v2'
import { proveNativePublicReadPaidSoulHistoryV2 } from '../../../web/lib/soulidity/commerce/native-public-read-paid-soul-history-v2'
import { proveNativePublicReadPaidAuthorizationHistoryV2 } from '../../../web/lib/soulidity/commerce/native-public-read-paid-authorization-history-v2'
import { proveNativePublicReadPaidCustodyHistoryV2 } from '../../../web/lib/soulidity/commerce/native-public-read-paid-custody-history-v2'
import { proveNativePublicReadPaidOfferHistoryV2, NativePublicReadPaidOfferFieldV2Bcs } from '../../../web/lib/soulidity/commerce/native-public-read-paid-offer-history-v2'
import { proveNativePublicReadPaidPointerHistoryV2 } from '../../../web/lib/soulidity/commerce/native-public-read-paid-pointer-history-v2'
import { MoveEmptyStructBcs } from '../../../web/lib/sui/move-empty-struct'
import { proveNativePublicReadPaidMoneyV2 } from '../../../web/lib/soulidity/commerce/native-public-read-paid-money-v2'
import { proveNativePublicReadPaidReceiptV2 } from '../../../web/lib/soulidity/commerce/native-public-read-paid-receipt-v2'

// Controlled original SDK packet/full BCS corpus, copied from the existing receipt fixture. No executed node/mainnet claim.
export async function publicReadPurchaseFixture(variant = '', buyerOverride?:string,kindOverride=1, coherent:{ids?:Record<number,string>;state?:any;hostBirth?:string;kioskBirth?:string}={}) {
  const aid=(n:number)=>coherent.ids?.[n]??fixtureAid(n)
  const h = await batchHistoryFixture(0), n = await activityEvidenceFixture(), c = await activityEvidenceFixture(), f = await activityEvidenceFixture(), standard = await activityEvidenceFixture()
  const pin = (x: typeof n, original: number, callable: number, names: string[]) => {
    x.deployment.originalPackageId = aid(original); x.deployment.callablePackageId = aid(callable)
    const p = x.packageData.data.Package!; p.id = aid(callable); p.moduleMap = new Map(names.map(name => [name.split('::')[0], new Uint8Array([1])]))
    p.typeOriginTable = names.map(name => ({ moduleName: name.split('::')[0], datatypeName: name.split('::')[1], package: aid(original) })); x.rehashPackage()
  }
  pin(n, 40, 41, ['birth::PublicReadHostV2', 'birth::PublicReadLinkV2', 'birth::PaidKey', 'birth::AuthorizationKey', 'birth::ContentOperator', 'birth::NativeModule', 'registry::SoulProducer', 'registry::Registry'])
  pin(c, 42, 43, ['authorization::Authorization', 'paid_access::Ledger', 'paid_access::Offer', 'paid_access::Entry', 'paid_access::BuyerKey', 'paid_access::AttemptKey', 'paid_access::Receipt', 'paid_access::PaidAuthority1', 'paid_access::PaidRevision1', 'paid_access::Updated'])
  pin(f, 44, 45, ['economics::Config', 'economics::Paid'])
  pin(standard, 46, 47, ['soul::Soul', 'soul::ModuleKey'])
  n.packageData.data.Package!.linkageTable = new Map([[aid(42), { upgradedId: aid(43), upgradedVersion: '2' }], [aid(44), { upgradedId: aid(45), upgradedVersion: '2' }], [aid(46), { upgradedId: aid(47), upgradedVersion: '2' }]]); n.rehashPackage()
  c.packageData.data.Package!.linkageTable = new Map([[aid(44), { upgradedId: aid(45), upgradedVersion: '2' }]]); c.rehashPackage()
  const owner = aid(70), buyer = buyerOverride??aid(71), soulId = aid(72), stateId = aid(73), ledgerId = aid(74), configId = aid(75)
  const config = EconomicsConfigBcs.parse(EconomicsConfigBcs.serialize({ id: configId, revision: 8, primary_bps: 250, secondary_bps: 250, complete_fee: 0, recipient: aid(76), paused: false,
    income: { root: configId, revision: 0, funds: 0, collected: 0, withdrawn: 0, requests: { id: aid(77), size: 0 } }, schema: 3, enabled: true, payment_coin: { name: '0x2::sui::SUI' }, original_package: aid(44), callable_package: aid(45), commitment: new Uint8Array(32), native_binding: null, release_binding: null, minimum_release: 2,
    roles: { roles: Array.from({ length: 6 }, () => ({ original: aid(42), callable: aid(42), marker: { name: `${aid(42)}::paid_access::PaidRevision1` }, version: 1, pinned: true, frozen: false })) } }).toBytes())
  if (variant === 'money-zero-fee') config.primary_bps = 0
  config.commitment = economicsOperationalSnapshotHash({ domain: new TextEncoder().encode('soulidity-protocol-operational-v4'), config: economicsConfigSnapshot(config), gates: { primary: true, secondary: true } })
  const offer = PaidContentOfferBcs.parse(PaidContentOfferBcs.serialize({ issuer: owner, generation: 2, price: 101, scope: 1, duration: 100, revision: 3 }).toBytes())
  const quote = quoteNativePaidContent({ root: soulId, protocol: configId, kind: kindOverride, offer, feeRevision: '8', primaryBps: config.primary_bps, platformRecipient: config.recipient })
  const renewing = variant.startsWith('renew'), previousEntry = renewing ? { issuer: variant === 'renew-stale' ? aid(99) : owner, generation: variant === 'renew-stale' ? '1' : '2', scope: '1', expiry: ['renew-stale', 'renew-permanent'].includes(variant) ? null : '1500', revision: '3' } : null
  const shared = (id: number) => ({ objectId: aid(id), initialSharedVersion: id===94?coherent.hostBirth??'1':id===80?coherent.kioskBirth??'1':'1' })
  const intent: NativePublicReadPaidPurchaseV2 = { format: 'native-public-read-v2', buyer, nativeCallablePackageId: aid(41), coinType: '0x2::sui::SUI', registry: shared(78), config: shared(75), kiosk: shared(80), host: shared(94), kind: kindOverride,
    quote: { hash: quote.hash, total: quote.total }, entryHash: previousEntry ? variant === 'renew-hash' ? new Uint8Array(32) : sha256(PaidContentEntryBcs.serialize(previousEntry).toBytes()) : null,
    feeRevision: '8', quoteExpiryMs: '2000', attempt: new Uint8Array(32).fill(1), paymentCoin: { objectId: aid(81), version: '9', digest: adigest(81), balance: '1000' } }
  const money = variant.startsWith('money'), Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
  const funding = money ? h.base.object(aid(81), 9, '0x2::coin::Coin<0x2::sui::SUI>', Coin.serialize({ id: aid(81), balance: 1000 }).toBytes(), { AddressOwner: buyer }, adigest(1)) : null
  const gasInput = money ? h.base.object(aid(82), 9, '0x2::coin::Coin<0x2::sui::SUI>', Coin.serialize({ id: aid(82), balance: 2000 }).toBytes(), { AddressOwner: buyer }, adigest(1)) : null
  if (funding) intent.paymentCoin.digest = funding.digest
  const tx = buildNativePublicReadPaidPurchaseV2(intent); tx.setGasOwner(buyer); tx.setGasPrice(1); tx.setGasBudget(1000); tx.setGasPayment([{ objectId: aid(82), version: 9, digest: gasInput?.digest ?? adigest(82) }]); tx.setExpiration({ Epoch: 6 })
  const bytes = await tx.build(), digest = TransactionDataBuilder.getDigestFromBytes(bytes), changes: any[] = []
  const write = (id: string, type: string, codec: any, a: any | null, z: any, owner: any) => {
    const before = a === null ? null : h.base.object(id, 9, type, codec.serialize(a).toBytes(), owner, adigest(1)), after = h.base.object(id, 10, type, codec.serialize(z).toBytes(), owner, digest)
    changes.push(h.base.change(after, !before, before))
  }
  const host = { id: aid(94), root: soulId, state: { id: stateId, root: soulId, protocol: variant === 'host-protocol' ? aid(99) : configId, registry: aid(78), schema: 1, creator: owner,
    description: '', image: '', creator_royalty_bps: 250, created_at: '0', provenance: { kind: 0, origin: null, joined: null }, mint_nonce: new Uint8Array([1]), content: aid(90), issuer: { original: aid(40), callable: aid(41), marker: { name: `${aid(41)}::registry::SourceRevision2` }, version: '2' } } }
  if(coherent.state)host.state=structuredClone(coherent.state)
  write(host.id, `${aid(40)}::birth::PublicReadHostV2`, NativePublicReadHostV2Bcs, host, variant === 'host-change' ? { ...host, state: { ...host.state, description: 'changed' } } : host, { Shared: { initialSharedVersion: variant === 'host-birth' ? 2 : coherent.hostBirth??1 } })
  const paidField = deriveDynamicFieldID(stateId, `0x2::dynamic_object_field::Wrapper<${aid(40)}::birth::PaidKey>`, new Uint8Array([0]))
  const ledger = { id: ledgerId, root: soulId, protocol: configId, controller: { root: soulId, parent: stateId, operator: { name: `${aid(40)}::birth::ContentOperator` } }, revision: '3', offers: { id: aid(83), size: '1' }, entries: { id: aid(84), size: renewing ? '1' : '0' }, attempts: { id: variant === 'table-alias' ? aid(84) : aid(85), size: '0' } }
  write(ledgerId, `${aid(42)}::paid_access::Ledger`, NativeInitialPaidBcs, ledger, { ...ledger, revision: '4', entries: { ...ledger.entries, size: '1' }, attempts: { ...ledger.attempts, size: variant === 'ledger-count' ? '2' : '1' } }, { ObjectOwner: variant === 'ledger-owner' ? stateId : paidField })
  const afterConfig = structuredClone(config)
  if (money) { afterConfig.income.funds = variant === 'money-income' ? '2' : quote.platformFee; afterConfig.income.collected = quote.platformFee; afterConfig.income.revision = BigInt(quote.platformFee) > 0n ? '1' : '0' }
  write(configId, `${aid(44)}::economics::Config<0x2::sui::SUI>`, EconomicsConfigBcs, config, afterConfig, { Shared: { initialSharedVersion: 1 } })
  const key = { kind: kindOverride, buyer }, entryId = deriveDynamicFieldID(ledger.entries.id, `${aid(42)}::paid_access::BuyerKey`, PaidContentBuyerKeyBcs.serialize(key).toBytes())
  const entry = { issuer: owner, generation: '2', scope: variant === 'scope' ? '2' : '1', expiry: variant === 'expiry' ? '1101' : renewing && !['renew-stale', 'renew-permanent'].includes(variant) ? '1600' : '1100', revision: '4' }
  write(entryId, `0x2::dynamic_field::Field<${aid(42)}::paid_access::BuyerKey,${aid(42)}::paid_access::Entry>`, NativePaidEntryFieldBcs, previousEntry ? { id: entryId, name: key, value: previousEntry } : null, { id: entryId, name: key, value: entry }, { ObjectOwner: ledger.entries.id })
  const attempt = { buyer, attempt: intent.attempt }, attemptId = deriveDynamicFieldID(ledger.attempts.id, `${aid(42)}::paid_access::AttemptKey`, NativePaidAttemptKeyBcs.serialize(attempt).toBytes())
  const receipt = { kind: kindOverride, quote: intent.quote.hash, entry_hash: variant === 'entry-hash' ? new Uint8Array(32) : sha256(PaidContentEntryBcs.serialize(entry).toBytes()), price: '101', total: quote.total, platform_fee: quote.platformFee, fee_revision: '8', platform_recipient: config.recipient, beneficiary: owner }
  write(attemptId, `0x2::dynamic_field::Field<${aid(42)}::paid_access::AttemptKey,${aid(42)}::paid_access::Receipt>`, NativePaidAttemptFieldBcs, null, { id: attemptId, name: attempt, value: receipt }, { ObjectOwner: ledger.attempts.id })
  const kiosk = h.base.object(aid(80), 9, '0x2::kiosk::Kiosk', SoulPublicKioskBcs.serialize({ id: aid(80), owner: variant === 'kiosk-owner' ? aid(99) : owner, profits: 13, item_count: 1, allow_extensions: false }).toBytes(), { Shared: { initialSharedVersion: variant === 'kiosk-birth' ? 2 : coherent.kioskBirth??1 } }, adigest(1))
  const clock = h.base.object(aid(6), 9, '0x2::clock::Clock', bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() }).serialize({ id: aid(6), timestamp_ms: 1000 }).toBytes(), { Shared: { initialSharedVersion: 1 } }, adigest(1))
  if (variant === 'standalone-state') changes.push([stateId, { inputState: { NotExist: true }, outputState: { NotExist: true }, idOperation: { Deleted: true } }])
  let gasIndex: number | null = null
  if (money) {
    write(aid(81), '0x2::coin::Coin<0x2::sui::SUI>', Coin, { id: aid(81), balance: 1000 }, { id: aid(81), balance: String(1000n - BigInt(quote.total) + (variant === 'money-debit' ? 1n : 0n)) }, { AddressOwner: buyer })
    write(aid(86), '0x2::coin::Coin<0x2::sui::SUI>', Coin, null, { id: aid(86), balance: variant === 'money-payout' ? 100 : 101 }, { AddressOwner: variant === 'money-recipient' ? aid(99) : owner })
    if (variant === 'money-extra-payout') write(aid(87), '0x2::coin::Coin<0x2::sui::SUI>', Coin, null, { id: aid(87), balance: 1 }, { AddressOwner: aid(99) })
    gasIndex = changes.length
    write(aid(82), '0x2::coin::Coin<0x2::sui::SUI>', Coin, { id: aid(82), balance: 2000 }, { id: aid(82), balance: variant === 'money-gas' ? 1999 : 1998 }, { AddressOwner: buyer })
  }
  const effects = h.base.effects(digest, 10, changes, [kiosk, clock].map(row => [row.objectId, { ReadOnlyRoot: ['9', row.digest] }]))
  effects.V2!.executedEpoch = '5'; effects.V2!.gasObjectIndex = gasIndex
  const packages = new Map([n, c, f, standard].map(x => [x.pkg.objectId, x.pkg])), get = h.transport.ledgerService.getObject
  n.transactionData.V1 = bcs.TransactionData.parse(bytes).V1; n.effectsData.V2 = structuredClone(effects.V2)
  n.eventsData.data = [{ package_id: aid(43), transaction_module: 'paid_access', sender: buyer, type_: { address: aid(42), module: 'paid_access', name: 'Updated', typeParams: [] }, contents: NativePaidUpdatedBcs.serialize({ root: soulId, kind: kindOverride, buyer, revision: '4', operation: 2, entry }).toBytes() },
    { package_id: aid(45), transaction_module: 'economics', sender: buyer, type_: { address: aid(44), module: 'economics', name: 'Paid', typeParams: [] }, contents: NativeSubscriptionPaidBcs.serialize({ subject: soulId, attempt: intent.attempt, payer: buyer, gross: quote.total, fee: quote.platformFee, beneficiary: owner }).toBytes() }]
  n.rehashTransaction()
  const client: any = { ...h.transport, ledgerService: { ...h.transport.ledgerService, getServiceInfo: n.client.ledgerService.getServiceInfo, getTransaction: n.client.ledgerService.getTransaction, getCheckpoint: n.client.ledgerService.getCheckpoint, getObject: (r: any, o: any) => {
    if (r.objectId === stateId) throw Error('NO_STANDALONE_V1_STATE')
    return r.version === undefined && packages.has(r.objectId) ? Promise.resolve({ response: { object: packages.get(r.objectId) } }) : get(r, o)
  } } }
  return { standard: standard.deployment, history: h, host, finality: n, stateId, params: { client, intent, packet: { bytes: toBase64(bytes), digest, expirationEpoch: '6' }, gas: { budget: '1000', price: '1', coins: [{ objectId: aid(82), version: '9', digest: gasInput?.digest ?? adigest(82) }] }, effects, offer, soulId, ledgerId, native: n.deployment, content: c.deployment, foundation: f.deployment, signal: h.controller.signal } }
}
