import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { assertSoulPublicDeployment, type SoulPublicDeployment, type SoulPublicReadClient } from './soul-public-read'
import { normalizeCollectionFloorAtomic } from './collection-floor-policy'
import { profileReadStep } from './profile-read-step'

export const CollectionFloorKeyBcs = bcs.struct('FloorPolicyKeyV1', { version: bcs.u8() })
export const CollectionFloorValueBcs = bcs.option(bcs.u128())
export const CollectionFloorFieldBcs = bcs.struct('FloorField', {
  id: bcs.Address, name: CollectionFloorKeyBcs, value: CollectionFloorValueBcs,
})
export const CollectionFloorParentBcs = bcs.struct('SoulCollection', {
  id: bcs.Address, version: bcs.u64(), creator: bcs.Address, extra_royalty_bps: bcs.u16(),
  tradeable: bcs.bool(), current_holder: bcs.Address, current_holder_kiosk_id: bcs.Address,
  right_id: bcs.Address, max_supply: bcs.option(bcs.u64()), current_supply: bcs.u64(),
})
const MAX_U64 = 18446744073709551615n
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`COLLECTION_FLOOR_${code}`) }
function id(value: string) { check(/^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'INVALID_ID') }
function decode<T extends { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }>(schema: T, bytes: Uint8Array): ReturnType<T['parse']> {
  const value = schema.parse(bytes)
  check(toBase64(schema.serialize(value).toBytes()) === toBase64(bytes), 'NONCANONICAL_BCS')
  return value
}

/** Raw shared-chain policy only. Missing/invalid is unavailable, never None/zero.
 * This reader does not hide a listing or authorize any market transaction. */
export async function readCollectionFloorPolicy(params: {
  client: SoulPublicReadClient; deployment: SoulPublicDeployment; collectionId: string; signal?: AbortSignal
}): Promise<Readonly<{ collectionId: string; floorPriceAtomic: string | null; collectionVersion: string; collectionDigest: string }>> {
  const deployment = assertSoulPublicDeployment(params.deployment), collectionId = params.collectionId, client = params.client
  id(collectionId)
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
  const { chainIdentifier } = await profileReadStep(signal, () => client.core.getChainIdentifier())
  const genesis = fromBase58(chainIdentifier)
  check(genesis.length === 32 && toBase58(genesis) === chainIdentifier
    && toHex(genesis.subarray(0, 4)) === deployment.chainIdentifier, 'WRONG_CHAIN')
  const keyType = `${deployment.originalPackageId}::collection::FloorPolicyKeyV1`
  const fieldId = deriveDynamicFieldID(collectionId, keyType, CollectionFloorKeyBcs.serialize({ version: 1 }).toBytes())
  const reads = new Map<string, string>()
  async function read(objectId: string, type: string, kind: number, owner?: string) {
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId,
      readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } }))
    const raw = response.object
    check(raw?.objectId === objectId && raw.objectType === normalizeStructTag(type)
      && typeof raw.version === 'bigint' && raw.version > 0n && raw.version <= MAX_U64, 'OBJECT_MISMATCH')
    check(typeof raw.digest === 'string' && fromBase58(raw.digest).length === 32
      && toBase58(fromBase58(raw.digest)) === raw.digest, 'DIGEST_INVALID')
    check(raw.owner?.kind === kind && (!owner || raw.owner.address === owner)
      && (kind !== 3 || typeof raw.owner.version === 'bigint' && raw.owner.version > 0n && raw.owner.version <= MAX_U64), 'OWNER_MISMATCH')
    check(raw.contents?.value instanceof Uint8Array && raw.contents.value.length > 0
      && raw.contents.value.length <= 1024, 'CONTENTS_INVALID')
    const fingerprint = [raw.version.toString(), raw.digest, toBase64(raw.contents.value),
      raw.owner.kind, raw.owner.address, raw.owner.version?.toString()].join('|')
    check(!reads.has(objectId) || reads.get(objectId) === fingerprint, 'CHANGED_RETRY')
    reads.set(objectId, fingerprint)
    return { bytes: raw.contents.value, version: raw.version.toString(), digest: raw.digest }
  }
  const parentType = `${deployment.originalPackageId}::collection::SoulCollection`
  const fieldType = `0x2::dynamic_field::Field<${keyType},0x1::option::Option<u128>>`
  const parentRaw = await read(collectionId, parentType, 3)
  const parent = decode(CollectionFloorParentBcs, parentRaw.bytes)
  check(parent.id === collectionId && parent.version === '1', 'PARENT_MISMATCH')
  const field = decode(CollectionFloorFieldBcs, (await read(fieldId, fieldType, 2, collectionId)).bytes)
  check(field.id === fieldId && field.name.version === 1, 'KEY_MISMATCH')
  const floor = normalizeCollectionFloorAtomic(field.value)
  await read(collectionId, parentType, 3)
  await read(fieldId, fieldType, 2, collectionId)
  signal.throwIfAborted()
  return Object.freeze({ collectionId, floorPriceAtomic: floor?.toString() ?? null,
    collectionVersion: parentRaw.version, collectionDigest: parentRaw.digest })
}
