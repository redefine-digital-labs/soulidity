import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'

const SUI_CLOCK_OBJECT_ID = '0x6'

export function buildPurchaseContentAccessTx(params: {
  accessListOnChainId: string
  stateOnChainId: string
  paymentCoinId?: string
  paymentCoinObjectIds?: string[]
  totalAtomic?: bigint
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const tx = new Transaction()
  const paymentCoin = buildPaymentCoin(tx, params)
  tx.moveCall({
    target: `${packageId}::market::purchase_content_access`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(params.accessListOnChainId),
      tx.object(params.stateOnChainId),
      paymentCoin,
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
}

function buildPaymentCoin(
  tx: Transaction,
  params: {
    paymentCoinId?: string
    paymentCoinObjectIds?: string[]
    totalAtomic?: bigint
  },
) {
  if (params.paymentCoinObjectIds) {
    if (params.totalAtomic == null || params.totalAtomic <= 0n) {
      throw new Error('totalAtomic must be positive when paymentCoinObjectIds is provided')
    }
    if (params.paymentCoinObjectIds.length === 0) {
      throw new Error('paymentCoinObjectIds must contain at least one object id')
    }
    const [primaryCoinId, ...remainingCoinIds] = params.paymentCoinObjectIds
    const primaryCoin = tx.object(primaryCoinId!)
    if (remainingCoinIds.length > 0) {
      tx.mergeCoins(primaryCoin, remainingCoinIds.map((coinId) => tx.object(coinId)))
    }
    const [paymentCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(params.totalAtomic)])
    return paymentCoin
  }

  if (!params.paymentCoinId) {
    throw new Error('paymentCoinId or paymentCoinObjectIds is required')
  }
  return tx.object(params.paymentCoinId)
}

export function buildAddContentAccessTx(params: {
  accessListOnChainId: string
  stateOnChainId: string
  grantee: string
  scopeMask: number
  expiresAtMs?: number | null
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::content_access::add_access`,
    arguments: [
      tx.object(params.accessListOnChainId),
      tx.object(params.stateOnChainId),
      tx.pure.address(params.grantee),
      tx.pure.u64(params.scopeMask),
      tx.pure.option('u64', params.expiresAtMs ?? null),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
}

export function buildRevokeContentAccessTx(params: {
  accessListOnChainId: string
  stateOnChainId: string
  grantee: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::content_access::revoke_access`,
    arguments: [
      tx.object(params.accessListOnChainId),
      tx.object(params.stateOnChainId),
      tx.pure.address(params.grantee),
    ],
  })
  return tx
}

export function buildSetContentAccessPriceTx(params: {
  accessListOnChainId: string
  stateOnChainId: string
  newPriceAtomic: number
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::content_access::set_content_price`,
    arguments: [
      tx.object(params.accessListOnChainId),
      tx.object(params.stateOnChainId),
      tx.pure.u64(params.newPriceAtomic),
    ],
  })
  return tx
}

export function buildSetContentAccessDurationTx(params: {
  accessListOnChainId: string
  stateOnChainId: string
  newDurationMs?: number | null
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::content_access::set_content_access_duration`,
    arguments: [
      tx.object(params.accessListOnChainId),
      tx.object(params.stateOnChainId),
      tx.pure.option('u64', params.newDurationMs ?? null),
    ],
  })
  return tx
}
