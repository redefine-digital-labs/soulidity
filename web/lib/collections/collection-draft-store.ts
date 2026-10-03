import { fromBase64, toBase64 } from '@mysten/sui/utils'

/** Device-local editing recovery only, never wallet/chain authority or a portable
 * backup. The non-extractable key is retained by this origin; clearing browser
 * data loses this draft. No plaintext private file is persisted or uploaded. */
export interface CollectionDraftSnapshot {
  fields: Record<string, string | number | boolean | null>
  rows: { name: string; description: string; tags: string[]; creatorRoyaltyBps: number }[]
  errors: { batch: string[]; folders: string[] }
  files: { role: 'cover' | 'template' | 'character' | 'memory' | 'image' | 'skills'; row: number; file: File }[]
}
interface Envelope { schema: 1; revision: number; iv: Uint8Array; ciphertext: ArrayBuffer; key: CryptoKey }
const LIMIT = 64 * 1024 * 1024
const check = (value: unknown, message: string): void => { if (!value) throw Error(message) }
const aad = (scope: string, revision: number) => new TextEncoder().encode(JSON.stringify(['collection-draft', 1, scope, revision]))
function validateScope(scope: string) { check(typeof scope === 'string' && scope.length > 0 && scope.length <= 1024, 'Invalid draft scope') }
export async function encryptCollectionDraft(scope: string, revision: number, draft: CollectionDraftSnapshot, key?: CryptoKey): Promise<Envelope> {
  validateScope(scope)
  check(Number.isSafeInteger(revision) && revision > 0, 'Invalid draft revision')
  check(draft.files.length <= 5002 && draft.rows.length <= 1000, 'Draft exceeds supported file or row count')
  check(draft.files.reduce((n, item) => n + item.file.size, 0) <= LIMIT, 'Draft exceeds local recovery size limit (64 MiB)')
  // Freeze metadata and immutable File references before asynchronous reads.
  const metadata = structuredClone({ fields: draft.fields, rows: draft.rows, errors: draft.errors })
  const sourceFiles = draft.files.map(item => ({ ...item }))
  const files = await Promise.all(sourceFiles.map(async ({ role, row, file }) => ({ role, row,
    name: file.name, type: file.type, lastModified: file.lastModified, bytes: toBase64(new Uint8Array(await file.arrayBuffer())) })))
  const bytes = new TextEncoder().encode(JSON.stringify({ ...metadata, files }))
  check(bytes.length <= LIMIT * 1.5, 'Draft metadata exceeds local recovery limit')
  const secret = key ?? await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  check(!secret.extractable, 'Draft recovery key must be non-extractable')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const value: Envelope = { schema: 1, revision, iv, key: secret,
    ciphertext: await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(scope, revision) }, secret, bytes) }
  // Apply the same decoder before replacing a readable version. An invalid
  // input must not become a committed record that no subsequent read can open.
  await decryptCollectionDraft(scope, value)
  return value
}
export async function decryptCollectionDraft(scope: string, value: Envelope): Promise<CollectionDraftSnapshot> {
  validateScope(scope)
  check(value?.schema === 1 && Number.isSafeInteger(value.revision) && value.revision > 0
    && value.iv?.byteLength === 12 && value.ciphertext?.byteLength <= LIMIT * 1.5 + 16, 'Unreadable draft envelope')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.iv),
    additionalData: aad(scope, value.revision) }, value.key, value.ciphertext)
  const data = JSON.parse(new TextDecoder().decode(plain))
  check(data && data.fields && Array.isArray(data.rows) && data.rows.length <= 1000
    && Array.isArray(data.files) && data.files.length <= 5002
    && Array.isArray(data.errors?.batch) && Array.isArray(data.errors?.folders), 'Unreadable draft payload')
  check(!Array.isArray(data.fields) && Object.values(data.fields).every(value => value === null
    || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))
    && data.rows.every((row: any) => row && typeof row.name === 'string' && typeof row.description === 'string'
      && Array.isArray(row.tags) && row.tags.every((tag: unknown) => typeof tag === 'string')
      && Number.isSafeInteger(row.creatorRoyaltyBps) && row.creatorRoyaltyBps >= 0 && row.creatorRoyaltyBps <= 10000)
    && [...data.errors.batch, ...data.errors.folders].every(item => typeof item === 'string'), 'Unreadable draft metadata')
  let total = 0
  const seen = new Set<string>()
  const files = data.files.map((item: any) => {
    check(['cover', 'template', 'character', 'memory', 'image', 'skills'].includes(item.role)
      && Number.isSafeInteger(item.row) && item.row >= 0 && item.row <= 1000
      && typeof item.name === 'string' && typeof item.type === 'string'
      && Number.isSafeInteger(item.lastModified) && typeof item.bytes === 'string', 'Unreadable draft file')
    const identity = `${item.row}:${item.role}`
    check(!seen.has(identity), 'Duplicate draft file'); seen.add(identity)
    const bytes = fromBase64(item.bytes); total += bytes.length
    check(total <= LIMIT, 'Draft files exceed local recovery limit')
    return { role: item.role, row: item.row, file: new File([bytes], item.name, { type: item.type, lastModified: item.lastModified }) }
  })
  return { fields: data.fields, rows: data.rows, errors: data.errors, files }
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('soulidity-collection-editing-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(Error('Draft database is blocked by another tab'))
  })
}
async function readEnvelope(db: IDBDatabase, scope: string): Promise<Envelope | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readonly'), req = tx.objectStore('drafts').get(scope)
    tx.oncomplete = () => resolve(req.result ?? null)
    tx.onabort = () => reject(tx.error ?? Error('Draft read failed'))
  })
}
export const collectionDraftStore = {
  async read(scope: string) {
    validateScope(scope); const db = await openDatabase()
    try {
      const value = await readEnvelope(db, scope)
      return { revision: value?.revision ?? 0, draft: value ? await decryptCollectionDraft(scope, value) : null }
    } finally { db.close() }
  },
  async write(scope: string, expectedRevision: number, draft: CollectionDraftSnapshot) {
    const snapshot = { ...structuredClone({ fields: draft.fields, rows: draft.rows, errors: draft.errors }),
      files: draft.files.map(item => ({ ...item })) }
    validateScope(scope); const db = await openDatabase()
    try {
      const prior = await readEnvelope(db, scope)
      check((prior?.revision ?? 0) === expectedRevision, 'Draft changed in another tab. Reload before editing.')
      // Never silently replace an unreadable record and its recovery key.
      if (prior) await decryptCollectionDraft(scope, prior)
      const value = await encryptCollectionDraft(scope, expectedRevision + 1, snapshot, prior?.key)
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('drafts', 'readwrite', { durability: 'strict' })
        const store = tx.objectStore('drafts'), request = store.get(scope)
        let conflict = false
        request.onsuccess = () => {
          if ((request.result?.revision ?? 0) !== expectedRevision) { conflict = true; tx.abort(); return }
          store.put(value, scope)
        }
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(Error(conflict ? 'Draft changed in another tab. Reload before editing.' : 'Draft could not be saved', { cause: tx.error }))
      })
      return value.revision
    } finally { db.close() }
  },
}
