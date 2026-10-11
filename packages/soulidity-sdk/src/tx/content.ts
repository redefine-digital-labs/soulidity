/**
 * Phase 2 unified content tx builders. Wraps the entry functions in
 * `move/soulidity/sources/content.move` and the active-binding /
 * state-config wrappers in `market.move`.
 *
 * `seal_approve_content_*` is intentionally NOT built here — Seal session
 * keys construct their own dry-run PTBs via `@mysten/seal`. See
 * `web/lib/soulidity/browser-content-access.ts` for the raw access resolver.
 */
import { Transaction, type TransactionArgument } from '@mysten/sui/transactions'
import { normalizeSuiObjectId } from '@mysten/sui/utils'
import { getRequiredSoulidityEnv } from '../env'
import { downloadPolicyToU8 } from '../kinds'
import type { SoulDownloadPolicy } from '../types'
import { validateInitialStateConfigEntries } from './shared'

const SUI_CLOCK_OBJECT_ID = '0x6'

/** Version indices are Move u64 values, not JavaScript floating-point IDs. */
function contentVersionIndex(value: number | bigint | string): bigint {
  if ((typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'string')
    || (typeof value === 'string' && !/^(0|[1-9][0-9]{0,19})$/.test(value))
    || (typeof value === 'number' && !Number.isSafeInteger(value))) {
    throw new Error('Content versionIndex must be a safe integer number, bigint or canonical decimal u64 string')
  }
  const index = BigInt(value)
  if (index < 0n || index > 18446744073709551615n) {
    throw new Error('Content versionIndex is outside the u64 range')
  }
  return index
}

interface ContentRoots {
  contentObjectId: string
  stateObjectId: string
  kindRegistryObjectId: string
}

type ContentU64 = number | bigint | string
export type ContentExpectedActive = { name: string; versionIndex: ContentU64 } | null
export interface ContentMutationSnapshot {
  expectedOwnershipEpoch: ContentU64
  expectedActive: ContentExpectedActive
}
export interface ContentMutationDeployment { packageId: string; marketConfigId: string }

function contentObjectId(value: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error('Content object ID is invalid')
  return normalizeSuiObjectId(value)
}
function contentKind(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('Content kind must be a u32')
  return value
}
function contentName(value: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(value)) throw new Error('Content name is invalid')
  return value
}
function ownershipEpoch(value: ContentU64): bigint {
  try { return contentVersionIndex(value) } catch { throw new Error('Content expectedOwnershipEpoch must be a canonical u64') }
}
function expectedActive(value: ContentExpectedActive): { name: string; versionIndex: bigint } | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'name') || !Object.hasOwn(value, 'versionIndex')) {
    throw new Error('Content expectedActive must be null or an exact name/versionIndex binding')
  }
  return { name: contentName(value.name), versionIndex: contentVersionIndex(value.versionIndex) }
}
function mutationDeployment(deployment?: ContentMutationDeployment): ContentMutationDeployment {
  const value = deployment ?? loadContentEnv()
  return { packageId: contentObjectId(value.packageId), marketConfigId: contentObjectId(value.marketConfigId) }
}
function mutationSnapshot<T extends ContentRoots & ContentMutationSnapshot & { kind: number }>(params: T) {
  return { ...params, contentObjectId: contentObjectId(params.contentObjectId), stateObjectId: contentObjectId(params.stateObjectId),
    kindRegistryObjectId: contentObjectId(params.kindRegistryObjectId), kind: contentKind(params.kind),
    expectedOwnershipEpoch: ownershipEpoch(params.expectedOwnershipEpoch), expectedActive: expectedActive(params.expectedActive) }
}

/** Non-authorizing precondition for a signed mutation, including atomic append. */
export function addAssertContentMutationScopeCalls(tx: Transaction,
  params: Pick<ContentRoots, 'contentObjectId' | 'stateObjectId'> & Pick<ContentMutationSnapshot, 'expectedOwnershipEpoch'>,
  deployment?: { packageId: string },
): void {
  // Resolve and validate all inputs before adding even a pure input to the PTB.
  const content = contentObjectId(params.contentObjectId), state = contentObjectId(params.stateObjectId)
  const epoch = ownershipEpoch(params.expectedOwnershipEpoch)
  const packageId = contentObjectId(deployment?.packageId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID'))
  tx.moveCall({ target: `${packageId}::content::assert_mutation_scope`,
    arguments: [tx.object(content), tx.object(state), tx.pure.u64(epoch)] })
}

export function addAssertContentActiveBindingCalls(tx: Transaction,
  params: Pick<ContentRoots, 'contentObjectId'> & Pick<ContentMutationSnapshot, 'expectedActive'> & { kind: number },
  deployment?: { packageId: string },
): void {
  const content = contentObjectId(params.contentObjectId), kind = contentKind(params.kind), active = expectedActive(params.expectedActive)
  const packageId = contentObjectId(deployment?.packageId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID'))
  tx.moveCall({ target: `${packageId}::content::assert_active_binding`, arguments: [tx.object(content), tx.pure.u32(kind),
    tx.pure.option('string', active?.name ?? null), tx.pure.option('u64', active?.versionIndex ?? null)] })
}

function addMutationPreconditions(tx: Transaction, params: ContentRoots & ContentMutationSnapshot & { kind: number }, deployment: ContentMutationDeployment) {
  addAssertContentMutationScopeCalls(tx, params, deployment)
  addAssertContentActiveBindingCalls(tx, params, deployment)
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
  expectedVersionIndex: number | bigint | string
  /** Exact public encrypted envelope, never plaintext or a raw encryption key. */
  encryptedEnvelope: Uint8Array
  contentBlobObjectId: string
}

function appendEnvelope(params: AppendContentVersionAsOwnerParams) {
  const expectedVersionIndex = contentVersionIndex(params.expectedVersionIndex)
  if (!(params.encryptedEnvelope instanceof Uint8Array) || params.encryptedEnvelope.byteLength === 0
    || params.encryptedEnvelope.byteLength > 65_536) {
    throw new Error('Content encryptedEnvelope must contain 1 to 65536 bytes')
  }
  return { expectedVersionIndex, encryptedEnvelope: new Uint8Array(params.encryptedEnvelope) }
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
  deployment?: { packageId: string },
): TransactionArgument {
  const envelope = appendEnvelope(params)
  const { packageId } = deployment ?? loadContentEnv()
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
      tx.pure.u64(envelope.expectedVersionIndex),
      tx.pure.vector('u8', envelope.encryptedEnvelope),
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
  deployment?: { packageId: string },
): TransactionArgument {
  const envelope = appendEnvelope(params)
  const { packageId } = deployment ?? loadContentEnv()
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
      tx.pure.u64(envelope.expectedVersionIndex),
      tx.pure.vector('u8', envelope.encryptedEnvelope),
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

export interface DeleteContentVersionAsOwnerParams extends ContentRoots, ContentMutationSnapshot {
  kind: number
  name: string
  versionIndex: number | bigint | string
}

export function buildDeleteContentVersionAsOwnerTx(
  params: DeleteContentVersionAsOwnerParams,
  deployment?: ContentMutationDeployment,
): Transaction {
  params = { ...mutationSnapshot(params), name: contentName(params.name), versionIndex: contentVersionIndex(params.versionIndex) }
  const resolved = mutationDeployment(deployment), { packageId } = resolved
  const tx = new Transaction()
  addMutationPreconditions(tx, params, resolved)
  tx.moveCall({
    target: `${packageId}::content::delete_version_as_owner`,
    arguments: [
      tx.object(params.contentObjectId),
      tx.object(params.stateObjectId),
      tx.object(params.kindRegistryObjectId),
      tx.pure.u32(params.kind),
      tx.pure.string(params.name),
      tx.pure.u64(contentVersionIndex(params.versionIndex)),
    ],
  })
  return tx
}

export interface DeleteContentVersionAsGrantedAgentParams extends DeleteContentVersionAsOwnerParams {
  soulGrantObjectId: string
}

export function buildDeleteContentVersionAsGrantedAgentTx(
  params: DeleteContentVersionAsGrantedAgentParams,
  deployment?: ContentMutationDeployment,
): Transaction {
  params = { ...mutationSnapshot(params), name: contentName(params.name), versionIndex: contentVersionIndex(params.versionIndex),
    soulGrantObjectId: contentObjectId(params.soulGrantObjectId) }
  const resolved = mutationDeployment(deployment), { packageId } = resolved
  const tx = new Transaction()
  addMutationPreconditions(tx, params, resolved)
  tx.moveCall({
    target: `${packageId}::content::delete_version_as_granted_agent`,
    arguments: [
      tx.object(params.contentObjectId),
      tx.object(params.stateObjectId),
      tx.object(params.kindRegistryObjectId),
      tx.object(params.soulGrantObjectId),
      tx.pure.u32(params.kind),
      tx.pure.string(params.name),
      tx.pure.u64(contentVersionIndex(params.versionIndex)),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
}

// ── Purge (owner only) ───────────────────────────────────────────────────

export interface PurgeContentVersionParams extends ContentRoots, ContentMutationSnapshot {
  kind: number
  name: string
  versionIndex: number | bigint | string
}

export function buildPurgeContentVersionAsOwnerTx(
  params: PurgeContentVersionParams,
  deployment?: ContentMutationDeployment,
): Transaction {
  params = { ...mutationSnapshot(params), name: contentName(params.name), versionIndex: contentVersionIndex(params.versionIndex) }
  const resolved = mutationDeployment(deployment), { packageId } = resolved
  const tx = new Transaction()
  addMutationPreconditions(tx, params, resolved)
  tx.moveCall({
    target: `${packageId}::content::purge_deleted_version_as_owner`,
    arguments: [
      tx.object(params.contentObjectId),
      tx.object(params.stateObjectId),
      tx.object(params.kindRegistryObjectId),
      tx.pure.u32(params.kind),
      tx.pure.string(params.name),
      tx.pure.u64(contentVersionIndex(params.versionIndex)),
    ],
  })
  return tx
}

// ── Active binding (via market wrapper) ──────────────────────────────────

export interface SetActiveContentParams extends ContentRoots, ContentMutationSnapshot {
  kind: number
  name: string
  versionIndex: number | bigint | string
}

/**
 * `versionIndex` accepts a literal value or an in-PTB `TransactionArgument` so the upload flow
 * can chain the index returned by `append_version_as_owner` straight into
 * `set_active_content` within the same wallet signature.
 */
export interface AddSetActiveContentParams extends Omit<SetActiveContentParams, 'versionIndex' | keyof ContentMutationSnapshot> {
  versionIndex: number | bigint | string | TransactionArgument
}

export function addSetActiveContentCalls(
  tx: Transaction,
  params: AddSetActiveContentParams,
  deployment?: { packageId: string; marketConfigId: string },
): void {
  const { packageId, marketConfigId } = deployment ?? loadContentEnv()
  const versionArg = typeof params.versionIndex === 'number' || typeof params.versionIndex === 'bigint' || typeof params.versionIndex === 'string'
    ? tx.pure.u64(contentVersionIndex(params.versionIndex))
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

export function buildSetActiveContentTx(params: SetActiveContentParams, deployment?: ContentMutationDeployment): Transaction {
  params = { ...mutationSnapshot(params), name: contentName(params.name), versionIndex: contentVersionIndex(params.versionIndex) }
  const resolved = mutationDeployment(deployment)
  const tx = new Transaction()
  addMutationPreconditions(tx, params, resolved)
  addSetActiveContentCalls(tx, params, resolved)
  return tx
}

export interface ClearActiveContentParams extends ContentRoots, ContentMutationSnapshot {
  kind: number
}

export function addClearActiveContentCalls(
  tx: Transaction,
  params: Omit<ClearActiveContentParams, keyof ContentMutationSnapshot>,
  deployment?: ContentMutationDeployment,
): void {
  const { packageId, marketConfigId } = deployment ?? loadContentEnv()
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

export function buildClearActiveContentTx(params: ClearActiveContentParams, deployment?: ContentMutationDeployment): Transaction {
  params = mutationSnapshot(params)
  const resolved = mutationDeployment(deployment)
  const tx = new Transaction()
  addMutationPreconditions(tx, params, resolved)
  addClearActiveContentCalls(tx, params, resolved)
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
  deployment?: { packageId: string; marketConfigId: string },
): void {
  validateInitialStateConfigEntries([{ key: params.key, valueUtf8: params.valueUtf8 }])
  const { packageId, marketConfigId } = deployment ?? loadContentEnv()
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
