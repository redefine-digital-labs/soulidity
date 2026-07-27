/**
 * Phase 2 per-kind paid-access tx builders. Mirrors:
 *   - market.move:
 *       configure_paid_access_kind / update_paid_access_kind /
 *       delete_paid_access_kind / purchase_paid_access (kind: u32)
 *   - paid_access.move:
 *       add_access (owner-only manual grant)
 *       revoke_access (owner-only)
 *       cleanup_stale_entries (anyone)
 *
 * Configuration epochs auto-invalidate on Soul ownership rotation; UI must
 * surface that to buyers and prompt re-configuration on the new owner side.
 */
import { Transaction, type TransactionArgument } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'

const SUI_CLOCK_OBJECT_ID = '0x6'

interface PaidAccessRoots {
  paidAccessListObjectId: string
  stateObjectId: string
}

interface PaidAccessKindRoots extends PaidAccessRoots {
  kindRegistryObjectId: string
}

function loadPaidAccessEnv() {
  return {
    packageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID'),
    marketConfigId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'),
    kindRegistryId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID'),
    paymentCoinType: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE'),
  }
}

function buildOptionalU64(tx: Transaction, value: number | bigint | null | undefined) {
  return tx.pure.option('u64', value == null ? null : BigInt(value))
}

// ── Configure / Update / Delete ──────────────────────────────────────────

export interface ConfigurePaidAccessKindParams extends PaidAccessKindRoots {
  kind: number
  priceAtomic: bigint | number
  scopeMask: number
  /** Lifetime access when null. */
  durationMs: number | bigint | null
}

export function buildConfigurePaidAccessKindTx(
  params: ConfigurePaidAccessKindParams,
): Transaction {
  const env = loadPaidAccessEnv()
  const tx = new Transaction()
  tx.moveCall({
    target: `${env.packageId}::market::configure_paid_access_kind_v2`,
    arguments: [
      tx.object(env.marketConfigId),
      tx.object(params.kindRegistryObjectId),
      tx.object(params.paidAccessListObjectId),
      tx.object(params.stateObjectId),
      tx.pure.u32(params.kind),
      tx.pure.u64(BigInt(params.priceAtomic)),
      tx.pure.u64(BigInt(params.scopeMask)),
      buildOptionalU64(tx, params.durationMs),
    ],
  })
  return tx
}

export interface UpdatePaidAccessKindParams extends ConfigurePaidAccessKindParams {}

export function buildUpdatePaidAccessKindTx(params: UpdatePaidAccessKindParams): Transaction {
  const env = loadPaidAccessEnv()
  const tx = new Transaction()
  tx.moveCall({
    target: `${env.packageId}::market::update_paid_access_kind_v2`,
    arguments: [
      tx.object(env.marketConfigId),
      tx.object(params.kindRegistryObjectId),
      tx.object(params.paidAccessListObjectId),
      tx.object(params.stateObjectId),
      tx.pure.u32(params.kind),
      tx.pure.u64(BigInt(params.priceAtomic)),
      tx.pure.u64(BigInt(params.scopeMask)),
      buildOptionalU64(tx, params.durationMs),
    ],
  })
  return tx
}

export interface DeletePaidAccessKindParams extends PaidAccessRoots {
  kind: number
}

export function buildDeletePaidAccessKindTx(params: DeletePaidAccessKindParams): Transaction {
  const env = loadPaidAccessEnv()
  const tx = new Transaction()
  tx.moveCall({
    target: `${env.packageId}::market::delete_paid_access_kind_v2`,
    arguments: [
      tx.object(env.marketConfigId),
      tx.object(params.paidAccessListObjectId),
      tx.object(params.stateObjectId),
      tx.pure.u32(params.kind),
    ],
  })
  return tx
}

// ── Purchase (per-kind) ──────────────────────────────────────────────────

export interface PurchasePaidAccessParams extends PaidAccessRoots {
  kind: number
  /**
   * Either a single payment coin object id (sourced from a previous coin-merge
   * step) or a list of coin object ids that must merge to exactly the quoted
   * total. The function builds the merge inline and asserts amount on-chain.
   */
  paymentCoinId?: string
  paymentCoinObjectIds?: string[]
  totalAtomic?: bigint | number
}

function buildPaymentCoin(
  tx: Transaction,
  params: PurchasePaidAccessParams,
  paymentCoinType: string,
): TransactionArgument {
  if (params.paymentCoinId) {
    return tx.object(params.paymentCoinId)
  }
  if (params.paymentCoinObjectIds && params.paymentCoinObjectIds.length > 0) {
    const [primary, ...rest] = params.paymentCoinObjectIds
    const primaryObj = tx.object(primary)
    if (rest.length > 0) {
      tx.mergeCoins(primaryObj, rest.map((id) => tx.object(id)))
    }
    if (params.totalAtomic != null) {
      const [splitCoin] = tx.splitCoins(primaryObj, [tx.pure.u64(BigInt(params.totalAtomic))])
      return splitCoin
    }
    return primaryObj
  }
  throw new Error('buildPurchasePaidAccessTx: paymentCoinId or paymentCoinObjectIds required')
}

export function buildPurchasePaidAccessTx(params: PurchasePaidAccessParams): Transaction {
  const env = loadPaidAccessEnv()
  const tx = new Transaction()
  const payment = buildPaymentCoin(tx, params, env.paymentCoinType)
  tx.moveCall({
    target: `${env.packageId}::market::purchase_paid_access_v2`,
    arguments: [
      tx.object(env.marketConfigId),
      tx.object(params.paidAccessListObjectId),
      tx.object(params.stateObjectId),
      tx.pure.u32(params.kind),
      payment,
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
}

// ── Owner-only manual grant / revoke (paid_access module direct) ─────────

export interface AddPaidAccessParams extends PaidAccessKindRoots {
  granteeAddress: string
  kind: number
  scopeMask: number
  /** Lifetime when null. */
  expiresAtMs: number | bigint | null
}

export function buildAddPaidAccessTx(params: AddPaidAccessParams): Transaction {
  const env = loadPaidAccessEnv()
  const tx = new Transaction()
  tx.moveCall({
    target: `${env.packageId}::paid_access::add_access`,
    arguments: [
      tx.object(params.paidAccessListObjectId),
      tx.object(params.stateObjectId),
      tx.object(params.kindRegistryObjectId),
      tx.pure.address(params.granteeAddress),
      tx.pure.u32(params.kind),
      tx.pure.u64(BigInt(params.scopeMask)),
      buildOptionalU64(tx, params.expiresAtMs),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
}

export interface RevokePaidAccessParams extends PaidAccessRoots {
  granteeAddress: string
  kind: number
}

export function buildRevokePaidAccessTx(params: RevokePaidAccessParams): Transaction {
  const env = loadPaidAccessEnv()
  const tx = new Transaction()
  tx.moveCall({
    target: `${env.packageId}::paid_access::revoke_access`,
    arguments: [
      tx.object(params.paidAccessListObjectId),
      tx.object(params.stateObjectId),
      tx.pure.address(params.granteeAddress),
      tx.pure.u32(params.kind),
    ],
  })
  return tx
}

// ── Cleanup stale entries (anyone may call) ──────────────────────────────

export interface CleanupStalePaidAccessParams extends PaidAccessRoots {
  /** Parallel arrays — `addrs[i]` paired with `kinds[i]`. */
  addrs: string[]
  kinds: number[]
}

export function buildCleanupStalePaidAccessTx(
  params: CleanupStalePaidAccessParams,
): Transaction {
  if (params.addrs.length !== params.kinds.length) {
    throw new Error('buildCleanupStalePaidAccessTx: addrs / kinds length mismatch')
  }
  const env = loadPaidAccessEnv()
  const tx = new Transaction()
  tx.moveCall({
    target: `${env.packageId}::paid_access::cleanup_stale_entries`,
    arguments: [
      tx.object(params.paidAccessListObjectId),
      tx.object(params.stateObjectId),
      tx.pure.vector('address', params.addrs),
      tx.pure.vector('u32', params.kinds),
    ],
  })
  return tx
}
