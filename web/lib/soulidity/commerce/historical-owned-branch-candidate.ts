import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { historicalObjectOutput, readHistoricalMoveObject } from '../../sui/historical-object'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'

import { readHistoricalChildThroughOwnedParent } from '../../sui/historical-owned-parent'

function check(value: unknown, code: string): asserts value { if (!value) throw Error(`COMMERCE_OWNED_BRANCH_${code}`) }

/** Review candidate for an ObjectOwned root dynamically borrowed through its
 * stable owner, a real direct typed DOF branch and its ObjectOwned target.
 * All branch/target writes must commit this root: qualified original deployed
 * code must establish that invariant. No recursive/current authority claim.
 * Owner rebinding and failed ancestor transactions are unsupported and reject.
 */
export async function readHistoricalOwnedBranchCandidate(input: {
  client: SuiGrpcClient; anchorEffects: ReturnType<typeof bcs.TransactionEffects.parse>; anchorTransactionDigest: string
  anchorCheckpoint: string; anchorMode: 'input' | 'written'; rootId: string; rootType: string
  rootOwnerId: string; branchId: string; branchType: string; targetId: string; targetType: string
  chainIdentifier: string; genesisDigest: string; signal: AbortSignal; maxHops?: number
  assertRoot: (rootBytes: Uint8Array) => void
  assertBranch: (branchBytes: Uint8Array, targetId: string) => void
  assertTarget: (targetBytes: Uint8Array) => void
}) {
  const saved = { ...input, anchorEffects: structuredClone(input.anchorEffects) }, source = input.client.ledgerService
  const client = { ledgerService: { getServiceInfo: source.getServiceInfo.bind(source), getTransaction: source.getTransaction.bind(source),
    getCheckpoint: source.getCheckpoint.bind(source), getObject: source.getObject.bind(source) } } as unknown as SuiGrpcClient
  const { rootId, rootType, rootOwnerId, branchId, branchType, targetId, targetType, assertRoot, assertBranch, assertTarget } = saved
  const maxHops = saved.maxHops ?? 64, signal = AbortSignal.any([saved.signal, AbortSignal.timeout(60000)])
  const id = (v: string) => /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) !== 0n
  check([rootId, rootOwnerId, branchId, targetId].every(id) && new Set([rootId, rootOwnerId, branchId, targetId]).size === 4, 'ROLES')
  check(Number.isSafeInteger(maxHops) && maxHops >= 1 && maxHops <= 64
    && [assertRoot, assertBranch, assertTarget].every(v => typeof v === 'function'), 'BOUND')
  const ancestors = new Map<string, Awaited<ReturnType<typeof readHistoricalParentTransaction>>>()
  const readAncestor = async (transactionDigest: string, maxCheckpoint: string) => {
    let ancestor = ancestors.get(transactionDigest)
    if (!ancestor) {
      ancestor = await readHistoricalParentTransaction({ client, transactionDigest, maxCheckpoint,
        chainIdentifier: saved.chainIdentifier, genesisDigest: saved.genesisDigest, signal })
      const transaction = Transaction.from(ancestor.transactionBytes).getData()
      check(!ancestor.sharedInputs.some(v => v.objectId === rootId) && !ancestor.ownedInputs.some(v => v.objectId === rootId)
        && !transaction.inputs.some(v => v.Object?.Receiving?.objectId === rootId)
        && !transaction.gasData.payment?.some(v => v.objectId === rootId), 'ROOT_INPUT_ALIAS')
      ancestors.set(transactionDigest, ancestor)
    }
    check(BigInt(ancestor.checkpoint) <= BigInt(maxCheckpoint), 'CACHED_CHECKPOINT_BOUND')
    return ancestor
  }
  const initialBranch = await readHistoricalChildThroughOwnedParent({ client, anchorEffects: saved.anchorEffects,
    anchorTransactionDigest: saved.anchorTransactionDigest, anchorCheckpoint: saved.anchorCheckpoint, anchorMode: saved.anchorMode,
    rootId, rootType, rootOwnerId, childId: branchId, childType: branchType, chainIdentifier: saved.chainIdentifier,
    genesisDigest: saved.genesisDigest, signal, maxHops, assertRoot })
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
    signal.throwIfAborted(); check(root.object.owner.ObjectOwner === rootOwnerId, 'ROOT_OWNER_REBOUND')
    totalBytes += root.bytes.length; check(totalBytes <= 16 * 1024 * 1024, 'BYTES')
    assertRoot(new Uint8Array(root.bytes))
    const writer = root.object.previousTransaction
    check(!seen.has(writer), 'CYCLE'); seen.add(writer)
    const ancestor = await readAncestor(writer, maxCheckpoint)
    check(ancestor.executionStatus === 'Success', 'UNSUPPORTED_FAILURE')
    const current = historicalObjectOutput(ancestor.effects, rootId)
    check(current.version === root.reference.version && current.digest === root.reference.digest
      && current.owner.ObjectOwner === rootOwnerId, 'ROOT_LINK')
    if (!current.created) check(current.inputOwner?.ObjectOwner === rootOwnerId, 'INPUT_OWNER_REBOUND')
    check(!ancestor.effects.V2!.unchangedConsensusObjects.some(([id]) => id === branchId || id === targetId), 'OWNED_CONSENSUS_ALIAS')
    const branchEffect = ancestor.effects.V2!.changedObjects.find(([id]) => id === branchId)
    const targetEffect = ancestor.effects.V2!.changedObjects.find(([id]) => id === targetId)
    trail.push({ rootVersion: String(current.version), transactionDigest: writer, checkpoint: ancestor.checkpoint, executionStatus: 'Success' })
    if (branchEffect) {
      check(branchEffect[1].outputState.$kind === 'ObjectWrite', 'BRANCH_REMOVED')
      const written = await readHistoricalMoveObject({ client, effects: ancestor.effects, transactionDigest: writer,
        objectId: branchId, type: branchType, mode: 'written', signal, maxBytes: 256 * 1024 })
      totalBytes += written.bytes.length
      check(written.reference.version === branch.version && written.reference.digest === branch.digest
        && written.object.owner.ObjectOwner === rootId, 'BRANCH_LINK')
      assertBranch(new Uint8Array(written.bytes), targetId)
    }
    if (targetEffect) {
      check(targetEffect[1].outputState.$kind === 'ObjectWrite', 'TARGET_REMOVED')
      const target = await readHistoricalMoveObject({ client, effects: ancestor.effects, transactionDigest: writer,
        objectId: targetId, type: targetType, mode: 'written', signal, maxBytes: 256 * 1024 })
      totalBytes += target.bytes.length; check(totalBytes <= 16 * 1024 * 1024, 'BYTES')
      check(target.object.owner.ObjectOwner === branchId, 'TARGET_OWNER')
      assertTarget(new Uint8Array(target.bytes)); signal.throwIfAborted()
      return { proof: 'original-owned-target-through-owned-typed-branch-candidate-only' as const,
        rootId, rootOwnerId, branchId, targetId, bytes: target.bytes, reference: target.reference,
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
      check(priorBranch.object.owner.ObjectOwner === rootId && priorBranch.reference.version < branch.version, 'BRANCH_INPUT')
      assertBranch(new Uint8Array(priorBranch.bytes), targetId); branch = priorBranch.reference
    }
    const prior = await readHistoricalMoveObject({ client, effects: ancestor.effects,
      transactionDigest: writer, objectId: rootId, type: rootType, mode: 'input', signal, maxBytes: 256 * 1024 })
    check(prior.reference.version < root.reference.version && prior.object.owner.ObjectOwner === rootOwnerId, 'PRIOR_ROOT')
    root = prior; maxCheckpoint = ancestor.checkpoint
  }
  throw Error('COMMERCE_OWNED_BRANCH_HOP_BOUND')
}
