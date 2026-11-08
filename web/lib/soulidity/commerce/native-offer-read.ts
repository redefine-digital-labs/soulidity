import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag } from '@mysten/sui/utils'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { readCommerceObject, decodeCommerce, commerceCheck, commerceId, readEconomicsIncome, type EconomicsTarget } from './economics-read'
import { NativeOfferBcs } from './economics-bcs'
import { quoteNativeSale, nativeSaleDistribution } from './native-sale-quote'
import { readSaleCollectionProof } from './collection-sale-proof'

/** A current Offer preview, not a purchase authorization. Full policy, buyer
 * custody, market gates and supported-tree proof still belong to preflight.
 * Collection-bound offers require a pinned linked Collection and membership
 * proof; absent evidence must never turn into zero extra royalty.
 */
export async function readNativeOfferPreview(input: { client: SuiGrpcClient; economics: EconomicsTarget;
  native: PinnedMovePackage; collection?: PinnedMovePackage; offerId: string; registryId: string; signal: AbortSignal }) {
  const client = input.client, native = structuredClone(input.native), economics = structuredClone(input.economics)
  const offerId = input.offerId, registryId = input.registryId
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  commerceCheck(commerceId(offerId) && commerceId(registryId), 'OFFER_INPUT')
  const income = await readEconomicsIncome({ client, target: economics, signal })
  const pkg = await readPinnedMovePackage(client, native, signal)
  const link = pkg.linkage.get(economics.foundation.originalPackageId)
  commerceCheck(link?.upgradedId === economics.foundation.callablePackageId
    && link.upgradedVersion === income.foundationVersion, 'NATIVE_FOUNDATION_LINK')
  const role = income.config.roles.roles[3]
  commerceCheck(role.original === native.originalPackageId && role.callable === native.callablePackageId && role.pinned
    && role.version === String(pkg.version) && pkg.origins.get('market::MarketAuthority1') === native.originalPackageId
    && role.marker, 'MARKET_ROLE')
  const marker = normalizeStructTag(role.marker.name)
  const parts = marker.split('::'), name = parts[2]
  commerceCheck(parts.length === 3 && parts[0] === native.callablePackageId && parts[1] === 'market'
    && /^MarketRevision[1-9][0-9]*$/.test(name) && pkg.origins.get(`market::${name}`) === native.callablePackageId, 'MARKET_REVISION')
  const origin = pkg.origins.get('market::Offer'); commerceCheck(origin, 'OFFER_ORIGIN')
  const object = await readCommerceObject(client, offerId, `${origin}::market::Offer`, signal)
  commerceCheck(object.owner.$kind === 'Shared', 'OFFER_OWNER')
  const offer = decodeCommerce(NativeOfferBcs, object.contents)
  commerceCheck(offer.id === offerId && offer.registry === registryId && offer.config === economics.configId
    && commerceId(offer.root) && commerceId(offer.state) && commerceId(offer.seller) && commerceId(offer.creator)
    && commerceId(offer.kiosk) && commerceId(offer.policy) && offer.manifest.length === 32
    && offer.royalty <= 10000 && BigInt(offer.ask) > 0n, 'OFFER_BINDING')
  if (offer.active) commerceCheck(offer.purchase && commerceId(offer.purchase.id) && offer.purchase.kiosk_id === offer.kiosk
    && offer.purchase.item_id === offer.root && offer.purchase.min_price === '0', 'OFFER_CAP')
  else commerceCheck(offer.purchase === null, 'TERMINAL_OFFER_CAP')
  const collection = offer.collection !== null && input.collection ? await readSaleCollectionProof({ client,
    pin: input.collection, nativeLinkage: pkg.linkage, collectionId: offer.collection,
    configId: economics.configId, soulId: offer.root, signal }) : null
  commerceCheck(!collection || collection.creator === offer.creator, 'OFFER_COLLECTION_CREATOR')
  const current = await readCommerceObject(client, income.object.objectId, income.configType, signal)
  commerceCheck(current.version === income.object.version && current.digest === income.object.digest, 'CONFIG_CHANGED')
  const currentOffer = await readCommerceObject(client, offerId, `${origin}::market::Offer`, signal)
  commerceCheck(currentOffer.version === object.version && currentOffer.digest === object.digest, 'OFFER_CHANGED')
  const collectionRequired = offer.collection !== null
  const quote = collectionRequired && !collection ? null : quoteNativeSale(BigInt(offer.ask), {
    secondaryBps: income.config.secondary_bps, creatorBps: offer.royalty, collectionBps: collection?.royaltyBps ?? 0 })
  const blockers = [
    ...(!offer.active ? ['OFFER_INACTIVE'] : []),
    ...(offer.config_revision !== income.config.revision ? ['OFFER_CONFIG_REVISION_CHANGED'] : []),
    ...(!income.config.enabled ? ['PROTOCOL_DISABLED'] : []),
    ...(income.config.paused ? ['PROTOCOL_PAUSED'] : []),
    ...(BigInt(income.config.minimum_release) > 2n ? ['UNSUPPORTED_PROTOCOL_RELEASE'] : []),
    ...(collectionRequired && !collection ? ['COLLECTION_PROOF_REQUIRED'] : []),
  ]
  return { offer, economics: income, observed: { objectId: object.objectId, version: object.version, digest: object.digest },
    quote, collection, distribution: quote ? nativeSaleDistribution(quote, { seller: offer.seller, creator: offer.creator, collection: collection?.holder ?? offer.seller }) : null,
    blockers, notAuthorization: true as const, remainingPreflight: ['TRANSFER_POLICY', 'BUYER_CUSTODY', 'MARKET_GATES', 'SUPPORTED_TREE'] as const }
}

/** Identify the reviewed Offer, economic terms and the recipients together. */
export function nativeSaleQuoteIdentity(preview: Awaited<ReturnType<typeof readNativeOfferPreview>>) {
  const { offer, quote, economics, observed, collection } = preview
  commerceCheck(quote && preview.blockers.length === 0, 'SALE_QUOTE_UNAVAILABLE')
  return publicMutationCanonical({
    offer: observed, seller: offer.seller, creator: offer.creator, coin: economics.coinType,
    feeRevision: economics.config.revision, platformRecipient: economics.config.recipient,
    collection: collection && { holder: collection.holder, observed: collection.observed, member: collection.member },
    amounts: Object.fromEntries(Object.entries(quote).map(([role, amount]) => [role, String(amount)])),
  })
}
