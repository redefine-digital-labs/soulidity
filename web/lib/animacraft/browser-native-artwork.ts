import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { profileReadStep, readSoulPublicSnapshotBySoulId } from '@soulidity/sdk'
import { getBrowserNativeReceiveTarget } from './browser-native-config'
import { createNativeReceiveClient, NativeReceiveError, readNativeReceiveTarget, receiveId,
  type NativeReceiveTarget } from './native-receive'
import { readNativeArtwork, fetchNativeArtwork } from './native-artwork'
import { readNativeCompleteReadTarget } from './native-complete-read'
import { readNativeEquipmentReadTarget } from './native-equipment-read'
import { readNativeEquipmentRenderTarget } from './native-equipment-render'
import { completeReadAggregatorUrls } from './native-protected-read-authority'
import { MAINNET_GENESIS_DIGEST } from './mainnet-chain'

export interface BrowserNativeArtworkConfig { target: NativeReceiveTarget }
export interface BrowserNativeProtectedArtworkConfig extends BrowserNativeArtworkConfig { aggregators: [string, string][] }
interface Subject { soulId: string; stateId: string; signal?: AbortSignal }
interface Dependencies { client?: (signal: AbortSignal) => SuiGrpcClient }
type Raw = NonNullable<Awaited<ReturnType<SuiGrpcClient['ledgerService']['getObject']>>['response']['object']>
const fullMask = ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents', 'package']
const fingerprint = (value: unknown) => toHex(sha256(new TextEncoder().encode(JSON.stringify(value,
  (_key, entry) => typeof entry === 'bigint' ? String(entry) : entry instanceof Uint8Array ? toBase64(entry) : entry))))
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_ARTWORK_BROWSER_INVALID', message, 422)
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

/** Public cover/scene reads never depend on Seal service configuration. */
export function getBrowserNativeArtworkConfig(): BrowserNativeArtworkConfig {
  return freeze({ target: getBrowserNativeReceiveTarget() })
}
export function getBrowserNativeProtectedArtworkConfig(): BrowserNativeProtectedArtworkConfig {
  const config = getBrowserNativeArtworkConfig()
  const aggregators = completeReadAggregatorUrls({
    NEXT_PUBLIC_SUI_NETWORK: process.env.NEXT_PUBLIC_SUI_NETWORK,
    NEXT_PUBLIC_SEAL_SERVER_CONFIGS: process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS,
  })
  return freeze({ ...config, aggregators: [...aggregators] })
}

function capture<C extends BrowserNativeArtworkConfig>(params: { soulId: string; stateId?: string; config: C; signal?: AbortSignal }) {
  const { signal: callerSignal, ...input } = params, data = structuredClone(input)
  receiveId(data.soulId)
  if (data.stateId !== undefined) receiveId(data.stateId)
  const pin = data.config.target
  const target = readNativeReceiveTarget({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: pin.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: pin.soulidityOriginalPackageId,
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(pin) })
  const signal = callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)
  signal.throwIfAborted()
  return { data, target, signal }
}
function aggregatorMap(config: BrowserNativeProtectedArtworkConfig) {
  check(Array.isArray(config.aggregators) && config.aggregators.length <= 64
    && config.aggregators.every(row => Array.isArray(row) && row.length === 2 && row.every(value => typeof value === 'string')),
  'Invalid captured public Seal service configuration')
  // The same public-only URL validator applies to supplied session snapshots.
  return completeReadAggregatorUrls({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet', NEXT_PUBLIC_SEAL_SERVER_CONFIGS:
    JSON.stringify(config.aggregators.map(([objectId, aggregatorUrl]) => ({ objectId, aggregatorUrl }))) })
}

/** The raw readers retain all provenance and Seal authority checks. This
 * session adds one browser deadline and a full-byte recheck spanning manifest
 * downloads, including immutable evidence and exact optional-field absence. */
export function createBrowserNativeReadSession(original: SuiGrpcClient, signal: AbortSignal) {
  const rows = new Map<string, string>(), batches = new Map<string, { request: unknown; value: string }>()
  const coreReads = new Map<string, { method: string; args: unknown[]; value: string }>()
  let calls = 0, totalBytes = 0
  const accept = (id: string, row: Raw | undefined) => {
    check(row?.objectId === id && typeof row.version === 'bigint' && row.version > 0n
      && row.version <= 18446744073709551615n, 'Artwork object reference unavailable')
    check(typeof row.digest === 'string' && fromBase58(row.digest).length === 32
      && toBase58(fromBase58(row.digest)) === row.digest, 'Artwork object digest invalid')
    if (row.owner?.kind === 3) check(typeof row.owner.version === 'bigint' && row.owner.version > 0n
      && row.owner.version <= row.version, 'Artwork shared birth version invalid')
    const contentBytes = row.contents?.value?.length ?? 0
    const moduleBytes = row.package?.modules.reduce((sum, module) => sum + (module.contents?.length ?? 0), 0) ?? 0
    check(contentBytes <= 256 * 1024 && moduleBytes <= 16 * 1024 * 1024
      && (!row.package || row.package.modules.length <= 1024 && row.package.typeOrigins.length <= 8192 && row.package.linkage.length <= 1024)
      && (totalBytes += contentBytes + moduleBytes) <= 64 * 1024 * 1024, 'Artwork evidence byte budget exceeded')
    const value = fingerprint(row)
    check(!rows.has(id) || rows.get(id) === value, 'Artwork evidence changed; retry the complete read')
    rows.set(id, value)
  }
  const ledger = new Proxy(original.ledgerService, { get(value, key) {
    const method = Reflect.get(value, key, value)
    if (typeof method !== 'function') return method
    return (input: any, options?: any) => {
      signal.throwIfAborted(); check(++calls <= 4096, 'Artwork read budget exceeded')
      const request = structuredClone(input)
      if (key === 'getObject' || key === 'batchGetObjects') request.readMask = { paths: fullMask }
      const call = method.call(value, request, { ...options, abort: signal })
      const finished = profileReadStep(signal, async () => {
        const wire = await call, result = { ...wire, response: structuredClone(wire.response) }
        if (key === 'getObject') accept(request.objectId, result.response.object)
        if (key === 'batchGetObjects') {
          check(result.response.objects.length === request.requests.length, 'Incomplete artwork batch')
          result.response.objects.forEach((entry: any, index: number) => {
            if (entry.result.oneofKind === 'object') accept(request.requests[index].objectId, entry.result.object)
            else check(entry.result.oneofKind === 'error' && entry.result.error.code === 5, 'Artwork optional evidence unavailable')
          })
          const id = fingerprint(request), value = fingerprint(result.response)
          check(!batches.has(id) || batches.get(id)!.value === value, 'Artwork optional evidence changed')
          batches.set(id, { request, value })
        }
        return result
      })
      return new Proxy(call, { get(value, key) {
        if (key === 'then') return finished.then.bind(finished)
        if (key === 'response') return finished.then(result => result.response)
        return Reflect.get(value, key, value)
      } })
    }
  } })
  const core = new Proxy(original.core, { get(value, key) {
    const method = Reflect.get(value, key, value)
    if (typeof method !== 'function') return method
    return (...input: unknown[]) => {
      const args = structuredClone(input)
      return profileReadStep(signal, async () => {
        const result = structuredClone(await Reflect.apply(method, value, args))
        if (key === 'getChainIdentifier' || key === 'getDynamicField') {
          const id = `${String(key)}:${fingerprint(args)}`, value = fingerprint(result)
          check(!coreReads.has(id) || coreReads.get(id)!.value === value, 'Artwork protocol evidence changed')
          coreReads.set(id, { method: String(key), args, value })
        }
        return result
      })
    }
  } })
  const client = new Proxy(original, { get(value, key) {
    return key === 'ledgerService' ? ledger : key === 'core' ? core : Reflect.get(value, key, value)
  } })
  return { client, async finish<T>(result: T) {
    // Snapshot original observations before rechecking: new verification batches
    // must not recursively join their own replay queue. Exact IDs and full-byte
    // fingerprints are unchanged; batching does not relax either evidence budget.
    const ids = [...rows.keys()], observedBatches = [...batches.values()]
    const verifyRequests: Array<Parameters<typeof client.ledgerService.batchGetObjects>[0]> = []
    for (let start = 0; start < ids.length; start += 50) {
      verifyRequests.push({
        requests: ids.slice(start, start + 50).map(objectId => ({ objectId })), readMask: { paths: fullMask },
      })
    }
    const recheck = async (requests: typeof verifyRequests, requirePresent: boolean) => {
      for (let start = 0; start < requests.length; start += 8) {
        signal.throwIfAborted()
        const results = await Promise.allSettled(requests.slice(start, start + 8).map(async request => {
          const { response } = await client.ledgerService.batchGetObjects(request)
          if (requirePresent) check(response.objects.every(entry => entry.result?.oneofKind === 'object'),
            'Artwork evidence disappeared during final verification')
        }))
        const failure = results.find(result => result.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
      }
    }
    await recheck(verifyRequests, true)
    // Optional-field absences retain their original exact per-object statuses.
    await recheck(observedBatches.map(({ request }) => request as typeof verifyRequests[number]), false)
    for (const { method, args } of coreReads.values()) await Reflect.apply(Reflect.get(core, method), core, args)
    signal.throwIfAborted()
    return result
  } }
}

export async function readBrowserNativeCompleteReadTarget(params: Subject & { config: BrowserNativeProtectedArtworkConfig }, dependencies: Dependencies = {}) {
  const { data, target, signal } = capture(params), aggregators = aggregatorMap(data.config)
  const read = createBrowserNativeReadSession((dependencies.client ?? createNativeReceiveClient)(signal), signal)
  return profileReadStep(signal, async () => read.finish(await readNativeCompleteReadTarget(read.client, target,
    { soulId: data.soulId, stateId: data.stateId! }, signal, aggregators)))
}
export async function readBrowserNativeEquipmentReadTarget(params: Subject & { selectionIndex: number; config: BrowserNativeProtectedArtworkConfig }, dependencies: Dependencies = {}) {
  const { data, target, signal } = capture(params), aggregators = aggregatorMap(data.config)
  const selectionIndex = params.selectionIndex
  check(Number.isSafeInteger(selectionIndex) && selectionIndex >= 0 && selectionIndex < 500, 'Invalid equipment selection index')
  const read = createBrowserNativeReadSession((dependencies.client ?? createNativeReceiveClient)(signal), signal)
  return profileReadStep(signal, async () => read.finish(await readNativeEquipmentReadTarget(read.client, target,
    { soulId: data.soulId, stateId: data.stateId!, selectionIndex }, signal, aggregators)))
}
export async function readBrowserNativeEquipmentRenderTarget(params: Subject & { config: BrowserNativeArtworkConfig }, dependencies: Dependencies = {}) {
  const { data, target, signal } = capture(params), read = createBrowserNativeReadSession((dependencies.client ?? createNativeReceiveClient)(signal), signal)
  return profileReadStep(signal, async () => read.finish(await readNativeEquipmentRenderTarget(read.client, target,
    { soulId: data.soulId, stateId: data.stateId! }, signal)))
}

/** A Soul-ID cover resolves its immutable State pointer before the exact native
 * Output, never a caller-provided State, SQL lookup or public-looking URL. */
export async function readBrowserNativeArtwork(params: { soulId: string; config: BrowserNativeArtworkConfig; signal?: AbortSignal },
  dependencies: Dependencies = {}): Promise<{ status: 'PROTECTED' } | { status: 'PUBLIC'; blob: Blob }> {
  const { data, target, signal } = capture(params), read = createBrowserNativeReadSession((dependencies.client ?? createNativeReceiveClient)(signal), signal)
  return profileReadStep(signal, async () => {
    const snapshot = await readSoulPublicSnapshotBySoulId({ client: read.client, soulId: data.soulId, signal,
      deployment: { originalPackageId: target.soulidityOriginalPackageId,
        chainIdentifier: toHex(fromBase58(MAINNET_GENESIS_DIGEST).subarray(0, 4)) } })
    const proof = await readNativeArtwork(read.client, target, { soulId: data.soulId, stateId: snapshot.stateId })
    check(proof.soulId === snapshot.soulId && snapshot.imageUrl === `walrus://${proof.blobId}`, 'Artwork public metadata mismatch')
    if (proof.status === 'PROTECTED') return read.finish({ status: 'PROTECTED' as const })
    const bytes = await fetchNativeArtwork(proof, fetch, signal)
    await read.finish(undefined)
    return { status: 'PUBLIC' as const, blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }) }
  })
}
