import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'

const SUI_CLOCK_OBJECT_ID = '0x6'

/**
 * Cap on the number of `grant::issue_to_grantee` / `grant::revoke` calls a
 * single PTB may carry. Sized so a wallet can sign one transaction without
 * tripping per-PTB compute or argument-budget limits; UI flows that exceed
 * this must split the work across multiple wallet signatures.
 */
export const MAX_GRANT_BATCH_SIZE = 32

export interface BatchIssueGrantItem {
  stateObjectId: string
  granteeAddress: string
  scopeMask: number
  expiresAtMs?: number | null
}

export interface BatchRevokeGrantItem {
  stateObjectId: string
  granteeAddress: string
}

function assertBatchSize(length: number, kind: 'issue' | 'revoke') {
  if (length === 0) {
    throw new Error(`buildBatch${kind === 'issue' ? 'IssueGrants' : 'RevokeGrants'}Tx: items must contain at least one entry`)
  }
  if (length > MAX_GRANT_BATCH_SIZE) {
    throw new Error(
      `buildBatch${kind === 'issue' ? 'IssueGrants' : 'RevokeGrants'}Tx: items exceeds MAX_GRANT_BATCH_SIZE (${MAX_GRANT_BATCH_SIZE})`,
    )
  }
}

function assertGranteeAddress(value: string) {
  if (value.trim().length === 0) {
    throw new Error('granteeAddress is required')
  }
}

function assertScopeMask(value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('scopeMask must be a positive integer')
  }
}

function assertFutureExpiry(value: number | null | undefined) {
  if (value != null && value <= Date.now()) {
    throw new Error('expiresAtMs must be in the future')
  }
}

export function buildIssueGrantTx(params: {
  stateObjectId: string
  granteeAddress: string
  scopeMask: number
  expiresAtMs?: number | null
}) {
  assertGranteeAddress(params.granteeAddress)
  assertScopeMask(params.scopeMask)
  assertFutureExpiry(params.expiresAtMs)

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::grant::issue_to_grantee`,
    arguments: [
      tx.object(params.stateObjectId),
      tx.pure.address(params.granteeAddress),
      tx.pure.u64(params.scopeMask),
      tx.pure.option('u64', params.expiresAtMs ?? null),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
}

/**
 * Bundle up to MAX_GRANT_BATCH_SIZE `grant::issue_to_grantee` calls into a
 * single PTB. Used by the desktop pet authorize flow so the human owner only
 * signs once across N owned Souls.
 *
 * Validates every item up front — the whole transaction is rejected if any
 * grantee/scope/expiry is malformed, so the wallet never sees a half-baked
 * PTB. Callers should pre-chunk by MAX_GRANT_BATCH_SIZE; this helper does
 * not silently truncate.
 */
export function buildBatchIssueGrantsTx(params: {
  items: ReadonlyArray<BatchIssueGrantItem>
}) {
  assertBatchSize(params.items.length, 'issue')
  for (const item of params.items) {
    assertGranteeAddress(item.granteeAddress)
    assertScopeMask(item.scopeMask)
    assertFutureExpiry(item.expiresAtMs)
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  for (const item of params.items) {
    tx.moveCall({
      target: `${packageId}::grant::issue_to_grantee`,
      arguments: [
        tx.object(item.stateObjectId),
        tx.pure.address(item.granteeAddress),
        tx.pure.u64(item.scopeMask),
        tx.pure.option('u64', item.expiresAtMs ?? null),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    })
  }
  return tx
}

export function buildRevokeGrantTx(params: {
  stateObjectId: string
  granteeAddress: string
}) {
  assertGranteeAddress(params.granteeAddress)
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

/**
 * Bundle up to MAX_GRANT_BATCH_SIZE `grant::revoke` calls into a single PTB.
 * Mirror of `buildBatchIssueGrantsTx` for the unauthorize/cleanup path.
 */
export function buildBatchRevokeGrantsTx(params: {
  items: ReadonlyArray<BatchRevokeGrantItem>
}) {
  assertBatchSize(params.items.length, 'revoke')
  for (const item of params.items) {
    assertGranteeAddress(item.granteeAddress)
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  for (const item of params.items) {
    tx.moveCall({
      target: `${packageId}::grant::revoke`,
      arguments: [
        tx.object(item.stateObjectId),
        tx.pure.address(item.granteeAddress),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    })
  }
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

export function buildCleanupInactiveGrantsTx(params: {
  stateObjectId: string
  granteeAddresses: string[]
}) {
  if (params.granteeAddresses.length === 0) {
    throw new Error('granteeAddresses must contain at least one address')
  }
  for (const granteeAddress of params.granteeAddresses) {
    if (granteeAddress.trim().length === 0) {
      throw new Error('granteeAddresses cannot contain empty addresses')
    }
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::grant::cleanup_inactive_grants`,
    arguments: [
      tx.object(params.stateObjectId),
      tx.pure.vector('address', params.granteeAddresses),
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
  tx.moveCall({
    target: `${packageId}::grant::revoke_scope_to_grantee`,
    arguments: [
      tx.object(params.stateObjectId),
      tx.pure.address(params.granteeAddress),
      tx.pure.u64(params.revokedScopeMask),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
}
