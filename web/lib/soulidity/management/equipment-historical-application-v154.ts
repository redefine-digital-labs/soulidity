import { bcs, type BcsType } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64, toHex, normalizeStructTag } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { CurrentCompleteCoreBcs } from '../../animacraft/current-maker-complete-application-carriers'
import { CurrentCompleteContentBcs } from '../../animacraft/current-maker-complete-installed-content'
import { CurrentCompleteArtifactBcs } from '../../animacraft/current-maker-complete-artifact'
import { NativeInitialAuthorizationBcs, NativeInitialPaidBcs, NativeInitialConfigurationBcs } from '../native-initial-children'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { ManagementApplicationBcs, ManagementLoadoutLibraryBcs } from './application-bcs'
import { readOriginalOptionalDirectChildV154 } from './application-original-optional-child-v154'
import { readApplicationContainedHistoricalChild } from './application-historical-contained-child'
import { readEquipmentHistoricalModelV154 } from './equipment-historical-model-v154'
import { captureAccountOriginalReadClientV155 } from './account-original-readers-v155'
import { parseEquipmentManagementRecord } from './equipment-record'
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_EQUIPMENT_APPLICATION_V154_${code}`) }
/** Read all original nested App carriers, preserving existing nonempty content,
 * authorizations, paid access and Forms. Shared wire codecs impose no Creator
 * initial-empty state and confer no Native authority. Equipment must conserve
 * their actual bodies; StateConfiguration absence is proven to App creation. */
export async function readEquipmentHistoricalApplicationV154(input: Parameters<typeof readEquipmentHistoricalModelV154>[0] & { contentTypeOrigin: string }) {
  const record = parseEquipmentManagementRecord(input.record), client = captureAccountOriginalReadClientV155(input.client, input.signal)
  const c = { client, record, standardTypeOrigin: input.standardTypeOrigin, visualTypeOrigin: input.visualTypeOrigin,
    contentTypeOrigin: input.contentTypeOrigin, compositionId: input.compositionId, maxHops: input.maxHops,
    originalOccupiedPartBcs: [...input.originalOccupiedPartBcs], signal: AbortSignal.any([input.signal, AbortSignal.timeout(120000)]) }
  check(/^0x[0-9a-f]{64}$/.test(c.contentTypeOrigin) && BigInt(c.contentTypeOrigin) > 0n, 'CONTENT_ORIGIN')
  const evidence = await readEquipmentHistoricalModelV154(c)
  if (!evidence.model || !evidence.sources || !evidence.slot || !evidence.rootApplication) return { ...evidence, applicationTree: null }
  const p = record.plan, app = p.target.application.originalPackageId, execution = evidence.execution
  check(execution.status === 'FINALIZED_EXECUTION', 'FINALITY')
  const rootOwner = evidence.rootApplication.moduleFieldId, expectedOperator = normalizeStructTag(`${app}::character::ContentOperator`)
  const Mapping = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address })
  function assertApplication(bytes: Uint8Array) {
    const value = ManagementApplicationBcs.parse(bytes)
    check(ManagementApplicationBcs.serialize(value).toBase64() === toBase64(bytes) && value.id === p.applicationId && value.root === p.soulId
      && value.operator.name === evidence.rootApplication!.applicationBefore.operator.name, 'APPLICATION_BINDING')
  }
  const histories: Array<{ role: string; snapshot: string; id: string; writer: string }> = [], mappingIds: string[] = []
  async function carrier<T extends { id: string }>(key: string, type: string, codec: BcsType<T, any>, optional = false) {
    const wrapper = `0x2::dynamic_object_field::Wrapper<${app}::character::${key}>`, fieldId = deriveDynamicFieldID(p.applicationId, wrapper, moveEmptyStructBytes())
    const snapshots = []
    mappingIds.push(fieldId)
    for (const snapshot of ['input', 'written'] as const) {
      const link = await readOriginalOptionalDirectChildV154({ client, effects: execution.effects, transactionDigest: record.packet.digest, checkpoint: execution.checkpoint,
        snapshot, rootId: p.applicationId, rootType: `${app}::character::ApplicationState`, rootOwnerId: rootOwner, childId: fieldId,
        childType: `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`, chainIdentifier: p.target.chainIdentifier,
        genesisDigest: MAINNET_GENESIS_DIGEST, maxHops: c.maxHops, signal: c.signal, assertRoot: assertApplication })
      if (link.status !== 'PRESENT') { check(optional, `REQUIRED_${key}`); snapshots.push(null); continue }
      const field = Mapping.parse(link.child.bytes)
      check(Mapping.serialize(field).toBase64() === toBase64(link.child.bytes) && field.id === fieldId && !field.name.name.dummy_field
        && link.child.reference.created && !execution.effects.V2!.changedObjects.some(([id]) => id === fieldId), 'PERMANENT_MAPPING')
      const proof = await readApplicationContainedHistoricalChild({ client, anchorEffects: execution.effects, anchorTransactionDigest: record.packet.digest,
        anchorCheckpoint: execution.checkpoint, anchorMode: snapshot, rootId: p.applicationId, rootType: `${app}::character::ApplicationState`, rootOwnerId: rootOwner,
        parentUid: fieldId, childId: field.value, childType: type, chainIdentifier: p.target.chainIdentifier,
        genesisDigest: MAINNET_GENESIS_DIGEST, maxHops: c.maxHops, signal: c.signal, assertContainsParent: bytes => assertApplication(bytes) })
      const value = codec.parse(proof.bytes)
      check(codec.serialize(value).toBase64() === toBase64(proof.bytes) && value.id === field.value, 'CARRIER_CANONICAL')
      histories.push({ role: key, snapshot, id: field.value, writer: proof.writerTransactionDigest })
      snapshots.push({ value, bytes: proof.bytes, proof, fieldId, linkBytes: link.child.bytes })
    }
    const [before, after] = snapshots
    check(Boolean(before) === Boolean(after), 'OPTIONAL_PRESENCE_CHANGED')
    if (!before || !after) return null
    check(before.fieldId === after.fieldId && toBase64(before.linkBytes) === toBase64(after.linkBytes)
      && toBase64(before.bytes) === toBase64(after.bytes), 'UNRELATED_CARRIER_CHANGED')
    return before
  }
  const core = await carrier('CoreKey', `${app}::character::Core`, CurrentCompleteCoreBcs)
  const authorization = await carrier('AuthorizationKey', `${c.contentTypeOrigin}::authorization::Authorization`, NativeInitialAuthorizationBcs)
  const content = await carrier('ContentKey', `${app}::character::Content`, CurrentCompleteContentBcs)
  const paid = await carrier('PaidAccessKey', `${c.contentTypeOrigin}::paid_access::Ledger`, NativeInitialPaidBcs)
  const loadout = await carrier('LoadoutKey', `${c.contentTypeOrigin}::loadout::Library`, ManagementLoadoutLibraryBcs)
  const output = await carrier('OutputKey', `${app}::output::Artifact`, CurrentCompleteArtifactBcs)
  const configuration = await carrier('StateConfigurationKey', `${c.contentTypeOrigin}::state_configuration::Configuration`, NativeInitialConfigurationBcs, true)
  check(core && authorization && content && paid && loadout && output, 'COMPLETED_APPLICATION_REQUIRED')
  for (const { value } of [authorization, paid, loadout, output, ...(configuration ? [configuration] : [])]) {
    check(value.root === p.soulId && value.controller.root === p.soulId && value.controller.parent === p.applicationId
      && normalizeStructTag(value.controller.operator.name) === expectedOperator, 'CONTROLLER')
  }
  const a = authorization.value, d = paid.value, l = loadout.value, x = content.value, o = output.value
  check(BigInt(a.grants.size) >= BigInt(a.count) && BigInt(a.count) <= BigInt(a.capacity), 'AUTH_COUNTS')
  const tableIds = [a.grants.id, d.offers.id, d.entries.id, d.attempts.id, l.heads.id, l.receipts.id,
    x.versions.id, x.counts.id, x.indices.id, x.names_by_kind.id, x.active.id, x.attempts.id, o.recipe.pages.id, o.materializations.id]
  const configurationValues: Array<{ key: string; value: Uint8Array; fieldId: string }> = []
  if (configuration) {
    const config = configuration.value
    tableIds.push(config.values.id)
    check(config.entries.length <= 512 && config.values.size === String(config.entries.length)
      && new Set(config.entries.map(row => row.key)).size === config.entries.length, 'CONFIGURATION_COVERAGE')
    const writer = await readHistoricalParentTransaction({ client, transactionDigest: configuration.proof.writerTransactionDigest, maxCheckpoint: execution.checkpoint,
      chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal: c.signal })
    check(writer.executionStatus === 'Success', 'CONFIGURATION_WRITER')
    const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.string(), value: bcs.byteVector() })
    let totalBytes = 0
    for (const entry of config.entries) {
      check(entry.key.length > 0 && entry.value_hash.length === 32, 'CONFIGURATION_ENTRY')
      const id = deriveDynamicFieldID(config.values.id, '0x1::string::String', bcs.string().serialize(entry.key).toBytes())
      const proof = await readApplicationContainedHistoricalChild({ client, anchorEffects: writer.effects, anchorTransactionDigest: writer.transactionDigest,
        anchorCheckpoint: writer.checkpoint, anchorMode: 'written', rootId: config.id, rootType: `${c.contentTypeOrigin}::state_configuration::Configuration`,
        rootOwnerId: configuration.fieldId, parentUid: config.values.id, childId: id, childType: '0x2::dynamic_field::Field<0x1::string::String,vector<u8>>',
        chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, maxHops: c.maxHops, signal: c.signal, assertContainsParent(bytes, uid) {
          const value = NativeInitialConfigurationBcs.parse(bytes)
          check(NativeInitialConfigurationBcs.serialize(value).toBase64() === toBase64(bytes) && value.id === config.id && value.values.id === uid
            && value.root === p.soulId && value.entries.some(row => row.key === entry.key), 'CONFIGURATION_PARENT')
        } })
      const field = Field.parse(proof.bytes); totalBytes += field.value.length
      check(totalBytes <= 4 * 1024 * 1024 && Field.serialize(field).toBase64() === toBase64(proof.bytes) && field.id === id && field.name === entry.key
        && toHex(sha256(field.value)) === toHex(entry.value_hash), 'CONFIGURATION_VALUE_HASH')
      if (execution.effects.V2!.changedObjects.some(([objectId]) => objectId === id)) {
        const common = { client, effects: execution.effects, transactionDigest: record.packet.digest, objectId: id,
          type: '0x2::dynamic_field::Field<0x1::string::String,vector<u8>>', signal: c.signal, maxBytes: 256 * 1024 }
        const before = await readHistoricalMoveObject({ ...common, mode: 'input' }), after = await readHistoricalMoveObject({ ...common, mode: 'mutated' })
        check(before.reference.version === proof.reference.version && before.reference.digest === proof.reference.digest
          && before.object.owner.ObjectOwner === config.values.id && after.object.owner.ObjectOwner === config.values.id
          && toBase64(before.bytes) === toBase64(proof.bytes) && toBase64(after.bytes) === toBase64(proof.bytes), 'CONFIGURATION_VALUE_CHANGED')
      }
      histories.push({ role: 'CONFIGURATION_VALUE', snapshot: 'both', id, writer: proof.writerTransactionDigest })
      configurationValues.push({ key: entry.key, value: field.value, fieldId: id })
    }
  }
  const roleIds = [p.soulId, p.applicationId, evidence.slot.compositionBefore.id, evidence.model.rootVisual.id, evidence.sources.boundParts.id,
    evidence.slot.compositionBefore.slots.id, evidence.slot.compositionBefore.references.pages.id, evidence.sources.boundParts.records.pages.id,
    evidence.slot.compositionBefore.assembly.profiles.id, evidence.slot.compositionBefore.assembly.palettes.id, evidence.slot.compositionBefore.enhancements.id,
    ...[core, authorization, content, paid, loadout, output, ...(configuration ? [configuration] : [])].map(row => row.value.id), ...mappingIds, ...tableIds]
  check(roleIds.every(id => /^0x[0-9a-f]{64}$/.test(id) && BigInt(id) > 0n) && new Set(roleIds).size === roleIds.length, 'ROLE_ALIAS')
  c.signal.throwIfAborted()
  return { ...evidence, applicationTree: { core, authorization, content, paid, loadout, output, configuration, configurationValues, histories, roleIds,
    originalNonEquipmentCarriersPreserved: true as const, originalConfigurationValuesVerified: true as const,
    requiresFullSemanticGasAllEffectsAndQualifiedOriginalSource: true as const }, completeBusinessOutputVerified: false as const }
}
