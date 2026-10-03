import {validateListingTransactionBytes} from './listing-transaction-validation'
import {runListingLifecycle} from './listing-operation-lifecycle'
import {withListingWalletLock,assertListingSelectionAvailable,marketListReservedAssets} from './listing-operation-scope'
import { fromBase58, toBase58, normalizeStructTag } from '@mysten/sui/utils'
import { buildListAnimacraftV8SoulTx, buildRepriceAnimacraftV8SoulTx, buildSelectedAnimacraftSoulSaleV8Tx } from '@soulidity/sdk'
import { validateMarketCancelCheckpoint as validateMarketListCheckpoint, type MarketCancelCheckpoint as MarketListCheckpoint } from './market-cancel-checkpoint'
import { NATIVE_MARKET_PAYMENT_COIN_TYPE } from './market-buy-types'
import type { NativeMarketListSnapshot, MarketListOperationRecord } from './market-list-types'
export type { NativeMarketListSnapshot, MarketListOperationRecord } from './market-list-types'
export type MarketListSnapshot = NativeMarketListSnapshot

export function marketListCheck(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export const marketListId = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
export const marketListUint64 = (value: unknown) => typeof value === 'string' && value.length <= 20 && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 18446744073709551615n
const positive = (value: unknown) => marketListUint64(value) && BigInt(value as string) > 0n
export const marketListDigest = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 44) return false
  try { const bytes = fromBase58(value); return bytes.length === 32 && toBase58(bytes) === value } catch { return false }
}
export function marketListOperationKey(soulId: string, owner: string) {
  marketListCheck(marketListId(soulId) && marketListId(owner), 'Invalid native listing scope')
  // LIST and atomic REPRICE intentionally share one durable scope and lock.
  return `soulidity.market-list-operation:mainnet:${soulId}:${owner}`
}
export const terminalMarketListOperation = (r: MarketListOperationRecord) => ['SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(r.phase)
export function validateMarketListSnapshot(value: unknown): NativeMarketListSnapshot {
  const s = structuredClone(value) as NativeMarketListSnapshot; const r=s?.release
  marketListCheck(s?.schema === 'native-market-list-v1' && r?.network === 'mainnet'
    && [s.soulId,s.stateId,s.bindingId,s.owner,s.kioskId,s.kioskCapId,s.creator,s.makerCreator,s.protocolFeeRecipient,
      r.protocolConfigId,r.soulidityOriginalPackageId,r.soulidityCallablePackageId,r.marketConfigV2Id,r.kioskRegistryId,r.soulTransferPolicyId,r.kioskPackageId].every(marketListId)
    && marketListDigest(r.soulidityCallableDigest) && marketListUint64(s.ownershipEpoch)
    && [s.listed,s.listAvailable,s.repriceAvailable,r.writesEnabled].every(v=>typeof v==='boolean')
    && r.paymentCoinType === NATIVE_MARKET_PAYMENT_COIN_TYPE
    && (s.equipmentId===null||marketListId(s.equipmentId))
    && (s.listed ? marketListId(s.listingId)&&positive(s.priceAtomic) : s.listingId===null&&s.priceAtomic===null),
  'Invalid native listing identity/release')
  const e=s.equipmentSale
  if(s.equipmentId===null) marketListCheck(e===undefined,'Unexpected equipment sale plan')
  else if(e!==undefined) {
    const exact=(value:unknown,fields:string[])=>marketListCheck(value!==null&&typeof value==='object'&&!Array.isArray(value)
      &&Object.keys(value).sort().join(',')===fields.sort().join(','),'Invalid equipment sale fields')
    exact(e,['scope','definitionRegistryId','baseRegistryId','removals','packs','runtimeCallableDigest','writesEnabled'])
    exact(e!.scope,['target','soulStateId','equipmentId','expectedRevision'])
    exact(e!.scope.target,['soulidityCallablePackageId','runtimeOriginalPackageId','protocolConfigId'])
    marketListCheck(e!.scope.soulStateId===s.stateId&&e!.scope.equipmentId===s.equipmentId
      &&e!.scope.target.soulidityCallablePackageId===r.soulidityCallablePackageId&&e!.scope.target.protocolConfigId===r.protocolConfigId
      &&marketListId(e!.scope.target.runtimeOriginalPackageId)&&marketListUint64(e!.scope.expectedRevision)
      &&marketListId(e!.definitionRegistryId)&&marketListId(e!.baseRegistryId)&&marketListDigest(e!.runtimeCallableDigest)
      &&typeof e!.writesEnabled==='boolean'&&Array.isArray(e!.removals)&&e!.removals.length<=500
      &&Array.isArray(e!.packs)&&e!.packs.length<=500,'Invalid equipment sale scope')
    for(const removal of e!.removals){
      exact(removal,removal.kind==='selection'?['kind','selectionIndex']:['kind','itemId'])
      marketListCheck(removal.kind==='selection'?marketListUint64(removal.selectionIndex)&&BigInt(removal.selectionIndex)<500n
        :['base','external'].includes(removal.kind)&&marketListId(removal.itemId),'Invalid equipment removal')
    }
    for(const [index,pack] of e!.packs.entries()){
      exact(pack,['runtimeCallablePackageId','paymentCoinType','releaseId','bindingIndex'])
      marketListCheck(marketListId(pack.runtimeCallablePackageId)&&marketListId(pack.releaseId)
        &&pack.bindingIndex===String(index)&&typeof pack.paymentCoinType==='string'&&pack.paymentCoinType.includes('::'),'Invalid equipment Pack identity')
      normalizeStructTag(pack.paymentCoinType)
    }
    // Validates adjacent revisions, unique instances/slots, Pack order and coin
    // types even for paused recovery records, without wallet/network activity.
    buildSelectedAnimacraftSoulSaleV8Tx([{target:r,soulStateId:s.stateId,provenanceBindingId:s.bindingId,
      currentKioskId:s.kioskId,currentKioskCapOnChainId:s.kioskCapId,priceAtomic:1n,equipment:e!}])
    marketListCheck(e!.packs.every(pack=>pack.runtimeCallablePackageId===e!.packs[0].runtimeCallablePackageId),'Mixed equipment Runtime packages')
  }
  marketListCheck((!s.listAvailable||!s.listed&&(s.equipmentId===null||e!==undefined))&&(!s.repriceAvailable||s.listed&&s.equipmentId===null),
    'Invalid native listing availability')
  const objects=[s.soulId,s.stateId,s.bindingId,s.kioskId,s.kioskCapId,r.marketConfigV2Id,r.kioskRegistryId,r.soulTransferPolicyId,
    r.protocolConfigId,...(s.listingId?[s.listingId]:[]),...(s.equipmentId?[s.equipmentId]:[]),
    ...(e?[e.definitionRegistryId,e.baseRegistryId,...e.packs.map(pack=>pack.releaseId),
      ...e.removals.flatMap(removal=>removal.kind==='selection'?[]:[removal.itemId])]:[])]
  marketListCheck(new Set(objects).size===objects.length,'Listing object identities overlap')
  const packages=[r.soulidityOriginalPackageId,r.soulidityCallablePackageId,r.kioskPackageId,
    ...(e?[e.scope.target.runtimeOriginalPackageId,...e.packs.map(pack=>pack.runtimeCallablePackageId)]:[])]
  marketListCheck(objects.every(id=>!packages.includes(id)),'Listing objects overlap packages')
  const rates=[s.soulCreatorRoyaltyBps,s.makerSourceRoyaltyBps]
  marketListCheck(rates.every(n=>Number.isInteger(n)&&n>=0&&n<=1000&&n%50===0)&&rates[0]+rates[1]<=1000,'Invalid native listing royalty schedule')
  return s
}
export function buildMarketListOperationTransaction(r: Pick<MarketListOperationRecord,'snapshot'|'kind'|'priceAtomic'>) {
  const s=r.snapshot
  marketListCheck(s.equipmentId===null||r.kind==='list'&&s.equipmentSale!==undefined,'Verified equipment sale plan required')
  const args={target:s.release,soulStateId:s.stateId,provenanceBindingId:s.bindingId,currentKioskId:s.kioskId,
    currentKioskCapOnChainId:s.kioskCapId,priceAtomic:BigInt(r.priceAtomic)}
  return r.kind==='reprice' ? buildRepriceAnimacraftV8SoulTx({...args,listingId:s.listingId!})
    : s.equipmentSale ? buildSelectedAnimacraftSoulSaleV8Tx([{...args,equipment:s.equipmentSale}]) : buildListAnimacraftV8SoulTx(args)
}
/** Compare canonical real SDK commands, including cancellation order and the
 * unique listing Result consumed by finalize. No extra transfer/payment inputs. */
export function validateMarketListOperationRecord(value: unknown): MarketListOperationRecord {
  const r=structuredClone(value) as MarketListOperationRecord
  const s=validateMarketListSnapshot(r?.snapshot);r.snapshot=s
  marketListCheck(r.schema===1&&['list','reprice'].includes(r.kind)&&positive(r.priceAtomic)&&marketListUint64(r.expirationEpoch)
    && (r.kind==='list'?!s.listed&&(s.equipmentId===null||s.equipmentSale!==undefined):s.listed&&s.equipmentId===null)
    && ['PREPARED','SIGNING','SIGNED','SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(r.phase)
    && (r.signature===null||typeof r.signature==='string'&&r.signature.length>0&&r.signature.length<32768)
    && (r.phase!=='SIGNED'||r.signature!==null)
    && (r.phase==='SUCCEEDED'?['PENDING','COMPLETE','SUPERSEDED'].includes(r.syncStatus as string):r.syncStatus===undefined)
    && (!['PREPARED','SIGNING','CANCELLED'].includes(r.phase)||r.signature===null),'Invalid native listing journal')
  marketListCheck(r.phase!=='RETIRED'||r.retirement,'Retired listing evidence missing')
  if(r.retirement!==undefined){
    marketListCheck(['RETIRED','SUCCEEDED','FAILED'].includes(r.phase)&&['SIGNING','SIGNED'].includes(r.retirement?.priorPhase)
      &&(r.retirement.priorPhase==='SIGNED'?r.signature!==null:r.signature===null),'Invalid listing retirement')
    r.retirement.checkpoint=validateMarketListCheckpoint(r.retirement.checkpoint,r.expirationEpoch)
  }
  const owned=new Set([s.bindingId,s.kioskCapId,...(s.equipmentSale?.removals.flatMap(row=>row.kind==='selection'?[]:[row.itemId])??[])])
  const mutable=new Set([s.stateId,s.kioskId,s.release.kioskRegistryId,...(s.listingId?[s.listingId]:[]),...(s.equipmentId?[s.equipmentId]:[])])
  validateListingTransactionBytes(r,{owner:s.owner,expected:buildMarketListOperationTransaction(r),owned,mutable,
    forbidden:[s.soulId,...(s.listingId?[s.listingId]:[]),s.release.soulTransferPolicyId,s.release.protocolConfigId,
      ...(s.equipmentSale?[s.equipmentSale.definitionRegistryId,s.equipmentSale.baseRegistryId,...s.equipmentSale.packs.map(pack=>pack.releaseId)]:[])]})
  return r
}

export interface MarketListOperationStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): MarketListOperationRecord | null
  write(key: string, record: MarketListOperationRecord): void
  archive(key: string, record: MarketListOperationRecord): void
  history(key: string): MarketListOperationRecord[]
  assertAvailable?(key:string,record:MarketListOperationRecord):void
}
export const marketListCanonical = (value: unknown): string => JSON.stringify(value, (_key, current) => current && typeof current === 'object' && !Array.isArray(current)
  ? Object.fromEntries(Object.keys(current).sort().map(key => [key,current[key]])) : current)
const canonical=marketListCanonical
function archivedRecord(value: unknown, key: string) {
  const record = validateMarketListOperationRecord(value)
  marketListCheck(record.phase === 'RETIRED' && marketListOperationKey(record.snapshot.soulId,record.snapshot.owner) === key, 'Listing archive scope/state mismatch')
  return record
}
/** Committed cross-tab journal; no TTL, deletion, quota swallowing or fallback. */
export function browserMarketListOperationStore(): MarketListOperationStore {
  marketListCheck(typeof window !== 'undefined' && navigator.locks?.request, 'Persistent listing recovery requires browser storage and Web Locks')
  const storage = window.localStorage
  return {
    exclusive:withListingWalletLock,
    assertAvailable:(key,record)=>assertListingSelectionAvailable(storage,key,record.snapshot.owner,marketListReservedAssets(record.snapshot)),
    read: key => {
      const raw = storage.getItem(key)
      if (raw === null) return null
      marketListCheck(raw.length <= 250000, 'Listing recovery record exceeds its size limit')
      return validateMarketListOperationRecord(JSON.parse(raw))
    },
    write: (key, record) => {
      const encoded = JSON.stringify(validateMarketListOperationRecord(record))
      marketListCheck(encoded.length <= 250000, 'Listing recovery record exceeds its size limit')
      storage.setItem(key, encoded)
      marketListCheck(storage.getItem(key) === encoded, 'Listing recovery could not be persisted')
    },
    archive: (key, value) => {
      const record = archivedRecord(value,key); const archiveKey = `${key}:retired:${record.digest}`
      const encoded = canonical(record)
      marketListCheck(encoded.length <= 250000, 'Listing archive exceeds its size limit')
      const existing = storage.getItem(archiveKey)
      if (existing !== null) marketListCheck(existing === encoded, 'Listing archive is immutable')
      else storage.setItem(archiveKey,encoded)
      marketListCheck(storage.getItem(archiveKey) === encoded, 'Listing archive could not be persisted')
    },
    history: key => {
      const prefix = `${key}:retired:`; const records: MarketListOperationRecord[] = []
      for (let index=0; index<storage.length; index++) {
        const name = storage.key(index)
        if (!name?.startsWith(prefix)) continue
        const raw = storage.getItem(name)
        marketListCheck(raw && raw.length <= 250000, 'Invalid listing archive size')
        const record = archivedRecord(JSON.parse(raw),key)
        marketListCheck(name === `${prefix}${record.digest}`, 'Listing archive digest mismatch')
        records.push(record)
      }
      return records.sort((a,b) => a.digest.localeCompare(b.digest))
    },
  }
}
export type MarketListQueryResult = 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'
export interface MarketListOperationAdapter {
  prepare(): Promise<MarketListOperationRecord>
  query(record: MarketListOperationRecord): Promise<MarketListQueryResult>
  preflight(record: MarketListOperationRecord, signing: boolean): Promise<void>
  sign(record: MarketListOperationRecord): Promise<{ bytes: string; signature: string }>
  verifySignature(record: MarketListOperationRecord): Promise<void>
  broadcast(record: MarketListOperationRecord): Promise<void>
  sync(record: MarketListOperationRecord): Promise<'COMPLETE' | 'SUPERSEDED'>
  expiryCheckpoint(record: MarketListOperationRecord): Promise<MarketListCheckpoint>
}
async function queryChecked(adapter: MarketListOperationAdapter, record: MarketListOperationRecord): Promise<MarketListQueryResult> {
  const result = await adapter.query(structuredClone(record))
  marketListCheck(['MISSING','PENDING','SUCCEEDED','FAILED'].includes(result), 'Invalid listing query result')
  return result
}

export async function runMarketListOperation(params: {
  soulId: string; owner: string; start?: boolean; store: MarketListOperationStore; adapter: MarketListOperationAdapter
  queryOnly?: boolean; cancelUnsigned?: boolean; retireExpired?: boolean; onRecord?: (record: MarketListOperationRecord) => void
}) {
  const {soulId,owner}=params
  return runListingLifecycle({...params,key:marketListOperationKey(soulId,owner),validate:validateMarketListOperationRecord,
    assertScope:r=>marketListCheck(r.snapshot.soulId===soulId&&r.snapshot.owner===owner,'Listing recovery scope mismatch')})
}
/** Historical outcomes are ephemeral observations; the retired packet remains
 * immutable and cannot sign, sync the current Soul, or mutate the active intent. */
export async function queryMarketListHistory(params: { soulId: string; owner: string; digest: string;
  store: MarketListOperationStore; adapter: MarketListOperationAdapter }): Promise<MarketListQueryResult> {
  const { soulId,owner,digest: requested,store,adapter } = params
  const key = marketListOperationKey(soulId,owner)
  marketListCheck(marketListDigest(requested), 'Invalid listing history digest')
  return store.exclusive(key,async () => {
    const entries = store.history(key).map(row => archivedRecord(row,key)).filter(row => row.digest === requested)
    marketListCheck(entries.length === 1, 'Exact listing history record required')
    return queryChecked(adapter,entries[0])
  })
}
