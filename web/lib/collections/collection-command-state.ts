import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { TypeTagSerializer } from '@mysten/sui/bcs'
import { fromBase58, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep, SoulPublicCollectionBcs, CollectionKioskRegistrationFieldBcs,
  SoulPublicMarketConfigBcs, CollectionPublicListingBcs, deriveKioskItemFieldId } from '@soulidity/sdk'
import { check, id, digest, same, decode, collectionCommandRaw, collectionCommandTypes, collectionCommandMarker,
  collectionCommandRegistration, parseCollectionCommandTarget, parseCollectionCommandPlan,
  type CollectionCommandTarget, type CollectionCommandRequest, type CollectionCommandObject, type CollectionCommandPlan } from './collection-command-plan'

export const collectionCommandSignal = (signal?: AbortSignal) => signal
  ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000)
type Raw = NonNullable<Awaited<ReturnType<SuiGrpcClient['ledgerService']['getObject']>>['response']['object']>
export function collectionCommandProjection(row: Raw | undefined): CollectionCommandObject {
  check(row?.bcs?.value instanceof Uint8Array, 'FULL_OBJECT_REQUIRED')
  const result = { objectId: row.objectId!, version: String(row.version), digest: row.digest!, bcs: toBase64(row.bcs.value) }
  const raw = collectionCommandRaw(result), move = raw.data.Move, owner = raw.owner
  check(owner.AddressOwner !== undefined ? row.owner?.kind === 1 && row.owner.address === owner.AddressOwner
    : owner.ObjectOwner !== undefined ? row.owner?.kind === 2 && row.owner.address === owner.ObjectOwner
      : owner.Shared !== undefined ? row.owner?.kind === 3 && row.owner.version === BigInt(owner.Shared.initialSharedVersion)
        : owner.$kind === 'Immutable' && row.owner?.kind === 4, 'OWNER_PROJECTION')
  check(row.previousTransaction === raw.previousTransaction, 'PREVIOUS_TRANSACTION_PROJECTION')
  if (move) {
    const type = move.type.Other ? TypeTagSerializer.tagToString({ struct: move.type.Other })
      : move.type.Coin ? `0x2::coin::Coin<${move.type.Coin}>`
        : move.type.$kind === 'GasCoin' ? '0x2::coin::Coin<0x2::sui::SUI>' : null
    check(type && row.objectType === normalizeStructTag(type) && row.contents?.value instanceof Uint8Array
      && toBase64(row.contents.value) === toBase64(move.contents), 'CONTENTS_PROJECTION')
  }
  return result
}
export async function collectionCommandChain(client: SuiGrpcClient, d: CollectionCommandTarget, signal: AbortSignal) {
  const chain = (await profileReadStep(signal, () => client.core.getChainIdentifier())).chainIdentifier
  digest(chain); check(toHex(fromBase58(chain).subarray(0, 4)) === d.chainIdentifier, 'WRONG_CHAIN')
}
/** The candidate listing ID is only a lookup hint. An inactive or mismatching
 * candidate fails; this reader never silently selects a different listing. */
export async function prepareCollectionCommandPlan(params: {
  client: SuiGrpcClient; target: CollectionCommandTarget; request: CollectionCommandRequest; author: string
  listingObjectOnChainId?: string | null; signal?: AbortSignal
}): Promise<CollectionCommandPlan> {
  const { request, author, listingObjectOnChainId } = structuredClone({ request: params.request, author: params.author,
    listingObjectOnChainId: params.listingObjectOnChainId ?? null })
  id(author); id(request.collectionId)
  const target = parseCollectionCommandTarget(params.target), signal = collectionCommandSignal(params.signal), t = collectionCommandTypes(target)
  await collectionCommandChain(params.client, target, signal)
  const objects = new Map<string, CollectionCommandObject | null>()
  async function read(objectId: string, optional = false) {
    id(objectId)
    const { response } = await profileReadStep(signal, () => params.client.ledgerService.batchGetObjects({ requests: [{ objectId }],
      readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents', 'previous_transaction', 'bcs'] } }, { abort: signal }))
    check(response.objects.length === 1, 'INCOMPLETE_RESPONSE')
    const r = response.objects[0].result
    check(r.oneofKind === 'object' || optional && r.oneofKind === 'error' && r.error.code === 5, 'OBJECT_UNAVAILABLE')
    const value = r.oneofKind === 'object' ? collectionCommandProjection(r.object) : null
    if (value) check(value.objectId === objectId, 'OBJECT_RESPONSE_ID')
    if (objects.has(objectId)) check(same(objects.get(objectId), value), 'READSET_CHANGED')
    else objects.set(objectId, value)
    return value
  }
  function contents(object: CollectionCommandObject | null) {
    check(object, 'REQUIRED_OBJECT'); const move = collectionCommandRaw(object).data.Move; check(move, 'MOVE_REQUIRED'); return move.contents
  }
  await read(target.callablePackageId)
  const collectionBytes = contents(await read(request.collectionId)), c = decode(SoulPublicCollectionBcs, collectionBytes)
  id(c.right_id); id(c.current_holder_kiosk_id)
  const rightBytes = contents(await read(c.right_id)), kioskBytes = contents(await read(c.current_holder_kiosk_id))
  await read(deriveKioskItemFieldId(c.current_holder_kiosk_id, c.right_id))
  await read(target.kioskRegistryId)
  const registrationBytes = contents(await read(collectionCommandRegistration(target, author)))
  const reg = decode(CollectionKioskRegistrationFieldBcs, registrationBytes); id(reg.value.kiosk_cap_id)
  const capBytes = contents(await read(reg.value.kiosk_cap_id))
  const listing = request.action !== 'list', selling = request.action !== 'delist'
  const exclusive = collectionCommandMarker(c.current_holder_kiosk_id, c.right_id, true)
  const ordinary = collectionCommandMarker(c.current_holder_kiosk_id, c.right_id, false)
  await read(exclusive, !listing); await read(ordinary, true)
  if (listing) id(listingObjectOnChainId)
  const listingBytes = listing ? contents(await read(listingObjectOnChainId!)) : null
  const marketBytes = selling ? contents(await read(target.marketConfigId)) : null
  const price = selling ? request.priceAtomic! : decode(CollectionPublicListingBcs, listingBytes!).price
  const feeBps = marketBytes ? decode(SoulPublicMarketConfigBcs, marketBytes).platform_fee_bps : 0
  const fee = (BigInt(price) * BigInt(feeBps) + 9999n) / 10000n
  const plan = parseCollectionCommandPlan({ schema: 'soulidity.collection-command-plan.v1', target, request, author,
    rightId: c.right_id, kioskId: c.current_holder_kiosk_id, kioskCapId: reg.value.kiosk_cap_id,
    oldListingId: listing ? listingObjectOnChainId : null,
    objects: [...objects.values()].filter((value): value is CollectionCommandObject => value !== null),
    absentIds: [...objects].filter(([, value]) => value === null).map(([key]) => key),
    expected: { collectionBcs: toBase64(collectionBytes), rightBcs: toBase64(rightBytes), kioskBcs: toBase64(kioskBytes),
      registrationBcs: toBase64(registrationBytes), capBcs: toBase64(capBytes), listingBcs: listingBytes ? toBase64(listingBytes) : null,
      marketBcs: marketBytes ? toBase64(marketBytes) : null },
    quote: { priceAtomic: price, feeBps, feeAtomic: String(fee), buyerTotalAtomic: String(BigInt(price) + fee), sellerReceivesAtomic: price } })
  // A stable double-read is a bounded observation, not an atomic chain snapshot.
  // The Move guards and owned references enforce the actual signing boundary.
  for (const [objectId, value] of objects) await read(objectId, value === null)
  signal.throwIfAborted(); return plan
}
export async function assertCollectionCommandCurrent(params: { client: SuiGrpcClient; plan: CollectionCommandPlan; signal?: AbortSignal }) {
  const p = parseCollectionCommandPlan(params.plan)
  const current = await prepareCollectionCommandPlan({ client: params.client, target: p.target, request: p.request,
    author: p.author, listingObjectOnChainId: p.oldListingId, signal: params.signal })
  // Do not invent an ownership revision: Collection version is a schema field.
  // Full frozen domain values plus exact owned cap reference remain necessary.
  check(same(p.expected, current.expected) && same(p.quote, current.quote) && p.kioskId === current.kioskId
    && p.kioskCapId === current.kioskCapId && p.rightId === current.rightId && same(p.absentIds, current.absentIds), 'AUTHORITY_CHANGED')
  const cap = (plan: CollectionCommandPlan) => plan.objects.find(row => row.objectId === plan.kioskCapId)
  check(same(cap(p), cap(current)), 'OWNED_CAP_REFERENCE_CHANGED')
  return current
}
