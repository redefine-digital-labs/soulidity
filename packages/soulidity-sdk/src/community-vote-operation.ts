import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { assertPublicCommunityVotesDeployment, buildSetPublicCommunityVoteTx, type PublicCommunityVotesDeployment } from './community-votes'

export interface PublicCommunityVoteIntent {
  deployment: PublicCommunityVotesDeployment
  owner: string
  actorId: string
  postId: string
  expectedRevision: string
  desired: 0 | 1 | 2
}
export interface PublicCommunityVoteOperation {
  schema: 'soulidity.community-vote-operation.v1'
  intent: PublicCommunityVoteIntent
  bytes: string
  digest: string
  expirationEpoch: string
  phase: 'PREPARED' | 'SIGNING' | 'SIGNED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  signature: string | null
}

/** Retain the exact verified signature if durable storage fails after the
 * wallet returns. This is an export/recovery aid, never broadcast authority. */
export class PublicCommunityVotePersistenceError extends Error {
  readonly #record: PublicCommunityVoteOperation
  constructor(record: PublicCommunityVoteOperation, cause: unknown) {
    super('COMMUNITY_VOTE_OPERATION_NOT_PERSISTED: Keep or export this recovery record; do not start a replacement transaction.', { cause })
    this.name = 'PublicCommunityVotePersistenceError'
    this.#record = structuredClone(record)
  }
  get record(): PublicCommunityVoteOperation { return structuredClone(this.#record) }
}

function check(value: unknown, code: string): asserts value { if (!value) throw new Error(code) }
const id = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
const u64 = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
  && BigInt(value) <= 18446744073709551615n
function keys(value: unknown, expected: string[]) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)), 'COMMUNITY_VOTE_OPERATION_FIELDS_INVALID')
}
function deployment(input: PublicCommunityVotesDeployment): PublicCommunityVotesDeployment {
  keys(input, ['community', 'registryId'])
  keys(input.community, ['profile', 'registryId'])
  keys(input.community.profile, ['originalPackageId', 'callablePackageId', 'registryId', 'chainIdentifier'])
  const checked = assertPublicCommunityVotesDeployment(input), profile = checked.community.profile
  return { community: { profile: { originalPackageId: profile.originalPackageId, callablePackageId: profile.callablePackageId,
    registryId: profile.registryId, chainIdentifier: profile.chainIdentifier }, registryId: checked.community.registryId }, registryId: checked.registryId }
}

/** Freeze semantic intent before any async read; JSON key order is not identity. */
export function createPublicCommunityVoteIntent(input: PublicCommunityVoteIntent): PublicCommunityVoteIntent {
  const value = structuredClone(input)
  keys(value, ['deployment', 'owner', 'actorId', 'postId', 'expectedRevision', 'desired'])
  const target = deployment(value.deployment)
  check(id(value.owner) && id(value.actorId) && id(value.postId), 'COMMUNITY_VOTE_OPERATION_ID_INVALID')
  check(new Set([value.actorId, value.postId, target.registryId, target.community.registryId, target.community.profile.registryId]).size === 5,
    'COMMUNITY_VOTE_OPERATION_ID_ALIAS')
  check(u64(value.expectedRevision) && Number.isInteger(value.desired) && value.desired >= 0 && value.desired <= 2, 'COMMUNITY_VOTE_OPERATION_INTENT_INVALID')
  Object.freeze(target.community.profile); Object.freeze(target.community); Object.freeze(target)
  return Object.freeze({ deployment: target, owner: value.owner, actorId: value.actorId, postId: value.postId,
    expectedRevision: value.expectedRevision, desired: value.desired })
}

/** One unresolved operation per release + wallet → target, independent of its
 * revision/desired state. Cold recovery needs no newly invented actor identity. */
export function publicCommunityVoteOperationKey(scope: Pick<PublicCommunityVoteIntent, 'deployment' | 'owner' | 'postId'>): string {
  const target = deployment(scope.deployment)
  check(id(scope.owner) && id(scope.postId), 'COMMUNITY_VOTE_OPERATION_ID_INVALID')
  return `soulidity.community-vote-operation:${target.community.profile.chainIdentifier}:${target.community.profile.originalPackageId}:${target.community.profile.callablePackageId}:${target.community.profile.registryId}:${target.community.registryId}:${target.registryId}:${scope.owner}:${scope.postId}`
}

/** Untrusted recovery input must describe exactly one set_vote PTB. Digest
 * verification alone is not enough: rehashed extra calls/arguments are rejected. */
export function parsePublicCommunityVoteOperation(input: unknown): PublicCommunityVoteOperation {
  const record = structuredClone(input) as PublicCommunityVoteOperation
  keys(record, ['schema', 'intent', 'bytes', 'digest', 'expirationEpoch', 'phase', 'signature'])
  check(record.schema === 'soulidity.community-vote-operation.v1', 'COMMUNITY_VOTE_OPERATION_SCHEMA_INVALID')
  const intent = createPublicCommunityVoteIntent(record.intent)
  check(u64(record.expirationEpoch) && ['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(record.phase)
    && (record.signature === null || typeof record.signature === 'string' && record.signature.length > 0 && record.signature.length <= 32768)
    && (record.phase !== 'SIGNED' || record.signature !== null)
    && (!['PREPARED', 'SIGNING', 'CANCELLED'].includes(record.phase) || record.signature === null), 'COMMUNITY_VOTE_OPERATION_PHASE_INVALID')
  check(typeof record.bytes === 'string' && record.bytes.length > 0 && record.bytes.length <= 32768, 'COMMUNITY_VOTE_OPERATION_BYTES_INVALID')
  const bytes = fromBase64(record.bytes), data = bcs.TransactionData.parse(bytes)
  check(toBase64(bytes) === record.bytes && toBase64(bcs.TransactionData.serialize(data).toBytes()) === record.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === record.digest, 'COMMUNITY_VOTE_OPERATION_DIGEST_MISMATCH')
  const tx = Transaction.from(bytes).getData()
  check(tx.sender === intent.owner && tx.gasData.owner === intent.owner && u64(tx.gasData.budget)
    && BigInt(tx.gasData.budget) > 0n && u64(tx.gasData.price) && BigInt(tx.gasData.price) > 0n
    && tx.gasData.payment?.length && String(data.V1?.expiration.Epoch) === record.expirationEpoch,
  'COMMUNITY_VOTE_OPERATION_SENDER_GAS_EXPIRATION_MISMATCH')
  const template = buildSetPublicCommunityVoteTx(intent).getData()
  const call = tx.commands[0]?.MoveCall, wanted = template.commands[0].MoveCall!
  check(tx.commands.length === 1 && call && call.package === wanted.package && call.module === wanted.module
    && call.function === wanted.function && JSON.stringify(call.typeArguments) === JSON.stringify(wanted.typeArguments)
    && call.arguments.length === wanted.arguments.length && tx.inputs.length === template.inputs.length,
  'COMMUNITY_VOTE_OPERATION_COMMAND_MISMATCH')
  wanted.arguments.forEach((argument, index) => {
    const actual = call.arguments[index]
    check(argument.$kind === 'Input' && actual.$kind === 'Input' && argument.Input === actual.Input,
      'COMMUNITY_VOTE_OPERATION_ARGUMENT_MISMATCH')
  })
  const objectIds = new Set<string>()
  template.inputs.forEach((expected, index) => {
    const actual = tx.inputs[index]
    if (expected.Pure) {
      check(actual?.Pure?.bytes === expected.Pure.bytes, 'COMMUNITY_VOTE_OPERATION_ARGUMENT_MISMATCH'); return
    }
    const objectId = expected.UnresolvedObject!.objectId
    objectIds.add(objectId)
    const shared = actual?.Object?.SharedObject
    check(shared?.objectId === objectId && u64(shared.initialSharedVersion) && shared.initialSharedVersion !== '0'
      && shared.mutable === (objectId === intent.deployment.registryId), 'COMMUNITY_VOTE_OPERATION_SHARED_INPUT_MISMATCH')
  })
  const gas = tx.gasData.payment!
  check(new Set(gas.map(ref => ref.objectId)).size === gas.length && gas.every(ref => id(ref.objectId)
    && !objectIds.has(ref.objectId) && u64(ref.version) && ref.version !== '0'
    && fromBase58(ref.digest).length === 32 && toBase58(fromBase58(ref.digest)) === ref.digest), 'COMMUNITY_VOTE_OPERATION_GAS_INVALID')
  return { schema: record.schema, intent, bytes: record.bytes, digest: record.digest, expirationEpoch: record.expirationEpoch,
    phase: record.phase, signature: record.signature }
}

export interface PublicCommunityVoteOperationStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): PublicCommunityVoteOperation | null
  write(key: string, record: PublicCommunityVoteOperation): void
}
export interface PublicCommunityVoteOperationAdapter {
  query(record: PublicCommunityVoteOperation): Promise<'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'>
  preflight(record: PublicCommunityVoteOperation, signing: boolean): Promise<void>
  sign(record: PublicCommunityVoteOperation): Promise<{ bytes: string; signature: string }>
  verifySignature(record: PublicCommunityVoteOperation): Promise<void>
  broadcast(record: PublicCommunityVoteOperation): Promise<void>
}

/** Query first. Persist PREPARED before a prompt and SIGNED before broadcast.
 * Unknown results retain the same bytes/digest; queryOnly can never sign/send. */
export async function runPublicCommunityVoteOperation(params: {
  intent: PublicCommunityVoteIntent; prepared?: PublicCommunityVoteOperation
  store: PublicCommunityVoteOperationStore; adapter: PublicCommunityVoteOperationAdapter
  queryOnly?: boolean; cancelUnsigned?: boolean
}): Promise<PublicCommunityVoteOperation> {
  const intent = createPublicCommunityVoteIntent(params.intent), key = publicCommunityVoteOperationKey(intent)
  const prepared = params.prepared ? parsePublicCommunityVoteOperation(params.prepared) : null
  const { store, adapter, queryOnly, cancelUnsigned } = params
  check(!(prepared && (queryOnly || cancelUnsigned)) && !(queryOnly && cancelUnsigned), 'COMMUNITY_VOTE_OPERATION_MODE_CONFLICT')
  return store.exclusive(key, async () => {
    let record = store.read(key)
    if (record) record = parsePublicCommunityVoteOperation(record)
    const sameScope = (r: PublicCommunityVoteOperation) => publicCommunityVoteOperationKey(r.intent) === key
      && JSON.stringify(r.intent.deployment) === JSON.stringify(intent.deployment)
    check(!record || sameScope(record), 'COMMUNITY_VOTE_OPERATION_SCOPE_MISMATCH')
    const save = (next: PublicCommunityVoteOperation) => {
      const checked = parsePublicCommunityVoteOperation(next)
      try { store.write(key, structuredClone(checked)) }
      catch (cause) { throw new PublicCommunityVotePersistenceError(checked, cause) }
      record = checked
    }
    if (prepared) {
      check(sameScope(prepared) && JSON.stringify(prepared.intent) === JSON.stringify(intent)
        && prepared.phase === 'PREPARED' && prepared.signature === null, 'COMMUNITY_VOTE_OPERATION_PREPARED_MISMATCH')
      check(!record || ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(record.phase), 'COMMUNITY_VOTE_OPERATION_RECOVERY_REQUIRED')
      if (record) {
        const result = await adapter.query(structuredClone(record))
        check(record.phase === 'CANCELLED' ? result === 'MISSING' : result === record.phase, 'COMMUNITY_VOTE_OPERATION_PREVIOUS_RESULT_UNCONFIRMED')
      }
      save(prepared)
    }
    check(record && sameScope(record), 'COMMUNITY_VOTE_OPERATION_NOT_FOUND')
    check(JSON.stringify(record.intent) === JSON.stringify(intent), 'COMMUNITY_VOTE_OPERATION_INTENT_MISMATCH')
    const reconcile = async () => {
      const result = await adapter.query(structuredClone(record!))
      if (result === 'SUCCEEDED' || result === 'FAILED') { save({ ...record!, phase: result }); return true }
      check(!['SUCCEEDED', 'FAILED'].includes(record!.phase), 'COMMUNITY_VOTE_OPERATION_RESULT_UNCONFIRMED')
      check(record!.phase !== 'CANCELLED' || result === 'MISSING', 'COMMUNITY_VOTE_OPERATION_CANCEL_UNCONFIRMED')
      return result === 'PENDING'
    }
    if (await reconcile() || queryOnly || record.phase === 'CANCELLED') return record
    if (cancelUnsigned) {
      check(record.phase === 'PREPARED' && record.signature === null, 'COMMUNITY_VOTE_OPERATION_CANNOT_DISCARD_SIGNED')
      save({ ...record, phase: 'CANCELLED' }); return record
    }
    await adapter.preflight(structuredClone(record), record.phase !== 'SIGNED')
    if (record.phase === 'PREPARED' || record.phase === 'SIGNING') {
      const wasUnsigned = record.phase === 'PREPARED'
      save({ ...record, phase: 'SIGNING' })
      let signed
      try { signed = await adapter.sign(structuredClone(record)) }
      catch (error) {
        if (wasUnsigned && error instanceof Error && error.name === 'WalletStandardError'
          && (error as Error & { context?: { __code?: unknown } }).context?.__code === 4001000) {
          save({ ...record, phase: 'PREPARED' })
        }
        throw error
      }
      check(signed.bytes === record.bytes, 'COMMUNITY_VOTE_OPERATION_WALLET_CHANGED_BYTES')
      const next = { ...record, phase: 'SIGNED' as const, signature: signed.signature }
      await adapter.verifySignature(structuredClone(next)); save(next)
    }
    await adapter.preflight(structuredClone(record), false)
    await adapter.verifySignature(structuredClone(record))
    await adapter.broadcast(structuredClone(record))
    await reconcile()
    return record
  })
}

