import {validateMarketCancelCheckpoint,type MarketCancelCheckpoint} from './market-cancel-checkpoint'

export interface ListingLifecycleRecord {
  bytes:string;digest:string;expirationEpoch:string
  phase:'PREPARED'|'SIGNING'|'SIGNED'|'SUCCEEDED'|'FAILED'|'CANCELLED'|'RETIRED'
  signature:string|null;syncStatus?:'PENDING'|'COMPLETE'|'SUPERSEDED'
  retirement?:{priorPhase:'SIGNING'|'SIGNED';checkpoint:MarketCancelCheckpoint}
}
export interface ListingLifecycleStore<R extends ListingLifecycleRecord> {
  exclusive<T>(key:string,work:()=>Promise<T>):Promise<T>
  read(key:string):R|null
  write(key:string,record:R):void
  archive(key:string,record:R):void
  history(key:string):R[]
  assertAvailable?(key:string,record:R):void
}
export type ListingQueryResult='MISSING'|'PENDING'|'SUCCEEDED'|'FAILED'
export interface ListingLifecycleAdapter<R extends ListingLifecycleRecord> {
  prepare():Promise<R>
  query(record:R):Promise<ListingQueryResult>
  preflight(record:R,signing:boolean):Promise<void>
  sign(record:R):Promise<{bytes:string;signature:string}>
  verifySignature(record:R):Promise<void>
  broadcast(record:R):Promise<void>
  sync(record:R):Promise<'COMPLETE'|'SUPERSEDED'>
  expiryCheckpoint(record:R):Promise<MarketCancelCheckpoint>
}
function check(value:unknown,message:string):asserts value {if(!value)throw new Error(message)}
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,current)=>current&&typeof current==='object'&&!Array.isArray(current)
  ?Object.fromEntries(Object.keys(current).sort().map(key=>[key,current[key]])):current)
const terminal=(r:ListingLifecycleRecord)=>['SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(r.phase)
function explicitWalletRejection(error:unknown){
  return error instanceof Error && error.name==='WalletStandardError'
    &&(error as Error&{context?:{__code?:unknown}}).context?.__code===4001000
}
async function queryChecked<R extends ListingLifecycleRecord>(adapter:ListingLifecycleAdapter<R>,record:R):Promise<ListingQueryResult>{
  const result=await adapter.query(structuredClone(record))
  check(['MISSING','PENDING','SUCCEEDED','FAILED'].includes(result),'Invalid listing query result');return result
}
/** One lifecycle for single and selected-asset listing packets. Concrete validators
 * must authenticate the entire command graph; this engine never rebuilds saved bytes. */
export async function runListingLifecycle<R extends ListingLifecycleRecord>(params:{
  key:string;start?:boolean;store:ListingLifecycleStore<R>;adapter:ListingLifecycleAdapter<R>
  queryOnly?:boolean;cancelUnsigned?:boolean;retireExpired?:boolean;onRecord?:(record:R)=>void
  validate:(value:unknown)=>R;assertScope:(record:R)=>void
}) {
  // Capture caller input, callbacks and scope before acquiring the async lock.
  const { key, start, queryOnly, cancelUnsigned, retireExpired, onRecord, store, adapter, validate, assertScope } = params
  const archivedRecord = (value: unknown, archiveKey: string) => {
    const r = validate(value); assertScope(r)
    check(archiveKey === key && r.phase === 'RETIRED', 'Listing archive scope/state mismatch'); return r
  }
  const scope = assertScope
  check([start,queryOnly,cancelUnsigned,retireExpired].filter(Boolean).length <= 1, 'Start and recovery-only actions are mutually exclusive')
  return store.exclusive(key, async () => {
    const stored = store.read(key)
    let record = stored ? validate(stored) : null
    if (record) scope(record)
    const copy = () => structuredClone(record!)
    const save = (r: R) => {
      const next = validate(r); scope(next)
      store.write(key, structuredClone(next)); record = next; onRecord?.(structuredClone(next))
    }
    const ensureArchive = (value: R) => {
      const retired = archivedRecord({ ...value,phase:'RETIRED',syncStatus:undefined },key)
      store.archive(key,structuredClone(retired))
      const entries = store.history(key).map(row => archivedRecord(row,key)).filter(row => row.digest === retired.digest)
      check(entries.length === 1 && canonical(entries[0]) === canonical(retired), 'Listing archive readback mismatch')
    }
    // Recover the second half of archive-before-pointer persistence before any
    // possible prompt/resend. This cannot unlock a new intent: start below still
    // queries and revalidates the live executed-checkpoint frontier.
    if (record && (record.phase === 'SIGNING' || record.phase === 'SIGNED')) {
      const archived = store.history(key).map(row => archivedRecord(row,key)).filter(row => row.digest === record!.digest)
      check(archived.length <= 1, 'Duplicate listing archive')
      if (archived.length) {
        check(archived[0].retirement!.priorPhase === record.phase
          && canonical({ ...archived[0],phase:record.phase,retirement:undefined }) === canonical(record), 'Listing archive packet mismatch')
        save(archived[0])
      }
    }
    if (start) {
      check(!record || terminal(record), 'Recover the pending listing first')
      if (record && record.phase !== 'CANCELLED') {
        const status = await queryChecked(adapter,copy())
        if (record.phase === 'RETIRED') {
          check(status !== 'PENDING', 'Retired listing is pending; query before starting a new operation')
          if (status === 'MISSING') validateMarketCancelCheckpoint(await adapter.expiryCheckpoint(copy()),record.expirationEpoch)
        } else check(status === record.phase, 'Previous listing result must be confirmed before a new operation')
        if (record.retirement) ensureArchive(record)
      }
      const prepared = validate(await adapter.prepare())
      scope(prepared); check(prepared.phase === 'PREPARED', 'Prepared listing phase mismatch')
      store.assertAvailable?.(key,structuredClone(prepared))
      check(!store.history(key).map(row => archivedRecord(row,key)).some(row => row.digest === prepared.digest),
        'A retired listing packet cannot be prepared or sent again')
      save(prepared)
    }
    check(record, 'No matching listing to recover')
    if (record.phase === 'CANCELLED') return copy()
    const reconcile = async (): Promise<ListingQueryResult> => {
      const result = await queryChecked(adapter,copy())
      if (result === 'SUCCEEDED' || result === 'FAILED') {
        if (result === 'SUCCEEDED') {
          // Past listing success is not proof of current custody. Every active
          // explicit recovery checks the authenticated mirror again; history
          // queries remain ledger-only observations.
          save({ ...record!, phase: result, syncStatus: 'PENDING' })
          if (record!.syncStatus === 'PENDING') {
            const status = await adapter.sync(copy())
            check(status === 'COMPLETE' || status === 'SUPERSEDED', 'Invalid listing synchronization result')
            save({ ...record!, syncStatus: status })
          }
        } else save({ ...record!, phase: result, syncStatus: undefined })
        return result
      }
      check(record!.phase === 'RETIRED' || !terminal(record!), 'Recorded listing result cannot be confirmed')
      return result
    }
    const result = await reconcile()
    if (result !== 'MISSING' || queryOnly || record.phase === 'RETIRED') return copy()
    if (retireExpired) {
      check(record.phase === 'SIGNING' || record.phase === 'SIGNED', 'Only an unknown signing or signed listing can retire')
      const checkpoint = validateMarketCancelCheckpoint(await adapter.expiryCheckpoint(copy()),record.expirationEpoch)
      let retired = validate({ ...record,phase:'RETIRED',retirement:{priorPhase:record.phase,checkpoint} })
      // An archive write can succeed before the active pointer write fails.
      // Revalidate expiry now, then reuse that original immutable evidence.
      const existing = store.history(key).map(row => archivedRecord(row,key)).filter(row => row.digest === record!.digest)
      check(existing.length <= 1, 'Duplicate listing archive')
      if (existing.length) {
        check(canonical({ ...retired,retirement:existing[0].retirement }) === canonical(existing[0])
          && existing[0].retirement!.priorPhase === record.phase, 'Listing archive packet mismatch')
        retired = existing[0]
      }
      ensureArchive(retired); save(retired); return copy()
    }
    if (cancelUnsigned) {
      check(record.phase === 'PREPARED' && record.signature === null, 'A signed or unknown signing transaction cannot be discarded')
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
      check(signed.bytes === record.bytes, 'Wallet changed the prepared listing; nothing was broadcast')
      const next = validate({ ...record, phase: 'SIGNED', signature: signed.signature })
      await adapter.verifySignature(structuredClone(next)); save(next)
    }
    await adapter.preflight(copy(), false)
    await adapter.verifySignature(copy())
    await adapter.broadcast(copy())
    await reconcile()
    return copy()
  })
}
