import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { profileReadStep } from '@soulidity/sdk'
import { getBrowserNativeReceiveTarget } from './browser-native-config'
import { boundedNativeMarketClient } from './browser-native-market-read'
import { createNativeReceiveClient, NativeReceiveError, readNativeReceiveTarget, receiveId,
  type NativeReceiveTarget } from './native-receive'
import { readOwnedEquipmentMarketSnapshot, readEquipmentMarketListingSnapshot } from './native-equipment-market-read'
import {readEquipmentMarketOperationSnapshot,type EquipmentMarketReadRequest} from './equipment-market-operation-snapshot'

export interface BrowserNativeEquipmentMarketConfig {
  target: NativeReceiveTarget & { equipmentMarket: NonNullable<NativeReceiveTarget['equipmentMarket']> }
}
interface Dependencies { client?: (signal: AbortSignal) => SuiGrpcClient }
function check(value: unknown, label: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_EQUIPMENT_MARKET_BROWSER_INVALID', label)
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
export function getBrowserNativeEquipmentMarketConfig(): BrowserNativeEquipmentMarketConfig {
  const target = getBrowserNativeReceiveTarget()
  check(target.equipmentMarket && target.runtime, 'Exact equipment Market release pin is unavailable')
  return freeze({ target }) as BrowserNativeEquipmentMarketConfig
}
function capture<T extends { rootId: string; config: BrowserNativeEquipmentMarketConfig; signal?: AbortSignal }>(input: T, fields: string[]) {
  check(Object.keys(input).every(key => ['rootId', 'config', 'signal', ...fields].includes(key)), 'Unexpected equipment Market read fields')
  check(input.config && Object.keys(input.config).length === 1 && Object.hasOwn(input.config, 'target'), 'Unexpected equipment Market config fields')
  const { signal: callerSignal, ...values } = input, data = structuredClone(values)
  const signal = callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)
  signal.throwIfAborted(); receiveId(data.rootId)
  const pin = data.config.target
  const target = readNativeReceiveTarget({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: pin.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: pin.soulidityOriginalPackageId,
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(pin) })
  check(target.equipmentMarket && target.runtime, 'Exact equipment Market release pin is unavailable')
  return { data, signal, target, market: target.equipmentMarket }
}

/** Exact selected instance only. Neither entry point enumerates the wallet,
 * signs, or enables writes; hooks/journals must enforce the release switches. */
export async function readBrowserOwnedEquipmentMarket(input: { rootId: string; itemId: string; kind: 'base' | 'external'; owner: string;
  config: BrowserNativeEquipmentMarketConfig; signal?: AbortSignal }, dependencies: Dependencies = {}) {
  const { data, signal, target, market } = capture(input, ['itemId', 'kind', 'owner'])
  receiveId(data.itemId); receiveId(data.owner)
  check(data.kind === 'base' || data.kind === 'external', 'Unsupported equipment kind')
  const client = boundedNativeMarketClient((dependencies.client ?? createNativeReceiveClient)(signal), signal)
  return profileReadStep(signal, () => readOwnedEquipmentMarketSnapshot(client, target, market,
    { rootId: data.rootId, itemId: data.itemId, kind: data.kind, owner: data.owner }, signal))
}

export async function readBrowserEquipmentMarketListing(input: { rootId: string; listingId: string; actor?: string;
  config: BrowserNativeEquipmentMarketConfig; signal?: AbortSignal }, dependencies: Dependencies = {}) {
  const { data, signal, target, market } = capture(input, ['listingId', 'actor'])
  receiveId(data.listingId); if (data.actor !== undefined) receiveId(data.actor)
  const client = boundedNativeMarketClient((dependencies.client ?? createNativeReceiveClient)(signal), signal)
  return profileReadStep(signal, () => readEquipmentMarketListingSnapshot(client, target, market,
    { rootId: data.rootId, listingId: data.listingId, actor: data.actor }, signal))
}

/** Transaction review/preflight entry. Equipped instances require the explicitly
 * selected Soul scope; the browser never expands wallet inventory into a sale. */
export async function readBrowserEquipmentMarketOperation(input:EquipmentMarketReadRequest&{
  config:BrowserNativeEquipmentMarketConfig;signal?:AbortSignal},dependencies:Dependencies={}){
  const {data,signal,target}=capture(input,['actor','itemId','kind','listingId','equipmentScope'])
  const {config:_,...request}=data
  const client=boundedNativeMarketClient((dependencies.client??createNativeReceiveClient)(signal),signal)
  return profileReadStep(signal,()=>readEquipmentMarketOperationSnapshot(client,target,request,signal))
}
