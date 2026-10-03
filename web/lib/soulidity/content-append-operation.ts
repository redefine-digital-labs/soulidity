import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { addAppendContentVersionAsOwnerCalls, addAppendContentVersionAsGrantedAgentCalls, addSetStateConfigCalls, addAssertContentMutationScopeCalls,
  addSetActiveContentCalls, addSetGrantCapacityCalls, addIssueGrantCalls, addAssertGrantCapacityCalls, addAssertPreservesGrantScopesCalls, getRequiredSoulidityEnv,
  downloadPolicyToU8, profileReadStep, MAX_GRANT_CAPACITY, type SoulDownloadPolicy, type WalrusUploadQuote } from '@soulidity/sdk'
import { uploadPreparedSoulPayload, queryHistoricalPreparedSoulPayload, observeHistoricalPreparedSoulPayload, continuePreparedSoulPayload, type SoulUploadResult } from '@/lib/upload/client-upload'
import { acknowledgeWalrusSingleBlobUpload } from '@/lib/upload/walrus-single-upload'
import { parseWalrusSingleRecord, readWalrusSingleRecord, walrusSingleKey,
  type WalrusSingleExecution, type WalrusSingleIntent, type WalrusSingleRecord } from '@/lib/upload/walrus-single-operation'
import { getBrowserPrivateLoadoutUploadConfig, validatePrivateLoadoutUploadConfig } from '@/lib/animacraft/private-loadout-storage'
import { contentAppendPreparationOperationHash, contentAppendPreparedEnvelope, verifyContentAppendPreparation,
  type ContentAppendPreparation } from './content-append-preparation'
import { contentEnvelopeKey } from './content-envelope'
import { getBrowserContentWriteConfig, readBrowserContentWriteState, type BrowserContentWriteConfig } from './browser-content-write-state'
import { getBrowserContentSealConfig } from './browser-content-open'
import { readContentAppendHistoricalOutputs } from './content-append-history'

export interface ContentAppendIntent {
  schema: 'soulidity.content-append-intent.v1'
  soulId: string; stateId: string; kindRegistryId: string; marketConfigId: string
  ownershipEpoch: string; grantId: string | null
  readModeMask: number; downloadPolicy: SoulDownloadPolicy
  spriteConfigJson: string | null; setActive: boolean
  autoGrantPlan: null | { capacityBefore: string; capacityAfter: string; targets: { address: string; scopeMask: number }[] }
  contentHash: string; plaintextByteLength: number; fileName: string; mimeType: string
  uploadConfig: ReturnType<typeof getBrowserPrivateLoadoutUploadConfig>
  rebase: null | { nonce: string; predecessor: string; storageRootHash: string; certifyGasBudgetMist: string
    autoGrantTargets: { address: string; scopeMask: number }[] }
}
const json = (v: unknown) => JSON.stringify(v)
const id = (v: unknown) => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v)
const u64 = (v: unknown) => typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n
function check(v: unknown, code: string): asserts v { if (!v) throw new Error(`CONTENT_APPEND_${code}`) }
function keys(v: unknown, names: string[]) { check(v && typeof v === 'object' && Object.keys(v).length === names.length
  && names.every(k => Object.hasOwn(v, k)), 'INTENT_SHAPE_INVALID') }
export function parseContentAppendIntent(record: ContentAppendPreparation): ContentAppendIntent {
  const i = JSON.parse(record.scope.intentJson) as ContentAppendIntent
  keys(i, ['schema', 'soulId', 'stateId', 'kindRegistryId', 'marketConfigId', 'ownershipEpoch', 'grantId', 'readModeMask',
    'downloadPolicy', 'spriteConfigJson', 'setActive', 'autoGrantPlan', 'contentHash', 'plaintextByteLength', 'fileName', 'mimeType', 'uploadConfig', 'rebase'])
  check(json(i) === record.scope.intentJson && i.schema === 'soulidity.content-append-intent.v1' && id(i.soulId) && id(i.stateId)
    && id(i.kindRegistryId) && id(i.marketConfigId) && u64(i.ownershipEpoch) && (i.grantId === null || id(i.grantId)), 'INTENT_ID_INVALID')
  check(Number.isInteger(i.readModeMask) && i.readModeMask > 0 && i.readModeMask <= 15 && (i.readModeMask & 1) !== 0
    && ['public', 'owner_only', 'allowlist'].includes(i.downloadPolicy) && typeof i.setActive === 'boolean'
    && (i.spriteConfigJson === null || (typeof i.spriteConfigJson === 'string' && new TextEncoder().encode(i.spriteConfigJson).length <= 64 * 1024)), 'INTENT_ACTION_INVALID')
  check((record.scope.kind === 3 && i.grantId === null) || (i.spriteConfigJson === null && !i.setActive), 'OWNER_SPRITE_ACTION_REQUIRED')
  check(i.contentHash === record.contentHash && i.plaintextByteLength === record.plaintextByteLength
    && i.fileName === record.sidecar.fileName && i.mimeType === record.sidecar.mimeType, 'INTENT_SOURCE_MISMATCH')
  check(json(validatePrivateLoadoutUploadConfig(i.uploadConfig)) === json(i.uploadConfig), 'UPLOAD_CONFIG_INVALID')
  if (i.rebase !== null) {
    keys(i.rebase, ['nonce', 'predecessor', 'storageRootHash', 'certifyGasBudgetMist', 'autoGrantTargets'])
    check(/^[0-9a-f]{32}$/.test(i.rebase.nonce) && /^[0-9a-f]{64}$/.test(i.rebase.predecessor)
      && /^[0-9a-f]{64}$/.test(i.rebase.storageRootHash) && u64(i.rebase.certifyGasBudgetMist)
      && BigInt(i.rebase.certifyGasBudgetMist) > 0n && BigInt(i.rebase.certifyGasBudgetMist) <= 9223372036854775807n,
    'REBASE_INTENT_INVALID')
    check(Array.isArray(i.rebase.autoGrantTargets) && i.rebase.autoGrantTargets.length <= MAX_GRANT_CAPACITY
      && (i.rebase.autoGrantTargets.length === 0 || i.grantId === null && (i.readModeMask & 8) === 0), 'REBASE_GRANT_TARGETS_INVALID')
    const seen = new Set<string>()
    for (const target of i.rebase.autoGrantTargets) {
      keys(target, ['address', 'scopeMask'])
      check(id(target.address) && target.address !== record.scope.author && !seen.has(target.address)
        && Number.isInteger(target.scopeMask) && target.scopeMask > 0 && target.scopeMask <= 15, 'REBASE_GRANT_TARGETS_INVALID')
      seen.add(target.address)
    }
  }
  if (i.autoGrantPlan !== null) {
    const plan = i.autoGrantPlan
    keys(plan, ['capacityBefore', 'capacityAfter', 'targets'])
    check(i.grantId === null && (i.readModeMask & 8) === 0 && u64(plan.capacityBefore) && u64(plan.capacityAfter)
      && BigInt(plan.capacityAfter) >= BigInt(plan.capacityBefore) && BigInt(plan.capacityAfter) <= BigInt(MAX_GRANT_CAPACITY)
      && Array.isArray(plan.targets) && plan.targets.length <= MAX_GRANT_CAPACITY, 'AUTO_GRANT_PLAN_INVALID')
    const seen = new Set<string>()
    for (const target of plan.targets) {
      keys(target, ['address', 'scopeMask'])
      check(id(target.address) && target.address !== record.scope.author && !seen.has(target.address)
        && Number.isInteger(target.scopeMask) && target.scopeMask > 0 && target.scopeMask <= 15, 'AUTO_GRANT_TARGET_INVALID')
      seen.add(target.address)
    }
  }
  return i
}
function configured(record: ContentAppendPreparation, i: ContentAppendIntent, config: BrowserContentWriteConfig) {
  check(config.target.soulidityOriginalPackageId === record.scope.originalPackageId
    && config.target.soulidityCallablePackageId === record.scope.callablePackageId && config.kindRegistryId === i.kindRegistryId,
  'RELEASE_CHANGED')
  check(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID') === record.scope.originalPackageId
    && getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID') === record.scope.callablePackageId
    && getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID') === i.kindRegistryId
    && getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID') === i.marketConfigId
    && json(getBrowserPrivateLoadoutUploadConfig(i.uploadConfig.storageEpochs)) === json(i.uploadConfig), 'CONFIGURATION_CHANGED')
}
export function contentAppendAttachment(record: ContentAppendPreparation) {
  const i = parseContentAppendIntent(record), s = record.scope
  const sharedIds = [i.soulId, i.stateId, i.kindRegistryId, i.marketConfigId, s.contentObjectId, `0x${'0'.repeat(63)}6`]
  check(i.grantId === null || !sharedIds.includes(i.grantId), 'GRANT_OBJECT_ROLE_ALIAS')
  const operationScope = `content-append:${contentAppendPreparationOperationHash(s)}`
  return { scope: operationScope, historicalOwnedObjectIds: i.grantId ? [i.grantId] : [],
    historicalSharedObjects: [{ objectId: s.contentObjectId, mutable: true }, { objectId: i.stateId, mutable: true },
      { objectId: i.kindRegistryId, mutable: false }, { objectId: `0x${'0'.repeat(63)}6`, mutable: false },
      ...(i.spriteConfigJson !== null || i.setActive ? [{ objectId: i.marketConfigId, mutable: false }] : [])],
    append: (tx: Transaction, blobObjectId: string) => {
    // The protocol-size preview uses Content as a fixed-width placeholder;
    // real Blob identity is separately proved from registration before writing.
    check(blobObjectId !== i.grantId, 'GRANT_BLOB_ROLE_ALIAS')
    // Both write and historical templates bind the signed deployment explicitly.
    // Current write authority/configuration is checked separately before signing.
    const deployment = { packageId: s.callablePackageId, marketConfigId: i.marketConfigId }
    const common = { contentObjectId: s.contentObjectId, stateObjectId: i.stateId, kindRegistryObjectId: i.kindRegistryId,
      kind: s.kind, name: s.name, slotReadModeMask: i.readModeMask, downloadPolicy: i.downloadPolicy,
      expectedVersionIndex: s.versionIndex, encryptedEnvelope: contentAppendPreparedEnvelope(record, blobObjectId), contentBlobObjectId: blobObjectId }
    addAssertContentMutationScopeCalls(tx, { contentObjectId: s.contentObjectId, stateObjectId: i.stateId,
      expectedOwnershipEpoch: i.ownershipEpoch }, deployment)
    // The signed union must not narrow a scope added while awaiting signature,
    // nor lower a concurrently raised capacity. Check before any grant writes.
    if (i.autoGrantPlan) {
      addAssertGrantCapacityCalls(tx, { stateObjectId: i.stateId, capacity: i.autoGrantPlan.capacityBefore }, deployment)
      for (const target of i.autoGrantPlan.targets) addAssertPreservesGrantScopesCalls(tx, { stateObjectId: i.stateId,
        granteeAddress: target.address, scopeMask: target.scopeMask }, deployment)
    }
    const version = i.grantId ? addAppendContentVersionAsGrantedAgentCalls(tx, { ...common, soulGrantObjectId: i.grantId }, deployment)
      : addAppendContentVersionAsOwnerCalls(tx, common, deployment)
    if (i.spriteConfigJson !== null) addSetStateConfigCalls(tx, { stateObjectId: i.stateId, key: 'sprite_config_json', valueUtf8: i.spriteConfigJson }, deployment)
    if (i.setActive) addSetActiveContentCalls(tx, { contentObjectId: s.contentObjectId, stateObjectId: i.stateId,
      kindRegistryObjectId: i.kindRegistryId, kind: s.kind, name: s.name, versionIndex: version }, deployment)
    if (i.autoGrantPlan) {
      if (i.autoGrantPlan.capacityAfter !== i.autoGrantPlan.capacityBefore) addSetGrantCapacityCalls(tx, {
        stateObjectId: i.stateId, capacity: Number(i.autoGrantPlan.capacityAfter) }, deployment)
      for (const target of i.autoGrantPlan.targets) addIssueGrantCalls(tx, { stateObjectId: i.stateId,
        granteeAddress: target.address, scopeMask: target.scopeMask, expiresAtMs: null }, deployment)
    }
  } }
}
/** Scope hashes deliberately identify the user intent, not randomized Seal/AES
 * bytes. Bind every payment field to the verified author's exact preparation. */
export function contentAppendWalrusIntent(record: ContentAppendPreparation): WalrusSingleIntent {
  const i = parseContentAppendIntent(record), scope = contentAppendAttachment(record).scope
  return { network: i.uploadConfig.network, owner: record.scope.author, recipient: record.scope.author,
    operationScope: scope, attachmentScope: scope, contentHash: record.contentHash, payloadHash: record.payloadHash,
    payloadByteLength: record.ciphertext.length, storageEpochs: i.uploadConfig.storageEpochs, relayUrl: i.uploadConfig.relayUrl }
}
export function assertContentAppendWalrusRecord(record: ContentAppendPreparation, input: unknown): WalrusSingleRecord {
  const wal = parseWalrusSingleRecord(input), expected = contentAppendWalrusIntent(record)
  check(Object.keys(wal.intent).length === Object.keys(expected).length
    && (Object.keys(expected) as (keyof WalrusSingleIntent)[]).every(key => wal.intent[key] === expected[key]), 'WALRUS_PREPARATION_MISMATCH')
  return wal
}
type WriteState = Awaited<ReturnType<typeof readBrowserContentWriteState>>
export function assertContentAppendAuthority(record: ContentAppendPreparation, proof: WriteState) {
  const i = parseContentAppendIntent(record), s = record.scope, current = proof.snapshot
  check(proof.soulId === i.soulId && proof.stateId === i.stateId && proof.contentId === s.contentObjectId
    && proof.originalPackageId === s.originalPackageId && proof.callablePackageId === s.callablePackageId
    && proof.kindRegistryId === i.kindRegistryId && current.ownershipEpoch === i.ownershipEpoch, 'CURRENT_SCOPE_CHANGED')
  const descriptor = current.kindDescriptors.find(d => d.kind === s.kind)
  check(descriptor && !descriptor.deprecated && (BigInt(descriptor.op_mask) & 1n) !== 0n
    && (BigInt(descriptor.read_mode_mask) & BigInt(i.readModeMask)) === BigInt(i.readModeMask)
    && (descriptor.requires_download_policy || i.downloadPolicy === 'public')
    && ((i.readModeMask & 8) === 0 || i.downloadPolicy === 'public'), 'KIND_APPEND_NOT_ALLOWED')
  if (i.grantId === null) check(current.currentOwner === s.author, 'CURRENT_OWNER_CHANGED')
  else {
    const grant = current.grants.find(g => g.slot.grant_id === i.grantId && g.slot.grantee === s.author)
    const scopeMask = BigInt(descriptor.default_grant_scope_mask)
    check(grant?.currentEpoch && grant.unexpiredAtObservation && grant.grant && scopeMask > 0n
      && (BigInt(grant.slot.scope_mask) & scopeMask) === scopeMask, 'CURRENT_GRANT_INVALID')
  }
  const versions = current.contentVersions.filter(v => v.kind === s.kind && v.name === s.name)
  check(String(versions.length) === s.versionIndex && versions.every((v, n) => v.versionIndex === String(n)), 'VERSION_CHANGED_QUERY_OR_REBASE')
  if (i.autoGrantPlan) {
    check(current.grantCapacity === i.autoGrantPlan.capacityBefore, 'GRANT_CAPACITY_CHANGED')
    let newCount = 0
    for (const target of i.autoGrantPlan.targets) {
      const prior = current.grants.find(g => g.currentEpoch && g.slot.grantee === target.address)
      const existingMask = prior ? BigInt(prior.slot.scope_mask) : 0n
      check((BigInt(target.scopeMask) & BigInt(descriptor.default_grant_scope_mask)) === BigInt(descriptor.default_grant_scope_mask)
        && (BigInt(target.scopeMask) & existingMask) === existingMask, 'AUTO_GRANT_WOULD_NARROW')
      if (!prior) newCount++
    }
    check(BigInt(current.activeGrantCount) + BigInt(newCount) <= BigInt(i.autoGrantPlan.capacityAfter), 'AUTO_GRANT_CAPACITY_EXCEEDED')
  }
}
export function assertContentAppendFinal(record: ContentAppendPreparation, proof: WriteState, result: Pick<SoulUploadResult, 'blobObjectId'>) {
  const i = parseContentAppendIntent(record), s = record.scope, current = proof.snapshot
  check(proof.contentId === s.contentObjectId && proof.soulId === i.soulId && proof.stateId === i.stateId
    && proof.originalPackageId === s.originalPackageId && proof.callablePackageId === s.callablePackageId
    && proof.kindRegistryId === i.kindRegistryId, 'FINAL_ROOT_MISMATCH')
  check(current.ownershipEpoch === i.ownershipEpoch && (i.grantId !== null || current.currentOwner === s.author), 'FINAL_AUTHORITY_CHANGED')
  const v = current.contentVersions.find(v => v.kind === s.kind && v.name === s.name && v.versionIndex === s.versionIndex)
  check(v && v.slot.blob_object_id === result.blobObjectId && v.slot.seal_encrypted && !v.slot.deleted && !v.slot.purged
    && v.slot.read_mode_mask === String(i.readModeMask) && v.slot.download_policy === downloadPolicyToU8(i.downloadPolicy), 'FINAL_SLOT_UNAVAILABLE')
  const slot = { contentObjectId: s.contentObjectId, kind: s.kind, name: s.name, versionIndex: s.versionIndex, blobObjectId: result.blobObjectId }
  const envelope = current.config.find(row => row.key === contentEnvelopeKey(slot))
  check(envelope && json(envelope.valueBytes) === json([...contentAppendPreparedEnvelope(record, result.blobObjectId)]), 'FINAL_ENVELOPE_MISMATCH')
  if (i.spriteConfigJson !== null) check(current.config.some(c => c.key === 'sprite_config_json' && c.valueUtf8 === i.spriteConfigJson), 'FINAL_SPRITE_CONFIG_CHANGED')
  if (i.setActive) check(current.activeBindings.some(b => b.kind === s.kind && b.name === s.name && b.version_index === s.versionIndex), 'FINAL_ACTIVE_BINDING_CHANGED')
  if (i.autoGrantPlan) check(current.grantCapacity === i.autoGrantPlan.capacityAfter, 'FINAL_AUTO_GRANT_CAPACITY_CHANGED')
  for (const target of i.autoGrantPlan?.targets ?? []) check(current.grants.some(g => g.currentEpoch && g.unexpiredAtObservation
    && g.slot.grantee === target.address && (BigInt(g.slot.scope_mask) & BigInt(target.scopeMask)) === BigInt(target.scopeMask)), 'FINAL_AUTO_GRANT_CHANGED')
  return v
}

export async function runContentAppend(params: { record: ContentAppendPreparation; config: BrowserContentWriteConfig;
  execution: WalrusSingleExecution; signal: AbortSignal; confirmQuote: (quote: WalrusUploadQuote) => Promise<boolean>
  rebase?: { payment: WalrusSingleRecord; verify: () => Promise<void>; assertAuthority: (proof: WriteState) => void }
}, deps: { read?: typeof readBrowserContentWriteState; upload?: typeof uploadPreparedSoulPayload; acknowledge?: typeof acknowledgeWalrusSingleBlobUpload;
  continuePaid?: typeof continuePreparedSoulPayload } = {}) {
  const { signal } = params, execution = { ...params.execution }, config = structuredClone(params.config)
  const rebase = params.rebase ? { payment: structuredClone(params.rebase.payment), verify: params.rebase.verify, assertAuthority: params.rebase.assertAuthority } : null
  const record = await verifyContentAppendPreparation(params.record, execution.client), i = parseContentAppendIntent(record)
  check(Boolean(i.rebase) === Boolean(rebase), 'REBASE_HISTORY_REQUIRED')
  if (rebase) assertContentAppendWalrusRecord(record, rebase.payment)
  const guard = () => {
    signal.throwIfAborted(); check(execution.getAddress() === record.scope.author, 'WALLET_CHANGED'); configured(record, i, config)
    // A valid old stamp does not make a wrapper readable under a changed key
    // topology. Historical query remains available without this write gate.
    check(json(getBrowserContentSealConfig()) === json(record.sealConfig), 'SEAL_CONFIGURATION_CHANGED')
  }
  const step = async <T>(work: () => Promise<T>) => { guard(); const value = await profileReadStep(signal, work); guard(); return value }
  const read = () => step(() => (deps.read ?? readBrowserContentWriteState)({ config, soulId: i.soulId, stateId: i.stateId,
    contentId: record.scope.contentObjectId, kind: record.scope.kind, viewerAddress: record.scope.author, signal }, { client: () => execution.client }))
  const current = async () => {
    const proof = await read(); assertContentAppendAuthority(record, proof); rebase?.assertAuthority(proof)
    if (execution.beforeWrite) await step(execution.beforeWrite)
  }
  const attachment = contentAppendAttachment(record)
  // Placeholder Blob has the same fixed-width object ID and envelope length as
  // the eventual register result; check every attachment pure arg before paying.
  const limits = async (tx: Transaction, bytes?: Uint8Array) => {
    const { protocolConfig } = await step(() => execution.client.core.getProtocolConfig())
    const limit = (key: string) => { const v = protocolConfig.attributes[key]; check(typeof v === 'string' && /^[1-9][0-9]*$/.test(v), 'PROTOCOL_LIMIT_UNAVAILABLE'); return BigInt(v) }
    check(BigInt(tx.getData().commands.length) <= limit('max_programmable_tx_commands'), 'TOO_MANY_COMMANDS')
    for (const input of tx.getData().inputs) if (input.Pure) check(BigInt(fromBase64(input.Pure.bytes).length) <= limit('max_pure_argument_size'), 'PURE_ARGUMENT_TOO_LARGE')
    if (bytes) check(BigInt(bytes.length) <= limit('max_tx_size_bytes'), 'TRANSACTION_TOO_LARGE')
  }
  guard(); const preview = new Transaction(); attachment.append(preview, record.scope.contentObjectId); await limits(preview)
  const writeExecution = { ...execution, getAddress: () => { try { guard(); return record.scope.author } catch { return null } }, beforeWrite: current,
    // WAL supplies complete fixed bytes; serialization needs no re-resolution.
    sign: async (tx: Transaction) => { guard(); await limits(tx, await tx.build()); return execution.sign(tx) } }
  const result = rebase ? await (deps.continuePaid ?? continuePreparedSoulPayload)({ record: rebase.payment, payload: record.ciphertext,
    attachment, execution: writeExecution, certifyGasBudget: BigInt(i.rebase!.certifyGasBudgetMist),
    verify: async () => { guard(); await step(rebase.verify); guard() } })
    : await (deps.upload ?? uploadPreparedSoulPayload)({ payload: record.ciphertext, contentHash: record.contentHash,
    plaintextByteLength: record.plaintextByteLength, fileName: record.sidecar.fileName, walletAddress: record.scope.author,
    sendObjectTo: record.scope.author, operationScope: attachment.scope, attachment, storageEpochs: i.uploadConfig.storageEpochs,
    execution: writeExecution,
    confirmQuote: async quote => { await current(); await limits(preview); const yes = await step(() => params.confirmQuote(quote)); await current(); return yes } })
  guard(); const finalProof = await read(), version = assertContentAppendFinal(record, finalProof, result)
  rebase?.assertAuthority(finalProof)
  check(result.recoveryKey, 'WALRUS_RECEIPT_REQUIRED')
  await step(() => (deps.acknowledge ?? acknowledgeWalrusSingleBlobUpload)({ recoveryKey: result.recoveryKey!, certifyDigest: result.certifyTxDigest }))
  return { result, version }
}

/** No write preflight or wallet is needed to query the original paid packets.
 * A revoked grant/changed owner cannot cause a replacement register payment. */
export async function queryContentAppend(params: { record: ContentAppendPreparation; config?: BrowserContentWriteConfig;
  execution: WalrusSingleExecution; signal: AbortSignal; payment?: WalrusSingleRecord | null
}, deps: { recover?: (params: Parameters<typeof queryHistoricalPreparedSoulPayload>[0] & { operationScope: string }) => ReturnType<typeof queryHistoricalPreparedSoulPayload>;
  read?: typeof readBrowserContentWriteState; historical?: typeof readContentAppendHistoricalOutputs; observe?: typeof observeHistoricalPreparedSoulPayload;
  readPayment?: typeof readWalrusSingleRecord } = {}) {
  const execution = { ...params.execution }, config = structuredClone(params.config), signal = params.signal
  const importedPayment = params.payment === undefined ? undefined : structuredClone(params.payment)
  const record = await verifyContentAppendPreparation(params.record, execution.client), i = parseContentAppendIntent(record)
  signal.throwIfAborted()
  const attachment = contentAppendAttachment(record)
  const key = walrusSingleKey(contentAppendWalrusIntent(record))
  const stored = importedPayment === undefined ? (deps.readPayment ?? readWalrusSingleRecord)(key) : importedPayment
  if (stored === null) return { recovery: { status: 'NONE' as const, recoveryKey: key }, historical: null,
    current: null, currentStatus: 'NOT_CONFIRMED' as const, currentReason: null }
  const payment = assertContentAppendWalrusRecord(record, stored)
  const recovery = await profileReadStep(signal, () => (deps.recover ?? queryHistoricalPreparedSoulPayload)({ record: payment,
    payload: record.ciphertext, signal, operationScope: attachment.scope, attachment, execution: { ...execution, beforeWrite: undefined, getAddress: () => null,
      sign: async () => { throw new Error('CONTENT_APPEND_QUERY_CANNOT_SIGN') } } }))
  assertContentAppendWalrusRecord(record, recovery.record)
  check(recovery.recoveryKey === key, 'WALRUS_RECOVERY_KEY_MISMATCH')
  if (recovery.status !== 'CERTIFIED') return { recovery, historical: null, current: null,
    currentStatus: 'NOT_CONFIRMED' as const, currentReason: null }
  check(payment.certify && recovery.result.certifyTxDigest === payment.certify.digest
    && payment.uploaded && recovery.result.blobObjectId === payment.uploaded.blobObjectId, 'HISTORICAL_RECEIPT_MISMATCH')
  const historical = await (deps.historical ?? readContentAppendHistoricalOutputs)({ record, payment: recovery.record,
    effects: recovery.effects, client: execution.client, signal })
  // Current state is an independent observation. A later transfer/revocation or
  // an unavailable reader cannot erase a proved original append.
  let proof: WriteState
  try {
    const currentConfig = config ?? getBrowserContentWriteConfig()
    configured(record, i, currentConfig)
    proof = await profileReadStep(signal, () => (deps.read ?? readBrowserContentWriteState)({ config: currentConfig, soulId: i.soulId, stateId: i.stateId,
      contentId: record.scope.contentObjectId, kind: record.scope.kind, viewerAddress: record.scope.author, signal }, { client: () => execution.client }))
  } catch (error) {
    signal.throwIfAborted()
    return { recovery, historical, current: null, currentStatus: 'UNAVAILABLE' as const,
      currentReason: error instanceof Error ? error.message : 'Current state unavailable' }
  }
  try {
    const current = assertContentAppendFinal(record, proof, recovery.result)
    if (i.grantId) check(proof.snapshot.grants.some(grant => grant.grant?.id === i.grantId
      && grant.slot.grant_id === i.grantId && grant.slot.grantee === record.scope.author && grant.currentEpoch && grant.unexpiredAtObservation
      && (BigInt(grant.slot.scope_mask) & BigInt(current.slot.grant_scope_mask)) === BigInt(current.slot.grant_scope_mask)), 'CURRENT_ORIGINAL_GRANT_CHANGED')
    const storage = await (deps.observe ?? observeHistoricalPreparedSoulPayload)({ record: recovery.record,
      expectedOwner: historical.blobWrapperId, execution: { ...execution, beforeWrite: undefined, getAddress: () => null,
        sign: async () => { throw new Error('CONTENT_APPEND_QUERY_CANNOT_SIGN') } }, signal })
    signal.throwIfAborted()
    return { recovery, historical, current: storage.status === 'MATCHES_ORIGINAL' ? current : null,
      currentStatus: storage.status, currentReason: storage.reason }
  }
  catch (error) {
    signal.throwIfAborted()
    return { recovery, historical, current: null, currentStatus: 'CHANGED' as const,
      currentReason: error instanceof Error ? error.message : 'Current state differs from original append' }
  }
}
