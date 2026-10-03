import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toBase64 } from '@mysten/sui/utils'
import { profileReadStep, SoulPublicCollectionBcs, CollectionKioskRegistrationFieldBcs, CollectionPublicListingBcs,
  SoulPublicMarketConfigBcs, deriveKioskItemFieldId } from '@soulidity/sdk'
import type { CollectionCommandObject } from './collection-command-plan'
import { collectionCommandProjection, collectionCommandChain, collectionCommandSignal } from './collection-command-state'
import { check, id, same, decode, collectionCommandRaw, collectionCommandMarker, collectionCommandRegistration,
  collectionBuyContents, collectionBuyOwnerMarker, collectionBuyLock, collectionBuyRuleIds, collectionBuyTypes,
  CollectionBuyCoinBcs, collectionBuyRawType, parseCollectionBuyTarget, parseCollectionBuyPlan,
  type CollectionBuyPlan, type CollectionBuyTarget } from './collection-buy-plan'

export async function prepareCollectionBuyPlan(params: { client: SuiGrpcClient; target: CollectionBuyTarget;
  request: CollectionBuyPlan['request']; author: string; signal?: AbortSignal; paymentCoinObjectIds?: string[] }): Promise<CollectionBuyPlan> {
  const client = params.client, paymentCoinObjectIds = params.paymentCoinObjectIds ? [...params.paymentCoinObjectIds] : undefined
  const request = structuredClone(params.request), author = params.author, target = parseCollectionBuyTarget(params.target)
  id(author); id(request.collectionId); id(request.listingId)
  const signal = collectionCommandSignal(params.signal), objects = new Map<string, CollectionCommandObject | null>()
  await collectionCommandChain(client, target, signal)
  async function read(objectId: string, optional = false) {
    id(objectId)
    const { response } = await profileReadStep(signal, () => client.ledgerService.batchGetObjects({ requests: [{ objectId }],
      readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents', 'previous_transaction', 'bcs'] } }, { abort: signal }))
    check(response.objects.length === 1, 'INCOMPLETE_RESPONSE'); const r = response.objects[0].result
    check(r.oneofKind === 'object' || optional && r.oneofKind === 'error' && r.error.code === 5, 'OBJECT_UNAVAILABLE')
    const value = r.oneofKind === 'object' ? collectionCommandProjection(r.object) : null
    if (value) check(value.objectId === objectId, 'OBJECT_RESPONSE_ID')
    if (objects.has(objectId)) check(same(objects.get(objectId), value), 'READSET_CHANGED'); else objects.set(objectId, value)
    return value
  }
  async function bytes(objectId: string) { const value = await read(objectId); check(value, 'OBJECT_REQUIRED'); return collectionBuyContents(value) }
  await read(target.callablePackageId); await read(target.kioskPackageId)
  const collectionBytes = await bytes(request.collectionId), c = decode(SoulPublicCollectionBcs, collectionBytes)
  id(c.right_id); id(c.current_holder); id(c.current_holder_kiosk_id)
  const rightBytes = await bytes(c.right_id)
  await read(c.current_holder_kiosk_id); await read(deriveKioskItemFieldId(c.current_holder_kiosk_id, c.right_id))
  await read(collectionBuyOwnerMarker(target, c.current_holder_kiosk_id))
  await read(collectionBuyLock(c.current_holder_kiosk_id, c.right_id), true)
  await read(collectionCommandMarker(c.current_holder_kiosk_id, c.right_id, true))
  await read(collectionCommandMarker(c.current_holder_kiosk_id, c.right_id, false), true)
  const listingBytes = await bytes(request.listingId), listing = decode(CollectionPublicListingBcs, listingBytes)
  const marketBytes = await bytes(target.marketConfigId), market = decode(SoulPublicMarketConfigBcs, marketBytes)
  const policyBytes = await bytes(target.collectionTransferPolicyId)
  for (const ruleId of collectionBuyRuleIds(target)) await read(ruleId)
  await read(target.kioskRegistryId)
  const reg = await read(collectionCommandRegistration(target, author), true)
  let buyerKiosk: CollectionBuyPlan['buyerKiosk'] = { kind: 'NEW', kioskId: null, capId: null }
  if (reg) {
    const value = decode(CollectionKioskRegistrationFieldBcs, collectionBuyContents(reg))
    buyerKiosk = { kind: 'EXISTING', kioskId: value.value.kiosk_id, capId: value.value.kiosk_cap_id }
    await read(buyerKiosk.kioskId!); await read(buyerKiosk.capId!); await read(collectionBuyOwnerMarker(target, buyerKiosk.kioskId!))
    await read(deriveKioskItemFieldId(buyerKiosk.kioskId!, c.right_id), true); await read(collectionBuyLock(buyerKiosk.kioskId!, c.right_id), true)
  }
  const fee = (BigInt(listing.price) * BigInt(market.platform_fee_bps) + 9999n) / 10000n, total = BigInt(listing.price) + fee
  const candidates: { row: CollectionCommandObject; balance: bigint }[] = [], t = collectionBuyTypes(target)
  async function coin(objectId: string) {
    const row = await read(objectId); check(row, 'PAYMENT_UNAVAILABLE'); const raw = collectionCommandRaw(row)
    check(collectionBuyRawType(raw) === t.coin && raw.owner.AddressOwner === author, 'PAYMENT_TYPE_OWNER')
    candidates.push({ row, balance: BigInt(decode(CollectionBuyCoinBcs, collectionBuyContents(row)).balance) })
  }
  if (paymentCoinObjectIds) {
    check(paymentCoinObjectIds.length > 0 && paymentCoinObjectIds.length <= 32 && new Set(paymentCoinObjectIds).size === paymentCoinObjectIds.length, 'PAYMENT_SELECTION')
    for (const objectId of paymentCoinObjectIds) await coin(objectId)
  } else {
    let token: Uint8Array | undefined, found = false; const cursors = new Set<string>(), seen = new Set<string>()
    for (let page = 0; page < 10; page++) {
      const { response } = await profileReadStep(signal, () => client.stateService.listOwnedObjects({ owner: author, objectType: t.coin,
        pageSize: 20, pageToken: token, readMask: { paths: ['object_id'] } }, { abort: signal }))
      check(Array.isArray(response.objects), 'PAYMENT_SCAN_RESPONSE')
      for (const row of response.objects) { id(row.objectId); check(!seen.has(row.objectId!), 'PAYMENT_SCAN_DUPLICATE'); seen.add(row.objectId!); await coin(row.objectId!) }
      candidates.sort((a, b) => a.balance === b.balance ? a.row.objectId.localeCompare(b.row.objectId) : a.balance > b.balance ? -1 : 1)
      found = candidates.slice(0, 32).reduce((sum, row) => sum + row.balance, 0n) >= total
      if (found || !response.nextPageToken?.length) break
      token = response.nextPageToken; const cursor = toBase64(token); check(!cursors.has(cursor), 'PAYMENT_SCAN_CURSOR'); cursors.add(cursor)
      check(page < 9, 'PAYMENT_SCAN_LIMIT')
    }
    check(found, 'INSUFFICIENT_PAYMENT')
  }
  const selected: string[] = []; let balance = 0n
  for (const candidate of candidates) {
    if (paymentCoinObjectIds || balance < total && selected.length < 32) { selected.push(candidate.row.objectId); balance += candidate.balance }
    else objects.delete(candidate.row.objectId)
  }
  const plan = parseCollectionBuyPlan({ schema: 'soulidity.collection-buy-plan.v1', target, request, author, rightId: c.right_id,
    sellerAddress: c.current_holder, sellerKioskId: c.current_holder_kiosk_id, buyerKiosk, paymentCoinIds: selected,
    objects: [...objects.values()].filter((value): value is CollectionCommandObject => value !== null),
    absentIds: [...objects].filter(([, value]) => value === null).map(([objectId]) => objectId),
    expected: { collectionBcs: toBase64(collectionBytes), rightBcs: toBase64(rightBytes), listingBcs: toBase64(listingBytes), marketBcs: toBase64(marketBytes), policyBcs: toBase64(policyBytes) },
    quote: { priceAtomic: listing.price, feeBps: market.platform_fee_bps, feeAtomic: String(fee), buyerTotalAtomic: String(total), sellerReceivesAtomic: listing.price } })
  for (const [objectId, value] of objects) await read(objectId, value === null)
  signal.throwIfAborted(); return plan
}
export async function assertCollectionBuyCurrent(params: { client: SuiGrpcClient; plan: CollectionBuyPlan; signal?: AbortSignal }) {
  const client = params.client, signal = params.signal, p = parseCollectionBuyPlan(params.plan)
  const current = await prepareCollectionBuyPlan({ client, signal, target: p.target, request: p.request,
    author: p.author, paymentCoinObjectIds: p.paymentCoinIds })
  check(same(p.expected, current.expected) && same(p.quote, current.quote) && same(p.buyerKiosk, current.buyerKiosk)
    && same([...p.absentIds].sort(), [...current.absentIds].sort()) && p.objects.length === current.objects.length, 'AUTHORITY_CHANGED')
  for (const old of p.objects) {
    const now = current.objects.find(row => row.objectId === old.objectId); check(now, 'READSET_CHANGED')
    const before = collectionCommandRaw(old), after = collectionCommandRaw(now)
    check(same(before.owner, after.owner) && (before.owner.AddressOwner !== undefined || before.data.Package
      ? same(old, now) : toBase64(before.data.Move!.contents) === toBase64(after.data.Move!.contents)), 'FROZEN_REFERENCE_CHANGED')
  }
  return current
}
