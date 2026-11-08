import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { profileReadStep, SoulPublicKioskBcs } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { marketListDigest } from '../../animacraft/market-list-operation'
import { readFinalizedMutation } from '../../sui/finalized-mutation'
import { readSuiGasSettlement } from '../../sui/gas-settlement'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import type { proveNativeSaleListingExit } from './native-sale-listing-exit'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { commerceCheck, commerceId, decodeCommerce } from './economics-read'
import { publicMutationCanonical as canonical } from '../../sui/public-mutation-journal'
import { NativeOfferBcs } from './economics-bcs'
import { NativeExclusiveListingFieldBcs } from './native-sale-cancellation'
import { parseNativeSaleGraphPlan, type NativeSaleGraphPlan } from './native-sale-graph'

const ListingKey = bcs.struct('Listing', { id: bcs.Address, is_exclusive: bcs.bool() })
const KioskType = '0x2::kiosk::Kiosk'

/** Prove the original Native listing that created the Offer and reservation
 * referenced by a later purchase. No current market configuration is read. */
export async function readNativeSaleRelistByDigest(input: {
  client: SuiGrpcClient; native: PinnedMovePackage; plan: NativeSaleGraphPlan; seller: string; sellerAccountId: string
  digest: string; signal: AbortSignal
}) {
  const { client, digest, seller, sellerAccountId } = input
  const plan = parseNativeSaleGraphPlan(input.plan), native = structuredClone(input.native)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  commerceCheck(marketListDigest(digest) && commerceId(seller) && commerceId(sellerAccountId) && seller !== plan.buyer
    && plan.callablePackageId === native.callablePackageId && !plan.shared.some(ref => ref.objectId === sellerAccountId)
    && sellerAccountId !== plan.buyerAccount.objectId, 'RELIST_SCOPE')
  const service = await profileReadStep(signal, () => client.ledgerService.getServiceInfo({}, { abort: signal }))
  commerceCheck(service.response.chainId === MAINNET_GENESIS_DIGEST, 'RELIST_CHAIN')
  let original
  try {
    original = (await profileReadStep(signal, () => client.ledgerService.getTransaction({ digest,
      readMask: { paths: ['digest', 'transaction.digest', 'transaction.bcs'] } }, { abort: signal }))).response.transaction
  } catch (error) {
    signal.throwIfAborted()
    if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return { status: 'MISSING' as const }
    throw error
  }
  const bytes = original?.transaction?.bcs?.value
  commerceCheck(original?.digest === digest && original.transaction?.digest === digest && bytes instanceof Uint8Array
    && bytes.length > 0 && bytes.length <= 135000, 'RELIST_ORIGINAL_BYTES')
  const expiration = bcs.TransactionData.parse(bytes).V1?.expiration.Epoch
  return readNativeSaleListingHistory({ client, native, plan: { ...plan, seller, sellerAccountId },
    packet: { bytes: toBase64(bytes), digest, expirationEpoch: String(expiration), phase: 'PREPARED', signature: null }, signal })
}

export interface NativeSaleListingBinding {
  soulId: string
  seller: string
  sellerAccountId: string
  sellerKioskId: string
  registryId: string
  configId: string
  policyId: string
  collectionId: string | null
  coinType: string
  shared: NativeSaleGraphPlan['shared']
  offerId?: string
  generation?: string
  ask?: string
  rootRevision?: string
  reviewSnapshot?: Pick<ReturnType<typeof NativeOfferBcs.parse>, 'state' | 'creator' | 'royalty' | 'manifest' | 'config_revision' | 'generation'>
}

/** The first listing can prove its exact Offer before any purchase exists. */
export async function readNativeSaleListingHistory(input: {
  client: SuiGrpcClient; native: PinnedMovePackage; plan: NativeSaleListingBinding; packet: PublicMutationPacket; signal: AbortSignal
}) {
  const { client } = input, { native, packet, plan } = structuredClone({ native: input.native, packet: input.packet, plan: input.plan })
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  const { digest } = packet, { seller, sellerAccountId } = plan
  commerceCheck(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 180000, 'RELIST_PACKET')
  const bytes = fromBase64(packet.bytes), raw = bcs.TransactionData.parse(bytes), tx = Transaction.from(bytes).getData()
  const expiration = raw.V1?.expiration.Epoch
  commerceCheck(toBase64(bcs.TransactionData.serialize(raw).toBytes()) === packet.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === digest && Number.isSafeInteger(expiration)
    && String(expiration) === packet.expirationEpoch, 'RELIST_PACKET')
  const shared = [plan.registryId, plan.configId, plan.policyId, ...(plan.collectionId ? [plan.collectionId] : []), plan.sellerKioskId]
  const accountIndex = shared.length, call = tx.commands[0]?.MoveCall
  commerceCheck(tx.sender === seller && tx.commands.length === 1 && tx.inputs.length === accountIndex + 4
    && call?.package === native.callablePackageId && call.module === 'market'
    && call.function === (plan.collectionId ? 'list_with_collection' : 'list')
    && call.typeArguments.length === 1 && normalizeStructTag(call.typeArguments[0]) === plan.coinType
    && call.arguments.length === tx.inputs.length
    && call.arguments.every((arg, index) => arg.$kind === 'Input' && arg.Input === index), 'RELIST_GRAPH')
  for (const [index, id] of shared.entries()) {
    const ref = tx.inputs[index].Object?.SharedObject, expected = plan.shared.find(value => value.objectId === id)
    commerceCheck(expected && ref?.objectId === id && String(ref.initialSharedVersion) === expected.initialSharedVersion
      && ref.mutable === (id === plan.sellerKioskId), 'RELIST_SHARED_REFERENCE')
  }
  commerceCheck(tx.inputs[accountIndex].Object?.ImmOrOwnedObject?.objectId === sellerAccountId, 'RELIST_ACCOUNT')
  const args = tx.inputs.slice(accountIndex + 1).map(arg => {
    commerceCheck(arg.Pure, 'RELIST_PURE')
    return fromBase64(arg.Pure.bytes)
  })
  const root = decodeCommerce(bcs.Address, args[0]), ask = decodeCommerce(bcs.u64(), args[1])
  const rootRevision = decodeCommerce(bcs.u64(), args[2])
  commerceCheck(root === plan.soulId && BigInt(ask) > 0n && BigInt(rootRevision) > 0n
    && (plan.ask === undefined || ask === plan.ask) && (plan.rootRevision === undefined || rootRevision === plan.rootRevision), 'RELIST_TERMS')
  const result = await readFinalizedMutation({ client, packet, signal, chainIdentifier: '35834a8a',
    genesisDigest: MAINNET_GENESIS_DIGEST, errorPrefix: 'COMMERCE_RELIST_HISTORY', proveSuccess: async context => {
      const pkg = await readPinnedMovePackage(client, native, signal), origin = pkg.origins.get('market::Offer')
      commerceCheck(origin, 'RELIST_OFFER_ORIGIN')
      const read = (objectId: string, type: string, mode: 'input' | 'created' | 'mutated') =>
        readHistoricalMoveObject({ client, effects: context.effects, transactionDigest: digest, objectId, type, mode, signal })
      const created = context.effects.V2!.changedObjects.filter(([, change]) => change.idOperation.$kind === 'Created'
        && change.outputState.ObjectWrite?.[1].$kind === 'Shared')
      commerceCheck(created.length === 1 && (plan.offerId === undefined || created[0][0] === plan.offerId), 'RELIST_CREATED_OFFER')
      const offerId = created[0][0], offerRow = await read(offerId, `${origin}::market::Offer`, 'created')
      const offer = decodeCommerce(NativeOfferBcs, offerRow.bytes), cap = offer.purchase
      const offerShared = plan.offerId ? plan.shared.find(ref => ref.objectId === plan.offerId)?.initialSharedVersion : String(offerRow.reference.version)
      commerceCheck(offerShared && offerRow.object.owner.Shared?.initialSharedVersion === offerShared
        && String(offerRow.reference.version) === offerShared && offer.id === offerId && offer.root === plan.soulId && offer.registry === plan.registryId && offer.config === plan.configId
        && offer.policy === plan.policyId && offer.seller === seller && offer.kiosk === plan.sellerKioskId && offer.collection === plan.collectionId
        && (plan.generation === undefined || offer.generation === plan.generation) && offer.root_revision === rootRevision && offer.ask === ask
        && offer.active && cap && commerceId(cap.id) && cap.item_id === plan.soulId && cap.kiosk_id === plan.sellerKioskId && cap.min_price === '0',
      'RELIST_OFFER')
      // The call signs the root revision and ask. The contract samples Config
      // and the remaining Offer fields when it executes the shared-object call.
      const { state, creator, royalty, manifest, config_revision, generation } = offer
      const reviewChanged = plan.reviewSnapshot !== undefined
        && canonical({ state, creator, royalty, manifest: Array.from(manifest), config_revision, generation })
          !== canonical({ ...plan.reviewSnapshot, manifest: Array.from(plan.reviewSnapshot.manifest) })
      const key = { id: plan.soulId, is_exclusive: true }
      const listingId = deriveDynamicFieldID(plan.sellerKioskId, '0x2::kiosk::Listing', ListingKey.serialize(key).toBytes())
      const listingRow = await read(listingId, '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>', 'created')
      const listing = decodeCommerce(NativeExclusiveListingFieldBcs, listingRow.bytes)
      commerceCheck(listingRow.object.owner.ObjectOwner === plan.sellerKioskId && listing.id === listingId
        && listing.name.id === plan.soulId && listing.name.is_exclusive && listing.value === '0', 'RELIST_RESERVATION')
      const kioskIn = await read(plan.sellerKioskId, KioskType, 'input'), kioskOut = await read(plan.sellerKioskId, KioskType, 'mutated')
      const kiosk = decodeCommerce(SoulPublicKioskBcs, kioskIn.bytes)
      const initialSharedVersion = plan.shared.find(ref => ref.objectId === plan.sellerKioskId)!.initialSharedVersion
      commerceCheck(kioskIn.object.owner.Shared?.initialSharedVersion === initialSharedVersion
        && kioskOut.object.owner.Shared?.initialSharedVersion === initialSharedVersion && kiosk.id === plan.sellerKioskId
        && kiosk.owner === seller && !kiosk.allow_extensions && kiosk.item_count > 0
        && toBase64(kioskIn.bytes) === toBase64(kioskOut.bytes), 'RELIST_KIOSK')
      const gas = await readSuiGasSettlement({ client, packet, effects: context.effects, signal })
      const expected = [offerId, listingId, plan.sellerKioskId, ...gas.gasCoinIds]
      const effects = context.effects.V2!
      commerceCheck(new Set([...expected, cap.id, plan.soulId, sellerAccountId]).size === expected.length + 3
        && effects.changedObjects.length === expected.length && new Set(effects.changedObjects.map(([id]) => id)).size === expected.length
        && effects.changedObjects.every(([id]) => expected.includes(id))
        && new Set(effects.unchangedConsensusObjects.map(([id]) => id)).size === effects.unchangedConsensusObjects.length
        && effects.unchangedConsensusObjects.every(([id, effect]) => !expected.includes(id)
          && (effect.$kind === 'PerEpochConfig' || effect.$kind === 'ReadOnlyRoot' && shared.includes(id))), 'RELIST_EFFECTS')
      function reference(row: typeof offerRow) {
        return { version: String(row.reference.version), digest: row.reference.digest, writer: row.object.previousTransaction }
      }
      return { offerId, listingId, purchaseCapId: cap.id, ask, rootRevision, gas, reviewChanged,
        offerOutput: reference(offerRow), listingOutput: reference(listingRow),
        sellerKioskInput: { ...reference(kioskIn), initialSharedVersion, objectId: plan.sellerKioskId } }
    } })
  return result.status === 'SUCCEEDED' ? { ...result, status: 'RELIST_CONFIRMED' as const } : result
}


export function assertNativeSaleListingConsumed(
  listing: Extract<Awaited<ReturnType<typeof readNativeSaleListingHistory>>, { status: 'RELIST_CONFIRMED' }>['receipt'],
  exit: Awaited<ReturnType<typeof proveNativeSaleListingExit>>,
  error: string,
) {
  commerceCheck(exit.offerId === listing.offerId && exit.listingId === listing.listingId
    && exit.purchaseCapId === listing.purchaseCapId && canonical(exit.offerInput) === canonical(listing.offerOutput)
    && canonical(exit.listingInput) === canonical(listing.listingOutput), error)
}
