import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64, toHex } from '@mysten/sui/utils'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { ManagementApplicationBcs } from './application-bcs'
import { parseFormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalRoot } from './application-forms-historical-root'

function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_APPLICATION_${code}`) }

/** Body/descriptor relation only. Historical provenance must be supplied by the
 * effects reader below; semantic_hash is not the Application body commitment. */
export function verifyFormsApplicationBody(input: {
  bytes: Uint8Array; id: string; root: string; revision: string; bodyHash: Iterable<number>
}) {
  const value = ManagementApplicationBcs.parse(input.bytes)
  check(ManagementApplicationBcs.serialize(value).toBase64() === toBase64(input.bytes), 'NONCANONICAL')
  check(value.id === input.id && value.root === input.root && value.revision === input.revision, 'BINDING')
  check(toHex(sha3_256(input.bytes)) === toHex(Uint8Array.from(input.bodyHash)), 'BODY_COMMITMENT')
  return value
}

/** ACTIVATE writes Application in the original effects, so both versions can
 * be authenticated directly. SAVE leaves this nested owned object unchanged:
 * it requires a separate parent-committed lineage proof and is rejected here.
 * Snapshot, semantic recipe/render, Item outputs and custody remain mandatory. */
export async function readFormsHistoricalActivatedApplication(input: Parameters<typeof readFormsHistoricalRoot>[0]) {
  const record = parseFormsManagementRecord(input.record), p = record.plan
  check(p.action.kind === 'ACTIVATE', 'ACTIVATE_REQUIRED')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45000)])
  const root = await readFormsHistoricalRoot({ ...input, record, signal })
  if (root.status !== 'HISTORICAL_ROOT_JOURNAL_EVIDENCE') return root
  const app = p.target.application.originalPackageId
  const wrapper = `0x2::dynamic_object_field::Wrapper<${input.standardTypeOrigin}::soul::ModuleKey<${app}::character::ApplicationWitness>>`
  const owner = deriveDynamicFieldID(p.soulId, wrapper, bcs.byteVector().serialize(new TextEncoder().encode('animacraft')).toBytes())
  const args = { client: input.client, effects: root.effects, transactionDigest: root.transactionDigest,
    objectId: p.applicationId, type: `${app}::character::ApplicationState`, signal, maxBytes: 256 * 1024 }
  const old = await readHistoricalMoveObject({ ...args, mode: 'input' })
  const written = await readHistoricalMoveObject({ ...args, mode: 'mutated' })
  check(old.object.owner.ObjectOwner === owner && written.object.owner.ObjectOwner === owner, 'MODULE_OWNER')
  const common = { id: p.applicationId, root: p.soulId }
  const before = verifyFormsApplicationBody({ ...common, bytes: old.bytes, revision: p.expectedApplication,
    bodyHash: root.applicationDescriptorBefore.body_hash })
  const after = verifyFormsApplicationBody({ ...common, bytes: written.bytes, revision: String(BigInt(p.expectedApplication) + 1n),
    bodyHash: root.applicationDescriptorAfter.body_hash })
  check(toHex(before.recipe_hash) === p.action.expectedRecipe, 'INPUT_RECIPE')
  const active = root.after.active
  check(active && active.application_revision === after.revision && toHex(active.composition) === toHex(after.recipe_hash), 'ACTIVE_COMPOSITION')
  signal.throwIfAborted()
  return { ...root, status: 'HISTORICAL_ACTIVATED_APPLICATION_EVIDENCE' as const,
    applicationBefore: before, applicationAfter: after, applicationInputReference: old.reference,
    applicationOutputReference: written.reference, applicationBodiesVerified: true as const,
    completeBusinessOutputVerified: false as const }
}

import { normalizeStructTag } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { historicalObjectOutput } from '../../sui/historical-object'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { CanonicalSoulBcs } from '../canonical-native-workbench'

/** SAVE's unchanged Application is found through the original Soul's own
 * committed history. Qualified Character code must commit every Application
 * mutation to this permanent root descriptor. Address/Object ownership may
 * change along that history; shared roots, failure and incomplete data refuse.
 * This domain invariant is not a generic recursive child-tree proof. */
export async function readFormsHistoricalSavedApplication(input: Parameters<typeof readFormsHistoricalRoot>[0] & { maxHops?: number }) {
  const record = parseFormsManagementRecord(input.record), p = record.plan, maxHops = input.maxHops ?? 64
  check(p.action.kind === 'SAVE', 'SAVE_REQUIRED')
  check(Number.isSafeInteger(maxHops) && maxHops >= 1 && maxHops <= 256, 'HOP_BOUND')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const root = await readFormsHistoricalRoot({ ...input, record, signal })
  if (root.status !== 'HISTORICAL_ROOT_JOURNAL_EVIDENCE') return root
  check(!root.effects.V2!.changedObjects.some(([id]) => id === p.applicationId), 'SAVE_APPLICATION_CHANGED')
  const app = p.target.application.originalPackageId, rootType = `${input.standardTypeOrigin}::soul::Soul`
  const wrapper = `0x2::dynamic_object_field::Wrapper<${input.standardTypeOrigin}::soul::ModuleKey<${app}::character::ApplicationWitness>>`
  const owner = deriveDynamicFieldID(p.soulId, wrapper, bcs.byteVector().serialize(new TextEncoder().encode('animacraft')).toBytes())
  let current = await readHistoricalMoveObject({ client: input.client, effects: root.effects, transactionDigest: root.transactionDigest,
    objectId: p.soulId, type: rootType, mode: 'input', signal, maxBytes: 256 * 1024 })
  let checkpoint = root.checkpoint, bytes = 0
  const seen = new Set<string>(), trail: Array<{ version: string; transactionDigest: string; checkpoint: string }> = []
  for (let hop = 0; hop < maxHops; hop++) {
    signal.throwIfAborted()
    bytes += current.bytes.length; check(bytes <= 16 * 1024 * 1024, 'BYTE_BOUND')
    check(current.object.owner.$kind === 'AddressOwner' || current.object.owner.$kind === 'ObjectOwner', 'ROOT_OWNER')
    const soul = CanonicalSoulBcs.parse(current.bytes)
    check(CanonicalSoulBcs.serialize(soul).toBase64() === toBase64(current.bytes) && soul.id === p.soulId
      && soul.schema === 1 && !soul.editing && JSON.stringify(soul.origin) === JSON.stringify(root.rootBefore.origin), 'ANCESTOR_ROOT')
    const descriptors = soul.modules.filter(row => normalizeStructTag(row.namespace.name) === normalizeStructTag(`${app}::character::ApplicationWitness`)
      && toHex(row.name) === toHex(new TextEncoder().encode('animacraft')))
    check(descriptors.length === 1 && JSON.stringify(descriptors[0]) === JSON.stringify(root.applicationDescriptorBefore), 'ANCESTOR_DESCRIPTOR')
    const previous = current.object.previousTransaction
    check(!seen.has(previous), 'CYCLE'); seen.add(previous)
    const ancestor = await readHistoricalParentTransaction({ client: input.client, transactionDigest: previous, maxCheckpoint: checkpoint,
      chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal })
    check(ancestor.executionStatus === 'Success', 'UNSUPPORTED_FAILURE')
    const ref = historicalObjectOutput(ancestor.effects, p.soulId)
    check(ref.version === current.reference.version && ref.digest === current.reference.digest
      && JSON.stringify(ref.owner) === JSON.stringify(current.object.owner), 'ROOT_LINK')
    check(!ancestor.sharedInputs.some(row => row.objectId === p.soulId), 'SHARED_ROOT')
    trail.push({ version: String(ref.version), transactionDigest: previous, checkpoint: ancestor.checkpoint })
    if (ancestor.effects.V2!.changedObjects.some(([id]) => id === p.applicationId)) {
      const output = await readHistoricalMoveObject({ client: input.client, effects: ancestor.effects, transactionDigest: previous,
        objectId: p.applicationId, type: `${app}::character::ApplicationState`, mode: 'written', signal, maxBytes: 256 * 1024 })
      check(output.object.owner.ObjectOwner === owner, 'MODULE_OWNER')
      const value = verifyFormsApplicationBody({ bytes: output.bytes, id: p.applicationId, root: p.soulId,
        revision: p.expectedApplication, bodyHash: root.applicationDescriptorBefore.body_hash })
      signal.throwIfAborted()
      return { ...root, status: 'HISTORICAL_SAVED_APPLICATION_EVIDENCE' as const, applicationBefore: value, applicationAfter: value,
        applicationReference: output.reference, applicationWriter: previous, applicationTrail: trail,
        applicationBodiesVerified: true as const, requiresQualifiedParentCommitInvariant: true as const,
        completeBusinessOutputVerified: false as const }
    }
    check(!ref.created, 'APPLICATION_MISSING_AT_ROOT_CREATION')
    current = await readHistoricalMoveObject({ client: input.client, effects: ancestor.effects, transactionDigest: previous,
      objectId: p.soulId, type: rootType, mode: 'input', signal, maxBytes: 256 * 1024 })
    checkpoint = ancestor.checkpoint
  }
  throw Error('APPLICATION_FORMS_APPLICATION_HOP_BOUND')
}
