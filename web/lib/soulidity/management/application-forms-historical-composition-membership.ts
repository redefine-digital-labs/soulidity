import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { readHistoricalChildThroughOwnedParent } from '../../sui/historical-owned-parent'
import { ManagementApplicationBcs } from './application-bcs'
import { parseFormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalComposition } from './application-forms-historical-composition'
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_COMPOSITION_KEY_${code}`) }

/** CompositionKey is a permanent child under qualified Character code. Prove
 * the original mapping through Application's own committed history, independent
 * of later outer Soul transfers. Slot/palette/variant children remain separate. */
export async function readFormsHistoricalCompositionMembership(input: Parameters<typeof readFormsHistoricalComposition>[0] & { maxHops?: number }) {
  const record = parseFormsManagementRecord(input.record), p = record.plan
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const evidence = await readFormsHistoricalComposition({ ...input, record, signal })
  if (evidence.status !== 'HISTORICAL_COMPOSITION_METADATA_EVIDENCE') return evidence
  const app = p.target.application.originalPackageId
  const wrapper = `0x2::dynamic_object_field::Wrapper<${app}::character::CompositionKey>`
  const id = deriveDynamicFieldID(p.applicationId, wrapper, moveEmptyStructBytes())
  check(!evidence.effects.V2!.changedObjects.some(([objectId]) => objectId === id), 'PERMANENT_FIELD_CHANGED')
  const moduleWrapper = `0x2::dynamic_object_field::Wrapper<${input.standardTypeOrigin}::soul::ModuleKey<${app}::character::ApplicationWitness>>`
  const moduleOwner = deriveDynamicFieldID(p.soulId, moduleWrapper, bcs.byteVector().serialize(new TextEncoder().encode('animacraft')).toBytes())
  const proof = await readHistoricalChildThroughOwnedParent({ client: input.client, anchorEffects: evidence.effects,
    anchorTransactionDigest: evidence.transactionDigest, anchorCheckpoint: evidence.checkpoint, anchorMode: 'input',
    rootId: p.applicationId, rootType: `${app}::character::ApplicationState`, rootOwnerId: moduleOwner,
    childId: id, childType: `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`, chainIdentifier: p.target.chainIdentifier,
    genesisDigest: MAINNET_GENESIS_DIGEST, signal, maxHops: input.maxHops, assertRoot(bytes) {
      const value = ManagementApplicationBcs.parse(bytes)
      check(ManagementApplicationBcs.serialize(value).toBase64() === toBase64(bytes) && value.id === p.applicationId && value.root === p.soulId
        && BigInt(value.revision) <= BigInt(p.expectedApplication)
        && value.operator.name === evidence.applicationBefore.operator.name, 'APPLICATION_LINEAGE')
    } })
  check(proof.reference.created, 'CREATION_REQUIRED')
  const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address })
  const field = Field.parse(proof.bytes)
  check(Field.serialize(field).toBase64() === toBase64(proof.bytes) && field.id === id && field.name.name.dummy_field === false
    && field.value === evidence.compositionBefore.id, 'MAPPING')
  signal.throwIfAborted()
  return { ...evidence, status: 'HISTORICAL_COMPOSITION_MEMBERSHIP_EVIDENCE' as const, compositionKeyProof: proof,
    compositionKeyMembershipVerified: true as const, requiresCompositionKeyMembershipProof: false as const,
    requiresQualifiedPermanentChildInvariant: true as const, completeBusinessOutputVerified: false as const }
}
