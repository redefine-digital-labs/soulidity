import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readHistoricalMoveObject, historicalObjectOutput } from '../../sui/historical-object'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { CanonicalSoulBcs } from '../canonical-native-workbench'
import { readEquipmentHistoricalRootApplication } from './equipment-historical-root-application'
import { captureAccountOriginalReadClientV155 } from './account-original-readers-v155'
import { parseEquipmentManagementRecord } from './equipment-record'
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_EQUIPMENT_MODULE_V154_${code}`) }
/** Authenticate the actual typed ModuleKey field at BOTH original Soul
 * snapshots. Earlier custody may be AddressOwned or ObjectOwned; every exact
 * root version/digest/owner link is still checked. This domain walk depends on
 * qualified Standard parent-commit semantics, not generic recursive coverage. */
export async function readEquipmentHistoricalModuleV154(input: Parameters<typeof readEquipmentHistoricalRootApplication>[0] & { maxHops?: number }) {
  const record = parseEquipmentManagementRecord(input.record), client = captureAccountOriginalReadClientV155(input.client, input.signal)
  const standard = input.standardTypeOrigin, maxHops = input.maxHops ?? 64, signal = AbortSignal.any([input.signal, AbortSignal.timeout(120000)])
  check(Number.isSafeInteger(maxHops) && maxHops >= 1 && maxHops <= 256, 'HOP_BOUND')
  const evidence = await readEquipmentHistoricalRootApplication({ client, record, standardTypeOrigin: standard, signal })
  if (!evidence.rootApplication) return { ...evidence, moduleHistory: null }
  const execution = evidence.execution; check(execution.status === 'FINALIZED_EXECUTION', 'FINALITY')
  const p = record.plan, app = p.target.application.originalPackageId, namespace = normalizeStructTag(`${app}::character::ApplicationWitness`)
  const rootType = `${standard}::soul::Soul`, id = evidence.rootApplication.moduleFieldId
  const wrapper = `0x2::dynamic_object_field::Wrapper<${standard}::soul::ModuleKey<${app}::character::ApplicationWitness>>`
  const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: bcs.byteVector() }), value: bcs.Address })
  const moduleType = `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`
  async function at(snapshot: 'input' | 'written', childId = id, childType = moduleType, optional = false) {
    const args = { client, objectId: p.soulId, type: rootType, signal, maxBytes: 256 * 1024 }
    let root = await readHistoricalMoveObject({ ...args, effects: execution.effects, transactionDigest: record.packet.digest, mode: snapshot })
    let maximum = execution.checkpoint, totalBytes = 0
    const seen = new Set<string>(), trail: Array<{ version: string; transactionDigest: string; checkpoint: string }> = []
    for (let hop = 0; hop < maxHops; hop++) {
      signal.throwIfAborted(); totalBytes += root.bytes.length; check(totalBytes <= 16 * 1024 * 1024, 'BYTE_BOUND')
      check(root.object.owner.$kind === 'AddressOwner' || root.object.owner.$kind === 'ObjectOwner', 'ROOT_OWNER')
      const soul = CanonicalSoulBcs.parse(root.bytes)
      check(CanonicalSoulBcs.serialize(soul).toBase64() === toBase64(root.bytes) && soul.id === p.soulId && soul.schema === 1 && !soul.editing
        && JSON.stringify(soul.origin) === JSON.stringify(evidence.rootApplication!.rootBefore.origin), 'ANCESTOR_ROOT')
      const rows = soul.modules.filter(row => normalizeStructTag(row.namespace.name) === namespace && toHex(row.name) === '616e696d616372616674')
      check(rows.length === 1 && rows[0].object === p.applicationId && rows[0].schema === 3 && !rows[0].removable
        && normalizeStructTag(rows[0].value_type.name) === normalizeStructTag(`${app}::character::ApplicationState`), 'ANCESTOR_DESCRIPTOR')
      const writer = root.object.previousTransaction; check(!seen.has(writer), 'CYCLE'); seen.add(writer)
      const parent = await readHistoricalParentTransaction({ client, transactionDigest: writer, maxCheckpoint: maximum,
        chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal })
      check(parent.executionStatus === 'Success' && !parent.sharedInputs.some(row => row.objectId === p.soulId), 'PARENT')
      const output = historicalObjectOutput(parent.effects, p.soulId)
      check(output.version === root.reference.version && output.digest === root.reference.digest && JSON.stringify(output.owner) === JSON.stringify(root.object.owner), 'PARENT_LINK')
      trail.push({ version: String(output.version), transactionDigest: writer, checkpoint: parent.checkpoint })
      if (parent.effects.V2!.changedObjects.some(([objectId]) => objectId === childId)) {
        const field = await readHistoricalMoveObject({ client, effects: parent.effects, transactionDigest: writer, objectId: childId,
          type: childType, mode: 'written', signal, maxBytes: 16384 })
        check(field.object.owner.ObjectOwner === p.soulId, 'CHILD_OWNER')
        if (childId === id) {
          const value = Field.parse(field.bytes)
          check(Field.serialize(value).toBase64() === toBase64(field.bytes) && value.id === id
            && toHex(value.name.name) === '616e696d616372616674' && value.value === p.applicationId, 'TYPED_MODULE_BINDING')
        }
        return { field, trail, writerTransactionDigest: writer }
      }
      if (output.created && optional) return { field: null, trail, writerTransactionDigest: writer }
      check(!output.created, 'MISSING_AT_CREATION')
      root = await readHistoricalMoveObject({ ...args, effects: parent.effects, transactionDigest: writer, mode: 'input' })
      check(root.reference.version < output.version, 'PRIOR_LINK'); maximum = parent.checkpoint
    }
    throw Error('MANAGEMENT_EQUIPMENT_MODULE_V154_INCOMPLETE_HISTORY')
  }
  const before = await at('input'), after = await at('written')
  check(before.field && after.field && toBase64(before.field.bytes) === toBase64(after.field.bytes), 'FIELD_CHANGED')
  // Standard commit_update always writes ModuleVersionKey. Older roots may
  // acquire it here with installed=0; absent metadata is proven from original
  // history rather than mistaken for a known installation revision.
  const namespaceValue = evidence.rootApplication.rootBefore.modules.find(row => row.object === p.applicationId)!.namespace
  const VersionKey = bcs.struct('ModuleVersionKey', { namespace: bcs.struct('TypeName', { name: bcs.string() }), name: bcs.byteVector() })
  const Version = bcs.struct('ModuleVersion', { installed: bcs.u64(), updated: bcs.u64() })
  const VersionField = bcs.struct('Field', { id: bcs.Address, name: VersionKey, value: Version })
  const versionKey = { namespace: namespaceValue, name: new TextEncoder().encode('animacraft') }, versionKeyType = `${standard}::soul::ModuleVersionKey`
  const versionId = deriveDynamicFieldID(p.soulId, versionKeyType, VersionKey.serialize(versionKey).toBytes())
  const versionType = `0x2::dynamic_field::Field<${versionKeyType},${standard}::soul::ModuleVersion>`
  const versionBefore = await at('input', versionId, versionType, true)
  const versionAfter = await at('written', versionId, versionType)
  check(versionAfter.field && versionAfter.writerTransactionDigest === record.packet.digest, 'VERSION_CURRENT_WRITE')
  function version(bytes: Uint8Array) {
    const value = VersionField.parse(bytes)
    check(VersionField.serialize(value).toBase64() === toBase64(bytes) && value.id === versionId
      && VersionKey.serialize(value.name).toBase64() === VersionKey.serialize(versionKey).toBase64(), 'VERSION_KEY')
    return value.value
  }
  const prior = versionBefore.field ? version(versionBefore.field.bytes) : null, next = version(versionAfter.field.bytes)
  check(next.updated === evidence.rootApplication.rootAfter.revision && next.installed === (prior?.installed ?? '0'), 'VERSION_UPDATE')
  if (prior) check(BigInt(prior.updated) <= BigInt(evidence.rootApplication.rootBefore.revision)
    && BigInt(prior.installed) <= BigInt(prior.updated) && !versionAfter.field.reference.created, 'VERSION_PRIOR')
  else check(versionAfter.field.reference.created && next.installed === '0', 'LEGACY_VERSION_CREATION')
  signal.throwIfAborted()
  return { ...evidence, moduleHistory: { before, after, versionId, versionBefore, versionAfter,
    originalModuleVersionUpdateVerified: true as const, legacyInstalledRevisionUnknown: prior === null, bothOriginalTypedModuleFieldsVerified: true as const,
    requiresQualifiedStandardParentCommitInvariant: true as const }, completeBusinessOutputVerified: false as const }
}
