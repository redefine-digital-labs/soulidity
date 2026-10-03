import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { assertPublicProfileMetadataRef, buildCreateWalletProfileTx, buildUpdateWalletProfileTx } from './wallet-profile'
import { createPublicProfileSaveIntent, type PublicProfileSaveIntent, type PublicProfileUploadReceipt } from './public-profile-save'
import { encodePublicWalletProfileMetadata, publicWalletProfileMetadataHash } from './public-profile-metadata'

export interface PublicProfileOperation {
  schema: 'soulidity.public-profile-operation.v1'
  intent: PublicProfileSaveIntent
  receipt: PublicProfileUploadReceipt
  bytes: string; digest: string; expirationEpoch: string
  phase: 'PREPARED' | 'SIGNING' | 'SIGNED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  signature: string | null
}
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(code) }
const u64 = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n
const id = (v: unknown) => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v)
const terminal = (record: PublicProfileOperation) => ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(record.phase)

/** Synchronous storage parser, NOT permission to sign. The asynchronous
 * validator below additionally binds public document and intent commitments. */
export function parsePublicProfileOperation(input: unknown): PublicProfileOperation {
  const r = structuredClone(input) as PublicProfileOperation
  check(r?.schema === 'soulidity.public-profile-operation.v1', 'PROFILE_OPERATION_SCHEMA_INVALID')
  const intent = createPublicProfileSaveIntent(r.intent)
  check(JSON.stringify(intent) === JSON.stringify(r.intent), 'PROFILE_OPERATION_INTENT_NONCANONICAL')
  check(r.receipt?.schema === 'soulidity.public-profile-upload.v1' && /^[0-9a-f]{64}$/.test(r.receipt.intentHash),
    'PROFILE_OPERATION_RECEIPT_INVALID')
  const metadata = assertPublicProfileMetadataRef(r.receipt.reference)
  check(u64(r.expirationEpoch) && ['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(r.phase)
    && (r.signature === null || typeof r.signature === 'string' && r.signature.length > 0 && r.signature.length <= 32768)
    && (r.phase !== 'SIGNED' || r.signature !== null)
    && (!['PREPARED', 'SIGNING', 'CANCELLED'].includes(r.phase) || r.signature === null), 'PROFILE_OPERATION_PHASE_INVALID')
  check(typeof r.bytes === 'string' && r.bytes.length > 0 && r.bytes.length <= 32768, 'PROFILE_OPERATION_BYTES_INVALID')
  const bytes = fromBase64(r.bytes), data = bcs.TransactionData.parse(bytes)
  check(toBase64(bytes) === r.bytes && toBase64(bcs.TransactionData.serialize(data).toBytes()) === r.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === r.digest, 'PROFILE_OPERATION_DIGEST_MISMATCH')
  const tx = Transaction.from(bytes).getData()
  check(tx.sender === intent.owner && tx.gasData.owner === intent.owner && u64(tx.gasData.budget)
    && BigInt(tx.gasData.budget) > 0n && u64(tx.gasData.price) && BigInt(tx.gasData.price) > 0n
    && tx.gasData.payment?.length && String(data.V1?.expiration.Epoch) === r.expirationEpoch,
  'PROFILE_OPERATION_SENDER_GAS_EXPIRATION_MISMATCH')
  const common = { deployment: intent.deployment, owner: intent.owner, handle: intent.handle, metadata }
  const template = (intent.expected ? buildUpdateWalletProfileTx({ ...common, profileId: intent.expected.profileId,
    expectedRevision: intent.expected.revision }) : buildCreateWalletProfileTx(common)).getData()
  const call = tx.commands[0]?.MoveCall, wanted = template.commands[0].MoveCall!
  check(tx.commands.length === 1 && call && call.package === wanted.package && call.module === wanted.module
    && call.function === wanted.function && JSON.stringify(call.typeArguments) === JSON.stringify(wanted.typeArguments)
    && call.arguments.length === wanted.arguments.length && tx.inputs.length === template.inputs.length,
  'PROFILE_OPERATION_COMMAND_MISMATCH')
  wanted.arguments.forEach((argument, index) => {
    const actual = call.arguments[index]
    check(argument.$kind === 'Input' && actual.$kind === 'Input' && argument.Input === actual.Input,
      'PROFILE_OPERATION_ARGUMENT_MISMATCH')
  })
  const inputs = new Set<string>()
  template.inputs.forEach((expected, index) => {
    const actual = tx.inputs[index]
    if (expected.Pure) {
      check(actual?.Pure?.bytes === expected.Pure.bytes, 'PROFILE_OPERATION_ARGUMENT_MISMATCH'); return
    }
    const objectId = expected.UnresolvedObject!.objectId
    inputs.add(objectId)
    if (objectId === intent.expected?.profileId) {
      check(actual.Object?.ImmOrOwnedObject?.objectId === objectId && u64(actual.Object.ImmOrOwnedObject.version),
        'PROFILE_OPERATION_OWNED_INPUT_MISMATCH')
    } else {
      check(actual.Object?.SharedObject?.objectId === objectId && u64(actual.Object.SharedObject.initialSharedVersion)
        && actual.Object.SharedObject.mutable === (objectId === intent.deployment.registryId),
      'PROFILE_OPERATION_SHARED_INPUT_MISMATCH')
    }
  })
  const gas = tx.gasData.payment!
  check(new Set(gas.map(ref => ref.objectId)).size === gas.length
    && gas.every(ref => id(ref.objectId) && !inputs.has(ref.objectId)), 'PROFILE_OPERATION_GAS_OVERLAP')
  return r
}

/** Only the exact profile PTB, frozen form, content reference and own-wallet gas
 * may enter recovery/signing. Browser storage does not attest any of them. */
export async function validatePublicProfileOperation(input: unknown): Promise<PublicProfileOperation> {
  const record = parsePublicProfileOperation(input)
  const metadata = encodePublicWalletProfileMetadata(record.intent.metadata)
  check(record.receipt.intentHash === await publicWalletProfileMetadataHash(new TextEncoder().encode(JSON.stringify(record.intent))),
    'PROFILE_OPERATION_INTENT_HASH_MISMATCH')
  check(record.receipt.reference.byteLength === metadata.length
    && record.receipt.reference.sha256 === await publicWalletProfileMetadataHash(metadata), 'PROFILE_OPERATION_METADATA_HASH_MISMATCH')
  return record
}

export function publicProfileOperationKey(intent: PublicProfileSaveIntent): string {
  const value = createPublicProfileSaveIntent(intent)
  return `soulidity.public-profile-operation:${value.deployment.chainIdentifier}:${value.deployment.registryId}:${value.owner}`
}
export interface PublicProfileOperationStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): PublicProfileOperation | null
  write(key: string, record: PublicProfileOperation): void
}
export interface PublicProfileOperationAdapter {
  query(record: PublicProfileOperation): Promise<'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'>
  preflight(record: PublicProfileOperation, signing: boolean): Promise<void>
  sign(record: PublicProfileOperation): Promise<{ bytes: string; signature: string }>
  verifySignature(record: PublicProfileOperation): Promise<void>
  broadcast(record: PublicProfileOperation): Promise<void>
}

/** Query first, persist exact signed bytes before broadcasting, never turn an
 * unknown result into failure or rebuild it. The store provides cross-tab
 * exclusion and durable writes; a cached terminal phase is not chain evidence. */
export async function runPublicProfileOperation(params: {
  intent: PublicProfileSaveIntent; prepared?: PublicProfileOperation
  store: PublicProfileOperationStore; adapter: PublicProfileOperationAdapter
  queryOnly?: boolean; cancelUnsigned?: boolean
}): Promise<PublicProfileOperation> {
  const intent = createPublicProfileSaveIntent(params.intent)
  const { store, adapter, queryOnly, cancelUnsigned } = params
  const prepared = params.prepared ? await validatePublicProfileOperation(params.prepared) : null
  const key = publicProfileOperationKey(intent)
  check(!(prepared && (queryOnly || cancelUnsigned)), 'PROFILE_OPERATION_MODE_CONFLICT')
  return store.exclusive(key, async () => {
    let record = store.read(key)
    if (record) record = await validatePublicProfileOperation(record)
    const sameScope = (r: PublicProfileOperation) => publicProfileOperationKey(r.intent) === key
      && JSON.stringify(r.intent.deployment) === JSON.stringify(intent.deployment)
    check(!record || sameScope(record), 'PROFILE_OPERATION_SCOPE_MISMATCH')
    const save = (next: PublicProfileOperation) => {
      // Only phase/signature transitions of the fully validated frozen record.
      const checked = parsePublicProfileOperation(next)
      store.write(key, structuredClone(checked)); record = checked
    }
    if (prepared) {
      check(sameScope(prepared) && JSON.stringify(prepared.intent) === JSON.stringify(intent)
        && prepared.phase === 'PREPARED' && prepared.signature === null, 'PROFILE_OPERATION_PREPARED_MISMATCH')
      check(!record || terminal(record), 'PROFILE_OPERATION_RECOVERY_REQUIRED')
      if (record && record.phase !== 'CANCELLED') {
        check(await adapter.query(structuredClone(record)) === record.phase, 'PROFILE_OPERATION_PREVIOUS_RESULT_UNCONFIRMED')
      }
      save(prepared)
    }
    check(record && sameScope(record), 'PROFILE_OPERATION_NOT_FOUND')
    if (record.phase === 'CANCELLED') return record
    const reconcile = async () => {
      const result = await adapter.query(structuredClone(record!))
      if (result === 'SUCCEEDED' || result === 'FAILED') {
        save({ ...record!, phase: result }); return true
      }
      check(!terminal(record!), 'PROFILE_OPERATION_RESULT_UNCONFIRMED')
      return result === 'PENDING'
    }
    if (await reconcile() || queryOnly) return record!
    if (cancelUnsigned) {
      check(record.phase === 'PREPARED' && record.signature === null, 'PROFILE_OPERATION_CANNOT_DISCARD_SIGNED')
      save({ ...record, phase: 'CANCELLED' }); return record!
    }
    await adapter.preflight(structuredClone(record), record.phase !== 'SIGNED')
    if (record.phase === 'PREPARED' || record.phase === 'SIGNING') {
      const wasUnsigned = record.phase === 'PREPARED'
      save({ ...record, phase: 'SIGNING' })
      let signed
      try { signed = await adapter.sign(structuredClone(record!)) }
      catch (error) {
        if (wasUnsigned && error instanceof Error && error.name === 'WalletStandardError'
          && (error as Error & { context?: { __code?: unknown } }).context?.__code === 4001000) {
          save({ ...record!, phase: 'PREPARED' })
        }
        throw error
      }
      check(signed.bytes === record.bytes, 'PROFILE_OPERATION_WALLET_CHANGED_BYTES')
      const next = { ...record, phase: 'SIGNED' as const, signature: signed.signature }
      await adapter.verifySignature(structuredClone(next)); save(next)
    }
    await adapter.preflight(structuredClone(record!), false)
    await adapter.verifySignature(structuredClone(record!))
    await adapter.broadcast(structuredClone(record!))
    await reconcile()
    return record!
  })
}
