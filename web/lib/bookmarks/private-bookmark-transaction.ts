import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { blake2b } from '@noble/hashes/blake2.js'
import { assertPrivateWalletBookmarksCipherRef, assertPrivateWalletBookmarksDeployment, assertPrivateWalletBookmarksScope,
  buildCommitPrivateWalletBookmarksTx, derivePrivateWalletBookmarksHeadFieldId, PrivateWalletBookmarksHeadFieldV1Bcs,
  profileReadStep, readPrivateWalletBookmarksHead, type PrivateWalletBookmarksCipherRef,
  type PrivateWalletBookmarksDeployment, type PrivateWalletBookmarksScope } from '@soulidity/sdk'
import { readActivityCheckpointEvidence } from '../soulidity/activity-transaction-evidence'
import { bookmarkCanonical, bookmarkCheck as check, bookmarkHash, bookmarkId, bookmarkU64 } from './private-bookmark-library'

/** Only public scope and ciphertext commitments; never a bookmarked Soul/intent. */
export interface PrivateBookmarkPublicPlan {
  deployment: PrivateWalletBookmarksDeployment; scope: PrivateWalletBookmarksScope
  expectedRevision: string; requestId: string; ciphertext: PrivateWalletBookmarksCipherRef
}
export interface PrivateBookmarkTransactionPacket {
  bytes: string; digest: string; expirationEpoch: string
  phase: 'PREPARED' | 'SIGNING' | 'SIGNED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; signature: string | null
}
export type PrivateBookmarkTransactionStatus = 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'
const MAX = 18446744073709551615n
const same = (a: unknown, b: unknown) => bookmarkCanonical(a) === bookmarkCanonical(b)
const exact = (v: unknown, keys: string[]) => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key))
function digest(v: unknown): asserts v is string {
  check(typeof v === 'string' && v.length <= 44 && fromBase58(v).length === 32 && toBase58(fromBase58(v)) === v, 'TRANSACTION_DIGEST_INVALID')
}
const positive = (v: unknown) => { check(bookmarkU64(v) && v !== '0', 'TRANSACTION_VERSION_INVALID') }
function canonical<C extends { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }>(codec: C, bytes: Uint8Array): ReturnType<C['parse']> {
  const value = codec.parse(bytes)
  check(toBase64(codec.serialize(value).toBytes()) === toBase64(bytes), 'TRANSACTION_NONCANONICAL_BCS')
  return value
}
function typedHash(domain: string, bytes: Uint8Array) {
  const prefix = new TextEncoder().encode(`${domain}::`), input = new Uint8Array(prefix.length + bytes.length)
  input.set(prefix); input.set(bytes, prefix.length)
  return toBase58(blake2b(input, { dkLen: 32 }))
}
export function validatePrivateBookmarkPublicPlan(input: unknown): PrivateBookmarkPublicPlan {
  const p = structuredClone(input) as PrivateBookmarkPublicPlan
  check(exact(p, ['deployment', 'scope', 'expectedRevision', 'requestId', 'ciphertext']) && bookmarkU64(p.expectedRevision)
    && BigInt(p.expectedRevision) < MAX && bookmarkHash(p.requestId), 'PUBLIC_PLAN_INVALID')
  return { deployment: assertPrivateWalletBookmarksDeployment(p.deployment), scope: assertPrivateWalletBookmarksScope(p.scope),
    expectedRevision: p.expectedRevision, requestId: p.requestId, ciphertext: assertPrivateWalletBookmarksCipherRef(p.ciphertext) }
}
/** Canonical frozen bytes must encode exactly one SDK head CAS; no extra calls,
 * type arguments, gas sponsorship, unused inputs or hidden bookmark metadata. */
export function validatePrivateBookmarkTransactionPacket(input: PrivateBookmarkPublicPlan, value: unknown): PrivateBookmarkTransactionPacket {
  const plan = validatePrivateBookmarkPublicPlan(input), packet = structuredClone(value) as PrivateBookmarkTransactionPacket
  check(exact(packet, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature']) && bookmarkU64(packet.expirationEpoch)
    && ['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(packet.phase), 'TRANSACTION_PACKET_INVALID')
  digest(packet.digest)
  check(packet.signature === null || typeof packet.signature === 'string' && packet.signature.length > 0 && packet.signature.length <= 32768
    && toBase64(fromBase64(packet.signature)) === packet.signature, 'TRANSACTION_SIGNATURE_INVALID')
  check(packet.phase !== 'SIGNED' || packet.signature !== null, 'TRANSACTION_SIGNATURE_REQUIRED')
  check(!['PREPARED', 'SIGNING', 'CANCELLED'].includes(packet.phase) || packet.signature === null, 'TRANSACTION_UNEXPECTED_SIGNATURE')
  check(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 180000, 'TRANSACTION_BYTE_BUDGET')
  const bytes = fromBase64(packet.bytes), raw = canonical(bcs.TransactionData, bytes)
  check(toBase64(bytes) === packet.bytes && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest, 'TRANSACTION_BYTES_MISMATCH')
  const actual = Transaction.from(bytes).getData(), expected = buildCommitPrivateWalletBookmarksTx(plan).getData()
  check(actual.sender === plan.scope.owner && actual.gasData.owner === plan.scope.owner
    && raw.V1.expiration.$kind === 'Epoch' && String(raw.V1.expiration.Epoch) === packet.expirationEpoch, 'TRANSACTION_SENDER_EXPIRY_MISMATCH')
  positive(actual.gasData.budget); positive(actual.gasData.price)
  const payments = actual.gasData.payment
  check(payments && payments.length > 0 && payments.length <= 256 && new Set(payments.map(row => row.objectId)).size === payments.length, 'TRANSACTION_GAS_INVALID')
  const reserved = [plan.scope.registryId, plan.ciphertext.blobObjectId, plan.deployment.originalPackageId, plan.deployment.callablePackageId]
  for (const row of payments) { check(bookmarkId(row.objectId) && !reserved.includes(row.objectId), 'TRANSACTION_GAS_OVERLAP'); positive(row.version); digest(row.digest) }
  const call = actual.commands[0]?.MoveCall, wanted = expected.commands[0].MoveCall!
  check(actual.commands.length === 1 && actual.inputs.length === expected.inputs.length && call && call.package === wanted.package
    && call.module === wanted.module && call.function === wanted.function && call.typeArguments.length === 0
    && call.arguments.length === wanted.arguments.length, 'TRANSACTION_COMMAND_MISMATCH')
  const used = new Set<number>()
  wanted.arguments.forEach((argument, index) => {
    const supplied = call.arguments[index]
    check(argument.$kind === 'Input' && supplied.$kind === 'Input' && !used.has(supplied.Input), 'TRANSACTION_ARGUMENT_MISMATCH')
    used.add(supplied.Input)
    const input = actual.inputs[supplied.Input], wantedInput = expected.inputs[argument.Input]
    if (wantedInput.Pure) check(input?.Pure?.bytes === wantedInput.Pure.bytes, 'TRANSACTION_PURE_MISMATCH')
    else {
      const shared = input?.Object?.SharedObject
      check(wantedInput.UnresolvedObject?.objectId === plan.scope.registryId && shared?.objectId === plan.scope.registryId
        && shared.mutable, 'TRANSACTION_SHARED_MISMATCH')
      positive(shared.initialSharedVersion)
    }
  })
  check(used.size === actual.inputs.length, 'TRANSACTION_UNUSED_INPUT')
  return packet
}
type Effects = ReturnType<typeof bcs.TransactionEffects.parse>
type ObjectRef = { version: string; digest: string | null; created: boolean }
function fieldRefs(effects: Effects, fieldId: string, registryId: string): { before: ObjectRef | null; after: ObjectRef } | null {
  if (effects.V2) {
    const rows = effects.V2.changedObjects.filter(([id]) => id === fieldId)
    check(rows.length <= 1 && !effects.V2.unchangedConsensusObjects.some(([id]) => id === fieldId), 'TRANSACTION_HEAD_EFFECTS_INVALID')
    if (!rows.length) return null
    const row = rows[0][1], write = row.outputState.ObjectWrite
    check(write && write[1].$kind === 'ObjectOwner' && write[1].ObjectOwner === registryId
      && ['Created', 'None'].includes(row.idOperation.$kind), 'TRANSACTION_HEAD_EFFECTS_INVALID')
    const created = row.idOperation.$kind === 'Created', version = effects.V2.lamportVersion
    positive(version); digest(write[0])
    if (created) check(row.inputState.$kind === 'NotExist', 'TRANSACTION_HEAD_LINEAGE_INVALID')
    else check(row.inputState.$kind === 'Exist' && row.inputState.Exist[1].$kind === 'ObjectOwner'
      && row.inputState.Exist[1].ObjectOwner === registryId && BigInt(row.inputState.Exist[0][0]) < BigInt(version), 'TRANSACTION_HEAD_LINEAGE_INVALID')
    const before = created ? null : { version: row.inputState.Exist![0][0], digest: row.inputState.Exist![0][1], created: false }
    if (before) { positive(before.version); digest(before.digest) }
    return { before, after: { version, digest: write[0], created } }
  }
  const v1 = effects.V1!
  check(!v1.sharedObjects.some(row => row.objectId === fieldId), 'TRANSACTION_HEAD_EFFECTS_INVALID')
  const rows = [...v1.created.map(row => ({ row, created: true })), ...v1.mutated.map(row => ({ row, created: false }))]
    .filter(value => value.row[0].objectId === fieldId)
  check(rows.length <= 1 && ![...v1.deleted, ...v1.unwrappedThenDeleted, ...v1.wrapped, ...v1.unwrapped.map(row => row[0])]
    .some(row => row.objectId === fieldId), 'TRANSACTION_HEAD_EFFECTS_INVALID')
  const prior = v1.modifiedAtVersions.filter(([id]) => id === fieldId)
  if (!rows.length) { check(prior.length === 0, 'TRANSACTION_HEAD_LINEAGE_INVALID'); return null }
  const { row: [ref, owner], created } = rows[0]
  check(owner.$kind === 'ObjectOwner' && owner.ObjectOwner === registryId, 'TRANSACTION_HEAD_OWNER_INVALID')
  check(created ? prior.length === 0 : prior.length === 1 && BigInt(prior[0][1]) < BigInt(ref.version), 'TRANSACTION_HEAD_LINEAGE_INVALID')
  positive(ref.version); digest(ref.digest)
  if (!created) positive(prior[0][1])
  // V1 commits the old version but has no old digest. Read canonical trusted
  // ledger bytes for that version without inventing an input-digest commitment.
  return { before: created ? null : { version: prior[0][1], digest: null, created: false }, after: { version: ref.version, digest: ref.digest, created } }
}
function headValue(raw: ReturnType<typeof PrivateWalletBookmarksHeadFieldV1Bcs.parse>, plan: PrivateBookmarkPublicPlan, fieldId: string) {
  const value = raw.value
  check(raw.id === fieldId && raw.name.version === 1 && raw.name.owner === plan.scope.owner && value.version === 1
    && value.registry_id === plan.scope.registryId && value.owner === plan.scope.owner && bookmarkU64(value.revision) && value.revision !== '0', 'TRANSACTION_HEAD_SCOPE_INVALID')
  const cipher = (v: typeof value.ciphertext) => assertPrivateWalletBookmarksCipherRef({ blobObjectId: v.blob_object_id, blobId: v.blob_id,
    sha256: toHex(new Uint8Array(v.sha256)), byteLength: v.byte_length })
  check(value.receipts.length === Number(BigInt(value.revision) > 32n ? 32n : BigInt(value.revision)), 'TRANSACTION_RECEIPT_WINDOW_INVALID')
  const ids = new Set<string>(), receipts = value.receipts.map((row, i) => {
    const requestId = toHex(new Uint8Array(row.request_id))
    check(bookmarkHash(requestId) && !ids.has(requestId) && BigInt(row.revision) === BigInt(value.revision) - BigInt(value.receipts.length - i - 1), 'TRANSACTION_RECEIPT_INVALID')
    ids.add(requestId); return { requestId, revision: row.revision, ciphertext: cipher(row.ciphertext) }
  })
  const ciphertext = cipher(value.ciphertext)
  check(same(receipts.at(-1)!.ciphertext, ciphertext), 'TRANSACTION_RECEIPT_HEAD_MISMATCH')
  return { revision: value.revision, ciphertext, receipts }
}
export function createPrivateBookmarkTransactionAdapter(params: {
  client: SuiGrpcClient; signal: AbortSignal; getAddress: () => string | null
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
  preflight: (plan: PrivateBookmarkPublicPlan, signing: boolean) => Promise<void>
}) {
  const { client, signal: lifetime, getAddress, sign, preflight } = params
  const deadline = () => AbortSignal.any([lifetime, AbortSignal.timeout(45000)])
  const wallet = (p: PrivateBookmarkPublicPlan) => { lifetime.throwIfAborted(); check(getAddress() === p.scope.owner, 'WALLET_CHANGED') }
  async function epoch(signal: AbortSignal) {
    const { response } = await profileReadStep(signal, () => client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }, { abort: signal }))
    check(typeof response.epoch?.epoch === 'bigint' && response.epoch.epoch >= 0n && response.epoch.epoch < MAX, 'TRANSACTION_EPOCH_UNAVAILABLE')
    return response.epoch.epoch
  }
  async function ready(p: PrivateBookmarkPublicPlan, packet: PrivateBookmarkTransactionPacket | null, signing: boolean) {
    wallet(p); const signal = deadline()
    await profileReadStep(signal, () => readPrivateWalletBookmarksHead({ client, deployment: p.deployment, scope: p.scope, signal }))
    await profileReadStep(signal, () => preflight(p, signing))
    if (packet) check(await epoch(signal) <= BigInt(packet.expirationEpoch), 'TRANSACTION_EXPIRED_QUERY_ONLY')
    wallet(p)
  }
  async function signature(p: PrivateBookmarkPublicPlan, packet: PrivateBookmarkTransactionPacket) {
    check(packet.signature, 'TRANSACTION_SIGNATURE_REQUIRED')
    await profileReadStep(deadline(), () => verifyTransactionSignature(fromBase64(packet.bytes), packet.signature!, { address: p.scope.owner, client }))
    lifetime.throwIfAborted()
  }
  return {
    async prepare(input: PrivateBookmarkPublicPlan): Promise<PrivateBookmarkTransactionPacket> {
      const p = validatePrivateBookmarkPublicPlan(input); await ready(p, null, true)
      const signal = deadline(), expirationEpoch = String(await epoch(signal) + 1n), tx = buildCommitPrivateWalletBookmarksTx(p)
      tx.setSender(p.scope.owner); tx.setExpiration({ Epoch: expirationEpoch })
      const bytes = await profileReadStep(signal, () => tx.build({ client })); wallet(p)
      return validatePrivateBookmarkTransactionPacket(p, { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch,
        phase: 'PREPARED', signature: null })
    },
    async preflight(input: PrivateBookmarkPublicPlan, value: PrivateBookmarkTransactionPacket, signing: boolean) {
      const p = validatePrivateBookmarkPublicPlan(input), packet = validatePrivateBookmarkTransactionPacket(p, value)
      await ready(p, packet, signing)
    },
    async sign(input: PrivateBookmarkPublicPlan, value: PrivateBookmarkTransactionPacket) {
      const p = validatePrivateBookmarkPublicPlan(input), packet = validatePrivateBookmarkTransactionPacket(p, value)
      check(['PREPARED', 'SIGNING'].includes(packet.phase), 'TRANSACTION_NOT_SIGNABLE'); await ready(p, packet, true)
      const signed = await profileReadStep(lifetime, () => sign(Transaction.from(fromBase64(packet.bytes)))); wallet(p)
      check(signed.bytes === packet.bytes, 'TRANSACTION_WALLET_BYTES_CHANGED')
      const next = validatePrivateBookmarkTransactionPacket(p, { ...packet, phase: 'SIGNED', signature: signed.signature })
      await signature(p, next); wallet(p); return { bytes: next.bytes, signature: next.signature! }
    },
    async verifySignature(input: PrivateBookmarkPublicPlan, value: PrivateBookmarkTransactionPacket) {
      const p = validatePrivateBookmarkPublicPlan(input); await signature(p, validatePrivateBookmarkTransactionPacket(p, value))
      lifetime.throwIfAborted()
    },
    async broadcast(input: PrivateBookmarkPublicPlan, value: PrivateBookmarkTransactionPacket) {
      const p = validatePrivateBookmarkPublicPlan(input), packet = validatePrivateBookmarkTransactionPacket(p, value)
      check(packet.phase === 'SIGNED', 'TRANSACTION_NOT_SIGNED'); await ready(p, packet, false); await signature(p, packet); wallet(p)
      // An ambiguous submit retains this packet. Never rebuild/sign a replacement.
      await profileReadStep(deadline(), () => client.core.executeTransaction({ transaction: fromBase64(packet.bytes), signatures: [packet.signature!] }))
      wallet(p)
    },
    async query(input: PrivateBookmarkPublicPlan, value: PrivateBookmarkTransactionPacket): Promise<PrivateBookmarkTransactionStatus> {
      const p = validatePrivateBookmarkPublicPlan(input), packet = validatePrivateBookmarkTransactionPacket(p, value), signal = deadline()
      const finish = (status: PrivateBookmarkTransactionStatus) => { signal.throwIfAborted(); return status }
      // Read-only even when account writes are disabled; this captures actual
      // chain/package/registry authority, not a private library or a new signature.
      await profileReadStep(signal, () => readPrivateWalletBookmarksHead({ client, deployment: p.deployment, scope: p.scope, signal }))
      let row
      try { row = (await profileReadStep(signal, () => client.ledgerService.getTransaction({ digest: packet.digest,
        readMask: { paths: ['digest', 'transaction.bcs', 'transaction.digest', 'effects.bcs', 'effects.digest', 'effects.transaction_digest', 'effects.status', 'checkpoint'] },
      }, { abort: signal }))).response.transaction }
      catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return finish('MISSING'); throw error }
      check(row?.digest === packet.digest && row.transaction?.digest === packet.digest && row.transaction.bcs?.value instanceof Uint8Array
        && toBase64(row.transaction.bcs.value) === packet.bytes && row.effects?.bcs?.value instanceof Uint8Array
        && row.effects.bcs.value.length > 0 && row.effects.bcs.value.length <= 1024 * 1024, 'TRANSACTION_EVIDENCE_MISMATCH')
      const decoded = canonical(bcs.TransactionEffects, row.effects.bcs.value), e = decoded.V2 ?? decoded.V1!
      const effectsDigest = typedHash('TransactionEffects', row.effects.bcs.value)
      check(e.transactionDigest === packet.digest && row.effects.transactionDigest === packet.digest && row.effects.digest === effectsDigest
        && ['Success', 'Failure'].includes(e.status.$kind) && row.effects.status?.success === (e.status.$kind === 'Success')
        && BigInt(e.executedEpoch) <= BigInt(packet.expirationEpoch) && e.eventsDigest === null, 'TRANSACTION_EFFECTS_MISMATCH')
      if (row.checkpoint === undefined) return finish('PENDING')
      check(typeof row.checkpoint === 'bigint' && row.checkpoint >= 0n && row.checkpoint <= MAX, 'TRANSACTION_CHECKPOINT_INVALID')
      const checkpoint = await profileReadStep(signal, () => readActivityCheckpointEvidence({ client, chainIdentifier: p.deployment.chainIdentifier,
        checkpoint: String(row.checkpoint), signal }))
      check(checkpoint.epoch === e.executedEpoch && checkpoint.transactions.some(tx => tx.transactionDigest === packet.digest && tx.effectsDigest === effectsDigest), 'TRANSACTION_CHECKPOINT_MEMBERSHIP')
      if (e.status.$kind === 'Failure') return finish('FAILED')
      const fieldId = derivePrivateWalletBookmarksHeadFieldId(p.deployment.originalPackageId, p.scope)
      const refs = fieldRefs(decoded, fieldId, p.scope.registryId)
      if (!refs) {
        // A genuine same-request replay may leave the head untouched. A missing
        // or aged-out receipt stays uncertain; it never permits another payment.
        const current = await readPrivateWalletBookmarksHead({ client, deployment: p.deployment, scope: p.scope, signal })
        const receipt = current.head?.receipts.find(r => r.requestId === p.requestId)
        if (!receipt) return finish('PENDING')
        check(same(receipt.ciphertext, p.ciphertext) && BigInt(receipt.revision) === BigInt(p.expectedRevision) + 1n, 'TRANSACTION_REPLAY_MISMATCH')
        return finish('SUCCEEDED')
      }
      const readField = async (ref: ObjectRef, isOutput: boolean) => {
        const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId: fieldId, version: BigInt(ref.version),
          readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] } }, { abort: signal }))
        const raw = response.object
        check(raw?.objectId === fieldId && raw.version === BigInt(ref.version) && raw.bcs?.value instanceof Uint8Array
          && raw.bcs.value.length > 0 && raw.bcs.value.length <= 20 * 1024 && (!ref.digest || raw.digest === ref.digest), 'TRANSACTION_HISTORICAL_REFERENCE')
        const object = canonical(bcs.Object, raw.bcs.value), move = object.data.Move
        check(typedHash('Object', raw.bcs.value) === raw.digest && object.owner.$kind === 'ObjectOwner' && object.owner.ObjectOwner === p.scope.registryId
          && move?.version === ref.version && move.hasPublicTransfer === false && move.type.$kind === 'Other' && normalizeStructTag(TypeTagSerializer.tagToString({ struct: move.type.Other }))
            === normalizeStructTag(`0x2::dynamic_field::Field<${p.deployment.originalPackageId}::profile::BookmarksHeadKeyV1, ${p.deployment.originalPackageId}::profile::BookmarksHeadV1>`)
          && (!isOutput || object.previousTransaction === packet.digest), 'TRANSACTION_HISTORICAL_BCS')
        return headValue(canonical(PrivateWalletBookmarksHeadFieldV1Bcs, new Uint8Array(move.contents)), p, fieldId)
      }
      const before = refs.before ? await readField(refs.before, false) : null, after = await readField(refs.after, true)
      check(before ? before.revision === p.expectedRevision : p.expectedRevision === '0', 'TRANSACTION_PREDECESSOR_MISMATCH')
      const expected = { revision: String(BigInt(p.expectedRevision) + 1n), ciphertext: p.ciphertext,
        receipts: [...(before?.receipts ?? []).slice(-31), { requestId: p.requestId, revision: String(BigInt(p.expectedRevision) + 1n), ciphertext: p.ciphertext }] }
      check(!before?.receipts.some(r => r.requestId === p.requestId) && same(after, expected), 'TRANSACTION_HISTORICAL_RESULT_MISMATCH')
      return finish('SUCCEEDED')
    },
  }
}
