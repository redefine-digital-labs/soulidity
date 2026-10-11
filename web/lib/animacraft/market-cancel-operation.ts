import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, toBase58, fromBase64, toBase64 } from '@mysten/sui/utils'
import { buildCancelAnimacraftV8SoulListingTx } from '@soulidity/sdk'
import { validateMarketCancelCheckpoint, type MarketCancelCheckpoint } from './market-cancel-checkpoint'
export type { MarketCancelCheckpoint } from './market-cancel-checkpoint'

export interface MarketCancelSnapshot {
  schema: 'native-market-cancel-v1'
  soulId: string; stateId: string; bindingId: string; owner: string
  kioskId: string; kioskCapId: string; ownershipEpoch: string; listingId: string
  listed: boolean; listingActive: boolean
  release: { network: 'mainnet'; protocolConfigId: string; soulidityCallablePackageId: string
    soulidityCallableDigest: string; writesEnabled: boolean }
}
export interface MarketCancelOperationRecord {
  schema: 1; kind: 'cancel-listing'
  soulId: string; stateId: string; bindingId: string; owner: string
  kioskId: string; kioskCapId: string; ownershipEpoch: string; listingId: string
  release: MarketCancelSnapshot['release']
  bytes: string; digest: string; expirationEpoch: string
  phase: 'PREPARED' | 'SIGNING' | 'SIGNED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'RETIRED'
  signature: string | null
  syncStatus?: 'PENDING' | 'COMPLETE' | 'SUPERSEDED'
  retirement?: { priorPhase: 'SIGNING' | 'SIGNED'; checkpoint: MarketCancelCheckpoint }
}
export function marketCancelCheck(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
const id = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
const u64 = (value: unknown) => typeof value === 'string' && value.length <= 20 && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 18446744073709551615n
const positive = (value: unknown) => u64(value) && BigInt(value as string) > 0n
const digest = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 44) return false
  try { const bytes = fromBase58(value); return bytes.length === 32 && toBase58(bytes) === value } catch { return false }
}
export const marketCancelReleaseKey = (r: MarketCancelSnapshot['release']) => JSON.stringify([
  r.network, r.protocolConfigId, r.soulidityCallablePackageId, r.soulidityCallableDigest,
])
export function marketCancelOperationKey(soulId: string, owner: string) {
  marketCancelCheck(id(soulId) && id(owner), 'Invalid market cancellation scope')
  return `soulidity.market-cancel-operation:mainnet:${soulId}:${owner}`
}
export const terminalMarketCancelOperation = (r: MarketCancelOperationRecord) => ['SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(r.phase)

export function buildMarketCancelOperationTransaction(r: Pick<MarketCancelOperationRecord,
  'stateId' | 'listingId' | 'kioskId' | 'kioskCapId' | 'release'>) {
  return buildCancelAnimacraftV8SoulListingTx({ soulidityCallablePackageId: r.release.soulidityCallablePackageId,
    soulStateId: r.stateId, listingId: r.listingId, currentKioskId: r.kioskId, currentKioskCapOnChainId: r.kioskCapId })
}
function identity(value: Pick<MarketCancelOperationRecord,'soulId'|'stateId'|'bindingId'|'owner'|'kioskId'|'kioskCapId'|'ownershipEpoch'|'listingId'|'release'>) {
  const r = value
  marketCancelCheck(r && [r.soulId,r.stateId,r.bindingId,r.owner,r.kioskId,r.kioskCapId,r.listingId].every(id)
    && new Set([r.soulId,r.stateId,r.bindingId,r.kioskId,r.kioskCapId,r.listingId]).size === 6 && u64(r.ownershipEpoch)
    && r.release?.network === 'mainnet' && typeof r.release.writesEnabled === 'boolean'
    && [r.release.protocolConfigId,r.release.soulidityCallablePackageId].every(id)
    && digest(r.release.soulidityCallableDigest), 'Invalid market cancellation identity/release')
}
/** Copy at the trust boundary before any await or caller-owned mutation. */
export function validateMarketCancelSnapshot(value: unknown): MarketCancelSnapshot {
  const snapshot = structuredClone(value) as MarketCancelSnapshot
  identity(snapshot)
  marketCancelCheck(snapshot.schema === 'native-market-cancel-v1' && typeof snapshot.listed === 'boolean'
    && typeof snapshot.listingActive === 'boolean', 'Invalid market cancellation snapshot')
  return snapshot
}

/** Recovery bytes may contain exactly the native four-Input cancel call. The
 * owned PersonalKioskCap cannot be substituted for a shared or receiving ref. */
export function validateMarketCancelOperationRecord(value: unknown): MarketCancelOperationRecord {
  const r = structuredClone(value) as MarketCancelOperationRecord
  identity(r)
  marketCancelCheck(r.schema === 1 && r.kind === 'cancel-listing' && u64(r.expirationEpoch)
    && ['PREPARED','SIGNING','SIGNED','SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(r.phase)
    && (r.signature === null || typeof r.signature === 'string' && r.signature.length > 0 && r.signature.length < 32768)
    && (r.phase !== 'SIGNED' || r.signature !== null)
    && (r.phase === 'SUCCEEDED' ? ['PENDING','COMPLETE','SUPERSEDED'].includes(r.syncStatus as string) : r.syncStatus === undefined)
    && (!['PREPARED','SIGNING','CANCELLED'].includes(r.phase) || r.signature === null), 'Invalid market cancellation recovery record')
  marketCancelCheck(typeof r.bytes === 'string' && r.bytes.length > 0 && r.bytes.length <= 180000 && digest(r.digest), 'Invalid cancellation transaction bytes/digest')
  const bytes = fromBase64(r.bytes); const data = bcs.TransactionData.parse(bytes)
  marketCancelCheck(toBase64(bytes) === r.bytes && toBase64(bcs.TransactionData.serialize(data).toBytes()) === r.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === r.digest, 'Cancellation recovery bytes/digest mismatch')
  const tx = Transaction.from(bytes).getData()
  marketCancelCheck(tx.sender === r.owner && tx.gasData.owner === r.owner && positive(tx.gasData.budget)
    && positive(tx.gasData.price) && tx.gasData.payment && tx.gasData.payment.length > 0
    && String(data.V1?.expiration.Epoch) === r.expirationEpoch, 'Cancellation recovery sender/gas/expiration mismatch')
  marketCancelCheck(r.phase !== 'RETIRED' || r.retirement, 'Retired cancellation evidence missing')
  if (r.retirement !== undefined) {
    marketCancelCheck(['RETIRED','SUCCEEDED','FAILED'].includes(r.phase)
      && ['SIGNING','SIGNED'].includes(r.retirement?.priorPhase)
      && (r.retirement.priorPhase === 'SIGNED' ? r.signature !== null : r.signature === null), 'Invalid cancellation retirement state')
    r.retirement.checkpoint = validateMarketCancelCheckpoint(r.retirement.checkpoint, r.expirationEpoch)
  }
  const expected = buildMarketCancelOperationTransaction(r).getData()
  const call = tx.commands[0]?.MoveCall; const wanted = expected.commands[0].MoveCall!
  marketCancelCheck(tx.commands.length === 1 && tx.inputs.length === 4 && call && call.package === wanted.package
    && call.module === wanted.module && call.function === wanted.function && call.typeArguments.length === 0
    && call.arguments.length === 4, 'Unexpected cancellation recovery command')
  const used = new Set<number>()
  wanted.arguments.forEach((expectedArg, index) => {
    const arg = call.arguments[index]
    marketCancelCheck(expectedArg.$kind === 'Input' && arg.$kind === 'Input' && !used.has(arg.Input), 'Unexpected cancellation recovery argument')
    used.add(arg.Input)
    const objectId = expected.inputs[expectedArg.Input].UnresolvedObject!.objectId
    const object = tx.inputs[arg.Input]?.Object
    if (objectId === r.kioskCapId) {
      marketCancelCheck(object?.ImmOrOwnedObject?.objectId === objectId && positive(object.ImmOrOwnedObject.version)
        && digest(object.ImmOrOwnedObject.digest), 'Cancellation recovery owned capability mismatch')
    } else {
      marketCancelCheck(object?.SharedObject?.objectId === objectId && positive(object.SharedObject.initialSharedVersion)
        && object.SharedObject.mutable === true, 'Cancellation recovery mutable shared input mismatch')
    }
  })
  const operationIds = [r.soulId,r.stateId,r.bindingId,r.kioskId,r.kioskCapId,r.listingId]
  marketCancelCheck(new Set(tx.gasData.payment.map(ref => ref.objectId)).size === tx.gasData.payment.length
    && tx.gasData.payment.every(ref => id(ref.objectId) && positive(ref.version) && digest(ref.digest)
      && !operationIds.includes(ref.objectId)), 'Cancellation recovery gas overlaps or is malformed')
  return r
}

export interface MarketCancelOperationStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): MarketCancelOperationRecord | null
  write(key: string, record: MarketCancelOperationRecord): void
  archive(key: string, record: MarketCancelOperationRecord): void
  history(key: string): MarketCancelOperationRecord[]
}
const canonical = (value: unknown): string => JSON.stringify(value, (_key, current) => current && typeof current === 'object' && !Array.isArray(current)
  ? Object.fromEntries(Object.keys(current).sort().map(key => [key,current[key]])) : current)
function archivedRecord(value: unknown, key: string) {
  const record = validateMarketCancelOperationRecord(value)
  marketCancelCheck(record.phase === 'RETIRED' && marketCancelOperationKey(record.soulId,record.owner) === key, 'Cancellation archive scope/state mismatch')
  return record
}
/** Committed cross-tab journal; no TTL, deletion, quota swallowing or fallback. */
export function browserMarketCancelOperationStore(): MarketCancelOperationStore {
  marketCancelCheck(typeof window !== 'undefined' && navigator.locks?.request, 'Persistent cancellation recovery requires browser storage and Web Locks')
  const storage = window.localStorage
  return {
    exclusive: (key, work) => navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      marketCancelCheck(lock, 'This Soul has a cancellation open in another tab'); return work()
    }),
    read: key => {
      const raw = storage.getItem(key)
      if (raw === null) return null
      marketCancelCheck(raw.length <= 250000, 'Cancellation recovery record exceeds its size limit')
      return validateMarketCancelOperationRecord(JSON.parse(raw))
    },
    write: (key, record) => {
      const encoded = JSON.stringify(validateMarketCancelOperationRecord(record))
      marketCancelCheck(encoded.length <= 250000, 'Cancellation recovery record exceeds its size limit')
      storage.setItem(key, encoded)
      marketCancelCheck(storage.getItem(key) === encoded, 'Cancellation recovery could not be persisted')
    },
    archive: (key, value) => {
      const record = archivedRecord(value,key); const archiveKey = `${key}:retired:${record.digest}`
      const encoded = canonical(record)
      marketCancelCheck(encoded.length <= 250000, 'Cancellation archive exceeds its size limit')
      const existing = storage.getItem(archiveKey)
      if (existing !== null) marketCancelCheck(existing === encoded, 'Cancellation archive is immutable')
      else storage.setItem(archiveKey,encoded)
      marketCancelCheck(storage.getItem(archiveKey) === encoded, 'Cancellation archive could not be persisted')
    },
    history: key => {
      const prefix = `${key}:retired:`; const records: MarketCancelOperationRecord[] = []
      for (let index=0; index<storage.length; index++) {
        const name = storage.key(index)
        if (!name?.startsWith(prefix)) continue
        const raw = storage.getItem(name)
        marketCancelCheck(raw && raw.length <= 250000, 'Invalid cancellation archive size')
        const record = archivedRecord(JSON.parse(raw),key)
        marketCancelCheck(name === `${prefix}${record.digest}`, 'Cancellation archive digest mismatch')
        records.push(record)
      }
      return records.sort((a,b) => a.digest.localeCompare(b.digest))
    },
  }
}
export type MarketCancelQueryResult = 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'
export interface MarketCancelOperationAdapter {
  prepare(): Promise<MarketCancelOperationRecord>
  query(record: MarketCancelOperationRecord): Promise<MarketCancelQueryResult>
  preflight(record: MarketCancelOperationRecord, signing: boolean): Promise<void>
  sign(record: MarketCancelOperationRecord): Promise<{ bytes: string; signature: string }>
  verifySignature(record: MarketCancelOperationRecord): Promise<void>
  broadcast(record: MarketCancelOperationRecord): Promise<void>
  sync(record: MarketCancelOperationRecord): Promise<'COMPLETE' | 'SUPERSEDED'>
  expiryCheckpoint(record: MarketCancelOperationRecord): Promise<MarketCancelCheckpoint>
}
function explicitWalletRejection(error: unknown) {
  return error instanceof Error && error.name === 'WalletStandardError'
    && (error as Error & { context?: { __code?: unknown } }).context?.__code === 4001000
}
async function queryChecked(adapter: MarketCancelOperationAdapter, record: MarketCancelOperationRecord): Promise<MarketCancelQueryResult> {
  const result = await adapter.query(structuredClone(record))
  marketCancelCheck(['MISSING','PENDING','SUCCEEDED','FAILED'].includes(result), 'Invalid cancellation query result')
  return result
}

export async function runMarketCancelOperation(params: {
  soulId: string; owner: string; start?: boolean; store: MarketCancelOperationStore; adapter: MarketCancelOperationAdapter
  queryOnly?: boolean; cancelUnsigned?: boolean; retireExpired?: boolean; onRecord?: (record: MarketCancelOperationRecord) => void
}) {
  // Capture caller input, callbacks and scope before acquiring the async lock.
  const { soulId, owner, start, queryOnly, cancelUnsigned, retireExpired, onRecord, store, adapter } = params
  const key = marketCancelOperationKey(soulId, owner)
  marketCancelCheck([start,queryOnly,cancelUnsigned,retireExpired].filter(Boolean).length <= 1, 'Start and recovery-only actions are mutually exclusive')
  return store.exclusive(key, async () => {
    const stored = store.read(key)
    let record = stored ? validateMarketCancelOperationRecord(stored) : null
    const scope = (r: MarketCancelOperationRecord) => marketCancelCheck(r.soulId === soulId && r.owner === owner, 'Cancellation recovery scope mismatch')
    if (record) scope(record)
    const copy = () => structuredClone(record!)
    const save = (r: MarketCancelOperationRecord) => {
      const next = validateMarketCancelOperationRecord(r); scope(next)
      store.write(key, structuredClone(next)); record = next; onRecord?.(structuredClone(next))
    }
    const ensureArchive = (value: MarketCancelOperationRecord) => {
      const retired = archivedRecord({ ...value,phase:'RETIRED',syncStatus:undefined },key)
      store.archive(key,structuredClone(retired))
      const entries = store.history(key).map(row => archivedRecord(row,key)).filter(row => row.digest === retired.digest)
      marketCancelCheck(entries.length === 1 && canonical(entries[0]) === canonical(retired), 'Cancellation archive readback mismatch')
    }
    // Recover the second half of archive-before-pointer persistence before any
    // possible prompt/resend. This cannot unlock a new intent: start below still
    // queries and revalidates the live executed-checkpoint frontier.
    if (record && (record.phase === 'SIGNING' || record.phase === 'SIGNED')) {
      const archived = store.history(key).map(row => archivedRecord(row,key)).filter(row => row.digest === record!.digest)
      marketCancelCheck(archived.length <= 1, 'Duplicate cancellation archive')
      if (archived.length) {
        marketCancelCheck(archived[0].retirement!.priorPhase === record.phase
          && canonical({ ...archived[0],phase:record.phase,retirement:undefined }) === canonical(record), 'Cancellation archive packet mismatch')
        save(archived[0])
      }
    }
    if (start) {
      marketCancelCheck(!record || terminalMarketCancelOperation(record), 'Recover the pending cancellation first')
      if (record && record.phase !== 'CANCELLED') {
        const status = await queryChecked(adapter,copy())
        if (record.phase === 'RETIRED') {
          marketCancelCheck(status !== 'PENDING', 'Retired cancellation is pending; query before starting a new operation')
          if (status === 'MISSING') validateMarketCancelCheckpoint(await adapter.expiryCheckpoint(copy()),record.expirationEpoch)
        } else marketCancelCheck(status === record.phase, 'Previous cancellation result must be confirmed before a new operation')
        if (record.retirement) ensureArchive(record)
      }
      const prepared = validateMarketCancelOperationRecord(await adapter.prepare())
      scope(prepared); marketCancelCheck(prepared.phase === 'PREPARED', 'Prepared cancellation phase mismatch')
      marketCancelCheck(!store.history(key).map(row => archivedRecord(row,key)).some(row => row.digest === prepared.digest),
        'A retired cancellation packet cannot be prepared or sent again')
      save(prepared)
    }
    marketCancelCheck(record, 'No matching cancellation to recover')
    if (record.phase === 'CANCELLED') return copy()
    const reconcile = async (): Promise<MarketCancelQueryResult> => {
      const result = await queryChecked(adapter,copy())
      if (result === 'SUCCEEDED' || result === 'FAILED') {
        if (result === 'SUCCEEDED') {
          // A saved readback is historical, not proof that this Soul is still
          // held after a later relist/transfer. Recheck without another signature.
          save({ ...record!, phase: result, syncStatus: 'PENDING' })
          if (record!.syncStatus === 'PENDING') {
            const status = await adapter.sync(copy())
            marketCancelCheck(status === 'COMPLETE' || status === 'SUPERSEDED', 'Invalid cancellation synchronization result')
            save({ ...record!, syncStatus: status })
          }
        } else save({ ...record!, phase: result, syncStatus: undefined })
        return result
      }
      marketCancelCheck(record!.phase === 'RETIRED' || !terminalMarketCancelOperation(record!), 'Recorded cancellation result cannot be confirmed')
      return result
    }
    const result = await reconcile()
    if (result !== 'MISSING' || queryOnly || record.phase === 'RETIRED') return copy()
    if (retireExpired) {
      marketCancelCheck(record.phase === 'SIGNING' || record.phase === 'SIGNED', 'Only an unknown signing or signed cancellation can retire')
      const checkpoint = validateMarketCancelCheckpoint(await adapter.expiryCheckpoint(copy()),record.expirationEpoch)
      let retired = validateMarketCancelOperationRecord({ ...record,phase:'RETIRED',retirement:{priorPhase:record.phase,checkpoint} })
      // An archive write can succeed before the active pointer write fails.
      // Revalidate expiry now, then reuse that original immutable evidence.
      const existing = store.history(key).map(row => archivedRecord(row,key)).filter(row => row.digest === record!.digest)
      marketCancelCheck(existing.length <= 1, 'Duplicate cancellation archive')
      if (existing.length) {
        marketCancelCheck(canonical({ ...retired,retirement:existing[0].retirement }) === canonical(existing[0])
          && existing[0].retirement!.priorPhase === record.phase, 'Cancellation archive packet mismatch')
        retired = existing[0]
      }
      ensureArchive(retired); save(retired); return copy()
    }
    if (cancelUnsigned) {
      marketCancelCheck(record.phase === 'PREPARED' && record.signature === null, 'A signed or unknown signing transaction cannot be discarded')
      save({ ...record, phase: 'CANCELLED' }); return copy()
    }
    await adapter.preflight(copy(), record.phase !== 'SIGNED')
    if (record.phase === 'PREPARED' || record.phase === 'SIGNING') {
      const initiallyUnsigned = record.phase === 'PREPARED'
      save({ ...record, phase: 'SIGNING' })
      let signed
      try { signed = await adapter.sign(copy()) } catch (error) {
        if (initiallyUnsigned && explicitWalletRejection(error)) save({ ...record!, phase: 'PREPARED' })
        throw error
      }
      marketCancelCheck(signed.bytes === record.bytes, 'Wallet changed the prepared cancellation; nothing was broadcast')
      const next = validateMarketCancelOperationRecord({ ...record, phase: 'SIGNED', signature: signed.signature })
      await adapter.verifySignature(structuredClone(next)); save(next)
    }
    await adapter.preflight(copy(), false)
    await adapter.verifySignature(copy())
    await adapter.broadcast(copy())
    await reconcile()
    return copy()
  })
}

/** Historical outcomes are ephemeral observations; the retired packet remains
 * immutable and cannot sign, sync the current Soul, or mutate the active intent. */
export async function queryMarketCancelHistory(params: { soulId: string; owner: string; digest: string;
  store: MarketCancelOperationStore; adapter: MarketCancelOperationAdapter }): Promise<MarketCancelQueryResult> {
  const { soulId,owner,digest: requested,store,adapter } = params
  const key = marketCancelOperationKey(soulId,owner)
  marketCancelCheck(digest(requested), 'Invalid cancellation history digest')
  return store.exclusive(key,async () => {
    const entries = store.history(key).map(row => archivedRecord(row,key)).filter(row => row.digest === requested)
    marketCancelCheck(entries.length === 1, 'Exact cancellation history record required')
    return queryChecked(adapter,entries[0])
  })
}
