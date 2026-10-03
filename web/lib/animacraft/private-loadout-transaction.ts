import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { assertPrivateNamedLoadoutCapture, assertPrivateNamedLoadoutCipherRef, assertPrivateNamedLoadoutDeployment,
  assertPrivateNamedLoadoutHash, assertPrivateNamedLoadoutId, assertPrivateNamedLoadoutScope, assertPrivateNamedLoadoutU64,
  buildSavePrivateNamedLoadoutTx, buildUpdatePrivateNamedLoadoutTx, derivePrivateNamedLoadoutHeadFieldId,
  PrivateNamedLoadoutHeadFieldV1Bcs, SoulStatePublicBcs, readPrivateNamedLoadoutHead, profileReadStep,
  type PrivateNamedLoadoutCapture, type PrivateNamedLoadoutCipherRef, type PrivateNamedLoadoutDeployment,
  type PrivateNamedLoadoutScope } from '@soulidity/sdk'

/** Public metadata only. Names, content and plaintext mutation hashes must
 * never be included in this plan or its exact-byte transaction recovery packet. */
export interface PrivateLoadoutPublicPlan {
  deployment: PrivateNamedLoadoutDeployment; scope: PrivateNamedLoadoutScope
  expectedRevision: string; requestId: string; ciphertext: PrivateNamedLoadoutCipherRef
  capture: PrivateNamedLoadoutCapture | null; protocolId: string
}
export interface PrivateLoadoutTransactionPacket {
  bytes: string; digest: string; expirationEpoch: string
  phase: 'PREPARED' | 'SIGNING' | 'SIGNED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  signature: string | null
}
export type PrivateLoadoutTransactionStatus = 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'
const MAX_U64 = 18446744073709551615n
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`PRIVATE_LOADOUT_TRANSACTION_${code}`)
}
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key)), 'INVALID_FIELDS')
}
function digest(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
    && fromBase58(value).length === 32 && toBase58(fromBase58(value)) === value, 'INVALID_DIGEST')
}
function positive(value: unknown) {
  assertPrivateNamedLoadoutU64(value); check(BigInt(value) > 0n, 'INVALID_POSITIVE_U64')
}
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b)
const timeout = () => AbortSignal.timeout(40000)

export function validatePrivateLoadoutPublicPlan(input: unknown): PrivateLoadoutPublicPlan {
  const value = structuredClone(input) as PrivateLoadoutPublicPlan
  exact(value, ['deployment', 'scope', 'expectedRevision', 'requestId', 'ciphertext', 'capture', 'protocolId'])
  const deployment = assertPrivateNamedLoadoutDeployment(value.deployment), scope = assertPrivateNamedLoadoutScope(value.scope)
  assertPrivateNamedLoadoutU64(value.expectedRevision); assertPrivateNamedLoadoutHash(value.requestId)
  assertPrivateNamedLoadoutId(value.protocolId)
  check(BigInt(value.expectedRevision) < MAX_U64, 'REVISION_EXHAUSTED')
  const ciphertext = assertPrivateNamedLoadoutCipherRef(value.ciphertext)
  const capture = value.capture === null ? null : assertPrivateNamedLoadoutCapture(value.capture)
  check(new Set([scope.soulId, scope.stateId, value.protocolId, ...(capture ? [capture.equipmentId] : [])]).size
    === (capture ? 4 : 3), 'OBJECT_ALIAS')
  return { deployment, scope, expectedRevision: value.expectedRevision, requestId: value.requestId,
    ciphertext, capture, protocolId: value.protocolId }
}
function build(plan: PrivateLoadoutPublicPlan) {
  return plan.capture ? buildSavePrivateNamedLoadoutTx({ ...plan, capture: plan.capture }) : buildUpdatePrivateNamedLoadoutTx(plan)
}

/** Accept only the one SDK head-CAS call, including exact pure bytes and shared
 * mutability. This validator never resolves objects or rebuilds saved bytes. */
export function validatePrivateLoadoutTransactionPacket(planInput: PrivateLoadoutPublicPlan, input: unknown): PrivateLoadoutTransactionPacket {
  const plan = validatePrivateLoadoutPublicPlan(planInput), packet = structuredClone(input) as PrivateLoadoutTransactionPacket
  exact(packet, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature'])
  assertPrivateNamedLoadoutU64(packet.expirationEpoch); digest(packet.digest)
  check(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(packet.phase), 'INVALID_PHASE')
  check(packet.signature === null || typeof packet.signature === 'string' && packet.signature.length > 0
    && packet.signature.length <= 32768 && toBase64(fromBase64(packet.signature)) === packet.signature, 'INVALID_SIGNATURE')
  check(packet.phase !== 'SIGNED' || packet.signature !== null, 'SIGNATURE_REQUIRED')
  check(!['PREPARED', 'SIGNING', 'CANCELLED'].includes(packet.phase) || packet.signature === null, 'UNEXPECTED_SIGNATURE')
  check(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 180000, 'BYTE_BUDGET')
  const bytes = fromBase64(packet.bytes), raw = bcs.TransactionData.parse(bytes)
  check(raw.V1 && toBase64(bytes) === packet.bytes && toBase64(bcs.TransactionData.serialize(raw).toBytes()) === packet.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest, 'BYTES_DIGEST_MISMATCH')
  const data = Transaction.from(bytes).getData(), expected = build(plan).getData()
  check(data.sender === plan.scope.owner && data.gasData.owner === plan.scope.owner
    && String(raw.V1.expiration.Epoch) === packet.expirationEpoch, 'SENDER_EXPIRATION_MISMATCH')
  positive(data.gasData.budget); positive(data.gasData.price)
  const payments = data.gasData.payment
  check(payments && payments.length > 0 && payments.length <= 256, 'GAS_REQUIRED')
  const reserved = [plan.scope.soulId, plan.scope.stateId, plan.protocolId, plan.ciphertext.blobObjectId,
    plan.deployment.callablePackageId, plan.deployment.originalPackageId, ...(plan.capture ? [plan.capture.equipmentId] : [])]
  check(new Set(payments.map(row => row.objectId)).size === payments.length, 'DUPLICATE_GAS')
  payments.forEach(row => {
    assertPrivateNamedLoadoutId(row.objectId); positive(row.version); digest(row.digest)
    check(!reserved.includes(row.objectId), 'GAS_OVERLAP')
  })
  const call = data.commands[0]?.MoveCall, wanted = expected.commands[0].MoveCall!
  check(data.commands.length === 1 && data.inputs.length === expected.inputs.length && call
    && call.package === wanted.package && call.module === wanted.module && call.function === wanted.function
    && call.typeArguments.length === 0 && call.arguments.length === wanted.arguments.length, 'COMMAND_MISMATCH')
  const indices = new Map<number, number>(), used = new Set<number>()
  wanted.arguments.forEach((argument, index) => {
    const actual = call.arguments[index]
    check(argument.$kind === 'Input' && actual.$kind === 'Input', 'ARGUMENT_MISMATCH')
    if (indices.has(argument.Input)) check(indices.get(argument.Input) === actual.Input, 'INPUT_ALIAS')
    else { check(!used.has(actual.Input), 'INPUT_ALIAS'); indices.set(argument.Input, actual.Input); used.add(actual.Input) }
    const expectedInput = expected.inputs[argument.Input], input = data.inputs[actual.Input]
    if (expectedInput.Pure) check(input?.Pure?.bytes === expectedInput.Pure.bytes, 'PURE_ARGUMENT_MISMATCH')
    else {
      const objectId = expectedInput.UnresolvedObject?.objectId, shared = input?.Object?.SharedObject
      check(objectId && shared?.objectId === objectId && shared.mutable === (objectId === plan.scope.stateId), 'SHARED_ARGUMENT_MISMATCH')
      positive(shared.initialSharedVersion)
    }
  })
  check(used.size === data.inputs.length, 'UNUSED_INPUT')
  return packet
}

type Effects = ReturnType<typeof bcs.TransactionEffects.parse>
type Raw = NonNullable<Awaited<ReturnType<SuiGrpcClient['ledgerService']['getObject']>>['response']['object']>
type Ref = { version: bigint; digest: string; owner: any; created: boolean }
/** Effects, not a current object version, select the historical read. */
function output(effects: Effects, id: string): Ref | null {
  if (effects.V2) {
    const rows = effects.V2.changedObjects.filter(([objectId]) => objectId === id)
    check(rows.length <= 1, 'DUPLICATE_EFFECTS_OBJECT')
    check(!effects.V2.unchangedConsensusObjects.some(([objectId]) => objectId === id), 'CONFLICTING_EFFECTS_OBJECT')
    if (!rows.length) return null
    const change = rows[0][1], write = change.outputState.ObjectWrite
    check(write && ['Created', 'None'].includes(change.idOperation.$kind), 'INVALID_OBJECT_WRITE')
    const version = BigInt(effects.V2.lamportVersion)
    check(version > 0n && version <= MAX_U64, 'INVALID_OUTPUT_VERSION')
    check(change.idOperation.$kind === 'Created' ? change.inputState.$kind === 'NotExist'
      : change.inputState.Exist && BigInt(change.inputState.Exist[0][0]) > 0n && BigInt(change.inputState.Exist[0][0]) < version
        && same(change.inputState.Exist[1], write[1]),
    'INVALID_WRITE_LINEAGE')
    digest(write[0]); return { version, digest: write[0], owner: write[1], created: change.idOperation.$kind === 'Created' }
  }
  check(effects.V1, 'UNSUPPORTED_EFFECTS')
  const rows = [...effects.V1.created, ...effects.V1.mutated].filter(([ref]) => ref.objectId === id)
  check(rows.length <= 1, 'DUPLICATE_EFFECTS_OBJECT')
  const modified = effects.V1.modifiedAtVersions.filter(([objectId]) => objectId === id)
  // Missing created/mutated output is a no-op only when effects contain no
  // contradictory lifetime change or input modification for this same object.
  check(![...effects.V1.deleted, ...effects.V1.wrapped, ...effects.V1.unwrappedThenDeleted].some(row => row.objectId === id)
    && !effects.V1.unwrapped.some(([row]) => row.objectId === id), 'CONFLICTING_EFFECTS_OBJECT')
  if (!rows.length) { check(modified.length === 0, 'INVALID_WRITE_LINEAGE'); return null }
  const [ref, owner] = rows[0]; positive(ref.version); digest(ref.digest)
  const created = effects.V1.created.some(([row]) => row.objectId === id)
  check(created ? modified.length === 0 : modified.length === 1 && BigInt(modified[0][1]) > 0n
    && BigInt(modified[0][1]) < BigInt(ref.version), 'INVALID_WRITE_LINEAGE')
  return { version: BigInt(ref.version), digest: ref.digest, owner, created }
}
function decode<C extends { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }>(codec: C, bytes: Uint8Array): ReturnType<C['parse']> {
  const result = codec.parse(bytes)
  check(toBase64(codec.serialize(result).toBytes()) === toBase64(bytes), 'NONCANONICAL_OBJECT_BCS')
  return result
}
function matchCipher(raw: any, plan: PrivateLoadoutPublicPlan) {
  const cipher = assertPrivateNamedLoadoutCipherRef({ blobObjectId: raw.blob_object_id, blobId: raw.blob_id,
    sha256: toHex(new Uint8Array(raw.sha256)), byteLength: raw.byte_length })
  return same(cipher, plan.ciphertext)
}
function matchCapture(raw: any, plan: PrivateLoadoutPublicPlan) {
  const capture = raw === null ? null : assertPrivateNamedLoadoutCapture({ equipmentId: raw.equipment_id,
    revision: raw.revision, commitment: toHex(new Uint8Array(raw.commitment)) })
  return same(capture, plan.capture)
}

export function createPrivateLoadoutTransactionAdapter(params: {
  client: SuiGrpcClient; getAddress: () => string | null
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
  /** Root owns the release gates and fresh owner/head/capture checks. Mandatory
   * before preparation/signing/broadcast, never during query-only recovery. */
  preflight: (plan: PrivateLoadoutPublicPlan, signing: boolean) => Promise<void>
}) {
  const { client, getAddress, sign, preflight } = params
  async function chain(plan: PrivateLoadoutPublicPlan, signal: AbortSignal) {
    const { chainIdentifier } = await profileReadStep(signal, () => client.core.getChainIdentifier())
    digest(chainIdentifier)
    check(toHex(fromBase58(chainIdentifier).subarray(0, 4)) === plan.deployment.chainIdentifier, 'WRONG_CHAIN')
  }
  async function epoch(signal: AbortSignal) {
    const { response } = await profileReadStep(signal, () => client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }, { abort: signal }))
    check(typeof response.epoch?.epoch === 'bigint' && response.epoch.epoch >= 0n && response.epoch.epoch < MAX_U64, 'EPOCH_UNAVAILABLE')
    return response.epoch.epoch
  }
  const wallet = (plan: PrivateLoadoutPublicPlan) => check(getAddress() === plan.scope.owner, 'WALLET_CHANGED')
  async function ready(plan: PrivateLoadoutPublicPlan, packet: PrivateLoadoutTransactionPacket | null, signing: boolean) {
    const signal = timeout(); wallet(plan); await chain(plan, signal)
    await profileReadStep(signal, () => preflight(structuredClone(plan), signing))
    if (packet) check(await epoch(signal) <= BigInt(packet.expirationEpoch), 'EXPIRED_QUERY_ONLY')
    wallet(plan)
  }
  async function signature(plan: PrivateLoadoutPublicPlan, packet: PrivateLoadoutTransactionPacket) {
    check(packet.signature, 'SIGNATURE_REQUIRED')
    await verifyTransactionSignature(fromBase64(packet.bytes), packet.signature, { address: plan.scope.owner, client })
  }
  return {
    async prepare(input: PrivateLoadoutPublicPlan): Promise<PrivateLoadoutTransactionPacket> {
      const plan = validatePrivateLoadoutPublicPlan(input)
      await ready(plan, null, true)
      const signal = timeout(), expirationEpoch = String(await epoch(signal) + 1n), tx = build(plan)
      tx.setSender(plan.scope.owner); tx.setExpiration({ Epoch: expirationEpoch })
      // The real SDK build resolves object versions/gas and estimates its gas
      // budget. No signing, payment or execution occurs during preparation.
      const bytes = await profileReadStep(signal, () => tx.build({ client }))
      wallet(plan)
      return validatePrivateLoadoutTransactionPacket(plan, { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes),
        expirationEpoch, phase: 'PREPARED', signature: null })
    },
    async preflight(input: PrivateLoadoutPublicPlan, value: PrivateLoadoutTransactionPacket, signing: boolean) {
      const plan = validatePrivateLoadoutPublicPlan(input), packet = validatePrivateLoadoutTransactionPacket(plan, value)
      await ready(plan, packet, signing)
    },
    async sign(input: PrivateLoadoutPublicPlan, value: PrivateLoadoutTransactionPacket) {
      const plan = validatePrivateLoadoutPublicPlan(input), packet = validatePrivateLoadoutTransactionPacket(plan, value)
      check(['PREPARED', 'SIGNING'].includes(packet.phase), 'NOT_SIGNABLE')
      await ready(plan, packet, true)
      const signed = await sign(Transaction.from(fromBase64(packet.bytes)))
      wallet(plan); check(signed.bytes === packet.bytes, 'WALLET_BYTES_CHANGED')
      const result = validatePrivateLoadoutTransactionPacket(plan, { ...packet, phase: 'SIGNED', signature: signed.signature })
      await signature(plan, result)
      return { bytes: result.bytes, signature: result.signature! }
    },
    async verifySignature(input: PrivateLoadoutPublicPlan, value: PrivateLoadoutTransactionPacket) {
      const plan = validatePrivateLoadoutPublicPlan(input), packet = validatePrivateLoadoutTransactionPacket(plan, value)
      await signature(plan, packet)
    },
    async broadcast(input: PrivateLoadoutPublicPlan, value: PrivateLoadoutTransactionPacket) {
      const plan = validatePrivateLoadoutPublicPlan(input), packet = validatePrivateLoadoutTransactionPacket(plan, value)
      check(packet.phase === 'SIGNED', 'NOT_SIGNED'); await ready(plan, packet, false); await signature(plan, packet); wallet(plan)
      // Do not abort-race execution: an uncertain result must retain the exact
      // signed packet and query the same digest, never rebuild or sign again.
      await client.core.executeTransaction({ transaction: fromBase64(packet.bytes), signatures: [packet.signature!] })
    },
    async query(input: PrivateLoadoutPublicPlan, packetInput: PrivateLoadoutTransactionPacket): Promise<PrivateLoadoutTransactionStatus> {
      const plan = validatePrivateLoadoutPublicPlan(input), packet = validatePrivateLoadoutTransactionPacket(plan, packetInput), signal = timeout()
      await chain(plan, signal)
      let response
      try {
        response = (await profileReadStep(signal, () => client.ledgerService.getTransaction({ digest: packet.digest,
          readMask: { paths: ['digest', 'transaction.digest', 'transaction.bcs', 'effects.bcs', 'effects.transaction_digest', 'effects.status', 'checkpoint'] },
        }, { abort: signal }))).response
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return 'MISSING'
        throw error
      }
      const value = response.transaction
      check(value?.digest === packet.digest && value.transaction?.digest === packet.digest
        && value.transaction.bcs?.value && toBase64(value.transaction.bcs.value) === packet.bytes
        && value.effects?.transactionDigest === packet.digest && value.effects.bcs?.value, 'EVIDENCE_MISMATCH')
      check(value.effects.bcs.value.length > 0 && value.effects.bcs.value.length <= 256 * 1024, 'EFFECTS_BYTE_BUDGET')
      const decoded = decode(bcs.TransactionEffects, value.effects.bcs.value), effects = decoded.V2 ?? decoded.V1
      check(effects?.transactionDigest === packet.digest && ['Success', 'Failure'].includes(effects.status.$kind)
        && value.effects.status?.success === (effects.status.$kind === 'Success')
        && BigInt(effects.executedEpoch) <= BigInt(packet.expirationEpoch), 'STATUS_MISMATCH')
      if (value.checkpoint === undefined) return 'PENDING'
      check(typeof value.checkpoint === 'bigint' && value.checkpoint >= 0n && value.checkpoint <= MAX_U64, 'CHECKPOINT_INVALID')
      if (effects.status.$kind === 'Failure') return 'FAILED'
      const historical = async (objectId: string, ref: Ref, type: string, maximum: number): Promise<Raw> => {
        const read = async () => {
          const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId, version: ref.version,
            readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents'] } }, { abort: signal }))
          const row = structuredClone(response.object)
          check(row?.objectId === objectId && row.version === ref.version && row.digest === ref.digest
            && row.objectType === normalizeStructTag(type) && row.contents?.value instanceof Uint8Array
            && row.contents.value.length > 0 && row.contents.value.length <= maximum, 'HISTORICAL_OBJECT_MISMATCH')
          if (ref.owner.Shared) check(row.owner?.kind === 3 && String(row.owner.version) === ref.owner.Shared.initialSharedVersion, 'HISTORICAL_OWNER_MISMATCH')
          else check(ref.owner.ObjectOwner && row.owner?.kind === 2 && row.owner.address === ref.owner.ObjectOwner, 'HISTORICAL_OWNER_MISMATCH')
          return row
        }
        const row = await read(), again = await read()
        check(toBase64(row.contents!.value!) === toBase64(again.contents!.value!), 'HISTORICAL_BYTES_CHANGED')
        return row
      }
      const stateRef = output(decoded, plan.scope.stateId)
      const shared = Transaction.from(fromBase64(packet.bytes)).getData().inputs
        .flatMap(input => input.Object?.SharedObject ? [input.Object.SharedObject] : []).find(input => input.objectId === plan.scope.stateId)!
      check(stateRef && !stateRef.created && stateRef.owner.Shared?.initialSharedVersion === shared.initialSharedVersion
        && BigInt(shared.initialSharedVersion) < stateRef.version, 'STATE_EFFECTS_MISMATCH')
      const stateRaw = await historical(plan.scope.stateId, stateRef, `${plan.deployment.originalPackageId}::soul::SoulState`, 8192)
      const state = decode(SoulStatePublicBcs, stateRaw.contents!.value!)
      check(state.id === plan.scope.stateId && state.version === '1' && state.soul_id === plan.scope.soulId
        && state.current_owner === plan.scope.owner && state.ownership_epoch === plan.scope.ownershipEpoch, 'HISTORICAL_SCOPE_MISMATCH')
      const fieldId = derivePrivateNamedLoadoutHeadFieldId(plan.deployment.originalPackageId, plan.scope.stateId), headRef = output(decoded, fieldId)
      if (!headRef) {
        // A receipt replay can leave the child untouched. A current exact-scope
        // receipt plus historical State proves this limited no-op case. If the
        // receipt aged out or ownership rotated, keep query-only uncertainty.
        let current
        try { current = await readPrivateNamedLoadoutHead({ client, deployment: plan.deployment, scope: plan.scope, signal }) }
        catch (error) {
          if (error instanceof Error && error.message === 'PRIVATE_NAMED_LOADOUT_OWNER_EPOCH_CHANGED') return 'PENDING'
          throw error
        }
        const receipt = current.head?.receipts.find(row => row.requestId === plan.requestId)
        if (!receipt) return 'PENDING'
        check(same(receipt.ciphertext, plan.ciphertext) && same(receipt.capture, plan.capture), 'REPLAY_RECEIPT_MISMATCH')
        return 'SUCCEEDED'
      }
      check(headRef.owner.ObjectOwner === plan.scope.stateId && (!headRef.created || plan.expectedRevision === '0'), 'HEAD_EFFECTS_OWNER_MISMATCH')
      const pkg = plan.deployment.originalPackageId
      const headRaw = await historical(fieldId, headRef, `0x2::dynamic_field::Field<${pkg}::soul::NamedLoadoutHeadKeyV1,${pkg}::named_loadout_v1::HeadV1>`, 16384)
      const field = decode(PrivateNamedLoadoutHeadFieldV1Bcs, headRaw.contents!.value!), head = field.value
      check(field.id === fieldId && field.name.version === 1 && head.version === 1 && head.soul_id === plan.scope.soulId
        && head.state_id === plan.scope.stateId && head.owner === plan.scope.owner && head.ownership_epoch === plan.scope.ownershipEpoch
        && BigInt(head.revision) === BigInt(plan.expectedRevision) + 1n && matchCipher(head.ciphertext, plan), 'HISTORICAL_HEAD_MISMATCH')
      check(head.receipts.length === Number(BigInt(head.revision) < 32n ? BigInt(head.revision) : 32n), 'RECEIPT_WINDOW_MISMATCH')
      const ids = new Set<string>()
      for (const [index, row] of head.receipts.entries()) {
        const request = toHex(new Uint8Array(row.request_id)); assertPrivateNamedLoadoutHash(request)
        check(!ids.has(request) && BigInt(row.revision) === BigInt(head.revision) - BigInt(head.receipts.length - index - 1), 'RECEIPT_ORDER_MISMATCH')
        // Validate every bounded old receipt, not only the matching last row.
        matchCipher(row.ciphertext, plan); matchCapture(row.capture, plan)
        ids.add(request)
      }
      const last = head.receipts.at(-1)!
      check(toHex(new Uint8Array(last.request_id)) === plan.requestId && last.revision === head.revision
        && matchCipher(last.ciphertext, plan) && matchCapture(last.capture, plan), 'HISTORICAL_RECEIPT_MISMATCH')
      signal.throwIfAborted(); return 'SUCCEEDED'
    },
  }
}
