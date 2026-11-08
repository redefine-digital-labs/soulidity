import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64, toBase64, normalizeStructTag } from '@mysten/sui/utils'
import { SoulPublicKioskBcs } from '@soulidity/sdk'
import { profileReadStep } from '@soulidity/sdk'
import { collectionCommandRaw } from '../../collections/collection-command-plan'
import { historicalMoveObjectType, readHistoricalMoveObject } from '../../sui/historical-object'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { readFinalizedMutation } from '../../sui/finalized-mutation'
import { readSuiGasSettlement } from '../../sui/gas-settlement'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { CanonicalOwnedAccountBcs } from '../canonical-native-workbench'
import { commerceCheck, commerceId, decodeCommerce } from './economics-read'
import { NativeOfferBcs } from './economics-bcs'

export interface NativeSaleCancelIntent { offerId: string; soulId: string; seller: string; kioskId: string; accountId: string }
const Events = bcs.vector(bcs.struct('Event', { package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
  type_: bcs.StructTag, contents: bcs.byteVector() }))
export const NativeSaleCancelledBcs = bcs.struct('Cancelled', { offer: bcs.Address, root: bcs.Address, seller: bcs.Address })
const ListingKey = bcs.struct('Listing', { id: bcs.Address, is_exclusive: bcs.bool() })
export const NativeExclusiveListingFieldBcs = bcs.struct('Field', { id: bcs.Address, name: ListingKey, value: bcs.u64() })

/** Recovery cancellation deliberately has no Config/current fee/pause gate.
 * It returns a listing capability; the Soul remains locked in its Kiosk.
 * This builder performs no signing, broadcasting or claim of cancellation.
 */
export function buildNativeSaleCancellation(input: NativeSaleCancelIntent & { callablePackageId: string }) {
  commerceCheck([input.offerId, input.soulId, input.seller, input.kioskId, input.accountId, input.callablePackageId].every(commerceId)
    && new Set([input.offerId, input.soulId, input.kioskId, input.accountId]).size === 4, 'CANCEL_INTENT')
  const tx = new Transaction(); tx.setSender(input.seller)
  tx.moveCall({ target: `${input.callablePackageId}::market::cancel`, arguments: [tx.object(input.offerId), tx.object(input.kioskId), tx.object(input.accountId)] })
  return tx
}

/** Finality + exact cancel graph + genuine saved Account reference + original
 * Offer terminal transition + exclusive listing removal + unchanged Kiosk
 * contents/owner + gas. Lock retention is asserted by pinned source execution,
 * not reconstructed as an untouched historical lock read. Never says unlocked.
 */
export async function readNativeSaleCancellationHistory(input: { client: SuiGrpcClient; native: PinnedMovePackage;
  custody: PinnedMovePackage; packet: PublicMutationPacket; intent: NativeSaleCancelIntent; signal: AbortSignal }) {
  const packet = structuredClone(input.packet), intent = structuredClone(input.intent), nativePin = structuredClone(input.native), custodyPin = structuredClone(input.custody)
  const ledger = input.client.ledgerService
  const client = { ledgerService: { getServiceInfo: ledger.getServiceInfo.bind(ledger), getTransaction: ledger.getTransaction.bind(ledger),
    getCheckpoint: ledger.getCheckpoint.bind(ledger), getObject: ledger.getObject.bind(ledger) } } as unknown as SuiGrpcClient
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  buildNativeSaleCancellation({ ...intent, callablePackageId: nativePin.callablePackageId })
  commerceCheck(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 180000, 'CANCEL_PACKET_BOUND')
  const bytes = fromBase64(packet.bytes), raw = bcs.TransactionData.parse(bytes), tx = Transaction.from(bytes).getData()
  commerceCheck(toBase64(bcs.TransactionData.serialize(raw).toBytes()) === packet.bytes && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest
    && tx.sender === intent.seller && Number.isSafeInteger(raw.V1.expiration.Epoch) && String(raw.V1.expiration.Epoch) === packet.expirationEpoch, 'CANCEL_PACKET')
  const call = tx.commands[0]?.MoveCall
  commerceCheck(tx.commands.length === 1 && tx.inputs.length === 3 && call && call.package === nativePin.callablePackageId
    && call.module === 'market' && call.function === 'cancel' && call.typeArguments.length === 0 && call.arguments.length === 3
    && call.arguments.every((arg, index) => arg.$kind === 'Input' && arg.Input === index)
    && tx.inputs[0].Object?.SharedObject?.objectId === intent.offerId && tx.inputs[0].Object.SharedObject.mutable
    && tx.inputs[1].Object?.SharedObject?.objectId === intent.kioskId && tx.inputs[1].Object.SharedObject.mutable
    && tx.inputs[2].Object?.ImmOrOwnedObject?.objectId === intent.accountId, 'CANCEL_GRAPH')
  const result = await readFinalizedMutation({ client, packet, chainIdentifier: '35834a8a', genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',
    signal, errorPrefix: 'COMMERCE_CANCEL_HISTORY', proveSuccess: async context => {
      const native = await readPinnedMovePackage(client, nativePin, signal), custody = await readPinnedMovePackage(client, custodyPin, signal)
      const link = native.linkage.get(custodyPin.originalPackageId)
      commerceCheck(link?.upgradedId === custodyPin.callablePackageId && link.upgradedVersion === String(custody.version), 'CANCEL_CUSTODY_LINK')
      const offerOrigin = native.origins.get('market::Offer'), eventOrigin = native.origins.get('market::Cancelled'), accountOrigin = custody.origins.get('account::Account')
      commerceCheck(offerOrigin && eventOrigin && accountOrigin, 'CANCEL_TYPE_ORIGINS')
      const events = decodeCommerce(Events, context.events)
      commerceCheck(events.length === 1, 'CANCEL_EVENT_COUNT'); const event = events[0]
      commerceCheck(event.type_.address === eventOrigin && event.type_.module === 'market' && event.type_.name === 'Cancelled'
        && event.type_.typeParams.length === 0 && event.package_id === nativePin.callablePackageId && event.transaction_module === 'market'
        && event.sender === intent.seller, 'CANCEL_EVENT_AUTHORITY')
      const receipt = decodeCommerce(NativeSaleCancelledBcs, event.contents)
      commerceCheck(receipt.offer === intent.offerId && receipt.root === intent.soulId && receipt.seller === intent.seller, 'CANCEL_RECEIPT')
      const read = (id: string, type: string, mode: 'input' | 'mutated') => readHistoricalMoveObject({ client, effects: context.effects,
        transactionDigest: packet.digest, objectId: id, type, mode, signal })
      const offerType = `${offerOrigin}::market::Offer`
      const before = await read(intent.offerId, offerType, 'input'), after = await read(intent.offerId, offerType, 'mutated')
      const a = decodeCommerce(NativeOfferBcs, before.bytes), b = decodeCommerce(NativeOfferBcs, after.bytes)
      commerceCheck(before.object.owner.$kind === 'Shared' && after.object.owner.$kind === 'Shared' && a.active && a.purchase && !b.active && b.purchase === null
        && before.object.owner.Shared!.initialSharedVersion === String(tx.inputs[0].Object!.SharedObject!.initialSharedVersion)
        && a.id === intent.offerId && a.root === intent.soulId && a.seller === intent.seller && a.kiosk === intent.kioskId
        && a.purchase.item_id === intent.soulId && a.purchase.kiosk_id === intent.kioskId && a.purchase.min_price === '0'
        && JSON.stringify({ ...a, active: null, purchase: null }) === JSON.stringify({ ...b, active: null, purchase: null }), 'CANCEL_OFFER_TRANSITION')
      const listingId = deriveDynamicFieldID(intent.kioskId, '0x2::kiosk::Listing', ListingKey.serialize({ id: intent.soulId, is_exclusive: true }).toBytes())
      const listingObject = await read(listingId, '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>', 'input')
      const listing = decodeCommerce(NativeExclusiveListingFieldBcs, listingObject.bytes), deletion = context.effects.V2!.changedObjects.find(([id]) => id === listingId)![1]
      commerceCheck(listingObject.object.owner.ObjectOwner === intent.kioskId && listing.id === listingId && listing.name.id === intent.soulId
        && listing.name.is_exclusive && listing.value === '0' && deletion.idOperation.$kind === 'Deleted' && deletion.outputState.$kind === 'NotExist', 'CANCEL_LISTING_REMOVAL')
      const kioskBefore = await read(intent.kioskId, '0x2::kiosk::Kiosk', 'input'), kioskAfter = await read(intent.kioskId, '0x2::kiosk::Kiosk', 'mutated')
      const kiosk = decodeCommerce(SoulPublicKioskBcs, kioskAfter.bytes)
      commerceCheck(kioskBefore.object.owner.$kind === 'Shared' && kioskAfter.object.owner.$kind === 'Shared' && kiosk.id === intent.kioskId
        && kioskBefore.object.owner.Shared!.initialSharedVersion === String(tx.inputs[1].Object!.SharedObject!.initialSharedVersion)
        && kiosk.owner === intent.seller && !kiosk.allow_extensions && toBase64(kioskBefore.bytes) === toBase64(kioskAfter.bytes), 'CANCEL_KIOSK_PRESERVED')
      // Account is an immutable owned transaction input, so it need not appear
      // among mutated effects. Its original signed ObjectRef pins full BCS.
      const ref = tx.inputs[2].Object!.ImmOrOwnedObject!
      const row = (await profileReadStep(signal, () => client.ledgerService.getObject({ objectId: ref.objectId, version: BigInt(ref.version),
        readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] } }, { abort: signal }))).response.object
      commerceCheck(row?.objectId === ref.objectId && String(row.version) === String(ref.version) && row.digest === ref.digest
        && row.bcs?.value instanceof Uint8Array && row.bcs.value.length <= 4096, 'CANCEL_ACCOUNT_REFERENCE')
      const object = collectionCommandRaw({ objectId: ref.objectId, version: String(ref.version), digest: ref.digest, bcs: toBase64(row.bcs.value) })
      commerceCheck(object.owner.AddressOwner === intent.seller && object.data.Move
        && historicalMoveObjectType(object.data.Move.type) === normalizeStructTag(`${accountOrigin}::account::Account`), 'CANCEL_ACCOUNT_TYPE_OWNER')
      const account = decodeCommerce(CanonicalOwnedAccountBcs, object.data.Move.contents), authority = account.authority
      commerceCheck(account.id === intent.accountId && account.owner === intent.seller && account.kiosk === intent.kioskId && authority
        && authority.owner === intent.seller && authority.kiosk === intent.kioskId && authority.cap.for === intent.kioskId, 'CANCEL_ACCOUNT_PAIR')
      const gas = await readSuiGasSettlement({ client, packet, effects: context.effects, signal })
      // The PurchaseCap UID was stored inline inside the original Offer. Its
      // deletion is an unwrapped-then-deleted ID, not a standalone Coin/Object
      // input. Reconcile that exact UID as well as all ordinary object writes.
      const e = context.effects.V2!, capId = a.purchase.id
      const capExit = e.changedObjects.filter(([id]) => id === capId)
      commerceCheck(capExit.length === 1 && capExit[0][1].inputState.$kind === 'NotExist'
        && capExit[0][1].outputState.$kind === 'NotExist' && capExit[0][1].idOperation.$kind === 'Deleted', 'CANCEL_CAP_UID_DELETION')
      const claimedEffectIds = [intent.offerId, intent.kioskId, listingId, capId, ...gas.gasCoinIds]
      commerceCheck(new Set([...claimedEffectIds, intent.accountId, intent.soulId]).size === claimedEffectIds.length + 2
        && e.changedObjects.length === claimedEffectIds.length && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length
        && e.changedObjects.every(([id]) => claimedEffectIds.includes(id))
        && new Set(e.unchangedConsensusObjects.map(([id]) => id)).size === e.unchangedConsensusObjects.length
        && e.unchangedConsensusObjects.every(([id, kind]) => !claimedEffectIds.includes(id) && kind.$kind === 'PerEpochConfig'), 'CANCEL_EFFECTS_COVERAGE')
      return { proof: 'native-cancel-finalized-listing-transition' as const, receipt, gas,
        sourceAssertsSoulStillLocked: true as const, notIndependentUntouchedLockProof: true as const,
        effectsReconciliation: 'exact-cancel-objects-and-gas' as const, claimedEffectIds,
        notCurrentAuthority: true as const, notCurrentListingAbsenceProof: true as const, notPermissionToRetryCancellation: true as const }
    } })
  return result.status === 'SUCCEEDED' ? { ...result, status: 'CANCELLATION_CONFIRMED' as const } : result
}
