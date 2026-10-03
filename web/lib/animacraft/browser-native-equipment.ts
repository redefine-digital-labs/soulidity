import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { profileReadStep } from '@soulidity/sdk'
import { getBrowserNativeReceiveTarget } from './browser-native-config'
import { createNativeReceiveClient, NativeReceiveError, receiveId, type NativeReceiveTarget } from './native-receive'
import { readNativeEquipment } from './native-equipment'
import { validEquipmentPackCursor, validEquipmentPackKey } from './native-equipment-pack'
import { validEquipmentCursor } from './native-equipment-bytes'
import { validateNamedLoadoutContent, type NamedLoadoutContent } from './named-loadout'

type Input = Parameters<typeof readNativeEquipment>[2]
export type BrowserEquipmentSnapshot = Awaited<ReturnType<typeof readNativeEquipment>>
const badQuery = () => { throw new NativeReceiveError('NATIVE_EQUIPMENT_BAD_QUERY', 'Invalid equipment read query.', 400) }

/** Same bounded public query surface as the former read API. The caller never
 * supplies owner, equipment IDs, source registry IDs or a claimed entitlement. */
export function parseBrowserEquipmentQuery(query: URLSearchParams): Pick<Input, 'inventory' | 'source' | 'update'> {
  const kind = query.get('inventory'), cursor = query.get('cursor'), itemId = query.get('item')
  const source = query.get('source'), styleStart = query.get('styleStart')
  const pack = query.get('pack'), packPass = query.get('packPass'), packCursor = query.get('packCursor')
  const packStyleCursor = query.get('packStyleCursor')
  const packPart = query.get('packPart'), packItem = query.get('packItem'), packStyle = query.get('packStyle')
  const keys = ['inventory', 'cursor', 'source', 'styleStart', 'item', 'pack', 'packPass', 'packCursor', 'packStyleCursor', 'packPart', 'packItem', 'packStyle', 'update']
  const styleKeys = [packPart, packItem, packStyle]
  const isId = (value: string) => /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
  if ([...query.keys()].some(key => !keys.includes(key)) || keys.some(key => query.getAll(key).length > 1)
    || (pack !== null && (pack !== '1' || source !== '1'))
    || (keys.slice(6, 12).some(key => query.has(key)) && pack !== '1')
    || (query.has('update') && query.get('update') !== '1')
    || (packPass !== null && (!isId(packPass) || packCursor !== null))
    || [packCursor, packStyleCursor].some(value => value !== null && !validEquipmentPackCursor(value))
    || (packStyleCursor !== null && packPass === null)
    || (styleKeys.some(key => key !== null) && (packPass === null || packStyleCursor !== null
      || styleKeys.some(key => key === null || !validEquipmentPackKey(key))))
    || (itemId !== null && (kind === null || cursor !== null || !isId(itemId)))
    || (source !== null && source !== '1')
    || (styleStart !== null && (source !== '1' || !/^(0|[1-9][0-9]{0,2})$/.test(styleStart) || Number(styleStart) > 500))
    || (kind !== null && kind !== 'base' && kind !== 'external') || (cursor !== null && kind === null)
    || (cursor !== null && !validEquipmentCursor(cursor))) return badQuery()
  return {
    ...(query.has('update') ? { update: true as const } : {}),
    ...(kind ? { inventory: { kind: kind as 'base' | 'external', ...(cursor ? { cursor } : {}), ...(itemId ? { itemId } : {}) } } : {}),
    ...(source ? { source: { ...(styleStart !== null ? { styleStart: Number(styleStart) } : {}),
      ...(pack ? { pack: { ...(packPass !== null ? { passId: packPass } : {}),
        ...(packCursor !== null ? { cursor: packCursor } : {}),
        ...(packStyleCursor !== null ? { styleCursor: packStyleCursor } : {}),
        ...(packPart !== null && packItem !== null && packStyle !== null
          ? { style: { partKey: packPart, itemKey: packItem, styleKey: packStyle } } : {}) } } : {}) } } : {}),
  }
}

/** Browser-to-gRPC read only. Soul/State IDs are discovery hints: the original
 * reader verifies their actual BCS linkage, custody, release, rights and stable
 * read set. No SQL lookup, JSON-RPC, private library read or signing occurs. */
export async function readBrowserNativeEquipment(params: {
  soulId: string; stateId: string; query?: URLSearchParams; loadoutContent?: NamedLoadoutContent; signal?: AbortSignal
}, dependencies: {
  target?: () => NativeReceiveTarget
  client?: (signal: AbortSignal) => SuiGrpcClient
} = {}): Promise<BrowserEquipmentSnapshot> {
  const soulId = receiveId(params.soulId), stateId = receiveId(params.stateId)
  const query = parseBrowserEquipmentQuery(new URLSearchParams(params.query))
  const content = params.loadoutContent === undefined ? undefined : structuredClone(validateNamedLoadoutContent(params.loadoutContent))
  if (content && (content.soulId !== soulId || content.stateId !== stateId || Object.keys(query).length !== 0)) badQuery()
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)
  signal.throwIfAborted()
  const target = structuredClone((dependencies.target ?? getBrowserNativeReceiveTarget)())
  const client = (dependencies.client ?? createNativeReceiveClient)(signal)
  const snapshot = await profileReadStep(signal, () => readNativeEquipment(client, target, {
    soulId, stateId, ...query, ...(content ? { loadoutContent: content } : {}),
  }))
  if (content && (snapshot.status !== 'BOUND' || !snapshot.equipment || !snapshot.source
    || !Array.isArray(snapshot.source.applyPacks) || !snapshot.inventory
    || snapshot.owner !== content.capturedOwner || snapshot.ownershipEpoch !== content.capturedOwnershipEpoch)) {
    throw new NativeReceiveError('NAMED_LOADOUT_EQUIPMENT_CHANGED', 'The Soul or saved loadout source changed. Refresh before applying it.', 409)
  }
  signal.throwIfAborted()
  return snapshot
}
