import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toBase64 } from '@mysten/sui/utils'
import { historicalObjectOutput, readHistoricalMoveObject, readHistoricalFailedSharedRoot } from '../../sui/historical-object'
import { readHistoricalChildThroughParent, readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'

function check(value: unknown, code: string): asserts value { if (!value) throw Error(`COMMERCE_SHARED_BRANCH_${code}`) }

/** Review candidate, not a qualified shared capability. The branch is a real
 * direct typed DOF below a physically contained parent UID; the target is
 * ObjectOwned by that branch's UID. The branch UID is NEVER claimed to be
 * physically embedded in the root. Source qualification must prove every
 * branch/target mutation commits this exclusive Shared root. This candidate
 * cannot clear that invariant or prove arbitrary recursive descendants.
 * Caller authenticates original anchor effects/checkpoint and derives/checks
 * the exact typed branch key/value and target identity in domain callbacks.
 */
export async function readHistoricalSharedOwnedBranchCandidate(input: {
  client: SuiGrpcClient; anchorEffects: ReturnType<typeof bcs.TransactionEffects.parse>; anchorTransactionDigest: string
  anchorCheckpoint: string; anchorMode: 'input' | 'readonly' | 'written'; rootId: string; rootType: string
  rootParentUid: string; branchId: string; branchType: string; targetId: string; targetType: string
  chainIdentifier: string; genesisDigest: string; signal: AbortSignal; maxHops?: number
  assertContainsParent: (rootBytes: Uint8Array, uid: string) => void
  assertBranch: (branchBytes: Uint8Array, targetId: string) => void
  assertTarget: (targetBytes: Uint8Array) => void
}) {
  const saved = { ...input, anchorEffects: structuredClone(input.anchorEffects) }, source = input.client.ledgerService
  const client = { ledgerService: { getServiceInfo: source.getServiceInfo.bind(source), getTransaction: source.getTransaction.bind(source),
    getCheckpoint: source.getCheckpoint.bind(source), getObject: source.getObject.bind(source) } } as unknown as SuiGrpcClient
  const { rootId, rootType, rootParentUid, branchId, branchType, targetId, targetType, assertContainsParent, assertBranch, assertTarget } = saved
  const maxHops = saved.maxHops ?? 64, signal = AbortSignal.any([saved.signal, AbortSignal.timeout(60000)])
  const id = (v: string) => /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) !== 0n
  check([rootId, rootParentUid, branchId, targetId].every(id) && new Set([rootId, branchId, targetId]).size === 3
    && rootParentUid !== branchId && rootParentUid !== targetId, 'ROLES')
  check(Number.isSafeInteger(maxHops) && maxHops >= 1 && maxHops <= 64
    && [assertContainsParent, assertBranch, assertTarget].every(v => typeof v === 'function'), 'BOUND')
  check(!saved.anchorEffects.V2?.changedObjects.some(([id]) => id === branchId || id === targetId), 'ANCHOR_BRANCH_OR_TARGET_CHANGED')
  const ancestors = new Map<string, Awaited<ReturnType<typeof readHistoricalParentTransaction>>>()
  const readAncestor = async (transactionDigest: string, maxCheckpoint: string) => {
    let ancestor = ancestors.get(transactionDigest)
    if (!ancestor) {
      ancestor = await readHistoricalParentTransaction({ client, transactionDigest, maxCheckpoint,
        chainIdentifier: saved.chainIdentifier, genesisDigest: saved.genesisDigest, signal })
      const transaction = Transaction.from(ancestor.transactionBytes).getData()
      check(!ancestor.ownedInputs.some(v => v.objectId === rootId)
        && !transaction.inputs.some(v => v.Object?.Receiving?.objectId === rootId)
        && !transaction.gasData.payment?.some(v => v.objectId === rootId), 'ROOT_INPUT_ALIAS')
      ancestors.set(transactionDigest, ancestor)
    }
    check(BigInt(ancestor.checkpoint) <= BigInt(maxCheckpoint), 'CACHED_CHECKPOINT_BOUND')
    return ancestor
  }
  const initialBranch = await readHistoricalChildThroughParent({ client, anchorEffects: saved.anchorEffects,
    anchorTransactionDigest: saved.anchorTransactionDigest, anchorCheckpoint: saved.anchorCheckpoint, anchorMode: saved.anchorMode,
    rootId, rootType, parentUid: rootParentUid, childId: branchId, childType: branchType, chainIdentifier: saved.chainIdentifier,
    genesisDigest: saved.genesisDigest, signal, maxHops, assertContainsParent })
  // The direct branch proof can walk deeper than the nearest target writer.
  // Guard EVERY transaction it relied on, including roots never reached by
  // the target loop below; source qualification does not waive input aliases.
  for (const step of initialBranch.trail) {
    const ancestor = await readAncestor(step.transactionDigest, step.checkpoint)
    check(ancestor.checkpoint === step.checkpoint, 'BRANCH_CHECKPOINT_CHANGED')
  }
  assertBranch(new Uint8Array(initialBranch.bytes), targetId)
  let branch = initialBranch.reference
  let root = await readHistoricalMoveObject({ client, effects: saved.anchorEffects, transactionDigest: saved.anchorTransactionDigest,
    objectId: rootId, type: rootType, mode: saved.anchorMode, signal, maxBytes: 256 * 1024 })
  const seen = new Set<string>(), trail: Array<{ rootVersion: string; transactionDigest: string; checkpoint: string; executionStatus: 'Success' | 'Failure' }> = []
  let maxCheckpoint = saved.anchorCheckpoint, totalBytes = 0
  for (let hop = 0; hop < maxHops; hop++) {
    signal.throwIfAborted(); check(root.object.owner.Shared, 'SHARED_ROOT')
    totalBytes += root.bytes.length; check(totalBytes <= 16 * 1024 * 1024, 'BYTES')
    assertContainsParent(new Uint8Array(root.bytes), rootParentUid)
    const writer = root.object.previousTransaction
    check(!seen.has(writer), 'CYCLE'); seen.add(writer)
    const ancestor = await readAncestor(writer, maxCheckpoint)
    const failed = ancestor.executionStatus === 'Failure'
    const failedRoot = failed ? await readHistoricalFailedSharedRoot({ client, effects: ancestor.effects, transactionDigest: writer,
      objectId: rootId, type: rootType, mode: 'mutated', signal, maxBytes: 256 * 1024 }) : null
    const current = failedRoot?.reference ?? historicalObjectOutput(ancestor.effects, rootId)
    check(current.version === root.reference.version && current.digest === root.reference.digest
      && current.owner.Shared?.initialSharedVersion === root.object.owner.Shared.initialSharedVersion, 'ROOT_LINK')
    const shared = ancestor.sharedInputs.filter(v => v.objectId === rootId)
    check(current.created ? shared.length === 0 : shared.length === 1 && shared[0].mutable === true
      && String(shared[0].initialSharedVersion) === root.object.owner.Shared.initialSharedVersion, 'EXCLUSIVE_ROOT')
    check(!ancestor.effects.V2!.unchangedConsensusObjects.some(([id]) => id === branchId || id === targetId), 'OWNED_CONSENSUS_ALIAS')
    const branchEffect = ancestor.effects.V2!.changedObjects.find(([id]) => id === branchId)
    const targetEffect = ancestor.effects.V2!.changedObjects.find(([id]) => id === targetId)
    if (failed) check(!branchEffect && !targetEffect, 'FAILED_CHILD_CHANGE')
    trail.push({ rootVersion: String(current.version), transactionDigest: writer, checkpoint: ancestor.checkpoint, executionStatus: failed ? 'Failure' : 'Success' })
    if (branchEffect) {
      check(branchEffect[1].outputState.$kind === 'ObjectWrite', 'BRANCH_REMOVED')
      const written = await readHistoricalMoveObject({ client, effects: ancestor.effects, transactionDigest: writer,
        objectId: branchId, type: branchType, mode: 'written', signal, maxBytes: 256 * 1024 })
      totalBytes += written.bytes.length
      check(written.reference.version === branch.version && written.reference.digest === branch.digest
        && written.object.owner.ObjectOwner === rootParentUid, 'BRANCH_LINK')
      assertBranch(new Uint8Array(written.bytes), targetId)
    }
    if (targetEffect) {
      check(targetEffect[1].outputState.$kind === 'ObjectWrite', 'TARGET_REMOVED')
      const target = await readHistoricalMoveObject({ client, effects: ancestor.effects, transactionDigest: writer,
        objectId: targetId, type: targetType, mode: 'written', signal, maxBytes: 256 * 1024 })
      totalBytes += target.bytes.length; check(totalBytes <= 16 * 1024 * 1024, 'BYTES')
      check(target.object.owner.ObjectOwner === branchId, 'TARGET_OWNER')
      assertTarget(new Uint8Array(target.bytes)); signal.throwIfAborted()
      return { proof: 'original-owned-target-through-shared-typed-branch-candidate-only' as const,
        rootId, rootParentUid, branchId, targetId, bytes: target.bytes, reference: target.reference,
        writerTransactionDigest: writer, trail, branchTrail: initialBranch.trail,
        requiresQualifiedRootParentCommitInvariant: true as const, requiresSharedHelperIndependentReview: true as const,
        notRecursiveTreeProof: true as const, notCurrentAuthority: true as const, notBusinessReceipt: true as const }
    }
    check(!current.created, 'TARGET_MISSING_AT_ROOT_CREATION')
    if (branchEffect) {
      check(branchEffect[1].idOperation.$kind !== 'Created', 'TARGET_MISSING_AT_BRANCH_CREATION')
      const priorBranch = await readHistoricalMoveObject({ client, effects: ancestor.effects, transactionDigest: writer,
        objectId: branchId, type: branchType, mode: 'input', signal, maxBytes: 256 * 1024 })
      totalBytes += priorBranch.bytes.length
      check(priorBranch.object.owner.ObjectOwner === rootParentUid && priorBranch.reference.version < branch.version, 'BRANCH_INPUT')
      assertBranch(new Uint8Array(priorBranch.bytes), targetId); branch = priorBranch.reference
    }
    const prior = await (failed ? readHistoricalFailedSharedRoot : readHistoricalMoveObject)({ client, effects: ancestor.effects,
      transactionDigest: writer, objectId: rootId, type: rootType, mode: 'input', signal, maxBytes: 256 * 1024 })
    if (failed) check(toBase64(prior.bytes) === toBase64(root.bytes)
      && prior.object.data.Move?.hasPublicTransfer === root.object.data.Move?.hasPublicTransfer, 'FAILED_ROOT_CHANGED')
    check(prior.reference.version < root.reference.version && prior.object.owner.Shared?.initialSharedVersion === root.object.owner.Shared.initialSharedVersion, 'PRIOR_ROOT')
    root = prior; maxCheckpoint = ancestor.checkpoint
  }
  throw Error('COMMERCE_SHARED_BRANCH_HOP_BOUND')
}
