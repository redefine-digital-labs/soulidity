import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { commerceCheck } from './economics-read'
import { readNativeSaleConditions } from './native-sale-conditions'
import { readNativeSaleFunding } from './native-sale-funding'
import { readNativeSaleSharedReferences } from './native-sale-shared-references'
import { assertNativeSaleGraph, assertNativeSalePlanObservations, buildNativeSaleGraph, type NativeSaleGraphPlan } from './native-sale-graph'

type Request = Parameters<typeof readNativeSaleConditions>[0] & {
  paymentCoinIds: string[]; gas: NativeSaleGraphPlan['gas']; expirationEpoch: string; quoteExpiryMs: string; attemptHex: string
  reviewedSoulId: string; reviewedTotal: string
}

/** NEW-intent preparation only, after the main journal has excluded an active
 * old/unknown operation. Old schemas and signed bytes must never be rebuilt by
 * this function. Main owns wallet selection, storage locking/readback, signing
 * and broadcast. This function only constructs and rechecks unsigned bytes.
 */
export async function prepareNativeSalePurchase(input: Request) {
  const client: SuiGrpcClient = input.client, signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const request = structuredClone({ ...input, client: undefined, signal: undefined, getBuyerAddress: undefined })
  const buyer = input.buyer, getBuyerAddress = input.getBuyerAddress
  const guard = () => { signal.throwIfAborted(); commerceCheck(getBuyerAddress() === buyer, 'SALE_PREPARE_WALLET_CHANGED') }
  commerceCheck(/^(0|[1-9][0-9]{0,15})$/.test(request.expirationEpoch)
    && /^[1-9][0-9]{0,19}$/.test(request.quoteExpiryMs), 'SALE_PREPARE_EXPIRATION')
  const conditionInput = { client, target: request.target, economics: request.economics, offerId: request.offerId, buyer,
    buyerAccountId: request.buyerAccountId, collection: request.collection, getBuyerAddress, signal }
  guard()
  const service = await profileReadStep(signal, () => client.ledgerService.getServiceInfo({}, { abort: signal }))
  commerceCheck(service.response.chainId === '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', 'SALE_PREPARE_CHAIN')
  async function epochCheck() {
    const epoch = (await profileReadStep(signal, () => client.ledgerService.getEpoch({ readMask: { paths: ['epoch', 'reference_gas_price'] } }, { abort: signal }))).response.epoch
    commerceCheck(typeof epoch?.epoch === 'bigint' && typeof epoch.referenceGasPrice === 'bigint' && epoch.referenceGasPrice > 0n
      && BigInt(request.expirationEpoch) >= epoch.epoch && BigInt(request.expirationEpoch) <= epoch.epoch + 1n
      && BigInt(request.gas.price) >= epoch.referenceGasPrice, 'SALE_PREPARE_EPOCH_OR_GAS_PRICE')
  }
  await epochCheck()
  const conditions = await readNativeSaleConditions(conditionInput); guard()
  commerceCheck(conditions.soulId === request.reviewedSoulId && String(conditions.quote.total) === request.reviewedTotal, 'SALE_PREPARE_REVIEW_CHANGED')
  const references = await readNativeSaleSharedReferences({ client, target: request.target, economics: request.economics, conditions, signal })
  commerceCheck(BigInt(references.timestampMs) <= BigInt(request.quoteExpiryMs), 'SALE_PREPARE_QUOTE_EXPIRED')
  const gasIds = request.gas.coins.map(coin => coin.objectId)
  const funding = await readNativeSaleFunding({ client, buyer, coinType: conditions.release.coinType, total: String(conditions.quote.total),
    coinIds: request.paymentCoinIds, gasCoinIds: gasIds, getBuyerAddress, signal })
  const gasFunding = await readNativeSaleFunding({ client, buyer, coinType: '0x2::sui::SUI', total: request.gas.budget,
    coinIds: gasIds, gasCoinIds: request.paymentCoinIds, getBuyerAddress, signal })
  commerceCheck(publicMutationCanonical(gasFunding.coins.map(({ objectId, version, digest }) => ({ objectId, version, digest })))
    === publicMutationCanonical(request.gas.coins), 'SALE_PREPARE_GAS_REFERENCES')
  const plan: NativeSaleGraphPlan = { schema: 'soulidity.native-sale-graph.v1', buyer, callablePackageId: conditions.release.native.callablePackageId,
    coinType: conditions.release.coinType, soulId: conditions.soulId, offerId: conditions.offerId, registryId: conditions.release.registryId,
    configId: conditions.release.configId, policyId: conditions.offer.policyId, sellerKioskId: conditions.offer.sellerKioskId,
    buyerKioskId: conditions.buyerKioskId, collectionId: conditions.offer.collectionId, buyerAccount: conditions.buyerAccount,
    generation: conditions.offer.generation, attemptHex: request.attemptHex, quoteExpiryMs: request.quoteExpiryMs, reviewedTotal: String(conditions.quote.total),
    paymentCoins: funding.coins, shared: references.shared, expirationEpoch: request.expirationEpoch, gas: request.gas }
  assertNativeSalePlanObservations(plan, conditions, funding); guard()
  const bytes = await buildNativeSaleGraph(plan).build(), packet: PublicMutationPacket = { bytes: toBase64(bytes),
    digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: plan.expirationEpoch, phase: 'PREPARED', signature: null }
  assertNativeSaleGraph(plan, packet)
  // Re-prove all observations after bytes exist. Never silently reselect/rebuild
  // them on drift; caller must query/preserve any existing prepared operation.
  const finalConditions = await readNativeSaleConditions(conditionInput)
  const finalFunding = await readNativeSaleFunding({ client, buyer, coinType: plan.coinType, total: plan.reviewedTotal,
    coinIds: request.paymentCoinIds, gasCoinIds: gasIds, getBuyerAddress, signal })
  assertNativeSalePlanObservations(plan, finalConditions, finalFunding)
  const finalGasFunding = await readNativeSaleFunding({ client, buyer, coinType: '0x2::sui::SUI', total: request.gas.budget,
    coinIds: gasIds, gasCoinIds: request.paymentCoinIds, getBuyerAddress, signal })
  commerceCheck(publicMutationCanonical(finalGasFunding.coins) === publicMutationCanonical(gasFunding.coins), 'SALE_PREPARE_GAS_CHANGED')
  const finalReferences = await readNativeSaleSharedReferences({ client, target: request.target, economics: request.economics, conditions: finalConditions, signal })
  commerceCheck(publicMutationCanonical(finalReferences.shared) === publicMutationCanonical(plan.shared)
    && BigInt(finalReferences.timestampMs) <= BigInt(plan.quoteExpiryMs), 'SALE_PREPARE_SHARED_OR_EXPIRY_CHANGED')
  await epochCheck(); guard()
  return { schema: 'soulidity.native-sale-preparation.v1' as const, plan, packet,
    // Public release identities captured with the original operation. Recovery
    // must use these pins/bytes, not a later environment or new callable ABI.
    context: { target: request.target, economics: request.economics, collection: request.collection ?? null,
      reviewedSoulId: request.reviewedSoulId, reviewedTotal: request.reviewedTotal },
    notSignedOrExecuted: true as const, requiresDurableJournalBeforeSigning: true as const,
    remaining: ['WALLET_FINAL_PREFLIGHT', 'EXECUTED_QUALIFICATION', 'COMPLETE_ORIGINAL_SALE_PROOF', 'ACTUAL_POST_SALE_USE'] as const }
}
