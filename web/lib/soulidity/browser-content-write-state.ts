import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, toHex } from '@mysten/sui/utils'
import { profileReadStep, readSoulDetailState, readSoulPublicSnapshotBySoulId, type SoulDetailStateSnapshot } from '@soulidity/sdk'
import { createBrowserNativeReadSession } from '@/lib/animacraft/browser-native-artwork'
import { getBrowserNativeReceiveTarget } from '@/lib/animacraft/browser-native-config'
import { MAINNET_GENESIS_DIGEST } from '@/lib/animacraft/mainnet-chain'
import { attestNativeReceiveTarget, createNativeReceiveClient, readNativeReceiveTarget, receiveId } from '@/lib/animacraft/native-receive'
import type { BrowserContentAccessConfig } from './browser-content-access'

/** Write preflight needs release and registry identity, not download services. */
export type BrowserContentWriteConfig = Pick<BrowserContentAccessConfig, 'target' | 'kindRegistryId'>
export interface BrowserContentWriteState {
  snapshot: SoulDetailStateSnapshot
  soulId: string
  stateId: string
  contentId: string
  originalPackageId: string
  callablePackageId: string
  kindRegistryId: string
}
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`BROWSER_CONTENT_WRITE_${code}`) }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function configOf(input: BrowserContentWriteConfig): BrowserContentWriteConfig {
  const value = structuredClone(input)
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2
    && Object.hasOwn(value, 'target') && Object.hasOwn(value, 'kindRegistryId'), 'CONFIG_INVALID')
  const target = readNativeReceiveTarget({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: value.target?.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: value.target?.soulidityOriginalPackageId,
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(value.target) })
  receiveId(value.kindRegistryId)
  return freeze({ target, kindRegistryId: value.kindRegistryId })
}
export function getBrowserContentWriteConfig(): BrowserContentWriteConfig {
  return configOf({ target: getBrowserNativeReceiveTarget(), kindRegistryId: process.env.NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID! })
}

/** Raw domain snapshot only, never permission to append/delete/purge/configure.
 * Missing new names are legitimate; callers derive CAS counts and authorization
 * from current descriptors, cached slots and grants immediately before signing.
 * Every call starts a fresh bounded observation; there is no cached write proof. */
export async function readBrowserContentWriteState(params: {
  config: BrowserContentWriteConfig; soulId: string; stateId: string; contentId: string
  viewerAddress: string | null; signal?: AbortSignal
  kind?: number
}, dependencies: { client?: (signal: AbortSignal) => SuiGrpcClient } = {}): Promise<BrowserContentWriteState> {
  const config = configOf(params.config), subject = structuredClone({ soulId: params.soulId, stateId: params.stateId,
    contentId: params.contentId, viewerAddress: params.viewerAddress, kind: params.kind })
  for (const value of [subject.soulId, subject.stateId, subject.contentId]) receiveId(value)
  if (subject.viewerAddress !== null) receiveId(subject.viewerAddress)
  check(new Set([subject.soulId, subject.stateId, subject.contentId]).size === 3, 'OBJECT_ALIAS')
  check(subject.kind === undefined || Number.isInteger(subject.kind) && subject.kind >= 0 && subject.kind <= 0xffff_ffff, 'KIND_INVALID')
  const timeout = AbortSignal.timeout(45000), signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout
  signal.throwIfAborted()
  const original = (dependencies.client ?? createNativeReceiveClient)(signal), session = createBrowserNativeReadSession(original, signal)
  const clockId = `0x${'0'.repeat(63)}6`
  // Clock is validated by the domain reader but never byte-frozen. It is an
  // observation time, not a stable business object; every pre-sign call rereads it.
  const ledger = new Proxy(session.client.ledgerService, { get(target, key) {
    const member = Reflect.get(target, key, target)
    if (key !== 'getObject' && key !== 'batchGetObjects') return typeof member === 'function' ? member.bind(target) : member
    return (request: any, options?: any) => {
      const isClock = key === 'getObject' ? request.objectId === clockId
        : request.requests?.length === 1 && request.requests[0].objectId === clockId
      const service = isClock ? original.ledgerService : target
      return Reflect.apply(Reflect.get(service, key, service), service, [request, { ...options, abort: signal }])
    }
  } })
  const client = new Proxy(session.client, { get(target, key) { return key === 'ledgerService' ? ledger : Reflect.get(target, key, target) } })
  return profileReadStep(signal, async () => {
    const pkg = config.target.soulidityOriginalPackageId, types = await attestNativeReceiveTarget(client, config.target)
    check(types.soulType === `${pkg}::soul::Soul` && types.stateType === `${pkg}::soul::SoulState`
      && types.contentObjectType === `${pkg}::content::SoulContent`, 'TYPE_ORIGIN_MISMATCH')
    const deployment = { originalPackageId: pkg, chainIdentifier: toHex(fromBase58(MAINNET_GENESIS_DIGEST).subarray(0, 4)) }
    const asset = await readSoulPublicSnapshotBySoulId({ client, deployment, soulId: subject.soulId, signal })
    check(asset.stateId === subject.stateId && asset.contentId === subject.contentId, 'POINTER_MISMATCH')
    const snapshot = await readSoulDetailState({ client, deployment: { ...deployment, kindRegistryId: config.kindRegistryId },
      stateId: subject.stateId, expectedState: { version: asset.stateVersion, digest: asset.stateDigest },
      viewerAddresses: subject.viewerAddress === null ? [] : [subject.viewerAddress],
      kindIds: subject.kind === undefined ? [] : [subject.kind], signal })
    check(snapshot.soulId === subject.soulId && snapshot.stateId === subject.stateId && snapshot.contentId === subject.contentId,
      'ROOT_MISMATCH')
    await session.finish(undefined)
    return freeze(structuredClone({ snapshot, soulId: subject.soulId, stateId: subject.stateId, contentId: subject.contentId,
      originalPackageId: pkg, callablePackageId: config.target.soulidityCallablePackageId, kindRegistryId: config.kindRegistryId }))
  })
}
