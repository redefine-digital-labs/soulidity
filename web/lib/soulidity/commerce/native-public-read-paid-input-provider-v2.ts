import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { commerceCheck } from './economics-read'
import { readContractCheckedNativePublicReadPaidPreviewV2 } from './native-public-read-paid-preview-v2'
import { nativePublicReadPaidReviewIdentityV2, readNativePublicReadPaidV2 } from './native-public-read-paid-read-v2'
import { readNativePublicReadPaidFundingV2 } from './native-public-read-paid-funding-v2'
import type { NativePublicReadPaidHostRequestV2 } from './native-public-read-paid-host-preflight-v2'

type Qualification = NativePublicReadPaidHostRequestV2['qualification']
export type NativePublicReadPaidPurchaseResourcesV2 = Omit<NativePublicReadPaidHostRequestV2, 'qualification' | 'reviewed' | 'getBuyerAddress'>
export type NativePublicReadPaidProviderInputV2 = Omit<NativePublicReadPaidHostRequestV2, 'qualification' | 'getBuyerAddress'> & {
  qualification: Omit<Qualification, 'client' | 'signal'>
}

/** Exact user-selected resources, never wallet balance guesses or implicit Gas.
 * A provider result supplies unsigned Host input only. Root still owns source
 * qualification/activation and the existing Host owns original exclusion/WAL.
 */
export async function reviewNativePublicReadPaidInputsV2(input: {
  qualification: Qualification
  purchase: NativePublicReadPaidPurchaseResourcesV2 | null
  getBuyerAddress: () => string | null
}) {
  const { client: source, signal: parent, ...selection } = input.qualification
  const selected = structuredClone(selection), purchase = structuredClone(input.purchase), getBuyerAddress = input.getBuyerAddress
  // Read each group/method once, preserving class receivers and accessor clients.
  const core = source.core, ledger = source.ledgerService
  const { getChainIdentifier, getMoveFunction, simulateTransaction, resolveTransactionPlugin } = core
  const { getObject, getEpoch } = ledger
  const client = {
    core: { getChainIdentifier: getChainIdentifier.bind(core),
      getMoveFunction: getMoveFunction?.bind(core), simulateTransaction: simulateTransaction?.bind(core), resolveTransactionPlugin: resolveTransactionPlugin?.bind(core) },
    ledgerService: { getObject: getObject.bind(ledger), getEpoch: getEpoch?.bind(ledger) },
  } as unknown as SuiGrpcClient
  const signal = AbortSignal.any([parent, AbortSignal.timeout(90000)])
  const guard = () => { signal.throwIfAborted(); commerceCheck(getBuyerAddress() === selected.buyer, 'PUBLIC_PAID_V2_PROVIDER_WALLET_CHANGED') }
  const request = { ...selected, client, signal }
  guard()
  let reviewed = await readNativePublicReadPaidV2(request)
  guard()
  const content = { soulId: selected.soulId, product: reviewed.product, hostId: reviewed.hostId,
    recordIndex: reviewed.recordIndex, kind: reviewed.kind, version: reviewed.contentVersion, scope: reviewed.contentScope, name: reviewed.contentName }
  const boundaries = { requiresRootSourceQualificationAndActivation: true as const, requiresExistingDurableHost: true as const,
    notSigningQualification: true as const, notReservedOrPaid: true as const, notDeliveryOrEquipmentProof: true as const }
  if (reviewed.decision.action === 'REUSE_OWNER' || reviewed.decision.action === 'REUSE_ENTRY') {
    return { status: 'REUSE_CURRENT_ACCESS' as const, content, reviewed, ...boundaries }
  }
  if (reviewed.decision.action !== 'PURCHASE_REQUIRED' || reviewed.purchaseBlockers.length) {
    return { status: 'PURCHASE_BLOCKED' as const, content, reviewed, ...boundaries }
  }
  const preview = await readContractCheckedNativePublicReadPaidPreviewV2(request)
  guard()
  commerceCheck(nativePublicReadPaidReviewIdentityV2(preview.qualification) === nativePublicReadPaidReviewIdentityV2(reviewed), 'PUBLIC_PAID_V2_PROVIDER_SELECTION_CHANGED')
  reviewed = preview.qualification
  commerceCheck(preview.status === 'CONTRACT_QUOTE_CHECKED' && reviewed.offer && reviewed.quote && reviewed.coinType
    && reviewed.platformRecipient && reviewed.configSharedReference, 'PUBLIC_PAID_V2_PROVIDER_QUOTE')
  const quote = reviewed.quote!, offer = reviewed.offer!, coinType = reviewed.coinType!
  const settlementPreview = {
    coinType, total: quote.total,
    directPayout: { beneficiary: offer.issuer, amount: quote.ask, method: 'DIRECT_COIN_TRANSFER' as const },
    protocolIncome: { configId: selected.economics.configId, recipient: reviewed.platformRecipient!, amount: quote.platformFee,
      method: 'PROTOCOL_LEDGER' as const, withdrawalAuthority: 'MATCHING_FOUNDATION_ADMIN' as const },
    notReceiptOrCurrentBalance: true as const,
  }
  if (!purchase) return { status: 'PURCHASE_SELECTION_REQUIRED' as const, content, reviewed, settlementPreview,
    requiredInputs: ['PAYMENT_COIN_REFERENCE', 'GAS_REFERENCES_BUDGET_PRICE', 'EXPIRATION_EPOCH', 'QUOTE_EXPIRY_MS', 'NEW_ATTEMPT_BYTES'] as const, ...boundaries }

  const uint = (value: string, positive = false) => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
    && BigInt(value) <= (1n << 64n) - 1n && (!positive || BigInt(value) > 0n)
  commerceCheck(uint(purchase.gas.budget, true) && uint(purchase.gas.price, true) && uint(purchase.expirationEpoch)
    && uint(purchase.quoteExpiryMs, true) && BigInt(reviewed.observedAtMs) <= BigInt(purchase.quoteExpiryMs)
    && purchase.attempt instanceof Uint8Array && purchase.attempt.length === 32 && purchase.attempt.some(byte => byte !== 0),
    'PUBLIC_PAID_V2_PROVIDER_RESOURCE_LIMITS')
  commerceCheck(typeof client.ledgerService.getEpoch === 'function', 'PUBLIC_PAID_V2_PROVIDER_EPOCH_CAPABILITY')
  const epoch = async () => {
    guard()
    const value = (await client.ledgerService.getEpoch({ readMask: { paths: ['epoch', 'reference_gas_price'] } }, { abort: signal })).response.epoch
    guard()
    commerceCheck(typeof value?.epoch === 'bigint' && typeof value.referenceGasPrice === 'bigint' && value.referenceGasPrice > 0n
      && BigInt(purchase.expirationEpoch) >= value.epoch && BigInt(purchase.expirationEpoch) <= value.epoch + 1n
      && BigInt(purchase.gas.price) >= value.referenceGasPrice, 'PUBLIC_PAID_V2_PROVIDER_EPOCH_GAS')
  }
  const businessIds = [selected.soulId, reviewed.hostId, reviewed.stateId, reviewed.ledgerId, selected.target.configId,
    selected.target.registryId, reviewed.shared.kiosk.objectId, reviewed.shared.clock.objectId]
  const funds = (gas: boolean) => readNativePublicReadPaidFundingV2({ client, buyer: selected.buyer,
    coinType: gas ? '0x2::sui::SUI' : coinType, required: gas ? purchase.gas.budget : quote.total,
    coins: gas ? purchase.gas.coins : [purchase.paymentCoin],
    excludedIds: [...businessIds, ...(gas ? [purchase.paymentCoin.objectId] : purchase.gas.coins.map(coin => coin.objectId))], getBuyerAddress, signal })
  await epoch()
  const funding = await funds(false), gasFunding = await funds(true)
  guard()
  const final = await readContractCheckedNativePublicReadPaidPreviewV2(request)
  guard()
  commerceCheck(final.status === 'CONTRACT_QUOTE_CHECKED' && nativePublicReadPaidReviewIdentityV2(final.qualification) === nativePublicReadPaidReviewIdentityV2(reviewed)
    && BigInt(final.qualification.observedAtMs) <= BigInt(purchase.quoteExpiryMs), 'PUBLIC_PAID_V2_PROVIDER_SELECTION_CHANGED')
  const finalFunding = await funds(false), finalGas = await funds(true)
  commerceCheck(publicMutationCanonical(finalFunding) === publicMutationCanonical(funding)
    && publicMutationCanonical(finalGas) === publicMutationCanonical(gasFunding), 'PUBLIC_PAID_V2_PROVIDER_FUNDING_CHANGED')
  await epoch()
  guard()
  const preflightInput: NativePublicReadPaidProviderInputV2 = {
    ...purchase, qualification: selected, reviewed: final.qualification,
  }
  return { status: 'PURCHASE_INPUTS_REVIEWED' as const, content, reviewed: final.qualification, settlementPreview,
    funding, gasFunding, preflightInput, ...boundaries }
}
