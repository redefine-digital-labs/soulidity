/**
 * Phase 2 unified content tx builders. Wraps the entry functions in
 * `move/soulidity/sources/content.move` and the active-binding /
 * state-config wrappers in `market.move`.
 *
 * `seal_approve_content_*` is intentionally NOT built here — Seal session
 * keys construct their own dry-run PTBs via `@mysten/seal`. See
 * `web/lib/soulidity/access.ts` for the access resolver entry point.
 */
import { Transaction, type TransactionArgument } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'
import { downloadPolicyToU8 } from '../kinds'
import type { SoulDownloadPolicy } from '../types'

const SUI_CLOCK_OBJECT_ID = '0x6'

interface ContentRoots {
  contentObjectId: string
  stateObjectId: string
  kindRegistryObjectId: string
}

function loadContentEnv(): ContentRoots & { packageId: string; marketConfigId: string } {
  return {
    packageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID'),
    marketConfigId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'),
    contentObjectId: '', // overridden by callers per-tx
    stateObjectId: '',
    kindRegistryObjectId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID'),
  }
}

// ── Append ───────────────────────────────────────────────────────────────

export interface AppendContentVersionAsOwnerParams extends ContentRoots {
  kind: number
  name: string
  slotReadModeMask: number
  downloadPolicy: SoulDownloadPolicy
  contentBlobObjectId: string
}

/**
 * Splice the `content::append_version_as_owner` moveCall into an existing
 * transaction. Used by the upload flow so a single PTB can run Walrus
 * `certify_blob` + Soulidity append in one wallet signature, dropping the
 * skill-upload prompt count from 3 → 2. Returns the appended version
 * index as a `TransactionArgument` so callers can chain it into a
 * `set_active_content` moveCall in the same PTB (sprite uploads with
 * `setActive: true` rely on this).
 */
export function addAppendContentVersionAsOwnerCalls(
  tx: Transaction,
  params: AppendContentVersionAsOwnerParams,
): TransactionArgument {
  const { packageId } = loadContentEnv()
  const result = tx.moveCall({
    target: `${packageId}::content::append_version_as_owner`,
    arguments: [
      tx.object(params.contentObjectId),
      tx.object(params.stateObjectId),
      tx.object(params.kindRegistryObjectId),
      tx.pure.u32(params.kind),
      tx.pure.string(params.name),
      tx.pure.u64(BigInt(params.slotReadModeMask)),
      tx.pure.u8(downloadPolicyToU8(params.downloadPolicy)),
      tx.object(params.contentBlobObjectId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  // `append_version_as_owner` returns `u64` (the new version index). The
  // moveCall proxy is itself the single-return argument. Cast pins it.
  return result as unknown as TransactionArgument
}

export function buildAppendContentVersionAsOwnerTx(
  params: AppendContentVersionAsOwnerParams,
): Transaction {
  const tx = new Transaction()
  addAppendContentVersionAsOwnerCalls(tx, params)
  return tx
}

export interface AppendContentVersionAsGrantedAgentParams extends AppendContentVersionAsOwnerParams {
  soulGrantObjectId: string
}

/**
 * Granted-agent variant of `addAppendContentVersionAsOwnerCalls`. Same
 * justification: lets the upload flow combine certify+append into one
 * signature when the appender is a scoped grantee instead of the owner.
 */
export function addAppendContentVersionAsGrantedAgentCalls(
  tx: Transaction,
  params: AppendContentVersionAsGrantedAgentParams,
): TransactionArgument {
  const { packageId } = loadContentEnv()
  const result = tx.moveCall({
    target: `${packageId}::content::append_version_as_granted_agent`,
    arguments: [
      tx.object(params.contentObjectId),
      tx.object(params.stateObjectId),
      tx.object(params.kindRegistryObjectId),
      tx.object(params.soulGrantObjectId),
      tx.pure.u32(params.kind),
      tx.pure.string(params.name),
      tx.pure.u64(BigInt(params.slotReadModeMask)),
      tx.pure.u8(downloadPolicyToU8(params.downloadPolicy)),
      tx.object(params.contentBlobObjectId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return result as unknown as TransactionArgument
}

export function buildAppendContentVersionAsGrantedAgentTx(
  params: AppendContentVersionAsGrantedAgentParams,
): Transaction {
  const tx = new Transaction()
  addAppendContentVersionAsGrantedAgentCalls(tx, params)
  return tx
}

// ── Delete ───────────────────────────────────────────────────────────────

export interface DeleteContentVersionAsOwnerParams extends ContentRoots {
  kind: number
  name: string
  versionIndex: number
}

export function buildDeleteContentVersionAsOwnerTx(
  params: DeleteContentVersionAsOwnerParams,
): Transaction {
  const { packageId } = loadContentEnv()
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::content::delete_version_as_owner`,
    arguments: [
      tx.object(params.contentObjectId),
      tx.object(params.stateObjectId),
      tx.object(params.kindRegistryObjectId),
      tx.pure.u32(params.kind),
      tx.pure.string(params.name),
      tx.pure.u64(BigInt(params.versionIndex)),
    ],
  })
  return tx
}

export interface DeleteContentVersionAsGrantedAgentParams extends DeleteContentVersionAsOwnerParams {
  soulGrantObjectId: string
}

export function buildDeleteContentVersionAsGrantedAgentTx(
  params: DeleteContentVersionAsGrantedAgentParams,
): Transaction {
  const { packageId } = loadContentEnv()
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::content::delete_version_as_granted_agent`,
    arguments: [
      tx.object(params.contentObjectId),
      tx.object(params.stateObjectId),
      tx.object(params.kindRegistryObjectId),
      tx.object(params.soulGrantObjectId),
      tx.pure.u32(params.kind),
      tx.pure.string(params.name),
      tx.pure.u64(BigInt(params.versionIndex)),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
}

// ── Purge (owner only) ───────────────────────────────────────────────────

export interface PurgeContentVersionParams extends ContentRoots {
  kind: number
  name: string
  versionIndex: number
}

export function buildPurgeContentVersionAsOwnerTx(
  params: PurgeContentVersionParams,
): Transaction {
  const { packageId } = loadContentEnv()
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::content::purge_deleted_version_as_owner`,
    arguments: [
      tx.object(params.contentObjectId),
      tx.object(params.stateObjectId),
      tx.object(params.kindRegistryObjectId),
      tx.pure.u32(params.kind),
      tx.pure.string(params.name),
      tx.pure.u64(BigInt(params.versionIndex)),
    ],
  })
  return tx
}

// ── Active binding (via market wrapper) ──────────────────────────────────

export interface SetActiveContentParams extends ContentRoots {
  kind: number
  name: string
  versionIndex: number
}

/**
 * `versionIndex` accepts either a literal value (legacy single-tx
 * standalone use) or an in-PTB `TransactionArgument` so the upload flow
 * can chain the index returned by `append_version_as_owner` straight into
 * `set_active_content` within the same wallet signature.
 */
export interface AddSetActiveContentParams extends Omit<SetActiveContentParams, 'versionIndex'> {
  versionIndex: number | bigint | TransactionArgument
}

export function addSetActiveContentCalls(
  tx: Transaction,
  params: AddSetActiveContentParams,
): void {
  const { packageId, marketConfigId } = loadContentEnv()
  const versionArg = typeof params.versionIndex === 'number' || typeof params.versionIndex === 'bigint'
    ? tx.pure.u64(BigInt(params.versionIndex))
    : params.versionIndex
  tx.moveCall({
    target: `${packageId}::market::set_active_content_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(params.kindRegistryObjectId),
      tx.object(params.contentObjectId),
      tx.object(params.stateObjectId),
      tx.pure.u32(params.kind),
      tx.pure.string(params.name),
      versionArg,
    ],
  })
}

export function buildSetActiveContentTx(params: SetActiveContentParams): Transaction {
  const tx = new Transaction()
  addSetActiveContentCalls(tx, params)
  return tx
}

export interface ClearActiveContentParams extends ContentRoots {
  kind: number
}

export function addClearActiveContentCalls(
  tx: Transaction,
  params: ClearActiveContentParams,
): void {
  const { packageId, marketConfigId } = loadContentEnv()
  tx.moveCall({
    target: `${packageId}::market::clear_active_content_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(params.kindRegistryObjectId),
      tx.object(params.contentObjectId),
      tx.object(params.stateObjectId),
      tx.pure.u32(params.kind),
    ],
  })
}

export function buildClearActiveContentTx(params: ClearActiveContentParams): Transaction {
  const tx = new Transaction()
  addClearActiveContentCalls(tx, params)
  return tx
}

// ── State config (free-form key/value blob map) ──────────────────────────

export interface SetStateConfigParams {
  stateObjectId: string
  key: string
  /** UTF-8 string body; will be encoded to vector<u8>. */
  valueUtf8: string
}

function utf8Bytes(value: string): number[] {
  return Array.from(new TextEncoder().encode(value))
}

export function addSetStateConfigCalls(
  tx: Transaction,
  params: SetStateConfigParams,
): void {
  const { packageId, marketConfigId } = loadContentEnv()
  tx.moveCall({
    target: `${packageId}::market::set_state_config_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(params.stateObjectId),
      tx.pure.string(params.key),
      tx.pure.vector('u8', utf8Bytes(params.valueUtf8)),
    ],
  })
}

export function buildSetStateConfigTx(params: SetStateConfigParams): Transaction {
  const tx = new Transaction()
  addSetStateConfigCalls(tx, params)
  return tx
}

export interface DeleteStateConfigParams {
  stateObjectId: string
  key: string
}

export function addDeleteStateConfigCalls(
  tx: Transaction,
  params: DeleteStateConfigParams,
): void {
  const { packageId, marketConfigId } = loadContentEnv()
  tx.moveCall({
    target: `${packageId}::market::delete_state_config_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(params.stateObjectId),
      tx.pure.string(params.key),
    ],
  })
}

export function buildDeleteStateConfigTx(params: DeleteStateConfigParams): Transaction {
  const tx = new Transaction()
  addDeleteStateConfigCalls(tx, params)
  return tx
}
