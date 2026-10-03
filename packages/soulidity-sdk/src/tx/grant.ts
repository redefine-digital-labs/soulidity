import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'
import { accessU64, accessId, accessScope, accessCapacity, type AccessU64 } from './access-snapshot'

const SUI_CLOCK_OBJECT_ID = '0x6'

/**
 * Cap on the number of `grant::issue_to_grantee` / `grant::revoke` calls a
 * single PTB may carry. Sized so a wallet can sign one transaction without
 * tripping per-PTB compute or argument-budget limits; UI flows that exceed
 * this must split the work across multiple wallet signatures.
 */
export const MAX_GRANT_BATCH_SIZE = 32

/**
 * Defensive ceiling for `grant::set_grant_capacity`. Mirrors
 * `MAX_GRANT_CAPACITY` in `move/soulidity/sources/grant.move::set_grant_capacity`
 * — the chain itself rejects values above this with `EGrantCapacityExceeded`, so
 * callers should fail fast off-chain to surface a clear error before signing.
 */
export const MAX_GRANT_CAPACITY = 10_000

export interface BatchIssueGrantItem {
  stateObjectId: string
  granteeAddress: string
  scopeMask: number
  expiresAtMs?: AccessU64 | null
  /**
   * When provided, splice `grant::set_grant_capacity(state, setCapacityTo)`
   * into the PTB immediately before this item's `issue_to_grantee` call.
   * Used to honor `/api/souls/grant-merge-masks`'s `requiredCapacity`
   * contract: any item where `requiredCapacity > currentCapacity` must
   * carry the bump in the same PTB, otherwise `grant::issue` aborts with
   * `EGrantCapacityExceeded` when the grantee is new.
   *
   * Validation: must be a canonical u64 in 0..`MAX_GRANT_CAPACITY`.
   * Pass `null`/`undefined` to skip the bump.
   */
  setCapacityTo?: AccessU64 | null
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
  accessId(value, 'granteeAddress')
}

function assertScopeMask(value: number) {
  accessScope(value)
}

function assertExpiry(value: AccessU64 | null | undefined) {
  if (value != null) accessU64(value, 'expiresAtMs')
}

function assertCapacityBump(value: AccessU64 | null | undefined) {
  if (value == null) return
  accessCapacity(value, 'setCapacityTo')
}

export interface AddIssueGrantParams {
  stateObjectId: string
  granteeAddress: string
  scopeMask: number
  expiresAtMs?: AccessU64 | null
}

/**
 * Splice `grant::issue_to_grantee` into an existing PTB. Used by the
 * auto-grant-on-append flow so a single owner upload signature also
 * issues N agent grants in the same transaction. Per-grantee idempotent
 * on-chain (existing slot is superseded). Callers must still check live grant
 * state before writing; an explicit deployment also supports exact read-only
 * reconstruction of an already executed transaction.
 */
export function addIssueGrantCalls(tx: Transaction, params: AddIssueGrantParams, deployment?: { packageId: string }): void {
  assertGranteeAddress(params.granteeAddress)
  assertScopeMask(params.scopeMask)
  assertExpiry(params.expiresAtMs)
  accessId(params.stateObjectId)

  const packageId = accessId(deployment?.packageId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID'))
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
}

export function buildIssueGrantTx(params: AddIssueGrantParams, deployment?: { packageId: string }, tx = new Transaction()) {
  addIssueGrantCalls(tx, params, deployment)
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
    assertExpiry(item.expiresAtMs)
    accessId(item.stateObjectId)
    assertCapacityBump(item.setCapacityTo)
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const tx = new Transaction()
  for (const item of params.items) {
    // Splice the capacity bump in the same PTB BEFORE the issue. The chain
    // executes commands in order, so `grant::issue_to_grantee` sees the
    // raised capacity from the prior `set_grant_capacity` and a new
    // grantee fits without `EGrantCapacityExceeded`.
    if (item.setCapacityTo != null) {
      tx.moveCall({
        target: `${packageId}::grant::set_grant_capacity`,
        arguments: [
          tx.object(item.stateObjectId),
          tx.pure.u64(item.setCapacityTo),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      })
    }
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
}, deployment?: { packageId: string }, tx = new Transaction()) {
  assertGranteeAddress(params.granteeAddress)
  accessId(params.stateObjectId)
  const packageId = accessId(deployment?.packageId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID'))
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

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
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
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
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

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
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

export interface AddSetGrantCapacityParams {
  stateObjectId: string
  capacity: AccessU64
}

/**
 * Splice `grant::set_grant_capacity` into an existing PTB. Used by the
 * auto-grant-on-append flow to bump capacity from the default of 1
 * before issuing N agent grants in the same transaction.
 */
export function addSetGrantCapacityCalls(
  tx: Transaction,
  params: AddSetGrantCapacityParams,
  deployment?: { packageId: string },
): void {
  const capacity = accessCapacity(params.capacity)
  accessId(params.stateObjectId)
  const packageId = accessId(deployment?.packageId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID'))
  tx.moveCall({
    target: `${packageId}::grant::set_grant_capacity`,
    arguments: [
      tx.object(params.stateObjectId),
      tx.pure.u64(capacity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
}

export function buildSetGrantCapacityTx(params: AddSetGrantCapacityParams, deployment?: { packageId: string }, tx = new Transaction()) {
  addSetGrantCapacityCalls(tx, params, deployment)
  return tx
}

export function buildRevokeGrantScopeTx(params: {
  stateObjectId: string
  granteeAddress: string
  revokedScopeMask: number
}, deployment?: { packageId: string }, tx = new Transaction()) {
  assertGranteeAddress(params.granteeAddress)
  accessId(params.stateObjectId)
  accessScope(params.revokedScopeMask, 'revokedScopeMask')
  const packageId = accessId(deployment?.packageId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID'))
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
