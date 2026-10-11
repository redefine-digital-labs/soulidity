import type { Transaction } from '@mysten/sui/transactions'
import { assertPublicProfileMetadataRef, assertWalletProfileDeployment, buildCreateWalletProfileTx,
  buildUpdateWalletProfileTx, normalizeWalletProfileHandle, readMyWalletProfile,
  type PublicProfileMetadataRef, type WalletProfileDeployment, type WalletProfileReadClient,
  type WalletProfileSnapshot } from './wallet-profile'
import { encodePublicWalletProfileMetadata, publicWalletProfileMetadataHash, readPublicProfileMetadata,
  validatePublicWalletProfileMetadata, type PublicProfileStorageTarget, type PublicWalletProfileMetadata } from './public-profile-metadata'

export interface PublicProfileSaveIntent {
  deployment: WalletProfileDeployment
  owner: string
  expected: { profileId: string; revision: string } | null
  handle: string | null
  metadata: PublicWalletProfileMetadata
}
/** Local recovery of paid public storage only. Never an identity, authorization,
 * transaction-success receipt or replacement for the chain profile. No expiry
 * silently discards a paid upload; its actual storage is checked on every reuse. */
export interface PublicProfileUploadReceipt {
  schema: 'soulidity.public-profile-upload.v1'
  intentHash: string
  reference: PublicProfileMetadataRef
}
export class PublicProfileReceiptPersistenceError extends Error {
  readonly #receipt: PublicProfileUploadReceipt
  constructor(receipt: PublicProfileUploadReceipt, cause: unknown) {
    super('PROFILE_UPLOAD_RECEIPT_NOT_PERSISTED: Keep or export the upload receipt; retry saving it without uploading again.', { cause })
    this.name = 'PublicProfileReceiptPersistenceError'
    this.#receipt = structuredClone(receipt)
  }
  get receipt(): PublicProfileUploadReceipt { return structuredClone(this.#receipt) }
}
const check = (condition: unknown, code: string) => { if (!condition) throw new Error(code) }
const id = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)

export function createPublicProfileSaveIntent(input: PublicProfileSaveIntent): PublicProfileSaveIntent {
  const value = structuredClone(input)
  const deployment = assertWalletProfileDeployment(value.deployment)
  check(id(value.owner), 'PROFILE_INVALID_ID')
  check(value.expected === null || (value.expected && id(value.expected.profileId)
    && typeof value.expected.revision === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value.expected.revision)
    && BigInt(value.expected.revision) < 18446744073709551615n), 'PROFILE_INVALID_EXPECTED_REVISION')
  return { deployment, owner: value.owner,
    expected: value.expected === null ? null : { profileId: value.expected.profileId, revision: value.expected.revision },
    handle: normalizeWalletProfileHandle(value.handle) || null, metadata: validatePublicWalletProfileMetadata(value.metadata) }
}

function assertExpected(intent: PublicProfileSaveIntent, profile: WalletProfileSnapshot | null) {
  check(intent.expected === null ? profile === null : profile !== null
    && profile.id === intent.expected.profileId && profile.revision === intent.expected.revision,
  'PROFILE_CHANGED_RELOAD_REQUIRED')
}

export type PreparedPublicProfileSave =
  | { status: 'already-current'; profile: WalletProfileSnapshot; transaction: null }
  | { status: 'prepared'; intent: PublicProfileSaveIntent; receipt: PublicProfileUploadReceipt; transaction: Transaction }

/** Explicit Save preparation: cold owner/revision read → paid browser upload or
 * exact receipt reuse → certified content read → fresh revision check → one PTB.
 * Does not sign or broadcast. The caller must freeze/persist signed transaction
 * bytes before broadcast and query the same digest after an uncertain result.
 * Upload cancellation is cooperative: do not race/discard a paid upload result.
 * Persist its receipt even if the wallet changes during the upload, then abort. */
export async function preparePublicProfileSave(params: {
  intent: PublicProfileSaveIntent
  client: WalletProfileReadClient
  storage: PublicProfileStorageTarget
  receipt?: PublicProfileUploadReceipt | null
  upload: (bytes: Uint8Array, signal: AbortSignal) => Promise<PublicProfileMetadataRef>
  persistReceipt: (receipt: PublicProfileUploadReceipt) => Promise<void>
  signal: AbortSignal
  fetcher?: typeof fetch
}): Promise<PreparedPublicProfileSave> {
  const intent = createPublicProfileSaveIntent(params.intent), storage = structuredClone(params.storage)
  const receipt = params.receipt ? structuredClone(params.receipt) : null
  const { client, signal, upload, persistReceipt, fetcher } = params
  signal.throwIfAborted()
  const bytes = encodePublicWalletProfileMetadata(intent.metadata)
  const contentHash = await publicWalletProfileMetadataHash(bytes)
  const intentHash = await publicWalletProfileMetadataHash(new TextEncoder().encode(JSON.stringify(intent)))
  signal.throwIfAborted()
  if (receipt) check(receipt.schema === 'soulidity.public-profile-upload.v1' && receipt.intentHash === intentHash,
    'PROFILE_UPLOAD_RECEIPT_SCOPE_MISMATCH')
  const current = await readMyWalletProfile({ client, deployment: intent.deployment, owner: intent.owner, signal })
  if (current && current.handle === intent.handle && current.metadata.sha256 === contentHash) {
    await readPublicProfileMetadata({ client, reference: current.metadata, storage, signal, fetcher })
    const latest = await readMyWalletProfile({ client, deployment: intent.deployment, owner: intent.owner, signal })
    check(latest && latest.id === current.id && latest.revision === current.revision
      && latest.handle === intent.handle && JSON.stringify(latest.metadata) === JSON.stringify(current.metadata),
    'PROFILE_CHANGED_RELOAD_REQUIRED')
    return { status: 'already-current', profile: latest!, transaction: null }
  }
  assertExpected(intent, current)
  const reference = assertPublicProfileMetadataRef(receipt?.reference ?? await upload(new Uint8Array(bytes), signal))
  check(reference.sha256 === contentHash && reference.byteLength === bytes.length, 'PROFILE_UPLOADED_CONTENT_MISMATCH')
  const uploaded: PublicProfileUploadReceipt = { schema: 'soulidity.public-profile-upload.v1', intentHash, reference }
  // Save before another await/abort check can lose the successful paid upload.
  try { await persistReceipt(structuredClone(uploaded)) }
  catch (cause) { throw new PublicProfileReceiptPersistenceError(uploaded, cause) }
  signal.throwIfAborted()
  await readPublicProfileMetadata({ client, reference, storage, signal, fetcher })
  const latest = await readMyWalletProfile({ client, deployment: intent.deployment, owner: intent.owner, signal })
  assertExpected(intent, latest)
  signal.throwIfAborted()
  const common = { deployment: intent.deployment, owner: intent.owner, handle: intent.handle, metadata: reference }
  const transaction = intent.expected === null ? buildCreateWalletProfileTx(common)
    : buildUpdateWalletProfileTx({ ...common, profileId: intent.expected.profileId, expectedRevision: intent.expected.revision })
  return { status: 'prepared', intent, receipt: uploaded, transaction }
}
