import { bcs } from '@mysten/sui/bcs'
import { SoulPublicKioskBcs, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE, deriveKioskItemFieldId } from '@soulidity/sdk'
import { deriveDynamicFieldID, toBase64, toHex } from '@mysten/sui/utils'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { CanonicalSoulBcs } from '../../web/lib/soulidity/canonical-native-workbench'
import { sha256 } from '@noble/hashes/sha2.js'
import { expect, it, vi } from 'vitest'
import { batchHistoryFixture } from './fixtures/walrus-batch-history'
import { activityEvidenceFixture, aid, adigest } from './fixtures/activity-transaction-evidence'
import { NativePublicReadHostV2Bcs, NativePublicReadLinkV2Bcs } from '../../web/lib/soulidity/native-public-read-record-v2'
import { NativeInitialPaidBcs, NativeInitialAuthorizationBcs } from '../../web/lib/soulidity/native-initial-children'
import { EconomicsConfigBcs, economicsConfigSnapshot, economicsOperationalSnapshotHash } from '../../web/lib/soulidity/commerce/economics-bcs'
import { PaidContentOfferBcs, PaidContentEntryBcs, PaidContentBuyerKeyBcs, quoteNativePaidContent } from '../../web/lib/soulidity/commerce/paid-content-policy'
import { NativePaidAttemptKeyBcs, NativePaidAttemptFieldBcs, NativePaidEntryFieldBcs } from '../../web/lib/soulidity/commerce/native-paid-content-receipt'
import { buildNativePublicReadPaidPurchaseV2, type NativePublicReadPaidPurchaseV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-transaction-v2'
import { readNativePublicReadPaidHistoryV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-history-v2'
import { NativePaidUpdatedBcs, NativeSubscriptionPaidBcs } from '../../web/lib/soulidity/commerce/native-paid-content-history'
import {readNativePublicReadPaidBeneficiaryFundsV2} from '../../web/lib/soulidity/commerce/native-public-read-paid-beneficiary-funds-v2'
import {proveNativePublicReadPaidRegistryIdentityV2} from '../../web/lib/soulidity/commerce/native-public-read-paid-registry-identity-v2'
import { simulateNativePublicReadPaidPurchaseV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-simulation-v2'
import { proveNativePublicReadPaidLinkHistoryV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-link-history-v2'
import { proveNativePublicReadPaidModulePointerHistoryV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-module-pointer-history-v2'
import { proveNativePublicReadPaidSoulHistoryV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-soul-history-v2'
import { proveNativePublicReadPaidAuthorizationHistoryV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-authorization-history-v2'
import { proveNativePublicReadPaidCustodyHistoryV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-custody-history-v2'
import { proveNativePublicReadPaidOfferHistoryV2, NativePublicReadPaidOfferFieldV2Bcs } from '../../web/lib/soulidity/commerce/native-public-read-paid-offer-history-v2'
import { proveNativePublicReadPaidPointerHistoryV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-pointer-history-v2'
import { MoveEmptyStructBcs } from '../../web/lib/sui/move-empty-struct'
import { proveNativePublicReadPaidMoneyV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-money-v2'
import { proveNativePublicReadPaidReceiptV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-receipt-v2'

// Controlled original full Objects/effects, actual SDK V2 packet. Neither
// executed payment, finality nor independent source/format acceptance.
async function fixture(variant = '', buyerOverride?:string,kindOverride=1) {
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
  const shared = (id: number) => ({ objectId: aid(id), initialSharedVersion: '1' })
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
  write(host.id, `${aid(40)}::birth::PublicReadHostV2`, NativePublicReadHostV2Bcs, host, variant === 'host-change' ? { ...host, state: { ...host.state, description: 'changed' } } : host, { Shared: { initialSharedVersion: variant === 'host-birth' ? 2 : 1 } })
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
  const kiosk = h.base.object(aid(80), 9, '0x2::kiosk::Kiosk', SoulPublicKioskBcs.serialize({ id: aid(80), owner: variant === 'kiosk-owner' ? aid(99) : owner, profits: 13, item_count: 1, allow_extensions: false }).toBytes(), { Shared: { initialSharedVersion: variant === 'kiosk-birth' ? 2 : 1 } }, adigest(1))
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
it('reads original Shared Host with embedded State, Entry/Attempt/Ledger without v1 State or Soul revision effects', async () => {
  const x = await fixture(), proof = await proveNativePublicReadPaidReceiptV2(x.params)
  expect(proof).toMatchObject({ format: 'native-public-read-v2', hostId: aid(94), stateId: x.stateId, entry: { expiry: '1100' }, receipt: { total: '104' }, requiresOriginalFinalityAndEvents: true, requiresOriginalHostLinkPaidPointerAuthAndOfferProof: true, notMoneySettlementProof: true, notContentDeliveryProof: true })
  expect(proof.claimedEffectIds).toContain(aid(94)); expect(proof.claimedEffectIds).not.toContain(x.stateId)
})
it.each(['table-alias', 'kiosk-birth', 'host-protocol', 'host-change', 'host-birth', 'kiosk-owner', 'ledger-count', 'ledger-owner', 'scope', 'expiry', 'entry-hash', 'standalone-state', 'renew-permanent', 'renew-hash'])('rejects contradictory original V2 business output: %s', async variant => {
  await expect(proveNativePublicReadPaidReceiptV2((await fixture(variant)).params)).rejects.toThrow()
})
it.each([['renew', '1600'], ['renew-stale', '1100']])('preserves lawful original renewal/replacement semantics in V2: %s', async (variant, expiry) => {
  expect(await proveNativePublicReadPaidReceiptV2((await fixture(variant)).params)).toMatchObject({ entry: { expiry }, notContentDeliveryProof: true })
})

async function historyFixture() { const x = await fixture(); return { ...x, params: { ...x.params, packet: { ...x.params.packet, phase: 'SIGNED' as const, signature: 'synthetic' } } } }
it('authenticates original V2 checkpoint/Host/Entry/Receipt/Updated/Paid without completing payment or delivery', async () => {
  expect(await readNativePublicReadPaidHistoryV2((await historyFixture()).params)).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', checkpoint: '100', receipt: { format: 'native-public-read-v2', requiresOriginalFinalityAndEvents: false, requiresOriginalHostLinkPaidPointerAuthAndOfferProof: true, notMoneySettlementProof: true, requiresOriginalPaidPointerProof: true, paidPointer: null, notContentDeliveryProof: true } })
})
it.each(['duplicate', 'authority', 'entry', 'operation', 'payment', 'attempt', 'checkpoint', 'eventless'])('rejects contradictory finalized V2 subscription history: %s', async variant => {
  const x = await historyFixture(), n = x.finality
  if (variant === 'duplicate') n.eventsData.data.push(n.eventsData.data[0])
  if (variant === 'authority') n.eventsData.data[0].package_id = aid(99)
  if (variant === 'entry' || variant === 'operation') { const e = NativePaidUpdatedBcs.parse(n.eventsData.data[0].contents); if (variant === 'entry') e.entry!.scope = '2'; else e.operation = 3; n.eventsData.data[0].contents = NativePaidUpdatedBcs.serialize(e).toBytes() }
  if (variant === 'payment' || variant === 'attempt') { const e = NativeSubscriptionPaidBcs.parse(n.eventsData.data[1].contents); if (variant === 'payment') e.gross = '103'; else e.attempt = new Uint8Array(32).fill(9); n.eventsData.data[1].contents = NativeSubscriptionPaidBcs.serialize(e).toBytes() }
  if (variant === 'eventless') n.eventsData.data = []
  n.rehashEvents()
  if (variant === 'checkpoint') { n.contentsData.V2!.transactions.pop(); n.rehashContents() }
  await expect(readNativePublicReadPaidHistoryV2(x.params)).rejects.toThrow()
})
it('preserves missing/pending original V2 outcomes without fresh payment or invented entry', async () => {
  const x = await historyFixture(); delete x.finality.ledger.checkpoint
  expect(await readNativePublicReadPaidHistoryV2(x.params)).toEqual({ status: 'PENDING' })
  x.finality.client.ledgerService.getTransaction.mockRejectedValue({ code: 'NOT_FOUND' })
  expect(await readNativePublicReadPaidHistoryV2(x.params)).toEqual({ status: 'MISSING' })
})

it('propagates authenticated original failure without reading success business objects', async () => {
  const x = await historyFixture(), n = x.finality
  n.effectsData.V2 = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { ...n.effectsData.V2!, status: { Failure: { error: { InsufficientGas: true }, command: null } }, changedObjects: [], unchangedConsensusObjects: [] } }).toBytes()).V2!
  n.eventsData.data = []; n.rehashEvents()
  x.params.client.ledgerService.getObject = () => { throw Error('SUCCESS_PROOF_MUST_NOT_RUN') }
  expect(await readNativePublicReadPaidHistoryV2(x.params)).toEqual({ status: 'FAILED', checkpoint: '100' })
})
it('rejects the wrong actual chain before accepting V2 receipt evidence', async () => {
  const x = await historyFixture()
  x.finality.client.ledgerService.getServiceInfo.mockResolvedValue({ response: { chainId: 'wrong' } })
  await expect(readNativePublicReadPaidHistoryV2(x.params)).rejects.toThrow('CHAIN_MISMATCH')
})
it('captures original history and object readers before the first asynchronous observation', async () => {
  const x = await historyFixture()
  x.finality.client.ledgerService.getServiceInfo.mockImplementation(async () => {
    x.params.client.ledgerService.getObject = () => { throw Error('REPLACED_OBJECT_READER') }
    x.params.client.ledgerService.getCheckpoint = () => { throw Error('REPLACED_CHECKPOINT_READER') }
    return { response: { chainId: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S' } }
  })
  expect(await readNativePublicReadPaidHistoryV2(x.params)).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', receipt: { notContentDeliveryProof: true } })
})

it('proves original V2 buyer debit, Kiosk-owner payout, platform income and independent gas', async () => {
  expect(await proveNativePublicReadPaidMoneyV2((await fixture('money')).params)).toMatchObject({ format: 'native-public-read-v2', buyerGrossDebit: '104', buyerChange: '896', payout: { owner: aid(70), amount: '101' }, protocolIncome: '3', gas: { netGasCharge: '2' }, notCompleteSubscriptionProof: true, notContentDeliveryProof: true })
})
it.each(['money-income', 'money-debit', 'money-payout', 'money-recipient', 'money-gas', 'money-extra-payout'])('rejects contradictory original V2 money evidence: %s', async variant => {
  await expect(proveNativePublicReadPaidMoneyV2((await fixture(variant)).params)).rejects.toThrow()
})
it('does not increment protocol income or revision for an original zero-fee V2 subscription', async () => {
  expect(await proveNativePublicReadPaidMoneyV2((await fixture('money-zero-fee')).params)).toMatchObject({ buyerGrossDebit: '101', buyerChange: '899', protocolIncome: '0', payout: { amount: '101' } })
})
it('composes original V2 finality/events/Receipt and actual money while leaving protected delivery incomplete', async () => {
  const x = await fixture('money')
  expect(await readNativePublicReadPaidHistoryV2({ ...x.params, packet: { ...x.params.packet, phase: 'SIGNED', signature: 'synthetic' }, proveMoney: true })).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', receipt: { notMoneySettlementProof: false, notContentDeliveryProof: true, requiresOriginalHostLinkPaidPointerAuthAndOfferProof: true, money: { protocolIncome: '3' } } })
})

async function pointerFixture(variant = '', money = false) {
  const x = await fixture(money ? 'money' : ''), h = x.history, p = x.params, hostType = `${aid(40)}::birth::PublicReadHostV2`
  const old = h.base.object(x.host.id, 9, hostType, NativePublicReadHostV2Bcs.serialize(x.host).toBytes(), { Shared: { initialSharedVersion: 1 } }, h.register.digest)
  p.effects.V2!.changedObjects.find(([id]) => id === x.host.id)![1].inputState = { Exist: [['9', old.digest], { Shared: { initialSharedVersion: '1' } }] }
  p.effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(p.effects).toBytes())
  const wrapped = `0x2::dynamic_object_field::Wrapper<${aid(40)}::birth::PaidKey>`, id = deriveDynamicFieldID(x.stateId, wrapped, new Uint8Array([0]))
  const codec = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address })
  const field = h.base.object(id, 9, `0x2::dynamic_field::Field<${wrapped},0x2::object::ID>`, codec.serialize({ id, name: { name: { dummy_field: false } }, value: variant === 'value' ? aid(99) : p.ledgerId }).toBytes(), { ObjectOwner: variant === 'owner' ? x.host.id : x.stateId }, h.register.digest)
  h.base.object(id, 11, `0x2::dynamic_field::Field<${wrapped},0x2::object::ID>`, codec.serialize({ id, name: { name: { dummy_field: false } }, value: aid(99) }).toBytes(), { ObjectOwner: x.stateId }, adigest(99))
  const ancestor = h.base.effects(h.register.digest, 9, [h.base.change(old, true), ...(variant === 'missing' ? [] : [h.base.change(field, true)])])
  h.ledgers.get(h.register.digest)!.effects = ancestor
  Object.assign(p.client.ledgerService, { getServiceInfo: h.transport.ledgerService.getServiceInfo, getTransaction: h.transport.ledgerService.getTransaction, getCheckpoint: h.transport.ledgerService.getCheckpoint })
  if (variant === 'changed') p.effects.V2!.changedObjects.push(h.base.change(field, true))
  return { ...x, run: () => proveNativePublicReadPaidPointerHistoryV2({ ...p, checkpoint: '2' }) }
}
it('authenticates original Paid pointer through actual Shared Host embedded State without standalone State RPC', async () => {
  const x = await pointerFixture(), proof = await x.run()
  expect(proof).toMatchObject({ stateId: x.stateId, ledgerId: x.params.ledgerId, requiresQualifiedHostParentCommitInvariant: true, notContentDeliveryProof: true })
  expect(proof.trail).toHaveLength(1)
})
it.each([['value', 'PUBLIC_PAID_V2_POINTER_VALUE'], ['owner', 'CHILD_PARENT'], ['missing', 'CHILD_NOT_FOUND_AT_ROOT_CREATION'], ['changed', 'PUBLIC_PAID_V2_POINTER_CHANGED']])('rejects original V2 Paid pointer %s without live fallback', async (variant, code) => {
  await expect((await pointerFixture(variant)).run()).rejects.toThrow(code)
})
it('rejects pointer ancestry after the authenticated checkpoint bound', async () => {
 const x = await pointerFixture(); x.history.ledgers.get(x.history.register.digest)!.checkpoint = 3n
 await expect(x.run()).rejects.toThrow('TRANSACTION_CHECKPOINT')
})
it('requires original ancestor raw transaction history', async () => {
 const x = await pointerFixture(); x.history.ledgers.clear()
 await expect(x.run()).rejects.toThrow('MISSING')
})

async function pointerHistoryFixture(variant = '', money = false) {
 const x = await pointerFixture(variant, money), n = x.finality, h = x.history
 n.effectsData.V2 = structuredClone(x.params.effects.V2); n.rehashTransaction()
 const originalGet = n.client.ledgerService.getTransaction.bind(n.client.ledgerService)
 const originalCheckpoint = n.client.ledgerService.getCheckpoint.bind(n.client.ledgerService)
 Object.assign(x.params.client.ledgerService, {
  getTransaction: (r: any, o: any) => r.digest === x.params.packet.digest ? originalGet(r, o) : h.transport.ledgerService.getTransaction(r),
  getCheckpoint: (r: any, o: any) => r.checkpointId.sequenceNumber === n.checkpoint.sequenceNumber ? originalCheckpoint(r, o) : h.transport.ledgerService.getCheckpoint(r),
 })
 return { ...x, runHistory: () => readNativePublicReadPaidHistoryV2({ ...x.params, packet: { ...x.params.packet, phase: 'SIGNED', signature: 'synthetic' }, proveMoney: money, provePaidPointer: true }) }
}
it('composes finalized original Paid pointer with receipt/events and money while keeping subscription partial', async () => {
 const x = await pointerHistoryFixture('', true), result = await x.runHistory()
 expect(result).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', receipt: { requiresOriginalPaidPointerProof: false, requiresOriginalHostLinkPaidPointerAuthAndOfferProof: true, notMoneySettlementProof: false, notContentDeliveryProof: true, paidPointer: { ledgerId: x.params.ledgerId, requiresQualifiedHostParentCommitInvariant: true }, money: { buyerGrossDebit: '104' } } })
})
it.each([['value','PUBLIC_PAID_V2_POINTER_VALUE'],['missing','CHILD_NOT_FOUND_AT_ROOT_CREATION'],['owner','CHILD_PARENT']])('propagates original pointer %s contradiction through finalized history', async (variant, code) => {
 await expect((await pointerHistoryFixture(variant)).runHistory()).rejects.toThrow(code)
})

async function offerHistoryFixture(variant = '') {
 const x = await pointerHistoryFixture('', true), h = x.history, p = x.params
 const ledgerType = `${aid(42)}::paid_access::Ledger`, original = h.rows.get(`${p.ledgerId}:9`)!
 const ledger = NativeInitialPaidBcs.parse(original.contents.value)
 const ownerId = deriveDynamicFieldID(x.stateId, `0x2::dynamic_object_field::Wrapper<${aid(40)}::birth::PaidKey>`, new Uint8Array([0]))
 const old = h.base.object(p.ledgerId, 9, ledgerType, NativeInitialPaidBcs.serialize(ledger).toBytes(), { ObjectOwner: ownerId }, h.register.digest)
 p.effects.V2!.changedObjects.find(([id]) => id === p.ledgerId)![1].inputState = { Exist: [['9', old.digest], { ObjectOwner: ownerId }] }
 p.effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(p.effects).toBytes())
 const id = deriveDynamicFieldID(ledger.offers.id, 'u32', bcs.u32().serialize(p.intent.kind).toBytes()), type = `0x2::dynamic_field::Field<u32,${aid(42)}::paid_access::Offer>`
 const field = h.base.object(id, 9, type, NativePublicReadPaidOfferFieldV2Bcs.serialize({ id, name: variant === 'key' ? 2 : p.intent.kind, value: { ...p.offer, price: variant === 'price' ? '102' : p.offer.price, generation: variant === 'generation' ? '1' : p.offer.generation, scope: variant === 'scope' ? '2' : p.offer.scope } }).toBytes(), { ObjectOwner: variant === 'owner' ? p.ledgerId : ledger.offers.id }, h.register.digest)
 const ancestor = h.ledgers.get(h.register.digest)!.effects
 ancestor.V2!.changedObjects.push(h.base.change(old, true), ...(variant === 'missing' ? [] : [h.base.change(field, true)]))
 h.ledgers.get(h.register.digest)!.effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(ancestor).toBytes())
 h.base.object(id, 11, type, NativePublicReadPaidOfferFieldV2Bcs.serialize({ id, name: p.intent.kind, value: { ...p.offer, price: '999' } }).toBytes(), { ObjectOwner: ledger.offers.id }, adigest(99))
 if (variant === 'changed') p.effects.V2!.changedObjects.push(h.base.change(field, true))
 x.finality.effectsData.V2 = structuredClone(p.effects.V2); x.finality.rehashTransaction()
 return { ...x, runOffer: () => proveNativePublicReadPaidOfferHistoryV2({ ...p, checkpoint: '100' }), runAll: () => readNativePublicReadPaidHistoryV2({ ...p, packet: { ...p.packet, phase: 'SIGNED', signature: 'synthetic' }, proveMoney: true, provePaidPointer: true, proveOffer: true }) }
}
it('reads the original V2 Offer through owned Ledger offers Table despite a later changed price', async () => {
 const x = await offerHistoryFixture(), proof = await x.runOffer()
 expect(proof).toMatchObject({ format: 'native-public-read-v2', ledgerId: x.params.ledgerId, offer: x.params.offer, requiresQualifiedParentCommitInvariant: true, requiresOriginalLedgerTreeMembership: true, notCurrentOffer: true })
 expect(proof.trail).toHaveLength(1)
})
it.each([['price','PUBLIC_PAID_V2_OFFER_HISTORY_FIELD'],['generation','PUBLIC_PAID_V2_OFFER_HISTORY_FIELD'],['scope','PUBLIC_PAID_V2_OFFER_HISTORY_FIELD'],['key','PUBLIC_PAID_V2_OFFER_HISTORY_FIELD'],['owner','CHILD_OWNER'],['missing','CHILD_MISSING_AT_CREATION'],['changed','PUBLIC_PAID_V2_OFFER_HISTORY_CHANGED_DURING_BUY']])('rejects original V2 Offer %s evidence', async (variant, code) => {
 await expect((await offerHistoryFixture(variant)).runOffer()).rejects.toThrow(code)
})
it('composes original Offer and Paid pointer with actual money and finalized events without asserting delivery', async () => {
 expect(await (await offerHistoryFixture()).runAll()).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', receipt: { requiresOriginalOfferProof: false, requiresOriginalPaidPointerProof: false, notMoneySettlementProof: false, notContentDeliveryProof: true, requiresOriginalHostLinkPaidPointerAuthAndOfferProof: true, offerHistory: { requiresQualifiedParentCommitInvariant: true, requiresOriginalLedgerTreeMembership: true } } })
})
it('propagates contradictory original Offer into composed recovery', async () => {
 await expect((await offerHistoryFixture('price')).runAll()).rejects.toThrow('PUBLIC_PAID_V2_OFFER_HISTORY_FIELD')
})

async function custodyHistoryFixture(variant = '') {
 const x = await offerHistoryFixture(), p = x.params, h = x.history, kioskId = p.intent.kiosk.objectId
 const original = h.rows.get(`${kioskId}:9`)!, body = SoulPublicKioskBcs.parse(original.contents.value)
 if (variant === 'extensions') body.allow_extensions = true
 const kiosk = h.base.object(kioskId, 9, '0x2::kiosk::Kiosk', SoulPublicKioskBcs.serialize(body).toBytes(), { Shared: { initialSharedVersion: 1 } }, h.register.digest)
 const readonly = p.effects.V2!.unchangedConsensusObjects.find(([id]) => id === kioskId)!
 readonly[1] = { ReadOnlyRoot: ['9', kiosk.digest] }
 const itemId = deriveKioskItemFieldId(kioskId, p.soulId), lockId = deriveDynamicFieldID(kioskId, '0x2::kiosk::Lock', bcs.Address.serialize(p.soulId).toBytes())
 const lockCodec = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Lock', { id: bcs.Address }), value: bcs.bool() })
 const item = h.base.object(itemId, 9, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs.serialize({ id: itemId, name: { name: { id: variant === 'item-key' ? aid(99) : p.soulId } }, value: variant === 'item-value' ? aid(99) : p.soulId }).toBytes(), { ObjectOwner: variant === 'item-owner' ? aid(99) : kioskId }, h.register.digest)
 const lock = h.base.object(lockId, 9, '0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>', lockCodec.serialize({ id: lockId, name: { id: variant === 'lock-key' ? aid(99) : p.soulId }, value: variant !== 'lock-false' }).toBytes(), { ObjectOwner: variant === 'lock-owner' ? aid(99) : kioskId }, h.register.digest)
 const ancestor = h.ledgers.get(h.register.digest)!.effects
 ancestor.V2!.changedObjects.push(h.base.change(kiosk, true), ...(variant === 'item-missing' ? [] : [h.base.change(item, true)]), ...(variant === 'lock-missing' ? [] : [h.base.change(lock, true)]))
 h.ledgers.get(h.register.digest)!.effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(ancestor).toBytes())
 if (variant === 'item-changed' || variant === 'lock-changed') p.effects.V2!.changedObjects.push(h.base.change(variant === 'item-changed' ? item : lock, true))
 p.effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(p.effects).toBytes())
 h.base.object(lockId, 11, '0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>', lockCodec.serialize({ id: lockId, name: { id: p.soulId }, value: false }).toBytes(), { ObjectOwner: kioskId }, adigest(99))
 x.finality.effectsData.V2 = structuredClone(p.effects.V2); x.finality.rehashTransaction()
 return { ...x, runCustody: () => proveNativePublicReadPaidCustodyHistoryV2({ ...p, checkpoint: '100' }), runEverything: () => readNativePublicReadPaidHistoryV2({ ...p, packet: { ...p.packet, phase: 'SIGNED', signature: 'synthetic' }, proveMoney: true, provePaidPointer: true, proveOffer: true, proveCustody: true }) }
}
it('authenticates original readonly Kiosk Item/Lock and ignores a later unlocked value', async () => {
 const x = await custodyHistoryFixture(), proof = await x.runCustody()
 expect(proof).toMatchObject({ format: 'native-public-read-v2', kioskId: x.params.intent.kiosk.objectId, soulId: x.params.soulId, requiresOriginalSoulTypeOwnerAndHostLinkProof: true, notCurrentCustody: true })
 expect(proof.itemTrail).toHaveLength(1); expect(proof.lockTrail).toHaveLength(1)
})
it('does not import the V1 extensions-disabled requirement into V2 custody', async () => {
 await expect((await custodyHistoryFixture('extensions')).runCustody()).resolves.toMatchObject({ notContentDeliveryProof: true })
})
it.each(['item-key','item-value','item-owner','item-missing','lock-key','lock-false','lock-owner','lock-missing','item-changed','lock-changed'])('rejects contradictory original readonly Kiosk %s', async variant => {
 await expect((await custodyHistoryFixture(variant)).runCustody()).rejects.toThrow()
})
it('composes original Kiosk custody with Offer/Paid pointer/money/events while preserving actual Soul/Link/delivery gaps', async () => {
 expect(await (await custodyHistoryFixture()).runEverything()).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', receipt: { requiresOriginalKioskItemLockProof: false, requiresOriginalOfferProof: false, requiresOriginalPaidPointerProof: false, notMoneySettlementProof: false, notContentDeliveryProof: true, kioskCustody: { requiresOriginalSoulTypeOwnerAndHostLinkProof: true } } })
})
it('propagates original missing Lock into composed recovery', async () => {
 await expect((await custodyHistoryFixture('lock-missing')).runEverything()).rejects.toThrow('CHILD_NOT_FOUND_AT_ROOT_CREATION')
})

async function authorizationFixture(variant = '') {
 const x = await custodyHistoryFixture(), p = x.params, h = x.history, authorizationId = aid(95)
 const wrapped = `0x2::dynamic_object_field::Wrapper<${aid(40)}::birth::AuthorizationKey>`, id = deriveDynamicFieldID(x.stateId, wrapped, new Uint8Array([0]))
 const codec = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address })
 const pointer = h.base.object(id, 9, `0x2::dynamic_field::Field<${wrapped},0x2::object::ID>`, codec.serialize({ id, name: { name: { dummy_field: false } }, value: variant === 'pointer' ? aid(99) : authorizationId }).toBytes(), { ObjectOwner: x.stateId }, h.register.digest)
 const auth = { id: authorizationId, root: p.soulId, controller: { root: p.soulId, parent: variant === 'controller' ? aid(99) : x.stateId, operator: { name: `${aid(40)}::birth::ContentOperator` } }, generation: variant === 'generation' ? '1' : '2', capacity: '3', count: variant === 'count' ? '4' : '1', next_sequence: '1', grants: { id: variant === 'grants-alias' ? x.stateId : aid(96), size: variant === 'grants-count' ? '0' : variant === 'old-grants' ? '2' : '1' } }
 const target = h.base.object(authorizationId, 9, `${aid(42)}::authorization::Authorization`, NativeInitialAuthorizationBcs.serialize(auth).toBytes(), { ObjectOwner: variant === 'owner' ? x.stateId : id }, h.register.digest)
 const ancestor = h.ledgers.get(h.register.digest)!.effects
 ancestor.V2!.changedObjects.push(h.base.change(pointer, true), ...(variant === 'missing' ? [] : [h.base.change(target, true)]))
 h.ledgers.get(h.register.digest)!.effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(ancestor).toBytes())
 h.base.object(authorizationId, 11, `${aid(42)}::authorization::Authorization`, NativeInitialAuthorizationBcs.serialize({ ...auth, generation: '99' }).toBytes(), { ObjectOwner: id }, adigest(99))
 if (variant === 'changed') p.effects.V2!.changedObjects.push(h.base.change(target, true))
 x.finality.effectsData.V2 = structuredClone(p.effects.V2); x.finality.rehashTransaction()
 return { ...x, runAuth: () => proveNativePublicReadPaidAuthorizationHistoryV2({ ...p, checkpoint: '100', authorizationId }), runAuthorizationHistory: () => readNativePublicReadPaidHistoryV2({ ...p, packet: { ...p.packet, phase: 'SIGNED', signature: 'synthetic' }, proveMoney: true, provePaidPointer: true, proveOffer: true, proveCustody: true, proveAuthorization: { authorizationId } }) }
}
it('proves actual original Authorization generation through Host embedded State and typed DOF branch despite later generation', async () => {
 const x = await authorizationFixture()
 expect(await x.runAuth()).toMatchObject({ generation: '2', hostId: x.params.intent.host.objectId, stateId: x.stateId, requiresQualifiedHostParentCommitInvariant: true, requiresSharedHelperIndependentReview: true, notCurrentAuthorization: true, notContentDeliveryProof: true })
})
it.each(['pointer','controller','generation','count','grants-count','grants-alias','owner','missing','changed'])('rejects contradictory original Authorization %s', async variant => {
 await expect((await authorizationFixture(variant)).runAuth()).rejects.toThrow()
})

it('accepts retained old-generation grants beyond the current generation physical count', async () => {
 expect(await (await authorizationFixture('old-grants')).runAuth()).toMatchObject({ generation: '2', requiresSharedHelperIndependentReview: true })
})
it('composes original candidate Authorization generation without clearing helper/source/delivery qualification', async () => {
 expect(await (await authorizationFixture()).runAuthorizationHistory()).toMatchObject({ status: 'SUBSCRIPTION_RECORDED', receipt: { requiresOriginalAuthorizationHistoryProof: false, notContentDeliveryProof: true, requiresOriginalHostLinkPaidPointerAuthAndOfferProof: true, authorizationHistory: { generation: '2', requiresSharedHelperIndependentReview: true, requiresQualifiedHostParentCommitInvariant: true } } })
})
it('propagates original generation mismatch through composed history without current fallback', async () => {
 await expect((await authorizationFixture('generation')).runAuthorizationHistory()).rejects.toThrow('PUBLIC_PAID_V2_AUTH_VALUE')
})

async function soulHistoryFixture(variant = '') {
 const x = await authorizationFixture(), p = x.params, h = x.history, itemId = deriveKioskItemFieldId(p.intent.kiosk.objectId,p.soulId)
 const link = { id: aid(97), root: p.soulId, host: variant === 'link-host' ? aid(99) : p.intent.host.objectId }, linkBytes = NativePublicReadLinkV2Bcs.serialize(link).toBytes()
 const descriptor = { namespace:{name:`${aid(40)}::birth::NativeModule`}, name:new TextEncoder().encode('native'), value_type:{name:`${aid(40)}::birth::PublicReadLinkV2`}, object:link.id, schema:variant==='schema'?1:2, removable:variant==='removable',body_hash:variant==='body'?new Uint8Array(32):sha3_256(linkBytes),semantic_hash:variant==='semantic'?new Uint8Array(32):sha256(linkBytes) }
 const soul = {id:p.soulId,schema:1,name:'Original Soul',revision:'9',origin:{producer:{name:`${aid(40)}::registry::SoulProducer`},source_type:{name:`${aid(40)}::registry::Registry`},source:variant==='registry'?aid(99):p.intent.registry.objectId,source_version:'2',source_hash:new Uint8Array(32),minted_by:variant==='creator'?aid(99):x.host.state.creator},modules:variant==='duplicate'?[descriptor,descriptor]:[descriptor],editing:variant==='editing'}
 const target=h.base.object(p.soulId,9,`${aid(46)}::soul::Soul`,CanonicalSoulBcs.serialize(soul).toBytes(),{ObjectOwner:variant==='owner'?p.intent.kiosk.objectId:itemId},h.register.digest)
 const ancestor=h.ledgers.get(h.register.digest)!.effects
 if(variant!=='missing')ancestor.V2!.changedObjects.push(h.base.change(target,true))
 h.ledgers.get(h.register.digest)!.effects=bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(ancestor).toBytes())
 h.base.object(p.soulId,11,`${aid(46)}::soul::Soul`,CanonicalSoulBcs.serialize({...soul,revision:'99',name:'Later Soul'}).toBytes(),{ObjectOwner:itemId},adigest(99))
 if(variant==='changed')p.effects.V2!.changedObjects.push(h.base.change(target,true))
 x.finality.effectsData.V2=structuredClone(p.effects.V2);x.finality.rehashTransaction()
 return {...x,linkBytes,runSoul:()=>proveNativePublicReadPaidSoulHistoryV2({...p,checkpoint:'100',standard:x.standard,linkBytes}),runCompleteHistory:()=>readNativePublicReadPaidHistoryV2({...p,packet:{...p.packet,phase:'SIGNED',signature:'synthetic'},proveSoul:{standard:x.standard,linkBytes},proveAuthorization:{authorizationId:aid(95)},proveMoney:true,provePaidPointer:true,proveOffer:true,proveCustody:true})}
}
it('authenticates original Standard Soul type and Item owner plus schema2 Link commitment without using later Soul revision',async()=>{
 const x=await soulHistoryFixture(),proof=await x.runSoul()
 expect(proof).toMatchObject({soulId:x.params.soulId,soulRevision:'9',hostId:x.params.intent.host.objectId,requiresOriginalModulePointerAndLinkOwnershipProof:true,requiresSharedHelperIndependentReview:true,requiresQualifiedKioskParentCommitInvariant:true,notContentDeliveryProof:true})
})
it.each(['link-host','schema','removable','body','semantic','registry','creator','duplicate','editing','owner','missing','changed'])('rejects contradictory original Soul or committed Link %s',async variant=>{
 await expect((await soulHistoryFixture(variant)).runSoul()).rejects.toThrow()
})
it('composes original Soul, Auth, Item/Lock, Offer, Paid pointer, money and events while preserving Link ownership/source/delivery requirements',async()=>{
 expect(await(await soulHistoryFixture()).runCompleteHistory()).toMatchObject({status:'SUBSCRIPTION_RECORDED',receipt:{requiresOriginalSoulHistoryProof:false,requiresOriginalAuthorizationHistoryProof:false,notContentDeliveryProof:true,soulHistory:{soulRevision:'9',requiresOriginalModulePointerAndLinkOwnershipProof:true,requiresSharedHelperIndependentReview:true}}})
})
it('propagates wrong original Soul owner through finalized history',async()=>{
 await expect((await soulHistoryFixture('owner')).runCompleteHistory()).rejects.toThrow('TARGET_OWNER')
})

it('captures original Auth RPC methods before the first receipt await even if the source client is replaced mid-read',async()=>{
 const x=await authorizationFixture(),source=x.params.client.ledgerService,read=source.getObject.bind(source)
 let replaced=false
 source.getObject=async(r:any,o:any)=>{if(!replaced){replaced=true;await Promise.resolve();source.getObject=()=>{throw Error('REPLACED_AUTH_RPC')}}return read(r,o)}
 expect(await x.runAuth()).toMatchObject({generation:'2',requiresSharedHelperIndependentReview:true});expect(replaced).toBe(true)
})
it('captures original Soul RPC methods before the first receipt await even if the source client is replaced mid-read',async()=>{
 const x=await soulHistoryFixture(),source=x.params.client.ledgerService,read=source.getObject.bind(source)
 let replaced=false
 source.getObject=async(r:any,o:any)=>{if(!replaced){replaced=true;await Promise.resolve();source.getObject=()=>{throw Error('REPLACED_SOUL_RPC')}}return read(r,o)}
 expect(await x.runSoul()).toMatchObject({soulRevision:'9',requiresSharedHelperIndependentReview:true});expect(replaced).toBe(true)
})

it.each(['receipt','money','pointer','offer','custody'])('captures standalone original V2 %s capabilities before the first await',async kind=>{
 const x=kind==='pointer'?await pointerFixture():kind==='offer'?await offerHistoryFixture():kind==='custody'?await custodyHistoryFixture():await fixture(kind==='money'?'money':'')
 const source=x.params.client.ledgerService,read=source.getObject.bind(source);let replaced=false
 source.getObject=async(r:any,o:any)=>{if(!replaced){replaced=true;await Promise.resolve();for(const method of ['getObject','getServiceInfo','getTransaction','getCheckpoint'])source[method]=()=>{throw Error('REPLACED_STANDALONE_RPC')}}return read(r,o)}
 const proof=kind==='receipt'?await proveNativePublicReadPaidReceiptV2(x.params):kind==='money'?await proveNativePublicReadPaidMoneyV2(x.params):kind==='pointer'?await proveNativePublicReadPaidPointerHistoryV2({...x.params,checkpoint:'100'}):kind==='offer'?await proveNativePublicReadPaidOfferHistoryV2({...x.params,checkpoint:'100'}):await proveNativePublicReadPaidCustodyHistoryV2({...x.params,checkpoint:'100'})
 expect(proof).toMatchObject({format:'native-public-read-v2',notContentDeliveryProof:true});expect(replaced).toBe(true)
})

async function modulePointerFixture(variant=''){
 const x=await soulHistoryFixture(),p=x.params,h=x.history,linkId=aid(97)
 const wrapper=`0x2::dynamic_object_field::Wrapper<${aid(46)}::soul::ModuleKey<${aid(40)}::birth::NativeModule>>`,name=new TextEncoder().encode('native')
 const id=deriveDynamicFieldID(p.soulId,wrapper,bcs.byteVector().serialize(name).toBytes()),codec=bcs.struct('Field',{id:bcs.Address,name:bcs.struct('Wrapper',{name:bcs.struct('ModuleKey',{name:bcs.byteVector()})}),value:bcs.Address})
 const pointer=h.base.object(id,9,`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`,codec.serialize({id,name:{name:{name:variant==='key'?new TextEncoder().encode('wrong'):name}},value:variant==='value'?aid(99):linkId}).toBytes(),{ObjectOwner:variant==='owner'?p.intent.kiosk.objectId:p.soulId},h.register.digest)
 const ancestor=h.ledgers.get(h.register.digest)!.effects
 if(variant!=='missing')ancestor.V2!.changedObjects.push(h.base.change(pointer,true))
 h.ledgers.get(h.register.digest)!.effects=bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(ancestor).toBytes())
 h.base.object(id,11,`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`,codec.serialize({id,name:{name:{name}},value:aid(99)}).toBytes(),{ObjectOwner:p.soulId},adigest(99))
 if(variant==='changed')p.effects.V2!.changedObjects.push(h.base.change(pointer,true))
 if(variant==='link-changed'){const row=h.base.object(linkId,10,`${aid(40)}::birth::PublicReadLinkV2`,x.linkBytes,{ObjectOwner:id},p.packet.digest);p.effects.V2!.changedObjects.push(h.base.change(row,true))}
 x.finality.effectsData.V2=structuredClone(p.effects.V2);x.finality.rehashTransaction()
 return {...x,runPointer:()=>proveNativePublicReadPaidModulePointerHistoryV2({...p,checkpoint:'100',standard:x.standard,linkBytes:x.linkBytes}),runModuleHistory:()=>readNativePublicReadPaidHistoryV2({...p,packet:{...p.packet,phase:'SIGNED',signature:'synthetic'},proveModulePointer:{standard:x.standard,linkBytes:x.linkBytes}})}
}
it('authenticates original ModuleKey pointer at the exact original Soul snapshot despite later pointer value',async()=>{
 const x=await modulePointerFixture(),proof=await x.runPointer()
 expect(proof).toMatchObject({soulId:x.params.soulId,linkId:aid(97),soulReference:{version:9n},requiresOriginalLinkObjectOwnershipProof:true,requiresQualifiedSoulParentCommitInvariant:true,notContentDeliveryProof:true})
 expect(proof.trail).toHaveLength(1)
})
it.each(['key','value','owner','missing','changed','link-changed'])('rejects original ModuleKey pointer %s',async variant=>{
 await expect((await modulePointerFixture(variant)).runPointer()).rejects.toThrow()
})
it('composes original ModuleKey pointer while keeping Link object owner and delivery unproved',async()=>{
 expect(await(await modulePointerFixture()).runModuleHistory()).toMatchObject({status:'SUBSCRIPTION_RECORDED',receipt:{requiresOriginalModulePointerHistoryProof:false,notContentDeliveryProof:true,modulePointerHistory:{requiresOriginalLinkObjectOwnershipProof:true}}})
})
it('propagates missing original ModuleKey pointer through finalized recovery',async()=>{
 await expect((await modulePointerFixture('missing')).runModuleHistory()).rejects.toThrow('CHILD_MISSING_AT_CREATION')
})
it('captures original ModuleKey history capabilities before the first await',async()=>{
 const x=await modulePointerFixture(),source=x.params.client.ledgerService,read=source.getObject.bind(source);let replaced=false
 source.getObject=async(r:any,o:any)=>{if(!replaced){replaced=true;await Promise.resolve();for(const method of ['getObject','getServiceInfo','getTransaction','getCheckpoint'])source[method]=()=>{throw Error('REPLACED_MODULE_RPC')}}return read(r,o)}
 expect(await x.runPointer()).toMatchObject({linkId:aid(97),requiresOriginalLinkObjectOwnershipProof:true});expect(replaced).toBe(true)
})

it('refuses to carry original ModuleKey proof across a Soul Item-owner rebinding',async()=>{
 const x=await modulePointerFixture(),p=x.params,h=x.history,entry=h.ledgers.get(h.register.digest)!,current=h.rows.get(`${p.soulId}:9`)!
 const old=h.base.object(p.soulId,8,`${aid(46)}::soul::Soul`,new Uint8Array(current.contents.value),{ObjectOwner:aid(999)},adigest(99))
 const at=entry.effects.V2!.changedObjects.findIndex(([id])=>id===p.soulId)
 entry.effects.V2!.changedObjects[at]=h.base.change(current,false,old,{ObjectOwner:aid(999)})
 entry.effects=bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(entry.effects).toBytes())
 await expect(x.runPointer()).rejects.toThrow('INPUT_OWNER_REBOUND')
})
it('always inventories original V2 effects in finalized money recovery without claiming complete delivery',async()=>{
 const x=await fixture('money'),result=await readNativePublicReadPaidHistoryV2({...x.params,packet:{...x.params.packet,phase:'SIGNED',signature:'synthetic'},proveMoney:true})
 expect(result).toMatchObject({status:'SUBSCRIPTION_RECORDED',receipt:{effectsInventory:{format:'native-public-read-v2',status:'INCOMPLETE_SUBPROOFS',unclaimedEffectIds:[],unexplainedConsensusIds:[],notCompleteSubscriptionProof:true,notContentDeliveryProof:true}}})
})
it('exposes extra authenticated original effects instead of hiding them behind successful receipt/money proofs',async()=>{
 const x=await fixture('money'),row=x.finality.effectsData.V2!
 row.changedObjects.push([aid(999),{inputState:{NotExist:true},outputState:{NotExist:true},idOperation:{Deleted:true}}] as any);x.finality.rehashTransaction()
 const result=await readNativePublicReadPaidHistoryV2({...x.params,packet:{...x.params.packet,phase:'SIGNED',signature:'synthetic'},proveMoney:true})
 expect(result).toMatchObject({status:'SUBSCRIPTION_RECORDED',receipt:{effectsInventory:{status:'UNEXPLAINED_EFFECTS',unclaimedEffectIds:[aid(999)],notContentDeliveryProof:true}}})
})

async function linkHistoryFixture(variant=''){
 const x=await modulePointerFixture(),p=x.params,h=x.history,linkId=aid(97),wrapper=`0x2::dynamic_object_field::Wrapper<${aid(46)}::soul::ModuleKey<${aid(40)}::birth::NativeModule>>`,moduleId=deriveDynamicFieldID(p.soulId,wrapper,bcs.byteVector().serialize(new TextEncoder().encode('native')).toBytes())
 const bytes=variant==='host'?NativePublicReadLinkV2Bcs.serialize({id:linkId,root:p.soulId,host:aid(99)}).toBytes():x.linkBytes
 const target=h.base.object(linkId,9,`${aid(40)}::birth::PublicReadLinkV2`,bytes,{ObjectOwner:variant==='owner'?p.soulId:moduleId},h.register.digest),ancestor=h.ledgers.get(h.register.digest)!
 if(variant!=='missing')ancestor.effects.V2!.changedObjects.push(h.base.change(target,true))
 ancestor.effects=bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(ancestor.effects).toBytes())
 h.base.object(linkId,11,`${aid(40)}::birth::PublicReadLinkV2`,NativePublicReadLinkV2Bcs.serialize({id:linkId,root:p.soulId,host:aid(99)}).toBytes(),{ObjectOwner:moduleId},adigest(99))
 if(variant==='changed')p.effects.V2!.changedObjects.push(h.base.change(target,true))
 x.finality.effectsData.V2=structuredClone(p.effects.V2);x.finality.rehashTransaction()
 return {...x,runLink:()=>proveNativePublicReadPaidLinkHistoryV2({...p,checkpoint:'100',standard:x.standard,linkBytes:x.linkBytes}),runLinkHistory:()=>readNativePublicReadPaidHistoryV2({...p,packet:{...p.packet,phase:'SIGNED',signature:'synthetic'},proveMoney:true,proveLink:{standard:x.standard,linkBytes:x.linkBytes}})}
}
it('authenticates actual original Link owner through Soul and typed ModuleKey rather than inferring from hash preimage',async()=>{
 const x=await linkHistoryFixture();expect(await x.runLink()).toMatchObject({linkId:aid(97),hostId:x.params.intent.host.objectId,reference:{version:9n},requiresQualifiedSoulAndKioskParentCommitInvariants:true,requiresSharedHelperIndependentReview:true,notCurrentLink:true,notContentDeliveryProof:true})
})
it.each(['owner','missing','host','changed'])('rejects original Link %s without current fallback',async variant=>{
 await expect((await linkHistoryFixture(variant)).runLink()).rejects.toThrow()
})
it('captures original Link history capabilities before first await',async()=>{
 const x=await linkHistoryFixture(),source=x.params.client.ledgerService,read=source.getObject.bind(source);let replaced=false
 source.getObject=async(r:any,o:any)=>{if(!replaced){replaced=true;await Promise.resolve();for(const method of ['getObject','getServiceInfo','getTransaction','getCheckpoint'])source[method]=()=>{throw Error('REPLACED_LINK_RPC')}}return read(r,o)}
 expect(await x.runLink()).toMatchObject({linkId:aid(97),notContentDeliveryProof:true});expect(replaced).toBe(true)
})

it('composes actual original Link owner history while preserving source/root-commit and delivery qualification',async()=>{
 const result=await(await linkHistoryFixture()).runLinkHistory()
 expect(result).toMatchObject({status:'SUBSCRIPTION_RECORDED',receipt:{requiresOriginalLinkObjectHistoryProof:false,notContentDeliveryProof:true,linkHistory:{linkId:aid(97),requiresQualifiedSoulAndKioskParentCommitInvariants:true,requiresSharedHelperIndependentReview:true},effectsInventory:{status:'INCOMPLETE_SUBPROOFS',missingSubproofs:expect.arrayContaining(['qualifiedSharedAndOwnedParentCommitInvariants','originalSourceAndPhysicalEconomics','completeOriginalRecordAndProtectedDelivery'])}}})
 if(result.status==='SUBSCRIPTION_RECORDED')expect(result.receipt.effectsInventory.missingSubproofs).not.toContain('originalLinkObjectOwnership')
})
it('propagates original Link owner mismatch through finalized recovery',async()=>{
 await expect((await linkHistoryFixture('owner')).runLinkHistory()).rejects.toThrow('TARGET_OWNER')
})

async function checkedSimulationFixture(variant=''){
 const x=await fixture(variant.startsWith('money-')?variant:'money'),p=x.params,n=x.finality
 const registry=x.history.base.object(p.intent.registry.objectId,9,`${aid(40)}::registry::Registry`,bcs.Address.serialize(p.intent.registry.objectId).toBytes(),{Shared:{initialSharedVersion:1}},adigest(1))
 n.effectsData.V2!.unchangedConsensusObjects.push([registry.objectId,{$kind:'ReadOnlyRoot',ReadOnlyRoot:['9',registry.digest]}])
 const Events=bcs.vector(bcs.struct('Event',{package_id:bcs.Address,transaction_module:bcs.string(),sender:bcs.Address,type_:bcs.StructTag,contents:bcs.byteVector()}))
 const simulation:any={digest:p.packet.digest,transaction:{digest:p.packet.digest,bcs:{value:(await import('@mysten/sui/utils')).fromBase64(p.packet.bytes)}},effects:{bcs:{value:bcs.TransactionEffects.serialize(n.effectsData).toBytes()},transactionDigest:p.packet.digest,status:{success:true}},events:{bcs:{value:Events.serialize(n.eventsData.data).toBytes()}},signatures:[],objects:{objects:[...x.history.rows.values()].map(row=>structuredClone(row))}}
 if(variant==='echo')simulation.transaction.bcs.value[5]^=1
 if(variant==='digest')simulation.digest=adigest(99)
 if(variant==='checkpoint')simulation.checkpoint=1n
 if(variant==='signatures')simulation.signatures=['NOT_A_NEW_UNSIGNED_SIMULATION']
 if(variant==='event-digest')simulation.events.bcs.value[10]^=1
 if(variant==='event-paid'){
  const events=Events.parse(simulation.events.bcs.value),paid=NativeSubscriptionPaidBcs.parse(events[1].contents);paid.gross='105';events[1].contents=NativeSubscriptionPaidBcs.serialize(paid).toBytes();simulation.events.bcs.value=Events.serialize(events).toBytes()
  const e=bcs.TransactionEffects.parse(simulation.effects.bcs.value);e.V2!.eventsDigest=(await import('./fixtures/activity-transaction-evidence')).activityHash('TransactionEvents',simulation.events.bcs.value);simulation.effects.bcs.value=bcs.TransactionEffects.serialize(e).toBytes()
 }
 if(variant==='registry-pool-missing')simulation.objects.objects=simulation.objects.objects.filter((r:any)=>r.objectId!==p.intent.registry.objectId)
 if(variant==='registry-effect-missing'){const e=bcs.TransactionEffects.parse(simulation.effects.bcs.value);e.V2!.unchangedConsensusObjects=e.V2!.unchangedConsensusObjects.filter(([id])=>id!==p.intent.registry.objectId);simulation.effects.bcs.value=bcs.TransactionEffects.serialize(e).toBytes()}
 if(variant==='object-missing')simulation.objects.objects=simulation.objects.objects.filter((r:any)=>r.objectId!==aid(86))
 if(variant==='object-alias')simulation.objects.objects.push(structuredClone(simulation.objects.objects[0]))
 if(variant==='object-raw')simulation.objects.objects.find((r:any)=>r.objectId===aid(86)).bcs.value[10]^=1
 if(variant==='failed'){const e=bcs.TransactionEffects.parse(simulation.effects.bcs.value);e.V2!.status={Failure:{error:{InsufficientGas:true},command:null}};simulation.effects.bcs.value=bcs.TransactionEffects.serialize(e).toBytes();simulation.effects.status.success=false}
 if(variant==='epoch'){const e=bcs.TransactionEffects.parse(simulation.effects.bcs.value);e.V2!.executedEpoch='4';simulation.effects.bcs.value=bcs.TransactionEffects.serialize(e).toBytes()}
 let address=p.intent.buyer,epochCalls=0
 p.client.ledgerService.getEpoch=vi.fn(async()=>({response:{epoch:{epoch:variant==='epoch-advance'&&++epochCalls>1?6n:5n,referenceGasPrice:1n}}}))
 p.client.transactionExecutionService={simulateTransaction:vi.fn(async(request:any)=>{expect(request.checks).toBe(0);expect(request.doGasSelection).toBe(false);expect(toBase64(request.transaction.bcs.value)).toBe(p.packet.bytes);expect(request.readMask.paths).toContain('transaction.objects');if(variant==='wallet')address=aid(999);return {response:{transaction:simulation,commandOutputs:[]}}})}
 const ledgerGet=p.client.ledgerService.getObject.bind(p.client.ledgerService);const ledgerReads:any[]=[]
 p.client.ledgerService.getObject=vi.fn(async(r:any,o:any)=>{ledgerReads.push(r);if(r.version!==undefined)throw Error('NO_SIMULATED_OBJECT_LEDGER_FALLBACK');return ledgerGet(r,o)})
 const input={...p,packet:{...p.packet,phase:'PREPARED' as const,signature:null},getBuyerAddress:()=>address}
 if(variant==='signed'){input.packet.phase='SIGNED' as any;input.packet.signature='old-signature' as any}
 return {...x,input,simulation,ledgerReads,runSimulation:()=>simulateNativePublicReadPaidPurchaseV2(input)}
}
it('checks exact prepared raw packet with enabled simulation and actual simulated Host/Entry/Receipt/Coin/income/Gas/events witnesses without ledger output fallback',async()=>{
 const x=await checkedSimulationFixture(),result=await x.runSimulation()
 expect(result).toMatchObject({checksRequested:'ENABLED',gasReselection:false,simulation:{money:{buyerGrossDebit:'104',payout:{amount:'101'},protocolIncome:'3',gas:{netGasCharge:'2'}},receipt:{entry:{generation:'2'},receipt:{total:'104'},requiresOriginalFinalityAndEvents:true},inventory:{status:'INCOMPLETE_SUBPROOFS'}},notSigningQualification:true,notFinalizedReceipt:true,notContentDelivered:true})
 expect(x.ledgerReads.every(r=>r.version===undefined)).toBe(true)
})
it.each(['echo','digest','checkpoint','signatures','event-digest','event-paid','registry-pool-missing','registry-effect-missing','object-missing','object-alias','object-raw','failed','epoch','epoch-advance','wallet','signed','money-income','money-debit','money-payout','money-gas'])('rejects contradictory full checked simulation: %s',async variant=>{
 const x=await checkedSimulationFixture(variant);await expect(x.runSimulation()).rejects.toThrow()
 if(variant==='signed')expect(x.input.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
})
it('snapshots simulation events and ObjectSet before asynchronous package verification',async()=>{
 const x=await checkedSimulationFixture(),read=x.input.client.ledgerService.getObject.getMockImplementation()!;let replaced=false
 x.input.client.ledgerService.getObject.mockImplementation(async(r:any,o:any)=>{if(!replaced){replaced=true;x.simulation.events.bcs.value.fill(0);x.simulation.objects.objects.length=0}return read(r,o)})
 expect(await x.runSimulation()).toMatchObject({notFinalizedReceipt:true,simulation:{money:{buyerGrossDebit:'104'}}});expect(replaced).toBe(true)
})

async function registryIdentityFixture(variant=''){
 const x=await fixture(),p=x.params,id=p.intent.registry.objectId,row=x.history.base.object(id,9,`${aid(40)}::registry::${variant==='type'?'Wrong':'Registry'}`,bcs.Address.serialize(variant==='id'?aid(999):id).toBytes(),variant==='owner'?{AddressOwner:p.intent.buyer}:{Shared:{initialSharedVersion:variant==='birth'?2:1}},adigest(1))
 if(variant!=='missing')p.effects.V2!.unchangedConsensusObjects.push([id,{$kind:'ReadOnlyRoot',ReadOnlyRoot:['9',variant==='digest'?adigest(999):row.digest]}])
 x.finality.effectsData.V2=structuredClone(p.effects.V2);x.finality.rehashTransaction()
 return {...x,runRegistry:()=>proveNativePublicReadPaidRegistryIdentityV2(p),runRegistryHistory:()=>readNativePublicReadPaidHistoryV2({...p,packet:{...p.packet,phase:'SIGNED',signature:'synthetic'},proveRegistryIdentity:true})}
}
it('verifies typed original Registry readonly identity/birth without claiming authority/source fields',async()=>{
 const x=await registryIdentityFixture();expect(await x.runRegistry()).toMatchObject({registryId:x.params.intent.registry.objectId,reference:{version:9n},observedReadOnlyIds:[x.params.intent.registry.objectId],requiresOriginalRegistrySourceAuthorityAndEconomicFields:true,notAuthorityProof:true,notCurrentSourceQualification:true})
})
it.each(['type','id','owner','birth','missing','digest'])('rejects contradictory original Registry %s',async variant=>{
 await expect((await registryIdentityFixture(variant)).runRegistry()).rejects.toThrow()
})
it('composes optional original Registry identity in finalized recovery while retaining authority and source gaps',async()=>{
 const x=await registryIdentityFixture(),result=await x.runRegistryHistory()
 expect(result).toMatchObject({status:'SUBSCRIPTION_RECORDED',receipt:{requiresOriginalRegistryIdentityProof:false,registryIdentity:{notAuthorityProof:true},effectsInventory:{missingSubproofs:expect.arrayContaining(['originalRegistrySourceAuthorityAndEconomicFields'])}}})
 if(result.status==='SUBSCRIPTION_RECORDED')expect(result.receipt.effectsInventory.unexplainedConsensusIds).not.toContain(x.params.intent.registry.objectId)
})
it('propagates missing original Registry identity when requested instead of falling back to current state',async()=>{
 await expect((await registryIdentityFixture('missing')).runRegistryHistory()).rejects.toThrow('READONLY_ROOT_REQUIRED')
})
it('captures original Registry RPC capability before the first await',async()=>{
 const x=await registryIdentityFixture(),source=x.params.client.ledgerService,read=source.getObject.bind(source);let changed=false
 source.getObject=async(r:any,o:any)=>{if(!changed){changed=true;await Promise.resolve();source.getObject=()=>{throw Error('REPLACED_REGISTRY_RPC')}}return read(r,o)}
 expect(await x.runRegistry()).toMatchObject({notAuthorityProof:true});expect(changed).toBe(true)
})

async function beneficiaryFundsFixture(variant='',buyerOverride?:string,kindOverride=1){
 const x=await fixture('money',buyerOverride,kindOverride),p=x.params,owner=aid(70),viewer=variant==='other'?p.intent.buyer:owner,Coin=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()}),extraId=aid(5500)
 const extra=x.history.base.object(extraId,11,'0x2::coin::Coin<0x2::sui::SUI>',Coin.serialize({id:extraId,balance:500}).toBytes(),{AddressOwner:owner},adigest(99))
 const before=p.client.ledgerService.getObject.bind(p.client.ledgerService),live=(id:string)=>[...x.history.rows.values()].filter((r:any)=>r.objectId===id).sort((a:any,b:any)=>Number(b.version-a.version))[0]
 p.client.ledgerService.getObject=async(r:any,o:any)=>{if(r.version!==undefined||![aid(86),extraId].includes(r.objectId))return before(r,o);if(['payout-missing','payout-missing-grpc'].includes(variant)&&r.objectId===aid(86))throw {code:variant==='payout-missing-grpc'?5:'NOT_FOUND'};if(variant==='rpc'&&r.objectId===aid(86))throw {code:'UNAVAILABLE'};return {response:{object:live(r.objectId)}}}
 p.client.core={getChainIdentifier:vi.fn(async()=>({chainIdentifier:'4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S'})),listOwnedObjects:vi.fn(async()=>({objects:(['payout-missing','payout-missing-grpc'].includes(variant)?[extraId]:[aid(86),extraId]).map(objectId=>({objectId})),hasNextPage:false,cursor:null}))}
 return {...x,viewer,runFunds:()=>readNativePublicReadPaidBeneficiaryFundsV2({...p,packet:{...p.packet,phase:'SIGNED',signature:'synthetic'},viewerAddress:viewer,getViewerAddress:()=>viewer})}
}
it('composes original finalized payout with current beneficiary Coin inventory without calling it current attributed profit or protocol income',async()=>{
 const x=await beneficiaryFundsFixture();expect(await x.runFunds()).toMatchObject({status:'ORIGINAL_PROCEEDS_AND_CURRENT_COIN_OBSERVATIONS',originalProceeds:{beneficiary:aid(70),amount:'101'},inventory:{observedCoinBalance:'601',notRevenueAttribution:true,notTotalWalletBalance:true},notProtocolIncomeWithdrawalAuthority:true,notPermissionToRetryPayment:true,notCompleteContentDelivery:true})
})
it('keeps original proceeds confirmed if the original payout Coin is unavailable after later wallet activity',async()=>{
 expect(await(await beneficiaryFundsFixture('payout-missing')).runFunds()).toMatchObject({status:'ORIGINAL_PROCEEDS_AND_CURRENT_COIN_OBSERVATIONS',originalProceeds:{amount:'101'},payout:{observations:[{status:'UNAVAILABLE'}]},inventory:{observedCoinBalance:'500'},notPermissionToRetryPayment:true})
})
it('does not read current Coin inventory for a different connected beneficiary wallet',async()=>{
 const x=await beneficiaryFundsFixture('other');expect(await x.runFunds()).toMatchObject({status:'OTHER_BENEFICIARY',originalProceeds:{amount:'101'}});expect(x.params.client.core.listOwnedObjects).not.toHaveBeenCalled()
})
it('does not turn transient payout RPC failure into missing/zero revenue or retry permission',async()=>{
 expect(await(await beneficiaryFundsFixture('rpc')).runFunds()).toMatchObject({status:'ORIGINAL_PROCEEDS_CURRENT_READBACK_UNAVAILABLE',originalProceeds:{amount:'101'},currentReadback:{stage:'PAYOUT_COIN',status:'UNAVAILABLE',code:'UNAVAILABLE'},notPermissionToRetryPayment:true})
})

it('recognizes numeric gRPC NOT_FOUND as unavailable current payout Coin while preserving original proceeds',async()=>{
 expect(await(await beneficiaryFundsFixture('payout-missing-grpc')).runFunds()).toMatchObject({originalProceeds:{amount:'101'},payout:{observations:[{status:'UNAVAILABLE'}]},inventory:{observedCoinBalance:'500'},notPermissionToRetryPayment:true})
})
it('keeps verified original proceeds when current inventory enumeration fails',async()=>{
 const x=await beneficiaryFundsFixture();x.params.client.core.listOwnedObjects.mockRejectedValue({code:14})
 expect(await x.runFunds()).toMatchObject({status:'ORIGINAL_PROCEEDS_CURRENT_READBACK_UNAVAILABLE',originalProceeds:{amount:'101'},currentReadback:{stage:'COIN_INVENTORY',status:'UNAVAILABLE',code:14},notProtocolIncomeWithdrawalAuthority:true})
})

it.each(['wallet','abort'])('does not mask %s during current funds recovery as a usable unavailable result',async variant=>{
 const x=await beneficiaryFundsFixture(),controller=new AbortController();let viewer:string|null=x.viewer
 x.params.client.core.listOwnedObjects.mockImplementation(async()=>{if(variant==='wallet')viewer=null;else controller.abort();throw {code:14}})
 await expect(readNativePublicReadPaidBeneficiaryFundsV2({...x.params,signal:controller.signal,packet:{...x.params.packet,phase:'SIGNED',signature:'synthetic'},viewerAddress:x.viewer,getViewerAddress:()=>viewer})).rejects.toBeDefined()
})

async function recoveryDeliveryFixture(buyerOverride?:string,kindOverride=1){
 const {recoverNativePublicReadPaidContentV2}=await import('../../web/lib/soulidity/commerce/native-public-read-paid-recovery-delivery-v2')
 const x=await beneficiaryFundsFixture('',buyerOverride,kindOverride),p=x.params;let address:string|null=p.intent.buyer
 const entry = await proveNativePublicReadPaidReceiptV2(p)
 const current:any={format:'native-public-read-v2',buyer:p.intent.buyer,soulId:p.soulId,hostId:p.intent.host.objectId,stateId:x.stateId,ledgerId:p.ledgerId,kind:p.intent.kind,recordIndex:0,contentScope:'1',contentVersion:'0',namespace:'current-content',owner:aid(70),generation:'2',entryReference:entry.entryReference,entryHash:toHex(entry.receipt.entry_hash),decision:{action:'REUSE_ENTRY'},recordReference:{objectId:aid(6000),version:'1',digest:adigest(1)},hostReference:{objectId:p.intent.host.objectId,version:'10',digest:adigest(10)}}
 const input:any={history:{...p,packet:{...p.packet,phase:'SIGNED',signature:'synthetic'}},delivery:{qualification:{format:'native-public-read-v2',client:p.client,target:{native:p.native,content:p.content,chainIdentifier:'35834a8a',registryId:p.intent.registry.objectId,configId:p.intent.config.objectId},economics:{},soulId:p.soulId,buyer:p.intent.buyer,kind:p.intent.kind,recordIndex:0,requiredScope:1n,signal:p.signal},protected:{sealConfig:{},getAddress:()=>address}}}
 const bytes=new Uint8Array([1,2,3]),read=vi.fn(async()=>structuredClone(current)),openPaid=vi.fn(async()=>({bytes,fileName:'content',mimeType:'text/plain'})),openOwner=vi.fn(async()=>({bytes,fileName:'content',mimeType:'text/plain'}))
 const deps:any={read,openPaid,openOwner}
 return {input,current,bytes,read,openPaid,openOwner,deps,setAddress:(v:string|null)=>{address=v},run:()=>recoverNativePublicReadPaidContentV2(input,deps)}
}
it('recovers original finalized money/Entry and opens only after separately current bound reusable access',async()=>{
 const x=await recoveryDeliveryFixture(),result=await x.run()
 expect(result).toMatchObject({status:'ORIGINAL_SUBSCRIPTION_CONTENT_OPENED',original:{status:'SUBSCRIPTION_RECORDED',receipt:{money:{payout:{amount:'101'}},requiresOriginalPaidPointerProof:true}},delivery:{status:'CONTENT_OPENED',content:{bytes:x.bytes}},notPermissionToRetryPayment:true,notDurablePurchaseCompletion:true})
 expect(x.read).toHaveBeenCalledTimes(2);expect(x.openPaid).toHaveBeenCalledTimes(1)
})
it.each(['BLOCKED','PURCHASE_REQUIRED'])('preserves original settlement without opening or paying again when current access is %s',async action=>{
 const x=await recoveryDeliveryFixture();x.current.decision.action=action
 expect(await x.run()).toMatchObject({status:'ORIGINAL_SUBSCRIPTION_CURRENT_ACCESS_UNAVAILABLE',original:{status:'SUBSCRIPTION_RECORDED'},notPermissionToRetryPayment:true})
 expect(x.openPaid).not.toHaveBeenCalled();expect(x.openOwner).not.toHaveBeenCalled()
})
it.each(['soulId','buyer','kind'])('rejects original/current selection mismatch %s before historical RPC',async key=>{
 const x=await recoveryDeliveryFixture();x.input.delivery.qualification[key]=key==='kind'?99:aid(999)
 await expect(x.run()).rejects.toThrow();expect(x.read).not.toHaveBeenCalled();expect(x.openPaid).not.toHaveBeenCalled()
})
it('rejects a version requiring scope outside the original purchase before querying payment',async()=>{
 const x=await recoveryDeliveryFixture()
 x.input.delivery.qualification.requiredScope=2n
 await expect(x.run()).rejects.toThrow('RECOVERY_SELECTION')
 expect(x.read).not.toHaveBeenCalled();expect(x.openPaid).not.toHaveBeenCalled()
})
it.each(['hostId','ledgerId','stateId'])('rejects current %s binding before protected open',async key=>{
 const x=await recoveryDeliveryFixture();x.current[key]=aid(999)
 await expect(x.run()).rejects.toThrow('CURRENT_BINDING');expect(x.openPaid).not.toHaveBeenCalled()
})
it('zeros returned plaintext when final current binding changes after protected open',async()=>{
 const x=await recoveryDeliveryFixture();x.openPaid.mockImplementation(async()=>{x.current.ledgerId=aid(999);return {bytes:x.bytes,fileName:'x',mimeType:'text/plain'}})
 await expect(x.run()).rejects.toThrow('CURRENT_BINDING');expect([...x.bytes]).toEqual([0,0,0])
})
it('keeps current owner reuse on the owner opener after original paid recovery',async()=>{
 const x=await recoveryDeliveryFixture();x.current.decision.action='REUSE_OWNER';x.current.owner=x.current.buyer;x.current.entryHash=null
 expect(await x.run()).toMatchObject({status:'ORIGINAL_SUBSCRIPTION_CONTENT_OPENED',accessBasis:'CURRENT_OWNER',delivery:{accessPath:'REUSE_OWNER'}});expect(x.openOwner).toHaveBeenCalledTimes(1);expect(x.openPaid).not.toHaveBeenCalled()
})
it.each(['MISSING','PENDING','FAILED'])('does not open for an original transaction in %s even when current access might exist',async status=>{
 const x=await recoveryDeliveryFixture();x.deps.history=vi.fn(async()=>({status}))
 expect(await x.run()).toMatchObject({status:'ORIGINAL_SUBSCRIPTION_NOT_CONFIRMED',notContentDelivered:true});expect(x.read).not.toHaveBeenCalled();expect(x.openPaid).not.toHaveBeenCalled()
})
it('captures recovery selection and callbacks before asynchronous history verification',async()=>{
 const x=await recoveryDeliveryFixture();x.deps.history=async(i:any)=>{await Promise.resolve();x.input.delivery.qualification.soulId=aid(999);x.input.delivery.protected.getAddress=()=>null;x.deps.read=()=>{throw Error('REPLACED_READ')};return readNativePublicReadPaidHistoryV2(i)}
 expect(await x.run()).toMatchObject({status:'ORIGINAL_SUBSCRIPTION_CONTENT_OPENED'})
})
it('rejects wallet change during original history verification before opening',async()=>{
 const x=await recoveryDeliveryFixture();x.deps.history=async(i:any)=>{const original=await readNativePublicReadPaidHistoryV2(i);x.setAddress(null);return original}
 await expect(x.run()).rejects.toThrow('WALLET_CHANGED');expect(x.read).not.toHaveBeenCalled();expect(x.openPaid).not.toHaveBeenCalled()
})
it('composes original raw finalized payout recovery and actual AES plaintext in one invocation with controlled Seal/RPC',async()=>{
 const {nativeAuthoringFixture}=await import('./fixtures/native-authoring'),{deriveNativeCreationContentId}=await import('../../web/lib/soulidity/native-creation-transaction'),{openNativePublicPaidContentV2}=await import('../../web/lib/soulidity/native-public-paid-content-open-v2'),{fromHex}=await import('@mysten/sui/utils')
 const f=await nativeAuthoringFixture()
 try{
 const x=await recoveryDeliveryFixture(f.request.author,3),p=x.input.history,q=x.input.delivery.qualification
 f.request.target.nativeOriginalPackageId=p.native.originalPackageId;f.request.contentId=deriveNativeCreationContentId(f.request.target,f.request.author,f.request.mintNonce)
 f.request.slots.push({fileIndex:2,kind:3,name:'pet',nonce:'04'.repeat(16),readMask:'5',downloadPolicy:0,setActive:false});f.params.files.push({...f.params.files[1],file:new File([await f.params.files[1].file.arrayBuffer()],'pet.txt',{type:'text/plain'})})
 const preparation=await f.prepare(),envelope=preparation.envelopes[2].envelope,file=preparation.preparation.manifest.files[2]
 const pin=(v:any)=>({originalPackageId:v.originalPackageId,callablePackageId:v.callablePackageId,callableDigest:v.callableDigest})
 q.target={chainIdentifier:'35834a8a',standard:pin(p.native),custody:pin(p.native),native:pin(p.native),content:pin(p.content),registryId:p.intent.registry.objectId,configId:p.intent.config.objectId}
 const ref=(objectId:string)=>({objectId,initialSharedVersion:'1',mutable:false as const})
 const snapshot:any={format:'native-public-read-v2',soulId:q.soulId,recordIndex:0,contentId:f.request.contentId,namespace:envelope.documentId,ownerAddress:aid(70),hostReference:x.current.hostReference,clockTimestampMs:'100',shared:{kiosk:ref(p.intent.kiosk.objectId),host:ref(p.intent.host.objectId),clock:ref(aid(6))},record:{kind:3,name:'pet',version:'0',read_mask:'5',scope:'1',deleted:false,purged:false,nonce:fromHex(envelope.nonce),envelope:new TextEncoder().encode(JSON.stringify(envelope)),reference:{blob_id:'1',object:aid(45),sha256:fromHex(file.payloadHash),bytes:String(file.payloadByteLength),end_epoch:15}}}
 // Current record/qualification and keyserver are controlled; original history,
 // packet/effects/events/money and local Seal/AES cryptography use real codecs.
 Object.assign(p.client.core,{getMoveFunction:f.params.wallet.client.core.getMoveFunction.bind(f.params.wallet.client.core),resolveTransactionPlugin:f.params.wallet.client.core.resolveTransactionPlugin.bind(f.params.wallet.client.core)})
 x.input.delivery.protected={sealClient:f.params.wallet.client,blobBaseUrl:'https://walrus.example.com',sealConfig:f.params.sealConfig,getAddress:f.params.wallet.getAddress,signPersonalMessage:f.sign}
 x.deps.openPaid=async(i:any)=>openNativePublicPaidContentV2(i,{read:async()=>structuredClone(snapshot),interface:async()=>({}) as any,fetcher:async()=>new Response(new Uint8Array(preparation.preparation.payloads[2]))})
 const result=await x.run();expect(result).toMatchObject({status:'ORIGINAL_SUBSCRIPTION_CONTENT_OPENED',original:{receipt:{money:{payout:{amount:'101'}}}}})
 if(result.delivery?.status!=='CONTENT_OPENED')throw Error('NO_CONTENT')
 expect(result.delivery.content.bytes).toEqual(new TextEncoder().encode('private memory: not in any public recovery journal'))
 expect(f.decryptCall).toHaveBeenCalledTimes(1);expect(f.unwrapped.every(b=>b.every(v=>v===0))).toBe(true)
 }finally{vi.restoreAllMocks()}
})
