import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { readActivityCheckpointEvidence } from '../soulidity/activity-transaction-evidence'
import { readHistoricalMoveObject, readHistoricalFailedSharedRoot, historicalObjectOutput } from './historical-object'

function hash(domain: string, bytes: Uint8Array) {
  const prefix = new TextEncoder().encode(`${domain}::`), value = new Uint8Array(prefix.length + bytes.length)
  value.set(prefix); value.set(bytes, prefix.length); return toBase58(blake2b(value, { dkLen: 32 }))
}
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`HISTORICAL_PARENT_${code}`) }
/** Authenticated-ledger original success/failure effects for one original ancestor. This proves
 * bytes/checkpoint membership, NOT validator quorum, business success or code
 * qualification. Failure stays Failure throughout object verification. */
export async function readHistoricalParentTransaction(input: {
  client: SuiGrpcClient; transactionDigest: string; maxCheckpoint: string; chainIdentifier: string; genesisDigest: string; signal: AbortSignal
}) {
  const { client, transactionDigest, maxCheckpoint, chainIdentifier, genesisDigest, signal } = input
  check(/^(0|[1-9][0-9]{0,19})$/.test(maxCheckpoint) && BigInt(maxCheckpoint) <= 18446744073709551615n, 'CHECKPOINT_BOUND')
  const info = await client.ledgerService.getServiceInfo({}, { abort: signal })
  check(info.response.chainId === genesisDigest, 'CHAIN')
  const response = await client.ledgerService.getTransaction({ digest: transactionDigest, readMask: { paths: [
    'digest', 'transaction.digest', 'transaction.bcs', 'effects.bcs', 'effects.transaction_digest', 'effects.status', 'checkpoint',
  ] } }, { abort: signal })
  const row = structuredClone(response.response.transaction), bytes = row?.transaction?.bcs?.value, raw = row?.effects?.bcs?.value
  check(row?.digest === transactionDigest && row.transaction?.digest === transactionDigest && bytes instanceof Uint8Array
    && bytes.length > 0 && bytes.length <= 1024 * 1024 && raw instanceof Uint8Array && raw.length > 0 && raw.length <= 1024 * 1024, 'TRANSACTION_RAW')
  const tx = bcs.TransactionData.parse(bytes), effects = bcs.TransactionEffects.parse(raw), e = effects.V2
  check(toBase64(bcs.TransactionData.serialize(tx).toBytes()) === toBase64(bytes)
    && TransactionDataBuilder.getDigestFromBytes(bytes) === transactionDigest
    && toBase64(bcs.TransactionEffects.serialize(effects).toBytes()) === toBase64(raw)
    && e?.transactionDigest === transactionDigest && row.effects?.transactionDigest === transactionDigest
    && row.effects.status?.success === (e.status.$kind === 'Success'), 'TRANSACTION_CANONICAL')
  check(row.checkpoint !== undefined && row.checkpoint >= 0n && row.checkpoint <= BigInt(maxCheckpoint), 'TRANSACTION_CHECKPOINT')
  const checkpoint = String(row.checkpoint), proof = await readActivityCheckpointEvidence({ client, chainIdentifier, checkpoint, signal })
  const members = proof.transactions.filter(v => v.transactionDigest === transactionDigest)
  check(members.length === 1 && members[0].effectsDigest === hash('TransactionEffects', raw) && proof.epoch === e.executedEpoch, 'CHECKPOINT_MEMBERSHIP')
  check(['Success', 'Failure'].includes(e.status.$kind), 'EXECUTION_STATUS')
  check(e.changedObjects.length <= 16384 && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length
    && new Set(e.unchangedConsensusObjects.map(([id]) => id)).size === e.unchangedConsensusObjects.length
    && e.unchangedConsensusObjects.every(([id]) => !e.changedObjects.some(([other]) => other === id)), 'EFFECT_ALIASES')
  signal.throwIfAborted()
  const inputs = Transaction.from(bytes).getData().inputs
  const ownedInputs = inputs.flatMap(i => i.Object?.ImmOrOwnedObject ? [structuredClone(i.Object.ImmOrOwnedObject)] : [])
  const sharedInputs = inputs.flatMap(i => i.Object?.SharedObject ? [i.Object.SharedObject] : [])
  return { effects, checkpoint, transactionDigest, sharedInputs, ownedInputs, transactionBytes: new Uint8Array(bytes), executionStatus: e.status.$kind }
}

/** Find a direct dynamic-field object's original value at an authenticated
 * SHARED parent-root snapshot. Walk only exact root version/digest/previousTx
 * links. Every ancestor must be finalized and every intermediate root must
 * still contain the same parent UID (domain callback must decode real layout).
 * Caller first authenticates anchor effects/finality and validates the exact
 * typed key/derived child ID. No current object/DF lookup or journal writes.
 * Bounded/incomplete history throws; failure only crosses a proven unchanged
 * Shared root with no target-child effect. Never converted to absent/retry/pay.
 * Requires Sui's exclusive mutable parent ownership rules; not a proof for
 * arbitrary borrowed descendants or non-exclusive write roots.
 */
export async function readHistoricalChildThroughParent(input: {
  client: SuiGrpcClient; anchorEffects: ReturnType<typeof bcs.TransactionEffects.parse>; anchorTransactionDigest: string
  anchorMode: 'readonly' | 'input' | 'written'; anchorCheckpoint: string; rootId: string; rootType: string
  parentUid: string; childId: string; childType: string; chainIdentifier: string; genesisDigest: string; signal: AbortSignal
  assertContainsParent: (rootBytes: Uint8Array, parentUid: string) => void; maxHops?: number
}) {
  const { client, rootId, rootType, parentUid, childId, childType, assertContainsParent, chainIdentifier, genesisDigest } = input
  const anchorEffects = structuredClone(input.anchorEffects), digest = input.anchorTransactionDigest, anchorMode = input.anchorMode
  const maxHops = input.maxHops ?? 64, signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  check(Number.isSafeInteger(maxHops) && maxHops >= 1 && maxHops <= 256 && typeof assertContainsParent === 'function', 'BOUNDS')
  check([rootId, parentUid, childId].every(id => /^0x[0-9a-f]{64}$/.test(id) && BigInt(id) !== 0n), 'ROLE_ID')
  check(new Set([rootId, childId]).size === 2 && parentUid !== childId, 'ROLE_ALIAS')
  let root = await readHistoricalMoveObject({ client, effects: anchorEffects, transactionDigest: digest,
    objectId: rootId, type: rootType, mode: anchorMode, signal, maxBytes: 256 * 1024 })
  let maxCheckpoint = input.anchorCheckpoint, totalBytes = 0
  const seen = new Set<string>(), trail: Array<{ rootVersion: string; transactionDigest: string; checkpoint: string; executionStatus: 'Success' | 'Failure' }> = []
  for (let hop = 0; hop < maxHops; hop++) {
    signal.throwIfAborted(); check(root.object.owner.Shared, 'SHARED_ROOT_REQUIRED')
    totalBytes += root.bytes.length; check(totalBytes <= 16 * 1024 * 1024, 'BYTE_BUDGET')
    assertContainsParent(new Uint8Array(root.bytes), parentUid)
    const previousTx = root.object.previousTransaction
    check(!seen.has(previousTx), 'TRANSACTION_CYCLE'); seen.add(previousTx)
    const ancestor = await readHistoricalParentTransaction({ client, transactionDigest: previousTx, maxCheckpoint, chainIdentifier, genesisDigest, signal })
    const failed = ancestor.executionStatus === 'Failure'
    const failedOutput = failed ? await readHistoricalFailedSharedRoot({ client, effects: ancestor.effects, transactionDigest: previousTx,
      objectId: rootId, type: rootType, mode: 'mutated', signal, maxBytes: 256 * 1024 }) : null
    const current = failedOutput?.reference ?? historicalObjectOutput(ancestor.effects, rootId)
    check(current.version === root.reference.version && current.digest === root.reference.digest
      && current.owner.Shared?.initialSharedVersion === root.object.owner.Shared.initialSharedVersion, 'ROOT_LINK')
    if (current.created) check(!ancestor.sharedInputs.some(ref => ref.objectId === rootId), 'CREATED_ROOT_INPUT_ALIAS')
    if (!current.created) {
      const refs = ancestor.sharedInputs.filter(ref => ref.objectId === rootId)
      check(refs.length === 1 && refs[0].mutable === true
        && String(refs[0].initialSharedVersion) === root.object.owner.Shared.initialSharedVersion, 'EXCLUSIVE_ROOT_INPUT_REQUIRED')
    }
    trail.push({ rootVersion: String(current.version), transactionDigest: previousTx, checkpoint: ancestor.checkpoint, executionStatus: failed ? 'Failure' : 'Success' })
    const field = ancestor.effects.V2!.changedObjects.find(([id]) => id === childId)
    if (failed) check(!field, 'FAILED_CHILD_CHANGE')
    if (field) {
      check(field[1].outputState.$kind === 'ObjectWrite', 'CHILD_ABSENT_OR_NOT_STORED')
      const child = await readHistoricalMoveObject({ client, effects: ancestor.effects, transactionDigest: previousTx,
        objectId: childId, type: childType, mode: 'written', signal, maxBytes: 256 * 1024 })
      check(child.object.owner.ObjectOwner === parentUid, 'CHILD_PARENT')
      signal.throwIfAborted()
      return { proof: 'original-child-through-shared-parent-lineage-only' as const, rootId, parentUid, childId,
        bytes: child.bytes, reference: child.reference, writerTransactionDigest: previousTx, trail,
        notCurrentAuthority: true as const, notBusinessReceipt: true as const }
    }
    check(!current.created, 'CHILD_NOT_FOUND_AT_ROOT_CREATION')
    const prior = await (failed ? readHistoricalFailedSharedRoot : readHistoricalMoveObject)({ client, effects: ancestor.effects, transactionDigest: previousTx,
      objectId: rootId, type: rootType, mode: 'input', signal, maxBytes: 256 * 1024 })
    if (failed) check(toBase64(prior.bytes) === toBase64(root.bytes)
      && prior.object.data.Move?.hasPublicTransfer === root.object.data.Move?.hasPublicTransfer, 'FAILED_ROOT_PAYLOAD_CHANGED')
    check(prior.reference.version < current.version && prior.object.owner.Shared?.initialSharedVersion === root.object.owner.Shared.initialSharedVersion,
      'ROOT_INPUT_LINK')
    root = prior; maxCheckpoint = ancestor.checkpoint
  }
  throw Error('HISTORICAL_PARENT_HOP_BUDGET_EXHAUSTED')
}
