import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { commerceCheck, decodeCommerce } from './economics-read'
import { NativeOfferBcs } from './economics-bcs'
import { NativeExclusiveListingFieldBcs } from './native-sale-cancellation'
import { parseNativeSaleGraphPlan, type NativeSaleGraphPlan } from './native-sale-graph'

const Key = bcs.struct('Listing', { id: bcs.Address, is_exclusive: bcs.bool() })

/** Original listing exit only, composed after exact graph/finality. Proves
 * Offer terminal fields, deleted inline PurchaseCap UID and consumed exclusive Kiosk listing. It does not
 * prove recursive source revocation, seller lock removal or complete effects.
 * Never queries today's listing to infer what an earlier sale removed.
 */
export async function proveNativeSaleListingExit(input: { client: SuiGrpcClient; plan: NativeSaleGraphPlan;
  effects: ReturnType<typeof bcs.TransactionEffects.parse>; transactionDigest: string;
  native: PinnedMovePackage; signal: AbortSignal }) {
  const plan = parseNativeSaleGraphPlan(input.plan), effects = structuredClone(input.effects)
  const { client, signal, transactionDigest } = input, e = effects.V2
  commerceCheck(e?.status.$kind === 'Success' && e.transactionDigest === transactionDigest
    && e.changedObjects.length <= 4096 && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length, 'SALE_EXIT_CONTEXT')
  const native = await readPinnedMovePackage(client, input.native, signal), origin = native.origins.get('market::Offer')
  commerceCheck(origin && native.pin.callablePackageId === plan.callablePackageId, 'SALE_EXIT_PACKAGE')
  const read = (objectId: string, type: string, mode: 'input' | 'mutated') => readHistoricalMoveObject({ client,
    effects, transactionDigest, objectId, type, mode, signal })
  const before = await read(plan.offerId, `${origin}::market::Offer`, 'input')
  const after = await read(plan.offerId, `${origin}::market::Offer`, 'mutated')
  const a = decodeCommerce(NativeOfferBcs, before.bytes), b = decodeCommerce(NativeOfferBcs, after.bytes)
  commerceCheck(before.object.owner.$kind === 'Shared' && after.object.owner.$kind === 'Shared'
    && before.object.owner.Shared!.initialSharedVersion === after.object.owner.Shared!.initialSharedVersion
    && a.id === plan.offerId && a.root === plan.soulId && a.kiosk === plan.sellerKioskId && a.seller !== plan.buyer
    && a.registry === plan.registryId && a.config === plan.configId && a.policy === plan.policyId
    && a.collection === plan.collectionId && a.generation === plan.generation && a.active && a.purchase
    && a.purchase.item_id === plan.soulId && a.purchase.kiosk_id === plan.sellerKioskId && a.purchase.min_price === '0'
    && !b.active && b.purchase === null
    && publicMutationCanonical({ ...a, active: null, purchase: null }) === publicMutationCanonical({ ...b, active: null, purchase: null }), 'SALE_EXIT_OFFER_TRANSITION')
  const listingId = deriveDynamicFieldID(plan.sellerKioskId, '0x2::kiosk::Listing', Key.serialize({ id: plan.soulId, is_exclusive: true }).toBytes())
  const original = await read(listingId, '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>', 'input')
  const field = decodeCommerce(NativeExclusiveListingFieldBcs, original.bytes), change = e.changedObjects.find(([id]) => id === listingId)![1]
  commerceCheck(original.object.owner.ObjectOwner === plan.sellerKioskId && field.id === listingId
    && field.name.id === plan.soulId && field.name.is_exclusive && field.value === '0'
    && change.idOperation.$kind === 'Deleted' && change.outputState.$kind === 'NotExist', 'SALE_EXIT_EXCLUSIVE_LISTING')
  // purchase_with_cap deletes the UID extracted from the inline Offer value.
  // It has no standalone input Object: exact unwrapped-then-deleted effects
  // are required, rather than inferring deletion from purchase=None alone.
  const capId = a.purchase.id, capExit = e.changedObjects.filter(([id]) => id === capId)
  commerceCheck(new Set([plan.offerId, plan.soulId, plan.sellerKioskId, listingId, capId]).size === 5
    && capExit.length === 1 && capExit[0][1].inputState.$kind === 'NotExist'
    && capExit[0][1].outputState.$kind === 'NotExist' && capExit[0][1].idOperation.$kind === 'Deleted', 'SALE_EXIT_CAP_UID_DELETION')
  return { proof: 'native-sale-original-offer-and-exclusive-listing-exit-only' as const, transactionDigest,
    offerId: plan.offerId, listingId, purchaseCapId: capId, claimedEffectIds: [plan.offerId, listingId, capId],
    offerInput: { version: String(before.reference.version), digest: before.reference.digest, writer: before.object.previousTransaction },
    listingInput: { version: String(original.reference.version), digest: original.reference.digest, writer: original.object.previousTransaction },
    notRecursiveSourceCleanup: true as const, notCompleteSaleProof: true as const, notCurrentAuthority: true as const }
}
