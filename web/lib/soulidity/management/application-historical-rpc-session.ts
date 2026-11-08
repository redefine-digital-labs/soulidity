import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toBase64 } from '@mysten/sui/utils'

const immutable = new Set(['getObject','getTransaction','getCheckpoint'])
function version(value: unknown) { return typeof value === 'bigint' ? value >= 0n : typeof value === 'string' ? /^(0|[1-9][0-9]*)$/.test(value) : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function eligible(method: string, request: any) {
  if (method === 'getObject') return typeof request?.objectId === 'string' && version(request.version)
  if (method === 'getTransaction') return typeof request?.digest === 'string' && request.digest.length > 0
  return version(request?.checkpointId?.sequenceNumber) || (typeof request?.checkpointId?.digest === 'string' && request.checkpointId.digest.length > 0)
}
function normalize(value: any): any {
  if (typeof value === 'bigint') return { $bigint: String(value) }
  if (value instanceof Uint8Array) return { $bytes: toBase64(value) }
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key,normalize(value[key])]))
  return value
}
function reusable(method: string, request: any, result: any) {
  const bytes = (value: unknown) => value instanceof Uint8Array && value.length > 0
  if (method === 'getObject') { const row = result?.response?.object; return row?.objectId === request.objectId && String(row.version) === String(request.version) && bytes(row.bcs?.value) }
  if (method === 'getTransaction') { const row = result?.response?.transaction; return row?.digest === request.digest && version(row.checkpoint) && row.effects?.status?.success === true && bytes(row.transaction?.bcs?.value) && bytes(row.effects?.bcs?.value) }
  const row = result?.response?.checkpoint
  return row && (request.checkpointId.digest ? row.digest === request.checkpointId.digest : String(row.sequenceNumber) === String(request.checkpointId.sequenceNumber)) && bytes(row.summary?.bcs?.value) && bytes(row.contents?.bcs?.value)
}
/** Conservative retained-response size, with early exit and no large JSON copy. */
function size(value: any, limit: number, seen = new Set<object>()): number {
  if (value instanceof Uint8Array) return value.byteLength
  if (typeof value === 'string') return value.length * 2
  if (value === null || typeof value !== 'object') return 16
  if (seen.has(value)) return limit + 1
  seen.add(value); let total = 32
  for (const key of Object.keys(value)) { total += key.length * 2 + size(value[key],limit-total,seen); if (total > limit) break }
  seen.delete(value); return total
}
/** One original recovery query only. Original immutable raw responses may be
 * coalesced/reused, never conclusions. All caller hash/type/owner/checkpoint
 * verifiers still execute. Live chain info, latest/current reads, RPC errors and
 * nonfinal transactions bypass retained caching. No cross-query persistence. */
export function createManagementHistoricalRpcSession(input: {
  client: SuiGrpcClient; signal: AbortSignal; maxEntries?: number; maxBytes?: number
}) {
  const maxEntries = input.maxEntries ?? 256, maxBytes = input.maxBytes ?? 16 * 1024 * 1024
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 256 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) throw Error('APPLICATION_HISTORICAL_RPC_SESSION_BOUND')
  const lifecycle = new AbortController(), signal = AbortSignal.any([input.signal,lifecycle.signal])
  const entries = new Map<string,Promise<any>>()
  let retainedBytes = 0, hits = 0, network = 0
  const check = (caller?: AbortSignal) => { signal.throwIfAborted(); caller?.throwIfAborted() }
  signal.addEventListener('abort',()=>{entries.clear();retainedBytes=0},{once:true})
  const service = input.client.ledgerService, wrappers = new Map<PropertyKey,unknown>()
  const ledgerService = new Proxy(service, { get(target,property) {
    const original = Reflect.get(target,property,target)
    if (typeof original !== 'function') return original
    if (wrappers.has(property)) return wrappers.get(property)
    if (typeof property !== 'string' || !immutable.has(property)) return original.bind(target)
    const wrapped = async (request: unknown, options?: any) => {
      const caller = options?.abort as AbortSignal | undefined; check(caller)
      const fetch = async () => { network++; const result = await original.call(target,request,{...options,abort:AbortSignal.any([signal,...(caller?[caller]:[])])});check(caller);return result }
      if (!eligible(property,request)) return fetch()
      const key = property+':'+JSON.stringify(normalize(request))
      if (key.length > 32768) return fetch()
      let pending = entries.get(key)
      if (pending) hits++
      else {
        if (entries.size >= maxEntries) return fetch()
        pending = fetch().then(result => {
          check(caller)
          if (!reusable(property,request,result)) { entries.delete(key); return result }
          let bytes: number
          try { bytes = size(result.response,maxBytes-retainedBytes) } catch { entries.delete(key); return result }
          if (bytes > maxBytes-retainedBytes) { entries.delete(key); return result }
          const snapshot = {...result,response:structuredClone(result.response)}
          retainedBytes += bytes; return snapshot
        }).catch(error => { entries.delete(key); throw error })
        entries.set(key,pending)
      }
      const result = await pending; check(caller)
      return {...result,response:structuredClone(result.response)}
    }
    wrappers.set(property,wrapped); return wrapped
  } })
  const client = new Proxy(input.client,{get(target,property){if(property==='ledgerService')return ledgerService;const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value}})
  return {client,signal,stats:()=>({hits,network,entries:entries.size,retainedBytes}),dispose(){lifecycle.abort();entries.clear();retainedBytes=0}}
}
