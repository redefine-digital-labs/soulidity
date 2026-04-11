import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'

const SUI_CLOCK_OBJECT_ID = '0x6'

export function buildPurchaseContentAccessTx(params: {
  accessListOnChainId: string
  stateOnChainId: string
  paymentCoinId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::content_access::purchase_content_access`,
    arguments: [
      tx.object(params.accessListOnChainId),
      tx.object(params.stateOnChainId),
      tx.object(params.paymentCoinId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
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
