import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'

const SUI_CLOCK_OBJECT_ID = '0x6'

export function buildIssueGrantTx(params: {
  stateObjectId: string
  granteeAddress: string
  scopeMask: number
  expiresAtMs?: number | null
}) {
  if (params.granteeAddress.trim().length === 0) {
    throw new Error('granteeAddress is required')
  }
  if (!Number.isInteger(params.scopeMask) || params.scopeMask <= 0) {
    throw new Error('scopeMask must be a positive integer')
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  const [grantObject] = tx.moveCall({
    target: `${packageId}::grant::issue`,
    arguments: [
      tx.object(params.stateObjectId),
      tx.pure.address(params.granteeAddress),
      tx.pure.u64(params.scopeMask),
      tx.pure.option('u64', params.expiresAtMs ?? null),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  tx.transferObjects([grantObject], tx.pure.address(params.granteeAddress))
  return tx
}

export function buildRevokeGrantTx(params: {
  stateObjectId: string
  granteeAddress: string
}) {
  if (params.granteeAddress.trim().length === 0) {
    throw new Error('granteeAddress is required')
  }
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::grant::revoke`,
    arguments: [
      tx.object(params.stateObjectId),
      tx.pure.address(params.granteeAddress),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
}

export function buildDestroyInvalidatedGrantTx(params: {
  stateObjectId: string
  grantObjectId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::grant::destroy_invalidated_grant`,
    arguments: [
      tx.object(params.grantObjectId),
      tx.object(params.stateObjectId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
}

export function buildSetGrantCapacityTx(params: {
  stateObjectId: string
  capacity: number
}) {
  if (!Number.isSafeInteger(params.capacity) || params.capacity <= 0) {
    throw new Error('capacity must be a positive safe integer')
  }
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::grant::set_grant_capacity`,
    arguments: [
      tx.object(params.stateObjectId),
      tx.pure.u64(params.capacity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
}

export function buildRevokeGrantScopeTx(params: {
  stateObjectId: string
  granteeAddress: string
  revokedScopeMask: number
}) {
  if (params.granteeAddress.trim().length === 0) {
    throw new Error('granteeAddress is required')
  }
  if (!Number.isInteger(params.revokedScopeMask) || params.revokedScopeMask <= 0) {
    throw new Error('revokedScopeMask must be a positive integer')
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  const [grantObject] = tx.moveCall({
    target: `${packageId}::grant::revoke_scope`,
    arguments: [
      tx.object(params.stateObjectId),
      tx.pure.address(params.granteeAddress),
      tx.pure.u64(params.revokedScopeMask),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  tx.transferObjects([grantObject], tx.pure.address(params.granteeAddress))
  return tx
}
