import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, toBase58, fromBase64, toBase64 } from '@mysten/sui/utils'
import { buildBuyAnimacraftV8SoulTx } from '@soulidity/sdk'
import { validateMarketCancelCheckpoint as validateMarketBuyCheckpoint, type MarketCancelCheckpoint as MarketBuyCheckpoint } from './market-cancel-checkpoint'
import { NATIVE_MARKET_PAYMENT_COIN_TYPE, type MarketBuySnapshot, type MarketBuyOperationRecord } from './market-buy-types'
export type { MarketBuySnapshot, MarketBuyOperationRecord, MarketBuyPaymentCoin } from './market-buy-types'

export function marketBuyCheck(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export const marketBuyId = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
export const marketBuyUint64 = (value: unknown) => typeof value === 'string' && value.length <= 20 && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 18446744073709551615n
const positive = (value: unknown) => marketBuyUint64(value) && BigInt(value as string) > 0n
export const marketBuyDigest = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 44) return false
  try { const bytes = fromBase58(value); return bytes.length === 32 && toBase58(bytes) === value } catch { return false }
}
export function marketBuyOperationKey(soulId: string, owner: string) {
  marketBuyCheck(marketBuyId(soulId) && marketBuyId(owner), 'Invalid native purchase scope')
  return `soulidity.market-buy-operation:mainnet:${soulId}:${owner}`
}
export const terminalMarketBuyOperation = (r: MarketBuyOperationRecord) => ['SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(r.phase)
export function validateMarketBuySnapshot(value: unknown): MarketBuySnapshot {
  const s = structuredClone(value) as MarketBuySnapshot; const r=s?.release
  marketBuyCheck(s?.schema === 'native-market-buy-v1' && r?.network === 'mainnet'
    && [s.soulId,s.stateId,s.bindingId,s.seller,s.sellerKioskId,s.listingId,s.creator,s.makerCreator,s.protocolFeeRecipient,s.buyer,
      r.protocolConfigId,r.soulidityOriginalPackageId,r.soulidityCallablePackageId,r.marketConfigV2Id,r.kioskRegistryId,r.soulTransferPolicyId,r.kioskPackageId].every(marketBuyId)
    && marketBuyDigest(r.soulidityCallableDigest) && marketBuyUint64(s.ownershipEpoch) && positive(s.priceAtomic)
    && typeof s.purchaseAvailable === 'boolean' && typeof r.writesEnabled === 'boolean'
    && r.paymentCoinType === NATIVE_MARKET_PAYMENT_COIN_TYPE && (s.buyer !== s.seller || !s.purchaseAvailable),
  'Invalid native purchase identity/release')
  marketBuyCheck((s.buyerKioskId === null && s.buyerKioskCapId === null)
    || marketBuyId(s.buyerKioskId) && marketBuyId(s.buyerKioskCapId)
      && (s.buyerKioskId !== s.sellerKioskId || !s.purchaseAvailable && s.buyer===s.seller),
  'Invalid buyer kiosk scope')
  const objects = [s.soulId,s.stateId,s.bindingId,s.sellerKioskId,s.listingId,r.marketConfigV2Id,r.kioskRegistryId,r.soulTransferPolicyId,
    ...(s.buyerKioskId ? [...(s.buyerKioskId===s.sellerKioskId?[]:[s.buyerKioskId]),s.buyerKioskCapId!] : [])]
  marketBuyCheck(new Set(objects).size === objects.length, 'Purchase object identities overlap')
  const rates = [s.soulCreatorRoyaltyBps,s.makerSourceRoyaltyBps]
  marketBuyCheck(rates.every(n => Number.isInteger(n) && n>=0 && n<=1000 && n%50===0) && rates[0]+rates[1]<=1000,
    'Invalid native purchase royalty schedule')
  return s
}
export function buildMarketBuyOperationTransaction(r: Pick<MarketBuyOperationRecord,'snapshot'|'paymentCoins'>) {
  const s=r.snapshot
  return buildBuyAnimacraftV8SoulTx({ target:s.release,soulStateId:s.stateId,provenanceBindingId:s.bindingId,
    listingId:s.listingId,sellerKioskId:s.sellerKioskId,priceAtomic:BigInt(s.priceAtomic),paymentCoinObjectIds:r.paymentCoins.map(c=>c.objectId),
    buyerKioskId:s.buyerKioskId,buyerKioskCapOnChainId:s.buyerKioskCapId })
}
/** Exact real SDK graph, including merge/split and new-kiosk result wiring.
 * No extra transfer, coin input, gas overlap or unconstrained pure argument. */
export function validateMarketBuyOperationRecord(value: unknown): MarketBuyOperationRecord {
  const r=structuredClone(value) as MarketBuyOperationRecord
  const s=validateMarketBuySnapshot(r?.snapshot); r.snapshot=s
  marketBuyCheck(s.buyer!==s.seller && s.buyerKioskId!==s.sellerKioskId,'A purchase journal cannot buy its own Soul or reuse the seller kiosk')
  marketBuyCheck(r.schema===1 && r.kind==='buy' && marketBuyUint64(r.expirationEpoch)
    && ['PREPARED','SIGNING','SIGNED','SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(r.phase)
    && (r.signature===null || typeof r.signature==='string' && r.signature.length>0 && r.signature.length<32768)
    && (r.phase!=='SIGNED'||r.signature!==null)
    && (r.phase==='SUCCEEDED'?['PENDING','COMPLETE','SUPERSEDED'].includes(r.syncStatus as string):r.syncStatus===undefined)
    && (!['PREPARED','SIGNING','CANCELLED'].includes(r.phase)||r.signature===null), 'Invalid native purchase journal')
  const objectIds=[s.soulId,s.stateId,s.bindingId,s.sellerKioskId,s.listingId,s.release.marketConfigV2Id,s.release.kioskRegistryId,s.release.soulTransferPolicyId,
    ...(s.buyerKioskId?[s.buyerKioskId,s.buyerKioskCapId!]:[])]
  marketBuyCheck(Array.isArray(r.paymentCoins) && r.paymentCoins.length>0 && r.paymentCoins.length<=32
    && new Set(r.paymentCoins.map(c=>c.objectId)).size===r.paymentCoins.length
    && r.paymentCoins.every(c=>marketBuyId(c.objectId)&&positive(c.version)&&marketBuyDigest(c.digest)&&positive(c.balanceAtomic)&&!objectIds.includes(c.objectId)),
  'Invalid verified purchase payment coins')
  const balance=r.paymentCoins.reduce((sum,c)=>sum+BigInt(c.balanceAtomic),0n)
  marketBuyCheck(balance>=BigInt(s.priceAtomic)&&balance<=18446744073709551615n,'Purchase payment balance outside exact bounds')
  marketBuyCheck(typeof r.bytes==='string' && r.bytes.length>0 && r.bytes.length<=180000 && marketBuyDigest(r.digest),'Invalid native purchase bytes')
  const bytes=fromBase64(r.bytes); const data=bcs.TransactionData.parse(bytes)
  marketBuyCheck(toBase64(bytes)===r.bytes && toBase64(bcs.TransactionData.serialize(data).toBytes())===r.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes)===r.digest,'Purchase bytes/digest mismatch')
  const tx=Transaction.from(bytes).getData()
  marketBuyCheck(tx.sender===s.buyer && tx.gasData.owner===s.buyer && positive(tx.gasData.budget)&&positive(tx.gasData.price)
    && tx.gasData.payment?.length && String(data.V1?.expiration.Epoch)===r.expirationEpoch,'Purchase sender/gas/expiration mismatch')
  marketBuyCheck(r.phase!=='RETIRED'||r.retirement,'Retired purchase evidence missing')
  if(r.retirement!==undefined){
    marketBuyCheck(['RETIRED','SUCCEEDED','FAILED'].includes(r.phase)&&['SIGNING','SIGNED'].includes(r.retirement?.priorPhase)
      && (r.retirement.priorPhase==='SIGNED'?r.signature!==null:r.signature===null),'Invalid purchase retirement')
    r.retirement.checkpoint=validateMarketBuyCheckpoint(r.retirement.checkpoint,r.expirationEpoch)
  }
  const expected=buildMarketBuyOperationTransaction(r).getData()
  const commandBytes=(commands:typeof tx.commands)=>toBase64(bcs.vector(bcs.Command).serialize(commands.map(command=>{
    marketBuyCheck(command.$kind!=='$Intent','Unresolved purchase command is forbidden');return command
  })).toBytes())
  marketBuyCheck(tx.inputs.length===expected.inputs.length && commandBytes(tx.commands)===commandBytes(expected.commands),'Unexpected native purchase command graph')
  expected.inputs.forEach((wanted,index)=>{
    const input=tx.inputs[index]
    if(wanted.Pure){marketBuyCheck(input.Pure?.bytes===wanted.Pure.bytes,'Purchase exact price argument mismatch');return}
    const id=wanted.UnresolvedObject!.objectId;const object=input.Object
    const coin=r.paymentCoins.find(c=>c.objectId===id)
    if(coin || id===s.bindingId || id===s.buyerKioskCapId){
      const ref=object?.ImmOrOwnedObject
      marketBuyCheck(ref?.objectId===id&&positive(ref.version)&&marketBuyDigest(ref.digest)
        && (!coin||ref.version===coin.version&&ref.digest===coin.digest),'Purchase owned/immutable input mismatch')
    }else{
      const mutable=![s.release.marketConfigV2Id,s.release.soulTransferPolicyId].includes(id)
      marketBuyCheck(object?.SharedObject?.objectId===id&&positive(object.SharedObject.initialSharedVersion)
        && object.SharedObject.mutable===mutable,'Purchase shared input mismatch')
    }
  })
  const forbidden=[...objectIds,...r.paymentCoins.map(c=>c.objectId)]
  marketBuyCheck(new Set(tx.gasData.payment.map(ref=>ref.objectId)).size===tx.gasData.payment.length
    && tx.gasData.payment.every(ref=>marketBuyId(ref.objectId)&&positive(ref.version)&&marketBuyDigest(ref.digest)&&!forbidden.includes(ref.objectId)),
  'Purchase gas overlaps assets or payment')
  return r
}

export interface MarketBuyOperationStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): MarketBuyOperationRecord | null
  write(key: string, record: MarketBuyOperationRecord): void
  archive(key: string, record: MarketBuyOperationRecord): void
  history(key: string): MarketBuyOperationRecord[]
}
export const marketBuyCanonical = (value: unknown): string => JSON.stringify(value, (_key, current) => current && typeof current === 'object' && !Array.isArray(current)
  ? Object.fromEntries(Object.keys(current).sort().map(key => [key,current[key]])) : current)
const canonical=marketBuyCanonical
function archivedRecord(value: unknown, key: string) {
  const record = validateMarketBuyOperationRecord(value)
  marketBuyCheck(record.phase === 'RETIRED' && marketBuyOperationKey(record.snapshot.soulId,record.snapshot.buyer) === key, 'Purchase archive scope/state mismatch')
  return record
}
/** Committed cross-tab journal; no TTL, deletion, quota swallowing or fallback. */
export function browserMarketBuyOperationStore(): MarketBuyOperationStore {
  marketBuyCheck(typeof window !== 'undefined' && navigator.locks?.request, 'Persistent purchase recovery requires browser storage and Web Locks')
  const storage = window.localStorage
  return {
    exclusive: (key, work) => navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      marketBuyCheck(lock, 'This Soul has a purchase open in another tab'); return work()
    }),
    read: key => {
      const raw = storage.getItem(key)
      if (raw === null) return null
      marketBuyCheck(raw.length <= 250000, 'Purchase recovery record exceeds its size limit')
      return validateMarketBuyOperationRecord(JSON.parse(raw))
    },
    write: (key, record) => {
      const encoded = JSON.stringify(validateMarketBuyOperationRecord(record))
      marketBuyCheck(encoded.length <= 250000, 'Purchase recovery record exceeds its size limit')
      storage.setItem(key, encoded)
      marketBuyCheck(storage.getItem(key) === encoded, 'Purchase recovery could not be persisted')
    },
    archive: (key, value) => {
      const record = archivedRecord(value,key); const archiveKey = `${key}:retired:${record.digest}`
      const encoded = canonical(record)
      marketBuyCheck(encoded.length <= 250000, 'Purchase archive exceeds its size limit')
      const existing = storage.getItem(archiveKey)
      if (existing !== null) marketBuyCheck(existing === encoded, 'Purchase archive is immutable')
      else storage.setItem(archiveKey,encoded)
      marketBuyCheck(storage.getItem(archiveKey) === encoded, 'Purchase archive could not be persisted')
    },
    history: key => {
      const prefix = `${key}:retired:`; const records: MarketBuyOperationRecord[] = []
      for (let index=0; index<storage.length; index++) {
        const name = storage.key(index)
        if (!name?.startsWith(prefix)) continue
        const raw = storage.getItem(name)
        marketBuyCheck(raw && raw.length <= 250000, 'Invalid purchase archive size')
        const record = archivedRecord(JSON.parse(raw),key)
        marketBuyCheck(name === `${prefix}${record.digest}`, 'Purchase archive digest mismatch')
        records.push(record)
      }
      return records.sort((a,b) => a.digest.localeCompare(b.digest))
    },
  }
}
export type MarketBuyQueryResult = 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'
export interface MarketBuyOperationAdapter {
  prepare(): Promise<MarketBuyOperationRecord>
  query(record: MarketBuyOperationRecord): Promise<MarketBuyQueryResult>
  preflight(record: MarketBuyOperationRecord, signing: boolean): Promise<void>
  sign(record: MarketBuyOperationRecord): Promise<{ bytes: string; signature: string }>
  verifySignature(record: MarketBuyOperationRecord): Promise<void>
  broadcast(record: MarketBuyOperationRecord): Promise<void>
  sync(record: MarketBuyOperationRecord): Promise<'COMPLETE' | 'SUPERSEDED'>
  expiryCheckpoint(record: MarketBuyOperationRecord): Promise<MarketBuyCheckpoint>
}
function explicitWalletRejection(error: unknown) {
  return error instanceof Error && error.name === 'WalletStandardError'
    && (error as Error & { context?: { __code?: unknown } }).context?.__code === 4001000
}
async function queryChecked(adapter: MarketBuyOperationAdapter, record: MarketBuyOperationRecord): Promise<MarketBuyQueryResult> {
  const result = await adapter.query(structuredClone(record))
  marketBuyCheck(['MISSING','PENDING','SUCCEEDED','FAILED'].includes(result), 'Invalid purchase query result')
  return result
}

export async function runMarketBuyOperation(params: {
  soulId: string; owner: string; start?: boolean; store: MarketBuyOperationStore; adapter: MarketBuyOperationAdapter
  queryOnly?: boolean; cancelUnsigned?: boolean; retireExpired?: boolean; onRecord?: (record: MarketBuyOperationRecord) => void
}) {
  // Capture caller input, callbacks and scope before acquiring the async lock.
  const { soulId, owner, start, queryOnly, cancelUnsigned, retireExpired, onRecord, store, adapter } = params
  const key = marketBuyOperationKey(soulId, owner)
  marketBuyCheck([start,queryOnly,cancelUnsigned,retireExpired].filter(Boolean).length <= 1, 'Start and recovery-only actions are mutually exclusive')
  return store.exclusive(key, async () => {
    const stored = store.read(key)
    let record = stored ? validateMarketBuyOperationRecord(stored) : null
    const scope = (r: MarketBuyOperationRecord) => marketBuyCheck(r.snapshot.soulId === soulId && r.snapshot.buyer === owner, 'Purchase recovery scope mismatch')
    if (record) scope(record)
    const copy = () => structuredClone(record!)
    const save = (r: MarketBuyOperationRecord) => {
      const next = validateMarketBuyOperationRecord(r); scope(next)
      store.write(key, structuredClone(next)); record = next; onRecord?.(structuredClone(next))
    }
    const ensureArchive = (value: MarketBuyOperationRecord) => {
      const retired = archivedRecord({ ...value,phase:'RETIRED',syncStatus:undefined },key)
      store.archive(key,structuredClone(retired))
      const entries = store.history(key).map(row => archivedRecord(row,key)).filter(row => row.digest === retired.digest)
      marketBuyCheck(entries.length === 1 && canonical(entries[0]) === canonical(retired), 'Purchase archive readback mismatch')
    }
    // Recover the second half of archive-before-pointer persistence before any
    // possible prompt/resend. This cannot unlock a new intent: start below still
    // queries and revalidates the live executed-checkpoint frontier.
    if (record && (record.phase === 'SIGNING' || record.phase === 'SIGNED')) {
      const archived = store.history(key).map(row => archivedRecord(row,key)).filter(row => row.digest === record!.digest)
      marketBuyCheck(archived.length <= 1, 'Duplicate purchase archive')
      if (archived.length) {
        marketBuyCheck(archived[0].retirement!.priorPhase === record.phase
          && canonical({ ...archived[0],phase:record.phase,retirement:undefined }) === canonical(record), 'Purchase archive packet mismatch')
        save(archived[0])
      }
    }
    if (start) {
      marketBuyCheck(!record || terminalMarketBuyOperation(record), 'Recover the pending purchase first')
      if (record && record.phase !== 'CANCELLED') {
        const status = await queryChecked(adapter,copy())
        if (record.phase === 'RETIRED') {
          marketBuyCheck(status !== 'PENDING', 'Retired purchase is pending; query before starting a new operation')
          if (status === 'MISSING') validateMarketBuyCheckpoint(await adapter.expiryCheckpoint(copy()),record.expirationEpoch)
        } else marketBuyCheck(status === record.phase, 'Previous purchase result must be confirmed before a new operation')
        if (record.retirement) ensureArchive(record)
      }
      const prepared = validateMarketBuyOperationRecord(await adapter.prepare())
      scope(prepared); marketBuyCheck(prepared.phase === 'PREPARED', 'Prepared purchase phase mismatch')
      marketBuyCheck(!store.history(key).map(row => archivedRecord(row,key)).some(row => row.digest === prepared.digest),
        'A retired purchase packet cannot be prepared or sent again')
      save(prepared)
    }
    marketBuyCheck(record, 'No matching purchase to recover')
    if (record.phase === 'CANCELLED') return copy()
    const reconcile = async (): Promise<MarketBuyQueryResult> => {
      const result = await queryChecked(adapter,copy())
      if (result === 'SUCCEEDED' || result === 'FAILED') {
        if (result === 'SUCCEEDED') {
          // Past purchase success is not proof of current custody. Every active
          // explicit recovery checks the authenticated mirror again; history
          // queries remain ledger-only observations.
          save({ ...record!, phase: result, syncStatus: 'PENDING' })
          if (record!.syncStatus === 'PENDING') {
            const status = await adapter.sync(copy())
            marketBuyCheck(status === 'COMPLETE' || status === 'SUPERSEDED', 'Invalid purchase synchronization result')
            save({ ...record!, syncStatus: status })
          }
        } else save({ ...record!, phase: result, syncStatus: undefined })
        return result
      }
      marketBuyCheck(record!.phase === 'RETIRED' || !terminalMarketBuyOperation(record!), 'Recorded purchase result cannot be confirmed')
      return result
    }
    const result = await reconcile()
    if (result !== 'MISSING' || queryOnly || record.phase === 'RETIRED') return copy()
    if (retireExpired) {
      marketBuyCheck(record.phase === 'SIGNING' || record.phase === 'SIGNED', 'Only an unknown signing or signed purchase can retire')
      const checkpoint = validateMarketBuyCheckpoint(await adapter.expiryCheckpoint(copy()),record.expirationEpoch)
      let retired = validateMarketBuyOperationRecord({ ...record,phase:'RETIRED',retirement:{priorPhase:record.phase,checkpoint} })
      // An archive write can succeed before the active pointer write fails.
      // Revalidate expiry now, then reuse that original immutable evidence.
      const existing = store.history(key).map(row => archivedRecord(row,key)).filter(row => row.digest === record!.digest)
      marketBuyCheck(existing.length <= 1, 'Duplicate purchase archive')
      if (existing.length) {
        marketBuyCheck(canonical({ ...retired,retirement:existing[0].retirement }) === canonical(existing[0])
          && existing[0].retirement!.priorPhase === record.phase, 'Purchase archive packet mismatch')
        retired = existing[0]
      }
      ensureArchive(retired); save(retired); return copy()
    }
    if (cancelUnsigned) {
      marketBuyCheck(record.phase === 'PREPARED' && record.signature === null, 'A signed or unknown signing transaction cannot be discarded')
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
      marketBuyCheck(signed.bytes === record.bytes, 'Wallet changed the prepared purchase; nothing was broadcast')
      const next = validateMarketBuyOperationRecord({ ...record, phase: 'SIGNED', signature: signed.signature })
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
export async function queryMarketBuyHistory(params: { soulId: string; owner: string; digest: string;
  store: MarketBuyOperationStore; adapter: MarketBuyOperationAdapter }): Promise<MarketBuyQueryResult> {
  const { soulId,owner,digest: requested,store,adapter } = params
  const key = marketBuyOperationKey(soulId,owner)
  marketBuyCheck(marketBuyDigest(requested), 'Invalid purchase history digest')
  return store.exclusive(key,async () => {
    const entries = store.history(key).map(row => archivedRecord(row,key)).filter(row => row.digest === requested)
    marketBuyCheck(entries.length === 1, 'Exact purchase history record required')
    return queryChecked(adapter,entries[0])
  })
}
