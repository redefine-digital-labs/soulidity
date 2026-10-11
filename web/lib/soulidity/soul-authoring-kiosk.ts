import { TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag } from '@mysten/sui/utils'
import { profileReadStep, CollectionKioskRegistryBcs, CollectionKioskRegistrationFieldBcs,
  CollectionPersonalKioskCapBcs, SoulPublicKioskBcs } from '@soulidity/sdk'
import { collectionCommandChain, collectionCommandProjection } from '../collections/collection-command-state'
import { collectionCommandRegistration, collectionCommandRaw, id, decode, same,
  type CollectionCommandObject } from '../collections/collection-command-plan'
import { collectionBuyTypes, collectionBuyOwnerMarker, CollectionBuyOwnerMarkerBcs } from '../collections/collection-buy-plan'
import { parseSoulAuthoringTarget, type SoulAuthoringTarget } from './soul-authoring-manifest'
import type { SoulAuthoringKiosk } from './soul-authoring-transaction'

function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`SOUL_AUTHORING_KIOSK_${code}`) }

/** Fresh, stable double-read of the author's registered personal Kiosk. Only an
 * explicit NOT_FOUND registration permits NEW; transport and custody failures
 * never select a replacement Kiosk. This observation is not a signing proof:
 * the authoring wallet still simulates and proves its exact transaction. */
export async function resolveSoulAuthoringKiosk(params: {
  client: SuiGrpcClient; target: SoulAuthoringTarget; author: string; signal: AbortSignal
}): Promise<SoulAuthoringKiosk> {
  const { client, author } = params, target = parseSoulAuthoringTarget(params.target)
  const signal = AbortSignal.any([params.signal, AbortSignal.timeout(45000)])
  id(author); signal.throwIfAborted()
  const types = collectionBuyTypes(target), objects = new Map<string, CollectionCommandObject | null>()
  await collectionCommandChain(client, target, signal)
  async function read(objectId: string, optional = false) {
    id(objectId)
    const { response } = await profileReadStep(signal, () => client.ledgerService.batchGetObjects({ requests: [{ objectId }],
      readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents', 'previous_transaction', 'bcs'] } }, { abort: signal }))
    check(response.objects.length === 1, 'INCOMPLETE_RESPONSE')
    const result = response.objects[0].result
    check(result.oneofKind === 'object' || optional && result.oneofKind === 'error' && result.error.code === 5, 'OBJECT_UNAVAILABLE')
    const value = result.oneofKind === 'object' ? collectionCommandProjection(result.object) : null
    if (value) check(value.objectId === objectId, 'OBJECT_RESPONSE_ID')
    if (objects.has(objectId)) check(same(objects.get(objectId), value), 'READSET_CHANGED')
    else objects.set(objectId, value)
    return value
  }
  function contents(row: CollectionCommandObject | null, type: string, kind: 'Shared' | 'ObjectOwner' | 'AddressOwner', owner?: string) {
    check(row, 'OBJECT_REQUIRED')
    const raw = collectionCommandRaw(row), move = raw.data.Move
    check(move?.type.Other && normalizeStructTag(TypeTagSerializer.tagToString({ struct: move.type.Other })) === normalizeStructTag(type)
      && raw.owner.$kind === kind && (owner === undefined || raw.owner.AddressOwner === owner || raw.owner.ObjectOwner === owner), 'TYPE_OWNER')
    return move.contents
  }
  const registry = decode(CollectionKioskRegistryBcs, contents(await read(target.kioskRegistryId), types.registry, 'Shared'))
  check(registry.version === '1', 'REGISTRY_VERSION')
  const registrationId = collectionCommandRegistration(target, author)
  check(registrationId !== target.kioskRegistryId, 'OBJECT_ALIAS')
  const registration = await read(registrationId, true)
  let selected: SoulAuthoringKiosk = { kind: 'NEW', kioskId: null, capId: null }
  if (registration) {
    const reg = decode(CollectionKioskRegistrationFieldBcs, contents(registration, types.registration, 'ObjectOwner', target.kioskRegistryId))
    check(reg.name.owner === author && reg.value.version === '1', 'REGISTRATION_INVALID')
    const kioskId = reg.value.kiosk_id, capId = reg.value.kiosk_cap_id
    id(kioskId); id(capId)
    const markerId = collectionBuyOwnerMarker(target, kioskId)
    const ids = [target.kioskRegistryId, registrationId, kioskId, capId, markerId]
    check(new Set(ids).size === ids.length, 'OBJECT_ALIAS')
    const kiosk = decode(SoulPublicKioskBcs, contents(await read(kioskId), types.kiosk, 'Shared'))
    check(kiosk.owner === author, 'KIOSK_OWNER')
    const cap = decode(CollectionPersonalKioskCapBcs, contents(await read(capId), types.cap, 'AddressOwner', author))
    check(cap.cap && cap.cap.for === kioskId && !ids.includes(cap.cap.id), 'CAP_INVALID'); id(cap.cap.id)
    const marker = decode(CollectionBuyOwnerMarkerBcs, contents(await read(markerId), types.ownerMarker, 'ObjectOwner', kioskId))
    check(!marker.name.dummy_field && marker.value === author, 'OWNER_MARKER_INVALID')
    selected = { kind: 'EXISTING', kioskId, capId }
  }
  for (const [objectId, value] of objects) await read(objectId, value === null)
  signal.throwIfAborted()
  return Object.freeze(selected)
}
