import { createPublicCommunityPublishIntent, publicCommunityPublishKey, validatePublicCommunityUploadReceipt,
  type PublicCommunityPublishIntent, type PublicCommunityUploadReceipt } from '@soulidity/sdk'

export interface CommunityPublishJournal {
  schema: 'soulidity.community-publish-journal.v1'
  intent: PublicCommunityPublishIntent
  receipt: PublicCommunityUploadReceipt | null
}
const LIMIT = 2 * 1024 * 1024
const json = (value: unknown) => JSON.stringify(value)
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`COMMUNITY_JOURNAL_${code}`) }
/** One active composer per wallet/release and parent. A newly generated operation
 * ID cannot bypass an unfinished paid operation after refresh or in another tab. */
export function communityPublishLane(input: PublicCommunityPublishIntent): string {
  const intent = createPublicCommunityPublishIntent(input)
  const prefix = publicCommunityPublishKey(intent).split(':').slice(0, -1).join(':')
  return `${prefix}:active:${intent.kind === 'post' ? 'post' : `comment:${intent.postId}`}`
}
export function communityPublishUploadScope(input: PublicCommunityPublishIntent): string {
  return `${publicCommunityPublishKey(input)}:document`
}
export async function validateCommunityPublishJournal(input: unknown): Promise<CommunityPublishJournal> {
  const value = structuredClone(input) as CommunityPublishJournal
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 3 && ['schema', 'intent', 'receipt'].every(key => Object.hasOwn(value, key))
    && value.schema === 'soulidity.community-publish-journal.v1', 'SCHEMA_INVALID')
  const intent = createPublicCommunityPublishIntent(value.intent)
  check(json(intent) === json(value.intent), 'INTENT_NONCANONICAL')
  const receipt = value.receipt === null ? null : await validatePublicCommunityUploadReceipt(intent, value.receipt)
  const result: CommunityPublishJournal = { schema: value.schema, intent, receipt }
  check(json(result).length <= LIMIT, 'TOO_LARGE')
  return result
}
export class CommunityJournalPersistenceError extends Error {
  readonly #record: CommunityPublishJournal
  constructor(record: CommunityPublishJournal, cause: unknown) {
    super('COMMUNITY_JOURNAL_NOT_PERSISTED: Keep the recovery record; do not start another paid upload.', { cause })
    this.name = 'CommunityJournalPersistenceError'; this.#record = structuredClone(record)
  }
  get record() { return structuredClone(this.#record) }
}
export interface CommunityPublishLease {
  read(): Promise<CommunityPublishJournal | null>
  /** Allows only absent→frozen intent→same-intent receipt. Never clears a receipt. */
  write(record: CommunityPublishJournal): Promise<void>
  /** Controller-only after both child operations are reconciled. Keeps an
   * immutable history copy before clearing the active composer lane. */
  archive(record: CommunityPublishJournal): Promise<void>
}
export interface CommunityPublishJournalStore {
  inspect(intent: PublicCommunityPublishIntent): Promise<CommunityPublishJournal | null>
  exclusive<T>(intent: PublicCommunityPublishIntent, work: (lease: CommunityPublishLease) => Promise<T>): Promise<T>
}
/** The controller reconciles both child operations before requesting archival.
 * Local records never attest on-chain publication success. */
export function browserCommunityPublishJournalStore(): CommunityPublishJournalStore {
  check(typeof window !== 'undefined' && navigator.locks?.request, 'STORAGE_AND_LOCKS_REQUIRED')
  const storage = window.localStorage
  async function read(key: string) {
    const raw = storage.getItem(key)
    if (raw === null) return null
    check(raw.length <= LIMIT, 'TOO_LARGE')
    const record = await validateCommunityPublishJournal(JSON.parse(raw))
    check(communityPublishLane(record.intent) === key, 'SCOPE_MISMATCH')
    return record
  }
  return {
    inspect: input => read(communityPublishLane(input)),
    exclusive(input, work) {
      const key = communityPublishLane(input)
      return navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
        check(lock, 'BUSY_IN_ANOTHER_TAB')
        let active = true, writing = false
        const live = () => check(active, 'LEASE_EXPIRED')
        const lease: CommunityPublishLease = {
          async read() { live(); const record = await read(key); live(); return record },
          async archive(input) {
            live(); check(!writing, 'CONCURRENT_WRITE'); writing = true
            let record: CommunityPublishJournal | undefined
            try {
              record = await validateCommunityPublishJournal(input)
              live(); check(communityPublishLane(record.intent) === key, 'SCOPE_MISMATCH')
              const previous = await read(key); live()
              check(previous && json(previous) === json(record), 'ARCHIVE_RECORD_CHANGED')
              const archiveKey = `${key}:history:${record.intent.operationId}`, encoded = json(record)
              const saved = storage.getItem(archiveKey)
              check(saved === null || saved === encoded, 'ARCHIVE_CONFLICT')
              storage.setItem(archiveKey, encoded)
              check(storage.getItem(archiveKey) === encoded, 'ARCHIVE_READBACK_FAILED')
              storage.removeItem(key)
              check(storage.getItem(key) === null, 'ARCHIVE_CLEAR_FAILED')
            } catch (cause) {
              if (record) throw new CommunityJournalPersistenceError(record, cause)
              throw cause
            }
            finally { writing = false }
          },
          async write(input) {
            live(); check(!writing, 'CONCURRENT_WRITE'); writing = true
            try {
              const record = await validateCommunityPublishJournal(input)
              live(); check(communityPublishLane(record.intent) === key, 'SCOPE_MISMATCH')
              let previous: CommunityPublishJournal | null
              try { previous = await read(key) }
              catch (cause) { throw new CommunityJournalPersistenceError(record, cause) }
              live()
              check(!previous || json(previous.intent) === json(record.intent), 'FROZEN_OPERATION_REQUIRED')
              check(!previous?.receipt || json(previous.receipt) === json(record.receipt), 'RECEIPT_IMMUTABLE')
              const encoded = json(record)
              try {
                storage.setItem(key, encoded)
                check(storage.getItem(key) === encoded, 'READBACK_FAILED')
              } catch (cause) { throw new CommunityJournalPersistenceError(record, cause) }
            } finally { writing = false }
          },
        }
        try { return await work(lease) } finally { active = false }
      })
    },
  }
}
