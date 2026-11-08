import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { ManagementItemBcs, ManagementDefinitionBcs, ManagementSourceBcs } from './application-bcs'
import { ApplicationFormSelectionsBcs, ApplicationFormSourcesBcs } from './application-form-snapshot'
import { parseFormsManagementRecord, type FormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalActivate } from './application-forms-historical-activate'
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_INCOMING_${code}`) }

/** Effects-selected incoming wallet Item relations. Caller authenticates effects
 * finality and captured selections. This helper does not authenticate a whole
 * activation or the preexisting original-Soul Item pool. */
export async function verifyFormsHistoricalIncomingItems(input: {
  client: SuiGrpcClient; record: FormsManagementRecord; effects: ReturnType<typeof bcs.TransactionEffects.parse>
  selections: ReturnType<typeof ApplicationFormSelectionsBcs.parse>; sources: ReturnType<typeof ApplicationFormSourcesBcs.parse>; signal: AbortSignal
}) {
  const record = parseFormsManagementRecord(input.record), p = record.plan
  check(p.action.kind === 'ACTIVATE' && input.selections.length === input.sources.length, 'SCOPE')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const data = Transaction.from(fromBase64(record.packet.bytes)).getData(), model = p.target.model.originalPackageId
  const selected = new Map<string, string>()
  for (let i = 0; i < input.selections.length; i++) {
    const free = input.selections[i].selection.Free
    if (!free) continue
    const source = input.sources[i].binding?.source
    check(source && !selected.has(free.id), 'SELECTED_ALIAS'); selected.set(free.id, toHex(source.source_hash))
  }
  const items: Array<{ id: string; destination: 'ORIGINAL_APPLICATION' | 'ORIGINAL_SENDER'; source: ReturnType<typeof ManagementSourceBcs.parse> }> = []
  for (const id of p.action.itemIds) {
    const refs = data.inputs.flatMap(row => row.Object?.ImmOrOwnedObject?.objectId === id ? [row.Object.ImmOrOwnedObject] : [])
    check(refs.length === 1, 'PACKET_REFERENCE')
    const args = { client: input.client, effects: input.effects, transactionDigest: record.packet.digest,
      objectId: id, type: `${model}::components::Item`, signal, maxBytes: 256 * 1024 }
    const old = await readHistoricalMoveObject({ ...args, mode: 'input' }), output = await readHistoricalMoveObject({ ...args, mode: 'mutated' })
    check(String(old.reference.version) === refs[0].version && old.reference.digest === refs[0].digest
      && old.object.owner.AddressOwner === p.author, 'INPUT_REFERENCE')
    const item = ManagementItemBcs.parse(old.bytes)
    check(ManagementItemBcs.serialize(item).toBase64() === toBase64(old.bytes) && item.id === id && item.source.definition.rights === 2
      && toHex(sha256(ManagementDefinitionBcs.serialize(item.source.definition).toBytes())) === toHex(item.source.definition_hash)
      && toBase64(old.bytes) === toBase64(output.bytes), 'ITEM_CONSERVATION')
    if (selected.has(id)) {
      check(toHex(sha256(ManagementSourceBcs.serialize(item.source).toBytes())) === selected.get(id), 'SOURCE')
      const Key = bcs.struct('ItemKey', { id: bcs.Address }), wrapper = `0x2::dynamic_object_field::Wrapper<${p.target.application.originalPackageId}::character::ItemKey>`
      const fieldId = deriveDynamicFieldID(p.applicationId, wrapper, Key.serialize({ id }).toBytes())
      check(output.object.owner.ObjectOwner === fieldId, 'ATTACHED_OWNER')
      const field = await readHistoricalMoveObject({ client: input.client, effects: input.effects, transactionDigest: record.packet.digest,
        objectId: fieldId, type: `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`, mode: 'created', signal, maxBytes: 256 * 1024 })
      const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: Key }), value: bcs.Address }), value = Field.parse(field.bytes)
      check(Field.serialize(value).toBase64() === toBase64(field.bytes) && value.id === fieldId && value.name.name.id === id && value.value === id
        && field.object.owner.ObjectOwner === p.applicationId, 'ATTACHED_FIELD')
      items.push({ id, destination: 'ORIGINAL_APPLICATION', source: item.source })
    } else {
      check(output.object.owner.AddressOwner === p.author, 'RETURN_OWNER')
      items.push({ id, destination: 'ORIGINAL_SENDER', source: item.source })
    }
  }
  signal.throwIfAborted()
  return { items, incomingItemConservationVerified: true as const, completeItemConservationVerified: false as const }
}
export async function readFormsHistoricalIncomingItems(input: Parameters<typeof readFormsHistoricalActivate>[0]) {
  const record = parseFormsManagementRecord(input.record)
  const evidence = await readFormsHistoricalActivate({ ...input, record })
  if (evidence.status !== 'HISTORICAL_ACTIVATE_RELATION_EVIDENCE') return evidence
  const incoming = await verifyFormsHistoricalIncomingItems({ client: input.client, record, effects: evidence.effects,
    selections: evidence.captured.selections, sources: evidence.captured.sources, signal: input.signal })
  return { ...evidence, status: 'HISTORICAL_INCOMING_ITEM_EVIDENCE' as const, incoming,
    requiresOriginalSoulItemPoolProof: true as const, completeBusinessOutputVerified: false as const }
}
