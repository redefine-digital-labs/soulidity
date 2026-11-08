import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { historicalObjectOutput, readHistoricalMoveObject } from '../../sui/historical-object'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { captureAccountOriginalReadClientV155 } from './account-original-readers-v155'

function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_ORIGINAL_CHILD_V154_${code}`) }
/** Original direct field presence, or complete parent history to creation for
 * a source-qualified permanent key. RPC NOT_FOUND is never absence. This is a
 * domain building block, not generic recursive coverage or a success receipt. */
export async function readOriginalOptionalDirectChildV154(input: {
  client: SuiGrpcClient; effects: Parameters<typeof readHistoricalMoveObject>[0]['effects']; transactionDigest: string; checkpoint: string
  snapshot: 'input' | 'written'; rootId: string; rootType: string; rootOwnerId: string; childId: string; childType: string
  chainIdentifier: string; genesisDigest: string; maxHops?: number; signal: AbortSignal; assertRoot: (bytes: Uint8Array) => void
}) {
  const c = { ...input, effects: structuredClone(input.effects) }, client = captureAccountOriginalReadClientV155(input.client, input.signal), maxHops = input.maxHops ?? 64
  check(Number.isSafeInteger(maxHops) && maxHops >= 1 && maxHops <= 256, 'HOP_BOUND')
  check([c.rootId, c.rootOwnerId, c.childId].every(id => /^0x[0-9a-f]{64}$/.test(id) && BigInt(id) > 0n)
    && new Set([c.rootId, c.rootOwnerId, c.childId]).size === 3 && ['input', 'written'].includes(c.snapshot), 'ROLES')
  const signal = AbortSignal.any([c.signal, AbortSignal.timeout(60000)]), args = { client, objectId: c.rootId, type: c.rootType, signal, maxBytes: 256 * 1024 }
  let root = await readHistoricalMoveObject({ ...args, effects: c.effects, transactionDigest: c.transactionDigest, mode: c.snapshot })
  let maximum = c.checkpoint, totalBytes = 0
  const seen = new Set<string>(), trail: Array<{ version: string; transactionDigest: string; checkpoint: string }> = []
  for (let hop = 0; hop < maxHops; hop++) {
    signal.throwIfAborted(); totalBytes += root.bytes.length; check(totalBytes <= 16 * 1024 * 1024, 'BYTE_BOUND')
    check(root.object.owner.ObjectOwner === c.rootOwnerId, 'ROOT_OWNER'); c.assertRoot(new Uint8Array(root.bytes))
    const writer = root.object.previousTransaction; check(!seen.has(writer), 'CYCLE'); seen.add(writer)
    const parent = await readHistoricalParentTransaction({ client, transactionDigest: writer, maxCheckpoint: maximum,
      chainIdentifier: c.chainIdentifier, genesisDigest: c.genesisDigest, signal })
    check(parent.executionStatus === 'Success' && !parent.sharedInputs.some(ref => ref.objectId === c.rootId), 'PARENT')
    const output = historicalObjectOutput(parent.effects, c.rootId)
    check(output.version === root.reference.version && output.digest === root.reference.digest && output.owner.ObjectOwner === c.rootOwnerId
      && (output.created || output.inputOwner?.ObjectOwner === c.rootOwnerId), 'PARENT_LINK')
    trail.push({ version: String(output.version), transactionDigest: writer, checkpoint: parent.checkpoint })
    const changes = parent.effects.V2!.changedObjects.filter(([id]) => id === c.childId)
    check(changes.length <= 1, 'CHILD_ALIAS')
    if (changes.length) {
      check(changes[0][1].outputState.$kind === 'ObjectWrite', 'PERMANENT_KEY_REMOVED')
      const child = await readHistoricalMoveObject({ client, effects: parent.effects, transactionDigest: writer,
        objectId: c.childId, type: c.childType, mode: 'written', signal, maxBytes: 256 * 1024 })
      check(child.object.owner.ObjectOwner === c.rootId, 'CHILD_OWNER'); signal.throwIfAborted()
      return { status: 'PRESENT' as const, child, writerTransactionDigest: writer, trail, requiresQualifiedParentCommitInvariant: true as const }
    }
    if (output.created) { signal.throwIfAborted(); return { status: 'ABSENT_AT_CREATION' as const, trail, requiresQualifiedParentCommitInvariant: true as const } }
    root = await readHistoricalMoveObject({ ...args, effects: parent.effects, transactionDigest: writer, mode: 'input' })
    check(root.reference.version < output.version && root.object.owner.ObjectOwner === c.rootOwnerId, 'PRIOR_LINK'); maximum = parent.checkpoint
  }
  throw Error('MANAGEMENT_ORIGINAL_CHILD_V154_INCOMPLETE_HISTORY')
}
