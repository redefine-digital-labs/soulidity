import {
  assertPublicProfileMetadataRef, createPublicProfileSaveIntent,
  preparePublicProfileSave, publicProfileOperationKey, readMyWalletProfile,
  runPublicProfileOperation, type PublicProfileOperationStore, type PublicProfileSaveIntent,
  type PublicProfileUploadReceipt,
} from '@soulidity/sdk'
import { createPublicProfileOperationClient } from './profile-operation-client'
import type { BrowserProfileConfig } from './profile-config'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { Transaction } from '@mysten/sui/transactions'
import type { ProfileCoverCache } from './profile-cover-cache'

export interface ProfileStorageReceipt {
  blobId: string; blobObjectId: string; contentHash: string; blobUrl: string
  recoveryKey: string; certifyTxDigest: string
}
export interface ProfileSaveDraft {
  schema: 'soulidity.profile-save-draft.v1'
  id: string
  intent: PublicProfileSaveIntent
  cover: { sha256: string; byteLength: number; type: string } | null
  coverReceipt: ProfileStorageReceipt | null
  metadataReceipt: PublicProfileUploadReceipt | null
}
export interface ProfileDraftStore {
  read(key: string): ProfileSaveDraft | null
  write(key: string, value: ProfileSaveDraft): void
  archive(key: string, value: ProfileSaveDraft): void
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const json = (value: unknown) => JSON.stringify(value)
async function coverHash(file: File) {
  check(file.size > 0 && file.size <= 10 * 1024 * 1024, 'PROFILE_DRAFT_COVER_INVALID')
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
    value => value.toString(16).padStart(2, '0')).join('')
}
export function parseProfileSaveDraft(input: unknown): ProfileSaveDraft {
  const value = structuredClone(input) as ProfileSaveDraft
  check(value?.schema === 'soulidity.profile-save-draft.v1' && /^[0-9a-f-]{36}$/.test(value.id), 'PROFILE_DRAFT_INVALID')
  check(json(createPublicProfileSaveIntent(value.intent)) === json(value.intent), 'PROFILE_DRAFT_INTENT_INVALID')
  check(value.cover === null || value.cover && /^[0-9a-f]{64}$/.test(value.cover.sha256)
    && Number.isSafeInteger(value.cover.byteLength) && value.cover.byteLength > 0 && value.cover.byteLength <= 10 * 1024 * 1024
    && ['image/png', 'image/jpeg', 'image/webp'].includes(value.cover.type), 'PROFILE_DRAFT_COVER_INVALID')
  check(value.coverReceipt === null || value.cover && value.coverReceipt
    && value.coverReceipt.contentHash === value.cover.sha256 && typeof value.coverReceipt.recoveryKey === 'string'
    && typeof value.coverReceipt.certifyTxDigest === 'string' && typeof value.coverReceipt.blobUrl === 'string', 'PROFILE_DRAFT_COVER_RECEIPT_INVALID')
  if (value.metadataReceipt !== null) {
    check(value.metadataReceipt?.schema === 'soulidity.public-profile-upload.v1'
      && /^[0-9a-f]{64}$/.test(value.metadataReceipt.intentHash), 'PROFILE_DRAFT_RECEIPT_INVALID')
    assertPublicProfileMetadataRef(value.metadataReceipt.reference)
  }
  return value
}

/** Public crash-recovery journal only. Never stores a cover body, private key,
 * private preferences or an authoritative copy of the chain account. */
export function browserProfileDraftStore(): ProfileDraftStore {
  const storage = window.localStorage
  function write(key: string, value: ProfileSaveDraft) {
    const encoded = json(parseProfileSaveDraft(value))
    check(encoded.length <= 65536, 'PROFILE_DRAFT_TOO_LARGE')
    storage.setItem(key, encoded)
    check(storage.getItem(key) === encoded, 'PROFILE_DRAFT_PERSISTENCE_FAILED')
  }
  return {
    read(key) {
      const raw = storage.getItem(key)
      if (raw === null) return null
      check(raw.length <= 65536, 'PROFILE_DRAFT_TOO_LARGE')
      return parseProfileSaveDraft(JSON.parse(raw))
    },
    write,
    archive(key, value) {
      write(`${key}:archive:${value.id}`, value)
      storage.removeItem(key)
      check(storage.getItem(key) === null, 'PROFILE_DRAFT_ARCHIVE_FAILED')
    },
  }
}
export type ProfileUploadRecovery = { status: 'NONE' | 'SOURCE_REQUIRED' | 'UNKNOWN' | 'FAILED' | 'CERTIFIED'; result?: ProfileStorageReceipt }
export interface ProfileSaveTransport {
  recover(scope: string, owner: string): Promise<ProfileUploadRecovery>
  upload(file: File, scope: string, owner: string): Promise<ProfileStorageReceipt>
  acknowledge(receipt: ProfileStorageReceipt): Promise<void>
}
export class ProfileDraftPersistenceError extends Error {
  readonly recovery: ProfileSaveDraft
  constructor(recovery: ProfileSaveDraft, cause: unknown) {
    super('PROFILE_DRAFT_NOT_PERSISTED: Export the recovery record. Existing upload packets remain recoverable; do not start a new upload.', { cause })
    this.recovery = structuredClone(recovery)
  }
}

export function createProfileSaveController(params: {
  config: BrowserProfileConfig; client: SuiGrpcClient; getAddress: () => string | null
  sign: (tx: Transaction) => Promise<{ bytes: string; signature: string }>
  operations: PublicProfileOperationStore; drafts: ProfileDraftStore; uploads: ProfileSaveTransport
  covers: ProfileCoverCache
}) {
  const { client, operations, drafts, uploads, covers, getAddress, sign } = params
  const config = structuredClone(params.config)
  const txClient = createPublicProfileOperationClient({ client, ...config,
    writesEnabled: () => config.writesEnabled, getAddress, sign })
  const draftKey = (intent: PublicProfileSaveIntent) => `${publicProfileOperationKey(intent)}:draft`
  const scope = (draft: ProfileSaveDraft, part: 'cover' | 'metadata') => `${publicProfileOperationKey(draft.intent)}:${draft.id}:${part}`
  function persist(key: string, draft: ProfileSaveDraft) {
    try { drafts.write(key, draft) } catch (error) { throw new ProfileDraftPersistenceError(draft, error) }
  }
  function writable(owner: string) {
    check(config.writesEnabled, 'PROFILE_WRITES_DISABLED')
    check(getAddress() === owner, 'PROFILE_RECONNECT_PREPARING_WALLET')
  }
  async function expected(draft: ProfileSaveDraft) {
    writable(draft.intent.owner)
    const current = await readMyWalletProfile({ client: client.core, deployment: config.deployment,
      owner: draft.intent.owner, signal: AbortSignal.timeout(15000) })
    check(draft.intent.expected === null ? current === null : current?.id === draft.intent.expected.profileId
      && current.revision === draft.intent.expected.revision, 'PROFILE_CHANGED_RELOAD_REQUIRED')
    writable(draft.intent.owner)
  }
  async function cover(draft: ProfileSaveDraft, key: string, file: File | null, queryOnly: boolean) {
    if (!draft.cover) return true
    const recovered = await uploads.recover(scope(draft, 'cover'), draft.intent.owner)
    let receipt = recovered.result
    if (recovered.status !== 'CERTIFIED') {
      check(!draft.coverReceipt, 'PROFILE_PAID_COVER_UNCONFIRMED')
      if (queryOnly) return false
      // Explicit resume may pass the SAME source/scope to the storage WAL. It
      // queries first, never rebuilds signed packets, and stops on PENDING or
      // expired unknown transactions. The query action never reaches upload.
      check(recovered.status !== 'FAILED', 'PROFILE_COVER_TRANSACTION_FAILED_ARCHIVE_REQUIRED')
      file ??= await covers.read(scope(draft, 'cover'))
      check(file, 'PROFILE_RESELECT_ORIGINAL_COVER')
      check(file.type === draft.cover.type && file.size === draft.cover.byteLength
        && await coverHash(file) === draft.cover.sha256,
      'PROFILE_RESELECT_MATCHING_COVER')
      await covers.write(scope(draft, 'cover'), file)
      const durable = await covers.read(scope(draft, 'cover'))
      check(durable && durable.type === draft.cover.type && durable.size === draft.cover.byteLength
        && await coverHash(durable) === draft.cover.sha256, 'PROFILE_COVER_RECOVERY_PERSISTENCE_FAILED')
      writable(draft.intent.owner)
      receipt = await uploads.upload(file, scope(draft, 'cover'), draft.intent.owner)
    }
    check(receipt && receipt.contentHash === draft.cover.sha256, 'PROFILE_COVER_HASH_MISMATCH')
    const base = config.storage.aggregatorUrl.replace(/\/+$/, '')
    check(receipt.blobUrl === `${base}/v1/blobs/${encodeURIComponent(receipt.blobId)}`, 'PROFILE_COVER_STORAGE_MISMATCH')
    // Persist before acknowledging or checking the wallet again: payment may
    // have completed while its owner disconnected.
    draft.coverReceipt = structuredClone(receipt)
    persist(key, draft)
    await uploads.acknowledge(receipt)
    return true
  }
  return {
    inspect(intent: PublicProfileSaveIntent) {
      return { draft: drafts.read(draftKey(intent)), operation: operations.read(publicProfileOperationKey(intent)) }
    },
    async run(input: { intent: PublicProfileSaveIntent; coverFile?: File | null; mode: 'save' | 'resume' | 'query' | 'discard' }) {
      input = { ...input }
      const intent = createPublicProfileSaveIntent(input.intent), key = publicProfileOperationKey(intent), keyDraft = draftKey(intent)
      check(json(intent.deployment) === json(config.deployment), 'PROFILE_RELEASE_CHANGED')
      return operations.exclusive(key, async () => {
        // The outer lease spans ALL paid work. Only this closure can bypass
        // the runner's identical inner lease, avoiding a reentrant Web Lock.
        const leased: PublicProfileOperationStore = { ...operations, exclusive: async (_key, work) => { check(_key === key, 'PROFILE_LEASE_SCOPE'); return work() } }
        let draft = drafts.read(keyDraft)
        if (draft) check(json(draft.intent.deployment) === json(config.deployment)
          && publicProfileOperationKey(draft.intent) === key, 'PROFILE_DRAFT_SCOPE_MISMATCH')
        const previous = operations.read(key)
        if (previous) {
          const belongs = !draft || json(previous.intent) === json(finalIntent(draft))
          const record = await runPublicProfileOperation({ intent: previous.intent, store: leased, adapter: txClient.adapter,
            queryOnly: input.mode === 'query' || input.mode === 'save' || !belongs,
            cancelUnsigned: input.mode === 'discard' && belongs })
          if (record.phase === 'SUCCEEDED') {
            if (belongs && draft) drafts.archive(keyDraft, draft)
            if (belongs && (draft || input.mode !== 'save')) return { status: 'saved' as const, intent: record.intent }
          }
          if (!['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(record.phase)) return { status: 'pending' as const, intent: record.intent }
          if (belongs && draft && input.mode !== 'discard') throw new Error('PROFILE_TRANSACTION_FINISHED_ARCHIVE_BEFORE_NEW_SAVE')
        }
        if (input.mode === 'discard') {
          if (draft) {
            for (const part of ['cover', 'metadata'] as const) {
              if (part === 'cover' && !draft.cover) continue
              const recovery = await uploads.recover(scope(draft, part), draft.intent.owner)
              check(['NONE', 'CERTIFIED', 'FAILED'].includes(recovery.status), 'PROFILE_UPLOAD_UNRESOLVED_CANNOT_DISCARD')
            }
            drafts.archive(keyDraft, draft)
          }
          return { status: 'archived' as const, intent: draft?.intent ?? intent }
        }
        if (!draft) {
          if (input.mode !== 'save') return { status: 'empty' as const, intent }
          writable(intent.owner)
          const file = input.coverFile
          draft = parseProfileSaveDraft({ schema: 'soulidity.profile-save-draft.v1', id: crypto.randomUUID(), intent,
            cover: file ? { type: file.type, byteLength: file.size,
              sha256: await coverHash(file) } : null,
            coverReceipt: null, metadataReceipt: null })
          persist(keyDraft, draft)
        } else if (input.mode === 'save') throw new Error('PROFILE_FROZEN_SAVE_RECOVERY_REQUIRED')
        if (input.mode !== 'query') await expected(draft)
        if (!await cover(draft, keyDraft, input.coverFile ?? null, input.mode === 'query')) return { status: 'pending' as const, intent: finalIntent(draft) }
        const frozen = finalIntent(draft)
        if (input.mode === 'query') {
          await uploads.recover(scope(draft, 'metadata'), draft.intent.owner)
          return { status: 'pending' as const, intent: frozen }
        }
        writable(frozen.owner)
        let uploaded: ProfileStorageReceipt | undefined
        const prepared = await preparePublicProfileSave({ intent: frozen, client: client.core, storage: config.storage,
          receipt: draft.metadataReceipt, signal: AbortSignal.timeout(120000),
          upload: async bytes => {
            const recovered = await uploads.recover(scope(draft!, 'metadata'), frozen.owner)
            check(recovered.status !== 'FAILED', 'PROFILE_METADATA_TRANSACTION_FAILED_ARCHIVE_REQUIRED')
            writable(frozen.owner)
            uploaded = recovered.status === 'CERTIFIED' ? recovered.result : await uploads.upload(
              new File([new Uint8Array(bytes)], 'public-profile.json', { type: 'application/json' }), scope(draft!, 'metadata'), frozen.owner)
            check(uploaded, 'PROFILE_METADATA_RECEIPT_REQUIRED')
            return assertPublicProfileMetadataRef({ blobId: uploaded.blobId, blobObjectId: uploaded.blobObjectId,
              sha256: uploaded.contentHash, byteLength: bytes.length })
          },
          persistReceipt: async receipt => {
            draft!.metadataReceipt = receipt; persist(keyDraft, draft!)
            if (uploaded) await uploads.acknowledge(uploaded)
          },
        })
        writable(frozen.owner)
        if (prepared.status === 'already-current') {
          drafts.archive(keyDraft, draft)
          return { status: 'saved' as const, intent: frozen }
        }
        const packet = await txClient.prepare(prepared)
        const result = await runPublicProfileOperation({ intent: frozen, prepared: packet, store: leased, adapter: txClient.adapter })
        if (result.phase === 'SUCCEEDED') {
          drafts.archive(keyDraft, draft)
          return { status: 'saved' as const, intent: frozen }
        }
        return { status: 'pending' as const, intent: frozen }
      })
    },
  }
}

function finalIntent(draft: ProfileSaveDraft) {
  return createPublicProfileSaveIntent({ ...draft.intent, metadata: { ...draft.intent.metadata,
    coverImageUrl: draft.coverReceipt?.blobUrl ?? draft.intent.metadata.coverImageUrl } })
}
