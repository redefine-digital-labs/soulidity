import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { ManagementItemBcs, ManagementSourceBcs, ManagementDefinitionBcs } from './application-bcs'
import { parseFormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalSlots } from './application-forms-historical-slots'
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_POOL_${code}`) }

/** Existing equipped Item pool comes from complete original slot inputs, not
 * today's wallet or caller-supplied ids. Qualified Character removes/rebinds
 * every old Item, so original effects expose Item and ItemKey input/output.
 * Incoming wallet Item conservation and source inventories remain separate. */
export async function readFormsHistoricalPoolItems(input: Parameters<typeof readFormsHistoricalSlots>[0]) {
  const record = parseFormsManagementRecord(input.record), p = record.plan
  check(p.action.kind === 'ACTIVATE', 'ACTIVATE_REQUIRED')
  const action = p.action
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const evidence = await readFormsHistoricalSlots({ ...input, record, signal })
  if (evidence.status !== 'HISTORICAL_SLOT_BINDINGS_EVIDENCE') return evidence
  const pool = evidence.originalSoulItemIds
  check(pool.every(id => !action.itemIds.includes(id)), 'WALLET_POOL_ALIAS')
  const selected = new Map<string, string>()
  for (let i = 0; i < evidence.captured.selections.length; i++) {
    const free = evidence.captured.selections[i].selection.Free
    if (free) selected.set(free.id, toHex(evidence.captured.sources[i].binding!.source.source_hash))
  }
  const Key = bcs.struct('ItemKey', { id: bcs.Address }), wrapper = `0x2::dynamic_object_field::Wrapper<${p.target.application.originalPackageId}::character::ItemKey>`
  const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: Key }), value: bcs.Address })
  const items: Array<{ id: string; destination: 'ORIGINAL_APPLICATION' | 'ORIGINAL_SENDER'; source: ReturnType<typeof ManagementSourceBcs.parse> }> = []
  for (const id of pool) {
    const fieldId = deriveDynamicFieldID(p.applicationId, wrapper, Key.serialize({ id }).toBytes())
    const common = { client: input.client, effects: evidence.effects, transactionDigest: evidence.transactionDigest, signal, maxBytes: 256 * 1024 }
    const fieldArgs = { ...common, objectId: fieldId, type: `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>` }
    async function mapping(mode: 'input' | 'written') {
      const object = await readHistoricalMoveObject({ ...fieldArgs, mode }), value = Field.parse(object.bytes)
      check(Field.serialize(value).toBase64() === toBase64(object.bytes) && value.id === fieldId && value.name.name.id === id
        && value.value === id && object.object.owner.ObjectOwner === p.applicationId, 'MAPPING')
    }
    await mapping('input')
    const args = { ...common, objectId: id, type: `${p.target.model.originalPackageId}::components::Item` }
    const old = await readHistoricalMoveObject({ ...args, mode: 'input' }), output = await readHistoricalMoveObject({ ...args, mode: 'mutated' })
    const item = ManagementItemBcs.parse(old.bytes)
    check(ManagementItemBcs.serialize(item).toBase64() === toBase64(old.bytes) && item.id === id && item.source.definition.rights === 2
      && toHex(sha256(ManagementDefinitionBcs.serialize(item.source.definition).toBytes())) === toHex(item.source.definition_hash)
      && old.object.owner.ObjectOwner === fieldId && toBase64(old.bytes) === toBase64(output.bytes), 'ITEM_CONSERVATION')
    if (selected.has(id)) {
      check(output.object.owner.ObjectOwner === fieldId && toHex(sha256(ManagementSourceBcs.serialize(item.source).toBytes())) === selected.get(id), 'REUSED_ITEM')
      await mapping('written'); items.push({ id, destination: 'ORIGINAL_APPLICATION', source: item.source })
    } else {
      const changes = evidence.effects.V2!.changedObjects.filter(([objectId]) => objectId === fieldId)
      check(output.object.owner.AddressOwner === p.author && changes.length === 1 && changes[0][1].outputState.$kind === 'NotExist', 'RETURNED_ITEM')
      items.push({ id, destination: 'ORIGINAL_SENDER', source: item.source })
    }
  }
  signal.throwIfAborted()
  return { ...evidence, status: 'HISTORICAL_ORIGINAL_POOL_ITEM_EVIDENCE' as const, originalPoolItems: items,
    originalPoolItemConservationVerified: true as const, requiresIncomingItemConservationProof: true as const,
    completeBusinessOutputVerified: false as const }
}
