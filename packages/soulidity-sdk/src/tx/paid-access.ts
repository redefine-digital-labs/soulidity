/** Per-kind paid-access builders; composable with read-only snapshot guards. */
import { Transaction, type TransactionArgument } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'
import { accessU64, accessId, accessScope, accessKind, type AccessU64 } from './access-snapshot'

const SUI_CLOCK_OBJECT_ID = '0x6'
export interface PaidAccessDeployment {
  packageId: string
  marketConfigId: string
  kindRegistryId?: string
  paymentCoinType?: string
}
interface PaidAccessRoots { paidAccessListObjectId: string; stateObjectId: string }
interface PaidAccessKindRoots extends PaidAccessRoots { kindRegistryObjectId: string }
function roots(params: PaidAccessRoots, deployment?: PaidAccessDeployment) {
  return { packageId: accessId(deployment?.packageId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')),
    list: accessId(params.paidAccessListObjectId), state: accessId(params.stateObjectId) }
}
function market(deployment?: PaidAccessDeployment): string {
  return accessId(deployment?.marketConfigId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'))
}
function optionalU64(value: AccessU64 | null | undefined, label: string): bigint | null {
  return value == null ? null : accessU64(value, label)
}

export interface ConfigurePaidAccessKindParams extends PaidAccessKindRoots {
  kind: number
  priceAtomic: AccessU64
  scopeMask: number
  /** Lifetime access when null. */
  durationMs: AccessU64 | null
}
function configure(params: ConfigurePaidAccessKindParams, operation: string, deployment: PaidAccessDeployment | undefined, tx: Transaction) {
  const r = roots(params, deployment), config = market(deployment), registry = accessId(params.kindRegistryObjectId)
  const kind = accessKind(params.kind), price = accessU64(params.priceAtomic, 'priceAtomic')
  const scope = accessScope(params.scopeMask), duration = optionalU64(params.durationMs, 'durationMs')
  tx.moveCall({ target: `${r.packageId}::market::${operation}`, arguments: [tx.object(config), tx.object(registry),
    tx.object(r.list), tx.object(r.state), tx.pure.u32(kind), tx.pure.u64(price), tx.pure.u64(scope), tx.pure.option('u64', duration)] })
  return tx
}
export function buildConfigurePaidAccessKindTx(params: ConfigurePaidAccessKindParams, deployment?: PaidAccessDeployment, tx = new Transaction()): Transaction {
  return configure(params, 'configure_paid_access_kind_v2', deployment, tx)
}
export interface UpdatePaidAccessKindParams extends ConfigurePaidAccessKindParams {}
export function buildUpdatePaidAccessKindTx(params: UpdatePaidAccessKindParams, deployment?: PaidAccessDeployment, tx = new Transaction()): Transaction {
  return configure(params, 'update_paid_access_kind_v2', deployment, tx)
}
export interface DeletePaidAccessKindParams extends PaidAccessRoots { kind: number }
export function buildDeletePaidAccessKindTx(params: DeletePaidAccessKindParams, deployment?: PaidAccessDeployment, tx = new Transaction()): Transaction {
  const r = roots(params, deployment), config = market(deployment), kind = accessKind(params.kind)
  tx.moveCall({ target: `${r.packageId}::market::delete_paid_access_kind_v2`, arguments: [tx.object(config),
    tx.object(r.list), tx.object(r.state), tx.pure.u32(kind)] })
  return tx
}

export interface PurchasePaidAccessParams extends PaidAccessRoots {
  kind: number
  /** An exact-total coin, or coins merged and optionally split to totalAtomic. */
  paymentCoinId?: string
  paymentCoinObjectIds?: string[]
  totalAtomic?: AccessU64
}
export function buildPurchasePaidAccessTx(params: PurchasePaidAccessParams, deployment?: PaidAccessDeployment, tx = new Transaction()): Transaction {
  const r = roots(params, deployment), config = market(deployment), kind = accessKind(params.kind)
  // Validate all inputs before adding even a merge/split command to a caller PTB.
  const total = optionalU64(params.totalAtomic, 'totalAtomic')
  const exactCoin = params.paymentCoinId ? accessId(params.paymentCoinId) : null
  const coins = params.paymentCoinObjectIds?.map(id => accessId(id)) ?? []
  if (exactCoin && coins.length) throw new Error('Specify paymentCoinId or paymentCoinObjectIds, not both')
  if (new Set(coins).size !== coins.length) throw new Error('Duplicate payment coin object IDs')
  if (!exactCoin && !coins.length) throw new Error('buildPurchasePaidAccessTx: paymentCoinId or paymentCoinObjectIds required')
  let payment: TransactionArgument
  if (exactCoin) payment = tx.object(exactCoin)
  else {
    const [primary, ...rest] = coins, primaryObj = tx.object(primary)
    if (rest.length) tx.mergeCoins(primaryObj, rest.map(id => tx.object(id)))
    payment = total === null ? primaryObj : tx.splitCoins(primaryObj, [tx.pure.u64(total)])[0]
  }
  tx.moveCall({ target: `${r.packageId}::market::purchase_paid_access_v2`, arguments: [tx.object(config),
    tx.object(r.list), tx.object(r.state), tx.pure.u32(kind), payment, tx.object(SUI_CLOCK_OBJECT_ID)] })
  return tx
}

export interface AddPaidAccessParams extends PaidAccessKindRoots {
  granteeAddress: string
  kind: number
  scopeMask: number
  /** Lifetime when null; historical reconstruction does not depend on Date.now. */
  expiresAtMs: AccessU64 | null
}
export function buildAddPaidAccessTx(params: AddPaidAccessParams, deployment?: PaidAccessDeployment, tx = new Transaction()): Transaction {
  const r = roots(params, deployment), registry = accessId(params.kindRegistryObjectId), grantee = accessId(params.granteeAddress, 'granteeAddress')
  const kind = accessKind(params.kind), scope = accessScope(params.scopeMask), expiry = optionalU64(params.expiresAtMs, 'expiresAtMs')
  tx.moveCall({ target: `${r.packageId}::paid_access::add_access`, arguments: [tx.object(r.list), tx.object(r.state),
    tx.object(registry), tx.pure.address(grantee), tx.pure.u32(kind), tx.pure.u64(scope),
    tx.pure.option('u64', expiry), tx.object(SUI_CLOCK_OBJECT_ID)] })
  return tx
}
export interface RevokePaidAccessParams extends PaidAccessRoots { granteeAddress: string; kind: number }
export function buildRevokePaidAccessTx(params: RevokePaidAccessParams, deployment?: PaidAccessDeployment, tx = new Transaction()): Transaction {
  const r = roots(params, deployment), grantee = accessId(params.granteeAddress, 'granteeAddress'), kind = accessKind(params.kind)
  tx.moveCall({ target: `${r.packageId}::paid_access::revoke_access`, arguments: [tx.object(r.list), tx.object(r.state),
    tx.pure.address(grantee), tx.pure.u32(kind)] })
  return tx
}
export interface CleanupStalePaidAccessParams extends PaidAccessRoots { addrs: string[]; kinds: number[] }
export function buildCleanupStalePaidAccessTx(params: CleanupStalePaidAccessParams, deployment?: PaidAccessDeployment, tx = new Transaction()): Transaction {
  if (params.addrs.length !== params.kinds.length) throw new Error('buildCleanupStalePaidAccessTx: addrs / kinds length mismatch')
  const r = roots(params, deployment), addrs = params.addrs.map(addr => accessId(addr, 'granteeAddress')), kinds = params.kinds.map(accessKind)
  tx.moveCall({ target: `${r.packageId}::paid_access::cleanup_stale_entries`, arguments: [tx.object(r.list), tx.object(r.state),
    tx.pure.vector('address', addrs), tx.pure.vector('u32', kinds)] })
  return tx
}
