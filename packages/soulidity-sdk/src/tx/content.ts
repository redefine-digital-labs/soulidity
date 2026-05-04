/**
 * Phase 2 unified content tx builders. Wraps the entry functions in
 * `move/soulidity/sources/content.move` and the active-binding /
 * state-config wrappers in `market.move`.
 *
 * `seal_approve_content_*` is intentionally NOT built here — Seal session
 * keys construct their own dry-run PTBs via `@mysten/seal`. See
 * `web/lib/soulidity/access.ts` for the access resolver entry point.
 */
import { Transaction } from '@mysten/sui/transactions'
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
    packageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'),
    marketConfigId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID'),
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

export function buildAppendContentVersionAsOwnerTx(
  params: AppendContentVersionAsOwnerParams,
): Transaction {
  const { packageId } = loadContentEnv()
  const tx = new Transaction()
  tx.moveCall({
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
  return tx
}

export interface AppendContentVersionAsGrantedAgentParams extends AppendContentVersionAsOwnerParams {
  soulGrantObjectId: string
}

export function buildAppendContentVersionAsGrantedAgentTx(
  params: AppendContentVersionAsGrantedAgentParams,
): Transaction {
  const { packageId } = loadContentEnv()
  const tx = new Transaction()
  tx.moveCall({
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

export function buildSetActiveContentTx(params: SetActiveContentParams): Transaction {
  const { packageId, marketConfigId } = loadContentEnv()
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::set_active_content`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(params.kindRegistryObjectId),
      tx.object(params.contentObjectId),
      tx.object(params.stateObjectId),
      tx.pure.u32(params.kind),
      tx.pure.string(params.name),
      tx.pure.u64(BigInt(params.versionIndex)),
    ],
  })
  return tx
}

export interface ClearActiveContentParams extends ContentRoots {
  kind: number
}

export function buildClearActiveContentTx(params: ClearActiveContentParams): Transaction {
  const { packageId, marketConfigId } = loadContentEnv()
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::clear_active_content`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(params.kindRegistryObjectId),
      tx.object(params.contentObjectId),
      tx.object(params.stateObjectId),
      tx.pure.u32(params.kind),
    ],
  })
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

export function buildSetStateConfigTx(params: SetStateConfigParams): Transaction {
  const { packageId, marketConfigId } = loadContentEnv()
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::set_state_config`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(params.stateObjectId),
      tx.pure.string(params.key),
      tx.pure.vector('u8', utf8Bytes(params.valueUtf8)),
    ],
  })
  return tx
}

export interface DeleteStateConfigParams {
  stateObjectId: string
  key: string
}

export function buildDeleteStateConfigTx(params: DeleteStateConfigParams): Transaction {
  const { packageId, marketConfigId } = loadContentEnv()
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::delete_state_config`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(params.stateObjectId),
      tx.pure.string(params.key),
    ],
  })
  return tx
}
