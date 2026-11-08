import { proveNativePaidContentTreeHistory } from '../../web/lib/soulidity/commerce/native-paid-content-tree-history'
import { toBase64 } from '@mysten/sui/utils'
import { proveNativePaidServiceOpeningHistory } from '../../web/lib/soulidity/commerce/native-paid-service-opening-history'
import { Transaction } from '@mysten/sui/transactions'
import { expect, it, vi } from 'vitest'
import { aid, adigest } from './fixtures/activity-transaction-evidence'
import { proveNativePaidContentReceipt } from '../../web/lib/soulidity/commerce/native-paid-content-receipt'
import { proveNativePaidContentOfferHistory } from '../../web/lib/soulidity/commerce/native-paid-content-offer-history'
import { proveNativePaidContentServiceHistory } from '../../web/lib/soulidity/commerce/native-paid-content-service-history'
import { proveNativePaidContentMoney } from '../../web/lib/soulidity/commerce/native-paid-content-money'
import { readNativePaidContentHistory, NativePaidUpdatedBcs, NativeSubscriptionPaidBcs } from '../../web/lib/soulidity/commerce/native-paid-content-history'
import { fixture, serviceFundsFixture, serviceRecoveryCase } from './fixtures/commerce-paid-content-receipt'
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
