import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { createPublicCommunityPublishIntent, publicCommunityPublishKey, validatePublicCommunityUploadReceipt,
  type PublicCommunityPublishIntent, type PublicCommunityUploadReceipt } from './community-publish-intent'
import { buildCreatePublicCommunityPostTx, buildCreatePublicCommunityCommentTx } from './community-posts-write'

export interface PublicCommunityPublishOperation {
  schema: 'soulidity.community-publish-operation.v1'
  intent: PublicCommunityPublishIntent
  receipt: PublicCommunityUploadReceipt
  bytes: string
  digest: string
  expirationEpoch: string
  phase: 'PREPARED' | 'SIGNING' | 'SIGNED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  signature: string | null
}
export class PublicCommunityPublishPersistenceError extends Error {
  readonly #record: PublicCommunityPublishOperation
  constructor(record: PublicCommunityPublishOperation, cause: unknown) {
    super('COMMUNITY_PUBLISH_OPERATION_NOT_PERSISTED: Keep or export this recovery record; do not start a replacement transaction.', { cause })
    this.name = 'PublicCommunityPublishPersistenceError'; this.#record = structuredClone(record)
  }
  get record(): PublicCommunityPublishOperation { return structuredClone(this.#record) }
}
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`COMMUNITY_PUBLISH_OPERATION_${code}`) }
const id = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
const u64 = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
  && BigInt(value) <= 18446744073709551615n
const CLOCK = `0x${'6'.padStart(64, '0')}`
function freezeIntent(input: PublicCommunityPublishIntent) {
  const intent = createPublicCommunityPublishIntent(input)
  const identities = [intent.deployment.registryId, intent.deployment.profile.registryId, intent.authorId, CLOCK,
    ...(intent.kind === 'comment' ? [intent.postId] : [])]
  check(new Set(identities).size === identities.length, 'ID_ALIAS')
  Object.freeze(intent.deployment.profile); Object.freeze(intent.deployment)
  if (intent.document.schema === 'soulidity.public-post.v1') Object.freeze(intent.document.tags)
  Object.freeze(intent.document); return Object.freeze(intent)
}
export function publicCommunityPublishOperationKey(intent: PublicCommunityPublishIntent): string {
  return publicCommunityPublishKey(freezeIntent(intent))
}

/** Validate untrusted recovery bytes against one complete publication template.
 * The returned ID is a pure Move result; no transfer or other command is allowed.
 * A receipt binds uploaded content but does not certify storage or authorization. */
export async function parsePublicCommunityPublishOperation(input: unknown): Promise<PublicCommunityPublishOperation> {
  const record = structuredClone(input) as PublicCommunityPublishOperation
  const fields = ['schema', 'intent', 'receipt', 'bytes', 'digest', 'expirationEpoch', 'phase', 'signature']
  check(record && typeof record === 'object' && !Array.isArray(record) && Object.keys(record).length === fields.length
    && fields.every(key => Object.hasOwn(record, key)), 'FIELDS_INVALID')
  check(record.schema === 'soulidity.community-publish-operation.v1', 'SCHEMA_INVALID')
  const intent = freezeIntent(record.intent)
  const receipt = await validatePublicCommunityUploadReceipt(intent, record.receipt)
  check(u64(record.expirationEpoch) && ['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(record.phase)
    && (record.signature === null || typeof record.signature === 'string' && record.signature.length > 0 && record.signature.length <= 32768)
    && (record.phase !== 'SIGNED' || record.signature !== null)
    && (!['PREPARED', 'SIGNING', 'CANCELLED'].includes(record.phase) || record.signature === null), 'PHASE_INVALID')
  check(typeof record.bytes === 'string' && record.bytes.length > 0 && record.bytes.length <= 32768, 'BYTES_INVALID')
  const bytes = fromBase64(record.bytes), data = bcs.TransactionData.parse(bytes)
  check(toBase64(bytes) === record.bytes && toBase64(bcs.TransactionData.serialize(data).toBytes()) === record.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === record.digest, 'DIGEST_MISMATCH')
  const tx = Transaction.from(bytes).getData()
  check(tx.sender === intent.owner && tx.gasData.owner === intent.owner && u64(tx.gasData.budget)
    && BigInt(tx.gasData.budget) > 0n && u64(tx.gasData.price) && BigInt(tx.gasData.price) > 0n
    && tx.gasData.payment?.length && String(data.V1?.expiration.Epoch) === record.expirationEpoch, 'SENDER_GAS_EXPIRATION_MISMATCH')
  const template = (intent.kind === 'post' ? buildCreatePublicCommunityPostTx({ ...intent, document: receipt.reference,
    postType: (['log', 'question', 'knowledge'] as const)[intent.postType], channel: intent.channel === 0 ? 'general' : 'questions' })
    : buildCreatePublicCommunityCommentTx({ ...intent, document: receipt.reference })).getData()
  const call = tx.commands[0]?.MoveCall, wanted = template.commands[0].MoveCall!
  check(tx.commands.length === 1 && call && call.package === wanted.package && call.module === wanted.module
    && call.function === wanted.function && JSON.stringify(call.typeArguments) === JSON.stringify(wanted.typeArguments)
    && call.arguments.length === wanted.arguments.length && tx.inputs.length === template.inputs.length, 'COMMAND_MISMATCH')
  wanted.arguments.forEach((argument, index) => {
    const actual = call.arguments[index]
    check(argument.$kind === 'Input' && actual.$kind === 'Input' && argument.Input === actual.Input, 'ARGUMENT_MISMATCH')
  })
  const objectIds = new Set<string>()
  template.inputs.forEach((expected, index) => {
    const actual = tx.inputs[index]
    if (expected.Pure) { check(actual?.Pure?.bytes === expected.Pure.bytes, 'ARGUMENT_MISMATCH'); return }
    const objectId = expected.UnresolvedObject!.objectId
    objectIds.add(objectId)
    const shared = actual?.Object?.SharedObject
    const mutableId = intent.kind === 'post' ? intent.deployment.registryId : intent.postId
    check(shared?.objectId === objectId && u64(shared.initialSharedVersion) && shared.initialSharedVersion !== '0'
      && shared.mutable === (objectId === mutableId), 'SHARED_INPUT_MISMATCH')
  })
  const gas = tx.gasData.payment!
  check(new Set(gas.map(ref => ref.objectId)).size === gas.length && gas.every(ref => id(ref.objectId)
    && !objectIds.has(ref.objectId) && u64(ref.version) && ref.version !== '0'
    && fromBase58(ref.digest).length === 32 && toBase58(fromBase58(ref.digest)) === ref.digest), 'GAS_INVALID')
  return { schema: record.schema, intent, receipt, bytes: record.bytes, digest: record.digest,
    expirationEpoch: record.expirationEpoch, phase: record.phase, signature: record.signature }
}
export const validatePublicCommunityPublishOperation = parsePublicCommunityPublishOperation

export interface PublicCommunityPublishOperationStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): PublicCommunityPublishOperation | null
  write(key: string, record: PublicCommunityPublishOperation): void
}
export interface PublicCommunityPublishOperationAdapter {
  query(record: PublicCommunityPublishOperation): Promise<'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'>
  /** Revalidate release, owner, authority, parent, certified document and expiry;
   * repeat immediately before broadcast. No uploads or replacement PTBs here. */
  preflight(record: PublicCommunityPublishOperation, signing: boolean): Promise<void>
  sign(record: PublicCommunityPublishOperation): Promise<{ bytes: string; signature: string }>
  verifySignature(record: PublicCommunityPublishOperation): Promise<void>
  broadcast(record: PublicCommunityPublishOperation): Promise<void>
}

/** Persist before prompting and before broadcasting. Uncertain outcomes retain
 * one intent, upload receipt and exact PTB; queryOnly never signs or sends. */
export async function runPublicCommunityPublishOperation(params: {
  intent: PublicCommunityPublishIntent; prepared?: PublicCommunityPublishOperation
  store: PublicCommunityPublishOperationStore; adapter: PublicCommunityPublishOperationAdapter
  queryOnly?: boolean; cancelUnsigned?: boolean
}): Promise<PublicCommunityPublishOperation> {
  const intent = freezeIntent(params.intent), key = publicCommunityPublishOperationKey(intent)
  const { store, adapter, queryOnly, cancelUnsigned } = params
  const prepared = params.prepared ? await parsePublicCommunityPublishOperation(params.prepared) : null
  check(!(prepared && (queryOnly || cancelUnsigned)) && !(queryOnly && cancelUnsigned), 'MODE_CONFLICT')
  return store.exclusive(key, async () => {
    let record = store.read(key)
    if (record) record = await parsePublicCommunityPublishOperation(record)
    const sameScope = (r: PublicCommunityPublishOperation) => publicCommunityPublishOperationKey(r.intent) === key
    check(!record || sameScope(record), 'SCOPE_MISMATCH')
    const save = async (next: PublicCommunityPublishOperation) => {
      const checked = await parsePublicCommunityPublishOperation(next)
      try { store.write(key, structuredClone(checked)) }
      catch (cause) { throw new PublicCommunityPublishPersistenceError(checked, cause) }
      record = checked
    }
    if (prepared) {
      check(sameScope(prepared) && JSON.stringify(prepared.intent) === JSON.stringify(intent)
        && prepared.phase === 'PREPARED' && prepared.signature === null, 'PREPARED_MISMATCH')
      check(!record || record.phase === 'CANCELLED', 'RECOVERY_REQUIRED')
      check(!record || JSON.stringify(record.intent) === JSON.stringify(intent), 'INTENT_MISMATCH')
      check(!record || JSON.stringify(record.receipt) === JSON.stringify(prepared.receipt), 'RECEIPT_MISMATCH')
      if (record) check(await adapter.query(structuredClone(record)) === 'MISSING', 'PREVIOUS_RESULT_UNCONFIRMED')
      await save(prepared)
    }
    check(record && sameScope(record), 'NOT_FOUND')
    check(JSON.stringify(record.intent) === JSON.stringify(intent), 'INTENT_MISMATCH')
    const reconcile = async () => {
      const result = await adapter.query(structuredClone(record!))
      check(['MISSING', 'PENDING', 'SUCCEEDED', 'FAILED'].includes(result), 'QUERY_INVALID')
      if (result === 'SUCCEEDED' || result === 'FAILED') { await save({ ...record!, phase: result }); return true }
      check(!['SUCCEEDED', 'FAILED'].includes(record!.phase), 'RESULT_UNCONFIRMED')
      check(record!.phase !== 'CANCELLED' || result === 'MISSING', 'CANCEL_UNCONFIRMED')
      return result === 'PENDING'
    }
    if (await reconcile() || queryOnly || record.phase === 'CANCELLED') return record
    if (cancelUnsigned) {
      check(record.phase === 'PREPARED' && record.signature === null, 'CANNOT_DISCARD_SIGNED')
      await save({ ...record, phase: 'CANCELLED' }); return record
    }
    await adapter.preflight(structuredClone(record), record.phase !== 'SIGNED')
    if (record.phase === 'PREPARED' || record.phase === 'SIGNING') {
      const wasUnsigned = record.phase === 'PREPARED'
      await save({ ...record, phase: 'SIGNING' })
      let signed
      try { signed = await adapter.sign(structuredClone(record)) }
      catch (error) {
        if (wasUnsigned && error instanceof Error && error.name === 'WalletStandardError'
          && (error as Error & { context?: { __code?: unknown } }).context?.__code === 4001000) {
          await save({ ...record, phase: 'PREPARED' })
        }
        throw error
      }
      check(signed.bytes === record.bytes, 'WALLET_CHANGED_BYTES')
      const next = { ...record, phase: 'SIGNED' as const, signature: signed.signature }
      await adapter.verifySignature(structuredClone(next)); await save(next)
    }
    await adapter.preflight(structuredClone(record), false)
    await adapter.verifySignature(structuredClone(record))
    await adapter.broadcast(structuredClone(record))
    await reconcile()
    return record
  })
}
