import { exportWalrusBatchPreparation, importWalrusBatchPreparation, walrusBatchCanonicalJson,
  walrusBatchKeys, WALRUS_BATCH_MAX_BYTES } from '../upload/walrus-batch-preparation'
import { openWalrusBatchDatabase, parseWalrusBatchRecord, walrusBatchStoreKey,
  type WalrusBatchRecord } from '../upload/walrus-batch-store'
import { parseSoulAuthoringPreparation, soulAuthoringPreparationHash, soulAuthoringStoreKey,
  type SoulAuthoringPreparation } from './soul-authoring-store'
import { createSoulAuthoringPacketParser, type SoulAuthoringPacketRecord } from './soul-authoring-packet'

/** Transport only. Cached phase/receipt fields are NOT chain proof. Importing
 * this envelope never installs a WAL, submits bytes, signs or pays. */
export interface SoulAuthoringRecovery {
  schema: 'soulidity.soul-authoring-recovery.v1'
  manifest: SoulAuthoringPreparation['manifest']
  upload: WalrusBatchRecord
  head: SoulAuthoringPacketRecord | null
  history: SoulAuthoringPacketRecord[]
}
export const SOUL_AUTHORING_RECOVERY_MAX_TEXT = Math.ceil(WALRUS_BATCH_MAX_BYTES * 4 / 3) + 100 * 1024 * 1024
const MAX_TEXT = SOUL_AUTHORING_RECOVERY_MAX_TEXT
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`SOUL_AUTHORING_RECOVERY_${code}`) }
function terminal(record: SoulAuthoringPacketRecord) {
  return ['SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'].includes(record.packet.phase)
}
export function parseSoulAuthoringRecovery(input: unknown): SoulAuthoringRecovery {
  const value = structuredClone(input) as SoulAuthoringRecovery
  walrusBatchKeys(value, ['schema', 'manifest', 'upload', 'head', 'history'])
  check(value.schema === 'soulidity.soul-authoring-recovery.v1', 'SCHEMA')
  const upload = parseWalrusBatchRecord(value.upload)
  const p = parseSoulAuthoringPreparation({ schema: 'soulidity.soul-authoring-preparation.v1', manifest: value.manifest, preparation: upload.preparation })
  const parser = createSoulAuthoringPacketParser(p)
  check(Array.isArray(value.history) && value.history.length <= 2048, 'HISTORY_BUDGET')
  const head = value.head === null ? null : parser.parse(value.head), history = value.history.map(parser.parse)
  check(history.every(terminal), 'NONTERMINAL_HISTORY')
  check(head !== null || history.length === 0, 'HISTORY_WITHOUT_HEAD')
  const records = [...history, ...(head ? [head] : [])]
  check(new Set(records.map(r => r.packet.digest)).size === records.length, 'DUPLICATE_PACKET')
  check(records.every(r => walrusBatchCanonicalJson(r).length <= 3 * 1024 * 1024)
    && walrusBatchCanonicalJson(history).length <= 64 * 1024 * 1024, 'PACKET_BUDGET')
  // A paid checkpoint without its exact parent transaction cannot be recovered
  // safely. Do not silently export a preparation-only backup in that case.
  if (upload.registration) check(records.some(r => r.plan.step.kind === 'REGISTER'
    && r.packet.digest === upload.registration!.packet.digest && r.packet.bytes === upload.registration!.packet.bytes), 'REGISTER_PACKET_MISSING')
  for (const consumption of upload.consumptions) check(records.some(r => r.plan.step.kind === 'MINT'
    && r.packet.digest === consumption.packet.digest && r.packet.bytes === consumption.packet.bytes), 'MINT_PACKET_MISSING')
  return { schema: value.schema, manifest: p.manifest, upload, head, history }
}
export function exportSoulAuthoringRecovery(input: SoulAuthoringRecovery): string {
  const value = parseSoulAuthoringRecovery(input)
  const text = walrusBatchCanonicalJson({ ...value, upload: { ...value.upload,
    preparation: JSON.parse(exportWalrusBatchPreparation(value.upload.preparation)) } })
  check(text.length <= MAX_TEXT, 'SIZE_LIMIT'); return text
}
/** Decodes ciphertext byte-for-byte; no regeneration of encrypted materials. */
export function importSoulAuthoringRecovery(text: string): SoulAuthoringRecovery {
  check(typeof text === 'string' && text.length <= MAX_TEXT, 'SIZE_LIMIT')
  const value = JSON.parse(text)
  walrusBatchKeys(value, ['schema', 'manifest', 'upload', 'head', 'history'])
  check(value.upload && typeof value.upload === 'object', 'UPLOAD_REQUIRED')
  const upload = value.upload as WalrusBatchRecord
  const preparation = importWalrusBatchPreparation(walrusBatchCanonicalJson(upload.preparation))
  const result = parseSoulAuthoringRecovery({ ...value, upload: { ...upload, preparation } })
  check(exportSoulAuthoringRecovery(result) === text, 'NONCANONICAL'); return result
}

/** One readonly IDB snapshot, not separately observed parent/upload/history.
 * No record is changed or removed, even if download is cancelled. */
export async function readSoulAuthoringRecovery(input: SoulAuthoringPreparation): Promise<SoulAuthoringRecovery> {
  const p = parseSoulAuthoringPreparation(input), key = soulAuthoringStoreKey(p.manifest.request)
  const packetKey = `${key}:packets`, prefix = `${packetKey}:history:`
  const batchKey = walrusBatchStoreKey(p.preparation.manifest.scope), db = await openWalrusBatchDatabase()
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction(['authoring', 'active', 'authoring-packets'], 'readonly')
    const parent = tx.objectStore('authoring').get(key), upload = tx.objectStore('active').get(batchKey)
    const packets = tx.objectStore('authoring-packets'), head = packets.get(packetKey)
    const cursor = packets.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`))
    const history: SoulAuthoringPacketRecord[] = []; let cause: unknown, result: SoulAuthoringRecovery
    const fail = (error: unknown) => { cause = error; tx.abort() }
    tx.onabort = () => reject(cause ?? new Error('SOUL_AUTHORING_RECOVERY_READ_FAILED', { cause: tx.error }))
    tx.oncomplete = () => resolve(result)
    cursor.onsuccess = () => { try {
      const row = cursor.result
      if (row) {
        check(history.length < 2048 && row.key === `${prefix}${row.value?.packet?.digest}:${row.value?.packet?.phase}`, 'HISTORY_KEY')
        history.push(row.value); row.continue(); return
      }
      walrusBatchKeys(parent.result, ['schema', 'manifest', 'batchKey'])
      check(parent.result.schema === 'soulidity.soul-authoring-parent.v1' && parent.result.batchKey === batchKey, 'PARENT_CHANGED')
      result = parseSoulAuthoringRecovery({ schema: 'soulidity.soul-authoring-recovery.v1', manifest: parent.result.manifest,
        upload: upload.result, head: head.result ?? null, history })
      const observed = parseSoulAuthoringPreparation({ schema: 'soulidity.soul-authoring-preparation.v1',
        manifest: result.manifest, preparation: result.upload.preparation })
      check(soulAuthoringPreparationHash(observed) === soulAuthoringPreparationHash(p), 'SELECTED_CREATION_CHANGED')
    } catch (error) { fail(error) } }
  }) } finally { db.close() }
}
