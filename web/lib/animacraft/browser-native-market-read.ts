import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { profileReadStep, type ResolvedPersonalKiosk } from '@soulidity/sdk'
import { getBrowserNativeReceiveTarget } from './browser-native-config'
import { createNativeReceiveClient, decodeNativeBcs, NativeReceiveError, readNativeReceiveTarget,
  receiveId, type NativeReceiveTarget } from './native-receive'
import { readNativeMarketBuySnapshot, readNativeMarketBuyTarget, type NativeMarketBuyTarget } from './native-market-buy-snapshot'
import { readNativeMarketListSnapshot } from './native-market-list-snapshot'
import {readNativeMarketBatchListSnapshot} from './native-market-batch-list-snapshot'
import {validateMarketBatchListSelection} from './market-batch-list-operation'
import type {MarketBatchListSelection} from './market-batch-list-types'
import { NativeCancelPersonalKioskCapBcs, readNativeMarketCancelSnapshot } from './native-market-cancel-snapshot'

export interface BrowserNativeMarketCancelConfig { target: NativeReceiveTarget }
export interface BrowserNativeMarketConfig extends BrowserNativeMarketCancelConfig { buyTarget: NativeMarketBuyTarget }
interface Dependencies { client?: (signal: AbortSignal) => SuiGrpcClient }
interface Subject { soulId: string; stateId: string; listingId?: string | null; signal?: AbortSignal }

export async function readBrowserNativeMarketBatchList(params:{owner:string;selection:MarketBatchListSelection[];
  config:BrowserNativeMarketConfig;signal?:AbortSignal},dependencies:Dependencies={}){
  check(Object.keys(params).every(key=>['owner','selection','config','signal'].includes(key)),'Unexpected batch read input')
  const {signal:callerSignal,...input}=params,data=structuredClone(input)
  receiveId(data.owner)
  const selection=validateMarketBatchListSelection(data.selection)
  const signal=callerSignal?AbortSignal.any([callerSignal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)
  signal.throwIfAborted()
  const captured={signal,target:captureMarketTarget(data.config.target)}
  const client=boundedNativeMarketClient((dependencies.client??createNativeReceiveClient)(captured.signal),captured.signal)
  return profileReadStep(captured.signal,()=>readNativeMarketBatchListSnapshot(client,captured.target,data.config.buyTarget,
    {owner:data.owner,selection},captured.signal))
}
const KIOSK_FAMILY = '0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879'
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_MARKET_BROWSER_INVALID', message, 422)
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

/** Capture only explicit public release variables. No server-name fallback. */
export function getBrowserNativeMarketConfig(): BrowserNativeMarketConfig {
  const target = getBrowserNativeReceiveTarget()
  const buyTarget = readNativeMarketBuyTarget(target, {
    NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID: process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID,
    NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID: process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID,
    NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID: process.env.NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID,
    NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID: process.env.NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID,
    NEXT_PUBLIC_KIOSK_PACKAGE_ID: process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID,
    NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE: process.env.NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE,
  })
  return freeze({ target, buyTarget })
}

/** Cancellation needs the release, not a fee policy, payment coin or enabled market. */
export function getBrowserNativeMarketCancelConfig(): BrowserNativeMarketCancelConfig {
  return freeze({ target: getBrowserNativeReceiveTarget() })
}

function capture<T extends Subject & { config: BrowserNativeMarketCancelConfig }>(params: T, fields: string[]) {
  check(Object.keys(params).every(key => [...fields, 'soulId', 'stateId', 'listingId', 'config', 'signal'].includes(key)),
    'Unexpected Market read input')
  const { signal: callerSignal, ...data } = params
  const captured = structuredClone(data)
  receiveId(captured.soulId); receiveId(captured.stateId)
  if (captured.listingId != null) receiveId(captured.listingId)
  const signal = callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)
  signal.throwIfAborted()
  const pin = captured.config.target
  // Revalidate the supplied session snapshot, never reread live env here.
  return { data: captured, signal, target:captureMarketTarget(pin) }
}
function captureMarketTarget(pin:NativeReceiveTarget){
  return readNativeReceiveTarget({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: pin.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: pin.soulidityOriginalPackageId,
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(pin) })
}

/** Preserve real gRPC UnaryCall methods; only propagate abort and prevent new
 * calls after cancellation. profileReadStep bounds the whole uncooperative read. */
export function boundedNativeMarketClient(client: SuiGrpcClient, signal: AbortSignal): SuiGrpcClient {
  const services = new Map<PropertyKey, object>()
  return new Proxy(client, { get(value, key) {
    if (!['core', 'ledgerService', 'stateService'].includes(String(key))) return Reflect.get(value, key, value)
    if (!services.has(key)) {
      const service = Reflect.get(value, key, value)
      services.set(key, new Proxy(service, { get(owner, method) {
        const run = Reflect.get(owner, method, owner)
        if (typeof run !== 'function') return run
        return (...args: unknown[]) => {
          signal.throwIfAborted()
          if (key !== 'core') args[1] = { ...(args[1] as object | undefined), abort: signal }
          return Reflect.apply(run, owner, args)
        }
      } }))
    }
    return services.get(key)
  } })
}

/** Fresh typed cap discovery for Cancel only. It does not use the old global
 * SDK client or projected JSON. The original cancel reader re-verifies the one
 * selected cap, its current Kiosk and the whole cancellation readset. */
async function discoverCancelCaps(client: SuiGrpcClient, target: NativeReceiveTarget, owner: string,
  signal: AbortSignal): Promise<ResolvedPersonalKiosk[]> {
  const get = async (objectId: string) => (await client.ledgerService.getObject({ objectId,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'package', 'contents'] } })).response.object
  const native = await get(target.soulidityCallablePackageId), pkg = native?.package
  check(native?.objectId === target.soulidityCallablePackageId && native.digest === target.soulidityCallableDigest
    && native.owner?.kind === 4 && pkg?.storageId === native.objectId && pkg.originalId === target.soulidityOriginalPackageId
    && pkg.version === native.version, 'Native cap-discovery package mismatch')
  const edges = pkg.linkage.filter(row => row.originalId === KIOSK_FAMILY)
  check(edges.length === 1, 'Exact Kiosk dependency required for cap discovery')
  const kioskId = receiveId(edges[0].upgradedId), kiosk = await get(kioskId), dependency = kiosk?.package
  check(kiosk?.objectId === kioskId && kiosk.owner?.kind === 4 && kiosk.version === edges[0].upgradedVersion
    && dependency?.storageId === kioskId && dependency.originalId === KIOSK_FAMILY && dependency.version === kiosk.version,
  'Kiosk dependency mismatch during cap discovery')
  const origins = dependency.typeOrigins.filter(row => row.moduleName === 'personal_kiosk' && row.datatypeName === 'PersonalKioskCap')
  check(origins.length === 1 && dependency.modules.some(row => row.name === 'personal_kiosk' && row.contents && row.contents.length > 4),
    'Missing cap type origin')
  const type = `${receiveId(origins[0].packageId)}::personal_kiosk::PersonalKioskCap`
  const candidates = new Set<string>(), cursors = new Set<string>()
  let cursor: Uint8Array | undefined
  for (let page = 0; ; page++) {
    signal.throwIfAborted(); check(page < 100, 'Cap discovery exceeds bounded pages')
    const { response } = await client.stateService.listOwnedObjects({ owner, objectType: type, pageSize: 50, pageToken: cursor,
      readMask: { paths: ['object_id', 'object_type', 'owner'] } })
    check(Array.isArray(response.objects) && response.objects.length <= 50, 'Malformed cap discovery page')
    for (const row of response.objects) {
      const objectId = receiveId(row.objectId)
      check(!candidates.has(objectId) && row.owner?.kind === 1 && row.owner.address === owner
        && row.objectType && normalizeStructTag(row.objectType) === normalizeStructTag(type), 'Cap candidate identity mismatch')
      candidates.add(objectId)
    }
    cursor = response.nextPageToken
    check(cursor === undefined || cursor instanceof Uint8Array && cursor.length <= 4096, 'Malformed cap cursor')
    if (!cursor?.length) break
    const key = toBase64(cursor); check(!cursors.has(key), 'Repeated cap cursor'); cursors.add(key)
  }
  const result: ResolvedPersonalKiosk[] = []
  for (const objectId of [...candidates].sort()) {
    signal.throwIfAborted()
    const row = await get(objectId)
    check(row?.objectId === objectId && row.owner?.kind === 1 && row.owner.address === owner
      && row.objectType && normalizeStructTag(row.objectType) === normalizeStructTag(type)
      && typeof row.version === 'bigint' && row.version > 0n && typeof row.digest === 'string' && row.digest.length > 0,
    'Raw discovered cap identity mismatch')
    const cap = decodeNativeBcs(NativeCancelPersonalKioskCapBcs, row.contents?.value)
    check(cap.id === objectId && cap.cap, 'Raw discovered cap mismatch'); receiveId(cap.cap.id)
    result.push({ ownerAddress: owner, currentKioskId: receiveId(cap.cap.for), currentKioskCapOnChainId: objectId })
  }
  return result
}

export async function readBrowserNativeMarketBuy(params: Subject & { buyer: string; config: BrowserNativeMarketConfig },
  dependencies: Dependencies = {}) {
  const { data, signal, target } = capture(params, ['buyer'])
  receiveId(data.buyer)
  check(data.config.buyTarget, 'Buy target is required')
  const client = boundedNativeMarketClient((dependencies.client ?? createNativeReceiveClient)(signal), signal)
  return profileReadStep(signal, () => readNativeMarketBuySnapshot(client, target, data.config.buyTarget,
    { soulId: data.soulId, stateId: data.stateId, buyer: data.buyer, listingId: data.listingId }, signal))
}

export async function readBrowserNativeMarketList(params: Subject & { kioskCapId?: string | null; config: BrowserNativeMarketConfig },
  dependencies: Dependencies = {}) {
  const { data, signal, target } = capture(params, ['kioskCapId'])
  if (data.kioskCapId != null) receiveId(data.kioskCapId)
  check(data.config.buyTarget, 'List target is required')
  const client = boundedNativeMarketClient((dependencies.client ?? createNativeReceiveClient)(signal), signal)
  return profileReadStep(signal, () => readNativeMarketListSnapshot(client, target, data.config.buyTarget,
    { soulId: data.soulId, stateId: data.stateId, listingId: data.listingId, kioskCapId: data.kioskCapId }, signal))
}

export async function readBrowserNativeMarketCancel(params: Subject & { listingId: string; kioskCapId?: string | null;
  config: BrowserNativeMarketCancelConfig }, dependencies: Dependencies = {}) {
  const { data, signal, target } = capture(params, ['kioskCapId'])
  receiveId(data.listingId)
  if (data.kioskCapId != null) receiveId(data.kioskCapId)
  const client = boundedNativeMarketClient((dependencies.client ?? createNativeReceiveClient)(signal), signal)
  return profileReadStep(signal, () => readNativeMarketCancelSnapshot(client, target,
    { soulId: data.soulId, stateId: data.stateId, listingId: data.listingId, kioskCapId: data.kioskCapId }, signal,
    owner => discoverCancelCaps(client, target, owner, signal)))
}
