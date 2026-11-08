import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag } from '@mysten/sui/utils'
import { SoulPublicKioskBcs } from '@soulidity/sdk'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { readCanonicalNativeWorkbench, CanonicalOwnedAccountBcs, type CanonicalNativeWorkbenchTarget } from '../canonical-native-workbench'
import { readNativeManagementState } from '../management/native-state'
import { commerceCheck, commerceId, decodeCommerce, readCommerceObject, type EconomicsTarget } from './economics-read'
import { readNativeOfferPreview } from './native-offer-read'
import { readNativeSaleTree } from './native-sale-tree'
import { readNativeSaleSourceBinding } from './native-sale-source-binding'

export const NativeTransferPolicyBcs = bcs.struct('TransferPolicy', { id: bcs.Address, balance: bcs.u64(),
  rules: bcs.struct('VecSet', { contents: bcs.vector(bcs.struct('TypeName', { name: bcs.string() })) }) })
export const NativeMarketRuleFieldBcs = bcs.struct('Field', { id: bcs.Address, name: MoveEmptyStructBcs,
  value: bcs.struct('RuleConfig', { config: bcs.Address, currency: bcs.struct('TypeName', { name: bcs.string() }) }) })
export const NativeMarketGatesFieldBcs = bcs.struct('Field', { id: bcs.Address, name: MoveEmptyStructBcs,
  value: bcs.struct('MarketGates', { primary: bcs.bool(), secondary: bcs.bool() }) })

/** Current condition proofs only, not a signing authorization. Reads actual
 * canonical seller custody/generation and buyer owned Account, TransferPolicy
 * rules/config/currency and secondary gate. Never guesses legacy Kiosk rules.
 * Recursive range/duties and permanent producer-directory proofs are composed.
 * Funds and final wallet/graph checks remain mandatory before signing.
 */
export async function readNativeSaleConditions(input: { client: SuiGrpcClient; target: CanonicalNativeWorkbenchTarget;
  economics: EconomicsTarget; offerId: string; buyer: string; buyerAccountId: string;
  collection?: PinnedMovePackage; getBuyerAddress: () => string | null; signal: AbortSignal }) {
  const target = structuredClone(input.target), economics = structuredClone(input.economics)
  const collectionRelease = input.collection ? structuredClone(input.collection) : null
  const { client } = input, buyer = input.buyer, signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  const guard = () => { signal.throwIfAborted(); commerceCheck(input.getBuyerAddress() === buyer, 'SALE_CONDITIONS_WALLET_CHANGED') }
  commerceCheck(target.custody && target.content && economics.configId === target.configId
    && economics.chainIdentifier === target.chainIdentifier && commerceId(buyer) && commerceId(input.buyerAccountId), 'SALE_CONDITIONS_INPUT')
  guard()
  const preview = await readNativeOfferPreview({ client, economics, native: target.native, registryId: target.registryId,
    offerId: input.offerId, collection: collectionRelease ?? undefined, signal })
  commerceCheck(preview.blockers.length === 0 && preview.quote && preview.offer.seller !== buyer, 'SALE_CONDITIONS_OFFER_UNAVAILABLE')
  guard()
  const root = await readCanonicalNativeWorkbench({ client, target, soulId: preview.offer.root, viewerAddress: buyer, signal })
  commerceCheck(root.stateId === preview.offer.state && root.revision === preview.offer.root_revision && root.creator === preview.offer.creator
    && root.royaltyBps === preview.offer.royalty && root.custody?.ownerAddress === preview.offer.seller
    && root.custody.kioskId === preview.offer.kiosk, 'SALE_CONDITIONS_SELLER_CUSTODY')
  const management = await readNativeManagementState({ client, target, soulId: root.soulId, viewerAddress: buyer,
    getViewerAddress: input.getBuyerAddress, signal })
  commerceCheck(management.stateId === root.stateId && management.authorization.generation === preview.offer.generation, 'SALE_CONDITIONS_GENERATION')
  const tree = await readNativeSaleTree({ client, target, soulId: root.soulId, expectedRevision: preview.offer.root_revision,
    expectedManifest: preview.offer.manifest, signal })
  const source = await readNativeSaleSourceBinding({ client, economics, native: target.native, registryId: target.registryId,
    soulId: root.soulId, stateId: root.stateId, signal })
  commerceCheck(source.gates.secondary && source.config.digest === preview.economics.object.digest, 'SALE_CONDITIONS_SOURCE_POLICY')
  const [native, standard, custody, foundation] = await Promise.all([readPinnedMovePackage(client, target.native, signal),
    readPinnedMovePackage(client, target.standard, signal), readPinnedMovePackage(client, target.custody, signal),
    readPinnedMovePackage(client, economics.foundation, signal)])
  for (const pkg of [standard, custody, foundation]) { const link = native.linkage.get(pkg.pin.originalPackageId)
    commerceCheck(link?.upgradedId === pkg.pin.callablePackageId && link.upgradedVersion === String(pkg.version), 'SALE_CONDITIONS_DEPENDENCY') }
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'SALE_CONDITIONS_ORIGIN'); return `${origin}::${module}::${name}` }
  const observations: Array<{ id: string; type: string; version: string; digest: string }> = []
  async function read(id: string, expectedType: string) { const object = await readCommerceObject(client, id, expectedType, signal)
    observations.push({ id, type: expectedType, version: object.version, digest: object.digest }); return object }
  const accountObject = await read(input.buyerAccountId, type(custody.origins, 'account', 'Account'))
  const account = decodeCommerce(CanonicalOwnedAccountBcs, accountObject.contents), authority = account.authority
  commerceCheck(accountObject.owner.AddressOwner === buyer && account.id === input.buyerAccountId && account.owner === buyer
    && authority && authority.owner === buyer && authority.kiosk === account.kiosk && authority.cap.for === account.kiosk
    && commerceId(authority.cap.id) && new Set([account.id, authority.cap.id, account.kiosk, root.soulId]).size === 4
    && [0, 32].includes(authority.closed_digest.length) && account.kiosk !== preview.offer.kiosk, 'SALE_CONDITIONS_BUYER_ACCOUNT')
  const buyerKioskObject = await read(account.kiosk, '0x2::kiosk::Kiosk'), kiosk = decodeCommerce(SoulPublicKioskBcs, buyerKioskObject.contents)
  commerceCheck(buyerKioskObject.owner.$kind === 'Shared' && kiosk.id === account.kiosk && kiosk.owner === buyer && !kiosk.allow_extensions, 'SALE_CONDITIONS_BUYER_KIOSK')
  const policyId = preview.offer.policy, rule = type(native.origins, 'market', 'Rule')
  const policyObject = await read(policyId, `0x2::transfer_policy::TransferPolicy<${type(standard.origins, 'soul', 'Soul')}>`)
  const policy = decodeCommerce(NativeTransferPolicyBcs, policyObject.contents)
  commerceCheck(policyObject.owner.$kind === 'Shared' && policy.id === policyId && policy.rules.contents.length === 1
    && normalizeStructTag(policy.rules.contents[0].name) === rule, 'SALE_CONDITIONS_POLICY_RULES')
  const keyType = `0x2::transfer_policy::RuleKey<${rule}>`, ruleId = deriveDynamicFieldID(policyId, keyType, moveEmptyStructBytes())
  const ruleObject = await read(ruleId, `0x2::dynamic_field::Field<${keyType},${type(native.origins, 'market', 'RuleConfig')}>`)
  const ruleField = decodeCommerce(NativeMarketRuleFieldBcs, ruleObject.contents)
  commerceCheck(ruleObject.owner.ObjectOwner === policyId && ruleField.id === ruleId && ruleField.value.config === economics.configId
    && normalizeStructTag(ruleField.value.currency.name) === preview.economics.coinType, 'SALE_CONDITIONS_POLICY_BINDING')
  const gateType = type(foundation.origins, 'economics', 'MarketGatesKey'), gateId = deriveDynamicFieldID(economics.configId, gateType, moveEmptyStructBytes())
  const gateObject = await read(gateId, `0x2::dynamic_field::Field<${gateType},${type(foundation.origins, 'economics', 'MarketGates')}>`)
  const gate = decodeCommerce(NativeMarketGatesFieldBcs, gateObject.contents)
  commerceCheck(gateObject.owner.ObjectOwner === economics.configId && gate.id === gateId && gate.value.secondary, 'SALE_CONDITIONS_SECONDARY_GATE')
  for (const observation of observations) { guard(); const current = await readCommerceObject(client, observation.id, observation.type, signal)
    commerceCheck(current.version === observation.version && current.digest === observation.digest, 'SALE_CONDITIONS_CHANGED') }
  const finalPreview = await readNativeOfferPreview({ client, economics, native: target.native, registryId: target.registryId, offerId: input.offerId,
    collection: collectionRelease ?? undefined, signal })
  commerceCheck(finalPreview.blockers.length === 0 && finalPreview.observed.digest === preview.observed.digest
    && finalPreview.economics.object.digest === preview.economics.object.digest
    && finalPreview.collection?.observed.digest === preview.collection?.observed.digest
    && finalPreview.collection?.member.digest === preview.collection?.member.digest, 'SALE_CONDITIONS_QUOTE_CHANGED')
  const finalRoot = await readCanonicalNativeWorkbench({ client, target, soulId: root.soulId, viewerAddress: buyer, signal })
  commerceCheck(JSON.stringify(root) === JSON.stringify(finalRoot), 'SALE_CONDITIONS_ROOT_CHANGED'); guard()
  return { proof: 'native-sale-current-custody-policy-gate-only' as const, soulId: root.soulId, offerId: preview.offer.id,
    release: { chainIdentifier: target.chainIdentifier, native: target.native, configId: economics.configId, registryId: target.registryId,
      coinType: preview.economics.coinType },
    offer: { policyId: preview.offer.policy, sellerKioskId: preview.offer.kiosk, generation: preview.offer.generation,
      collectionId: preview.offer.collection ?? null, observed: preview.observed }, collectionRelease,
    buyer, buyerKioskId: account.kiosk, buyerAccount: { objectId: accountObject.objectId, version: accountObject.version, digest: accountObject.digest },
    quote: preview.quote, tree, source, observed: observations, notAuthorization: true as const,
    remaining: ['FUNDS', 'FINAL_TRANSACTION_GRAPH', 'WALLET_PREFLIGHT', 'POST_SALE_CLEANUP_PROOF'] as const }
}
