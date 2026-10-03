import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { browserSoulAuthoringStore, parseSoulAuthoringPreparation, soulAuthoringPreparationHash,
  soulAuthoringStoreKey, type SoulAuthoringPreparation } from './soul-authoring-store'
import { browserSoulAuthoringPacketJournal } from './soul-authoring-journal'
import { createSoulAuthoringPacketParser, type SoulAuthoringPacketRecord } from './soul-authoring-packet'
import { createSoulAuthoringVerifier } from './soul-authoring-verifier'
import { assertWalrusBatchLifetime, walrusBatchJsonHash, type WalrusBatchLifetime } from '../upload/walrus-batch-preparation'
import { browserWalrusBatchStore, openWalrusBatchDatabase, parseWalrusBatchRecord, walrusBatchRecordHash,
  walrusBatchStoreKey, WALRUS_BATCH_STORE_CHANGED, type WalrusBatchRecord } from '../upload/walrus-batch-store'
import { publicMutationCanonical as canonical } from '../sui/public-mutation-journal'

function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`SOUL_AUTHORING_COMPLETION_${code}`) }
export interface SoulAuthoringCompletion {
  schema: 'soulidity.soul-authoring-completion.v1'
  manifest: SoulAuthoringPreparation['manifest']
  upload: WalrusBatchRecord
  head: SoulAuthoringPacketRecord
  history: SoulAuthoringPacketRecord[]
}
export function soulAuthoringCompletionKey(p: SoulAuthoringPreparation) {
  return `${soulAuthoringStoreKey(p.manifest.request)}:completed:${p.manifest.request.operationId}:${soulAuthoringPreparationHash(p)}`
}
function preparation(s: SoulAuthoringCompletion) {
  check(s.schema === 'soulidity.soul-authoring-completion.v1', 'SCHEMA')
  return parseSoulAuthoringPreparation({ schema: 'soulidity.soul-authoring-preparation.v1', manifest: s.manifest, preparation: s.upload.preparation })
}
function fingerprint(s: SoulAuthoringCompletion) {
  const p = preparation(s), parser = createSoulAuthoringPacketParser(p)
  return walrusBatchJsonHash({ schema: s.schema, manifest: s.manifest, uploadHash: walrusBatchRecordHash(s.upload),
    head: parser.parse(s.head), history: s.history.map(parser.parse).sort((a, b) => a.packet.digest.localeCompare(b.packet.digest)) })
}
/** Re-prove each immutable packet against chain history, including the full
 * business receipt. Cached SUCCEEDED flags and consumption rows are not proof. */
export async function proveSoulAuthoringCompletion(client: SuiGrpcClient, input: SoulAuthoringCompletion,
  expectedDigest: string, signal: AbortSignal) {
  const s = structuredClone(input), p = preparation(s), parser = createSoulAuthoringPacketParser(p)
  check(s.head.packet.digest === expectedDigest, 'SELECTED_RESULT_CHANGED')
  const records = [...s.history, s.head].map(parser.parse)
  check(records.length > 0 && records.length <= 2049 && new Set(records.map(r => r.packet.digest)).size === records.length, 'PACKET_SET')
  const verifier = createSoulAuthoringVerifier({ client, preparation: p,
    journal: { read: async () => structuredClone(s.head), history: async () => structuredClone(s.history) },
    uploads: { read: async () => structuredClone(s.upload) } })
  const registrations: SoulAuthoringPacketRecord[] = [], mintIndices: number[] = [], files: number[] = []
  const consumptions: WalrusBatchRecord['consumptions'] = []
  let selectedConfirmed = false
  for (const record of records) {
    signal.throwIfAborted()
    const result = await verifier.query(record, signal)
    if (['SUCCEEDED', 'FAILED'].includes(record.packet.phase))
      check(result.status === record.packet.phase, 'TERMINAL_CONTRADICTION')
    if (result.status === 'FAILED') continue
    if (['CANCELLED', 'RETIRED'].includes(record.packet.phase) && result.status === 'MISSING') continue
    check(result.status === 'SUCCEEDED', 'UNRESOLVED_PACKET')
    selectedConfirmed ||= record.packet.digest === expectedDigest
    if (record.plan.step.kind === 'REGISTER') {
      registrations.push(record)
      check(!s.upload.registration || canonical(result.receipt.registration) === canonical(s.upload.registration), 'REGISTER_RECEIPT_CHANGED')
      s.upload.registration = result.receipt.registration
    } else {
      check(result.receipt.consumption, 'CONSUMPTION_REQUIRED')
      const proof = result.receipt.consumption
      const saved = s.upload.consumptions.find(c => c.packet.digest === record.packet.digest)
      check(!saved || canonical(saved) === canonical(proof), 'CONSUMPTION_CHANGED')
      consumptions.push(proof)
      const indices = result.receipt.business.mints.map(m => m.mintIndex)
      check(canonical(indices) === canonical(record.plan.step.chunk.mintIndices), 'MINT_RECEIPT_CHANGED')
      mintIndices.push(...indices); files.push(...proof.indices)
    }
  }
  const exact = (indices: number[], count: number) => indices.length === count
    && [...indices].sort((a, b) => a - b).every((n, i) => n === i)
  check(selectedConfirmed && registrations.length === 1 && exact(mintIndices, p.manifest.request.mints.length)
    && exact(files, p.preparation.manifest.files.length), 'INCOMPLETE_CREATION')
  check(s.upload.consumptions.every(saved => consumptions.some(proof => canonical(saved) === canonical(proof))), 'UNBOUND_CONSUMPTION')
  // A confirmed mint may have crashed before local acceptance. Preserve the
  // newly re-proved consumption in the archive without repeating any payment.
  s.upload = parseWalrusBatchRecord({ ...s.upload, consumptions })
  signal.throwIfAborted(); return s
}
export async function readSoulAuthoringCompletion(key: string): Promise<SoulAuthoringCompletion | null> {
  const db = await openWalrusBatchDatabase()
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('archive', 'readonly'), row = tx.objectStore('archive').get(key)
    tx.oncomplete = () => resolve(row.result ?? null)
    tx.onabort = () => reject(new Error('SOUL_AUTHORING_COMPLETION_READ_FAILED', { cause: tx.error }))
  }) } finally { db.close() }
}

/** Explicit user action. Preserve ciphertext/receipts in one atomic move;
 * never delete on-chain Blobs or permit unknown packets to free the author lane. */
export async function archiveCompletedSoulAuthoring(params: { client: SuiGrpcClient; preparation: SoulAuthoringPreparation;
  expectedDigest: string; lifetime: WalrusBatchLifetime }) {
  const p = parseSoulAuthoringPreparation(params.preparation), parentKey = soulAuthoringStoreKey(p.manifest.request)
  const packetKey = `${parentKey}:packets`, batchKey = walrusBatchStoreKey(p.preparation.manifest.scope)
  const archiveKey = soulAuthoringCompletionKey(p), journal = browserSoulAuthoringPacketJournal(p)
  const guard = () => assertWalrusBatchLifetime(p.preparation.manifest.scope, params.lifetime)
  return journal.exclusive(packetKey, async () => {
    guard()
    const archived = await readSoulAuthoringCompletion(archiveKey); guard()
    if (archived) {
      check(soulAuthoringPreparationHash(preparation(archived)) === soulAuthoringPreparationHash(p), 'ARCHIVE_BINDING')
      await proveSoulAuthoringCompletion(params.client, archived, params.expectedDigest, params.lifetime.signal)
      guard(); return archiveKey
    }
    const current = await browserSoulAuthoringStore().read(parentKey); guard()
    check(current && soulAuthoringPreparationHash(current) === soulAuthoringPreparationHash(p), 'ACTIVE_CREATION_CHANGED')
    const head = await journal.read(packetKey), history = await journal.history(packetKey)
    const upload = await browserWalrusBatchStore().read(batchKey); guard()
    check(head && upload, 'DURABLE_RECORD_REQUIRED')
    const snapshot: SoulAuthoringCompletion = { schema: 'soulidity.soul-authoring-completion.v1', manifest: p.manifest,
      upload: parseWalrusBatchRecord(upload), head, history }
    const completed = await proveSoulAuthoringCompletion(params.client, snapshot, params.expectedDigest, params.lifetime.signal); guard()
    const expected = fingerprint(snapshot), archiveHash = fingerprint(completed), db = await openWalrusBatchDatabase()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['authoring', 'active', 'authoring-packets', 'archive'], 'readwrite', { durability: 'strict' })
        let cause: unknown
        const fail = (error: unknown) => { cause = error; tx.abort() }
        tx.onabort = () => reject(cause ?? new Error('SOUL_AUTHORING_COMPLETION_WRITE_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve()
        const parent = tx.objectStore('authoring').get(parentKey), batch = tx.objectStore('active').get(batchKey)
        const packets = tx.objectStore('authoring-packets'), latest = packets.get(packetKey)
        const archive = tx.objectStore('archive'), prior = archive.get(archiveKey)
        const prefix = `${packetKey}:history:`, rows: { key: IDBValidKey; value: SoulAuthoringPacketRecord }[] = []
        const cursor = packets.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`))
        cursor.onsuccess = () => { try {
          const row = cursor.result
          if (row) { check(rows.length < 2048, 'HISTORY_BUDGET'); rows.push({ key: row.key, value: row.value }); row.continue(); return }
          guard()
          check(parent.result?.schema === 'soulidity.soul-authoring-parent.v1' && parent.result.batchKey === batchKey
            && canonical(parent.result.manifest) === canonical(p.manifest), 'PARENT_CAS_CHANGED')
          check(batch.result && latest.result, 'ACTIVE_CAS_MISSING')
          check(rows.every(r => r.key === `${prefix}${r.value.packet.digest}:${r.value.packet.phase}`), 'HISTORY_KEY_CHANGED')
          const observed: SoulAuthoringCompletion = { ...snapshot, upload: batch.result, head: latest.result, history: rows.map(r => r.value) }
          check(fingerprint(observed) === expected, 'SNAPSHOT_CAS_CHANGED')
          check(prior.result === undefined || fingerprint(prior.result) === archiveHash, 'ARCHIVE_CONFLICT')
          archive.put(completed, archiveKey)
          tx.objectStore('authoring').delete(parentKey); tx.objectStore('active').delete(batchKey)
          packets.delete(packetKey); for (const row of rows) packets.delete(row.key)
        } catch (error) { fail(error) } }
      })
      // Await actual commit/readback; a network timeout must not release this lock.
      const saved = await readSoulAuthoringCompletion(archiveKey)
      check(saved && fingerprint(saved) === archiveHash, 'ARCHIVE_READBACK_REQUIRED')
      guard()
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(WALRUS_BATCH_STORE_CHANGED))
      return archiveKey
    } finally { db.close() }
  })
}
