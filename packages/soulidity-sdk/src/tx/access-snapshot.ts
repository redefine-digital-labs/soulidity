import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64, normalizeSuiObjectId } from '@mysten/sui/utils'

export type AccessU64 = string | bigint | number
export interface AccessSnapshotDeployment { packageId: string }
export interface GrantMutationSnapshot {
  ownershipEpoch: string
  capacity: string
  activeGrantCount: string
  /** Canonical base64 of the physical ActiveGrantSlot, including stale rows. */
  slotBcs: string | null
  live: boolean
}
export interface PaidMutationSnapshot {
  ownershipEpoch: string
  configBcs: string | null
  buyerTableBcs: string | null
  entryBcs: string | null
}

/** Exact numeric validation, independent of wall-clock time for historical PTBs. */
export function accessU64(value: AccessU64, label: string): bigint {
  if ((typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint')
    || (typeof value === 'string' && !/^(0|[1-9][0-9]{0,19})$/.test(value))
    || (typeof value === 'number' && !Number.isSafeInteger(value))) throw new Error(`${label} must be a canonical u64`)
  const result = BigInt(value)
  if (result < 0n || result > 18446744073709551615n) throw new Error(`${label} is outside the u64 range`)
  return result
}
export function accessId(value: string, label = 'object ID'): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error(`${label} is invalid`)
  return normalizeSuiObjectId(value)
}
export function accessScope(value: number, label = 'scopeMask'): number {
  if (!Number.isInteger(value) || value < 1 || value > 15) throw new Error(`${label} must be a valid scope mask (1..15)`)
  return value
}
export function accessKind(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('kind must be a u32')
  return value
}
export function accessCapacity(value: AccessU64, label = 'capacity'): bigint {
  const result = accessU64(value, label)
  if (result > 10000n) throw new Error(`${label} must be ≤ MAX_GRANT_CAPACITY (10000)`)
  return result
}

const U = bcs.u64(), A = bcs.Address
const GrantSlot = bcs.struct('ActiveGrantSlot', { version: U, grant_id: A, grantee: A, scope_mask: U,
  expires_at_ms: bcs.option(U), ownership_epoch_snapshot: U })
const PaidConfig = bcs.struct('KindPaidConfig', { version: U, price_atomic: U, scope_mask: U,
  duration_ms: bcs.option(U), ownership_epoch_snapshot: U })
const PaidEntry = bcs.struct('KindPaidEntry', { version: U, scope_mask: U, expires_at_ms: bcs.option(U), ownership_epoch_snapshot: U })
const BuyerTable = bcs.struct('Table', { id: A, size: U })
const MarketConfig = bcs.struct('MarketConfigV2', { id: A, version: U, legacy_config_id: A, fee_recipient: A,
  platform_fee_bps: bcs.u16(), primary_enabled: bcs.bool(), secondary_enabled: bcs.bool() })
function bytes<T>(value: string | null, codec: { parse: (value: Uint8Array) => T; serialize: (value: T) => { toBytes: () => Uint8Array } }): number[] | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > 160) throw new Error('snapshot BCS must be canonical base64')
  const raw = fromBase64(value)
  if (toBase64(raw) !== value || toBase64(codec.serialize(codec.parse(raw)).toBytes()) !== value) {
    throw new Error('snapshot BCS must be canonical and contain no trailing bytes')
  }
  return Array.from(raw)
}
function shape(value: object, keys: string[]) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid access mutation snapshot shape')
}

export function addAssertGrantMutationSnapshotCalls(tx: Transaction, params: {
  stateObjectId: string; soulObjectId: string; granteeAddress: string; snapshot: GrantMutationSnapshot
}, deployment: AccessSnapshotDeployment): void {
  const state = accessId(params.stateObjectId), soul = accessId(params.soulObjectId), grantee = accessId(params.granteeAddress, 'granteeAddress')
  const pkg = accessId(deployment.packageId), s = params.snapshot
  shape(s, ['ownershipEpoch', 'capacity', 'activeGrantCount', 'slotBcs', 'live'])
  const epoch = accessU64(s.ownershipEpoch, 'ownershipEpoch'), capacity = accessCapacity(s.capacity)
  const count = accessU64(s.activeGrantCount, 'activeGrantCount'), slot = bytes(s.slotBcs, GrantSlot)
  if (typeof s.live !== 'boolean' || (s.live && slot === null)) throw new Error('Invalid grant snapshot live flag')
  tx.moveCall({ target: `${pkg}::grant::assert_mutation_snapshot`, arguments: [tx.object(state), tx.pure.id(soul),
    tx.pure.address(grantee), tx.pure.u64(epoch), tx.pure.u64(capacity), tx.pure.u64(count),
    tx.pure.option('vector<u8>', slot), tx.pure.bool(s.live), tx.object('0x6')] })
}

export function addAssertPaidMutationSnapshotCalls(tx: Transaction, params: {
  paidAccessListObjectId: string; stateObjectId: string; soulObjectId: string; kind: number
  granteeAddress: string | null; snapshot: PaidMutationSnapshot
}, deployment: AccessSnapshotDeployment): void {
  const list = accessId(params.paidAccessListObjectId), state = accessId(params.stateObjectId), soul = accessId(params.soulObjectId)
  const pkg = accessId(deployment.packageId), kind = accessKind(params.kind)
  const grantee = params.granteeAddress === null ? null : accessId(params.granteeAddress, 'granteeAddress'), s = params.snapshot
  shape(s, ['ownershipEpoch', 'configBcs', 'buyerTableBcs', 'entryBcs'])
  const epoch = accessU64(s.ownershipEpoch, 'ownershipEpoch'), config = bytes(s.configBcs, PaidConfig)
  const table = bytes(s.buyerTableBcs, BuyerTable), entry = bytes(s.entryBcs, PaidEntry)
  if ((grantee === null && (table !== null || entry !== null)) || (table === null && entry !== null)) throw new Error('Invalid paid buyer snapshot binding')
  tx.moveCall({ target: `${pkg}::paid_access::assert_mutation_snapshot`, arguments: [tx.object(list), tx.object(state),
    tx.pure.id(soul), tx.pure.u32(kind), tx.pure.option('address', grantee), tx.pure.u64(epoch),
    tx.pure.option('vector<u8>', config), tx.pure.option('vector<u8>', table), tx.pure.option('vector<u8>', entry)] })
}

export function addAssertPaidMarketSnapshotCalls(tx: Transaction, params: {
  marketConfigObjectId: string; marketConfigBcs: string
}, deployment: AccessSnapshotDeployment): void {
  const config = accessId(params.marketConfigObjectId), pkg = accessId(deployment.packageId)
  const raw = bytes(params.marketConfigBcs, MarketConfig)
  if (raw === null) throw new Error('marketConfigBcs is required')
  tx.moveCall({ target: `${pkg}::market::assert_paid_access_snapshot_v2`, arguments: [tx.object(config), tx.pure.vector('u8', raw)] })
}

export function addAssertGrantCapacityCalls(tx: Transaction, params: {
  stateObjectId: string; capacity: string
}, deployment: AccessSnapshotDeployment): void {
  const state = accessId(params.stateObjectId), pkg = accessId(deployment.packageId), capacity = accessCapacity(params.capacity)
  tx.moveCall({ target: `${pkg}::grant::assert_capacity`, arguments: [tx.object(state), tx.pure.u64(capacity)] })
}

export function addAssertPreservesGrantScopesCalls(tx: Transaction, params: {
  stateObjectId: string; granteeAddress: string; scopeMask: number
}, deployment: AccessSnapshotDeployment): void {
  const state = accessId(params.stateObjectId), grantee = accessId(params.granteeAddress, 'granteeAddress')
  const pkg = accessId(deployment.packageId), scope = accessScope(params.scopeMask)
  tx.moveCall({ target: `${pkg}::grant::assert_preserves_active_scopes`, arguments: [tx.object(state),
    tx.pure.address(grantee), tx.pure.u64(scope), tx.object('0x6')] })
}
