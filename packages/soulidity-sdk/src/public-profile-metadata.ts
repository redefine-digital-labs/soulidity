import { bcs } from '@mysten/sui/bcs'
import { normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { assertPublicProfileMetadataRef, readWalletProfile, type PublicProfileMetadataRef,
  type WalletProfileDeployment, type WalletProfileReadClient, type WalletProfileSnapshot } from './wallet-profile'
import { profileReadStep as step } from './profile-read-step'

export interface PublicWalletProfileMetadata {
  schema: 'soulidity.public-profile.v1'
  displayName: string | null
  avatar: string | null
  bio: string | null
  coverImageUrl: string | null
  twitterUrl: string | null
  websiteUrl: string | null
}
export interface PublicProfileStorageTarget {
  /** Exact original Blob type from the release's Walrus dependency. */
  blobType: string
  /** Public HTTPS aggregator; never a private token or a profile-supplied URL. */
  aggregatorUrl: string
}
const KEYS = ['schema', 'displayName', 'avatar', 'bio', 'coverImageUrl', 'twitterUrl', 'websiteUrl']
const AVATARS = new Set(['🤖', '🦊', '👻', '📊', '💬', '⚙️', '🌸', '⚡'])
const utf8 = new TextEncoder()
const check = (value: unknown, code: string) => { if (!value) throw new Error(code) }
const publicString = (value: unknown, max: number): string | null => {
  check(value === null || (typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max), 'PROFILE_METADATA_TEXT_INVALID')
  return value === null ? null : (value as string).trim()
}
function publicUrl(value: unknown): string | null {
  if (value === null) return null
  const text = publicString(value, 2048)!
  const url = new URL(text)
  check(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password,
    'PROFILE_METADATA_URL_INVALID')
  return text
}
/** Explicit allowlist prevents accidental publication of account credentials,
 * private presets, device keys or server-returned identity/security fields. */
export function validatePublicWalletProfileMetadata(input: unknown): PublicWalletProfileMetadata {
  check(input !== null && typeof input === 'object' && !Array.isArray(input), 'PROFILE_METADATA_SCHEMA_INVALID')
  const value = input as Record<string, unknown>
  check(Object.keys(value).length === KEYS.length && KEYS.every(key => Object.hasOwn(value, key))
    && value.schema === 'soulidity.public-profile.v1', 'PROFILE_METADATA_SCHEMA_INVALID')
  check(value.avatar === null || AVATARS.has(value.avatar as string), 'PROFILE_METADATA_AVATAR_INVALID')
  return { schema: 'soulidity.public-profile.v1', displayName: publicString(value.displayName, 50),
    avatar: value.avatar as string | null, bio: publicString(value.bio, 160),
    coverImageUrl: publicUrl(value.coverImageUrl), twitterUrl: publicUrl(value.twitterUrl), websiteUrl: publicUrl(value.websiteUrl) }
}
export function encodePublicWalletProfileMetadata(input: unknown): Uint8Array {
  const bytes = utf8.encode(JSON.stringify(validatePublicWalletProfileMetadata(input)))
  check(bytes.length > 0 && bytes.length <= 65536, 'PROFILE_METADATA_LENGTH_INVALID')
  return bytes
}
export async function publicWalletProfileMetadataHash(bytes: Uint8Array): Promise<string> {
  check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 65536, 'PROFILE_METADATA_LENGTH_INVALID')
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))))
}

// Exact Walrus Blob/Storage layout at the release dependency. Do not infer Blob
// identity from an arbitrary URL or SDK projection that omits certified_epoch.
export const ProfileWalrusBlobBcs = bcs.struct('Blob', {
  id: bcs.Address, registered_epoch: bcs.u32(), blob_id: bcs.u256(), size: bcs.u64(), encoding_type: bcs.u8(),
  certified_epoch: bcs.option(bcs.u32()), storage: bcs.struct('Storage', {
    id: bcs.Address, start_epoch: bcs.u32(), end_epoch: bcs.u32(), storage_size: bcs.u64(),
  }), deletable: bcs.bool(),
})
const blobIdText = (bytes: Uint8Array) => toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
function storageTarget(input: PublicProfileStorageTarget) {
  const target = structuredClone(input)
  check(target && typeof target.blobType === 'string'
    && /^0x[0-9a-f]{64}::blob::Blob$/.test(target.blobType)
    && !target.blobType.startsWith(`0x${'0'.repeat(64)}::`), 'PROFILE_STORAGE_TYPE_INVALID')
  check(typeof target.aggregatorUrl === 'string', 'PROFILE_STORAGE_URL_INVALID')
  const url = new URL(target.aggregatorUrl)
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
    'PROFILE_STORAGE_URL_INVALID')
  return { blobType: normalizeStructTag(target.blobType),
    aggregatorUrl: url.href.replace(/\/$/, '') }
}

async function verifyBlob(client: WalletProfileReadClient, target: ReturnType<typeof storageTarget>,
  ref: PublicProfileMetadataRef, signal: AbortSignal) {
  const { object } = await step(signal, () => client.getObject({ objectId: ref.blobObjectId, include: { content: true }, signal }))
  check(object?.objectId === ref.blobObjectId && object.type === target.blobType
    && object.content instanceof Uint8Array && object.content.length <= 256, 'PROFILE_METADATA_BLOB_IDENTITY_MISMATCH')
  const blob = ProfileWalrusBlobBcs.parse(object.content)
  check(toBase64(ProfileWalrusBlobBcs.serialize(blob).toBytes()) === toBase64(object.content)
    && blob.id === ref.blobObjectId && blobIdText(bcs.u256().serialize(blob.blob_id).toBytes()) === ref.blobId
    && blob.size === String(ref.byteLength), 'PROFILE_METADATA_BLOB_CONTENT_MISMATCH')
  check(blob.certified_epoch !== null && blob.certified_epoch >= blob.registered_epoch
    && blob.certified_epoch >= blob.storage.start_epoch && blob.certified_epoch < blob.storage.end_epoch,
  'PROFILE_METADATA_BLOB_NOT_CERTIFIED')
  return blob.storage.end_epoch
}

async function download(target: ReturnType<typeof storageTarget>, ref: PublicProfileMetadataRef,
  signal: AbortSignal, fetcher: typeof fetch) {
  const response = await step(signal, () => fetcher(`${target.aggregatorUrl}/v1/blobs/${ref.blobId}`, {
    credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
  }), late => { void late.body?.cancel().catch(() => {}) })
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {})
    throw new Error('PROFILE_METADATA_STORAGE_UNAVAILABLE')
  }
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) !== ref.byteLength)) {
    void response.body!.cancel().catch(() => {})
    throw new Error('PROFILE_METADATA_LENGTH_MISMATCH')
  }
  const reader = response.body!.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const row = await step(signal, () => reader.read())
      if (row.done) break
      length += row.value.length
      check(length <= ref.byteLength, 'PROFILE_METADATA_LENGTH_MISMATCH')
      chunks.push(row.value)
    }
    check(length === ref.byteLength, 'PROFILE_METADATA_LENGTH_MISMATCH')
  } catch (error) { void reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  check(await step(signal, () => publicWalletProfileMetadataHash(bytes)) === ref.sha256, 'PROFILE_METADATA_HASH_MISMATCH')
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  return validatePublicWalletProfileMetadata(value)
}

/** Cold read: chain identity → exact Walrus object → bounded bytes → digest →
 * public-only schema. No browser DB cache, auth endpoint, cookies or API secret.
 * Successful retrieval does not promise that storage remains funded indefinitely. */
export async function readPublicWalletProfile(params: {
  client: WalletProfileReadClient; deployment: WalletProfileDeployment; profileId: string
  storage: PublicProfileStorageTarget; signal?: AbortSignal; fetcher?: typeof fetch
}): Promise<{ profile: WalletProfileSnapshot; metadata: PublicWalletProfileMetadata; storageEndEpoch: number }> {
  const deployment = structuredClone(params.deployment), storage = storageTarget(params.storage)
  const { client, profileId, fetcher = fetch } = params
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
  const profile = await readWalletProfile({ client, deployment, profileId, signal })
  const ref = assertPublicProfileMetadataRef(profile.metadata)
  const storageEndEpoch = await verifyBlob(client, storage, ref, signal)
  const metadata = await download(storage, ref, signal, fetcher)
  signal.throwIfAborted()
  return { profile, metadata, storageEndEpoch }
}

/** Validate a newly uploaded public document before attaching its pointer to a
 * profile. This proves content/storage only, never wallet or profile ownership. */
export async function readPublicProfileMetadata(params: {
  client: WalletProfileReadClient; reference: PublicProfileMetadataRef
  storage: PublicProfileStorageTarget; signal?: AbortSignal; fetcher?: typeof fetch
}): Promise<{ metadata: PublicWalletProfileMetadata; storageEndEpoch: number }> {
  const ref = assertPublicProfileMetadataRef(params.reference), storage = storageTarget(params.storage)
  const { client, fetcher = fetch } = params
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
  const storageEndEpoch = await verifyBlob(client, storage, ref, signal)
  const metadata = await download(storage, ref, signal, fetcher)
  signal.throwIfAborted()
  return { metadata, storageEndEpoch }
}
