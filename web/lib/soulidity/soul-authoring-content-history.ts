import { bcs } from '@mysten/sui/bcs'
import { toBase64 } from '@mysten/sui/utils'
import { SoulContentPublicBcs, SoulContentKeyPublicBcs, SoulContentSlotPublicBcs, SoulDetailStateBcs, downloadPolicyToU8,
  type InitialContentEntryInput, type StateConfigEntryInput } from '@soulidity/sdk'
import { historicalObjectOutput } from '../sui/historical-object'
import { contentEnvelopeKey } from './content-envelope'
import { soulAuthoringPacketCheck as check } from './soul-authoring-packet'
import type { SoulAuthoringHistoricalReader } from './soul-authoring-history-read'

const A = bcs.Address, S = bcs.string(), N = bcs.u32(), U = bcs.u64(), V = bcs.vector(bcs.u8())
const BlobKey = bcs.struct('ContentBlobKey', { kind: N, name: S, version_index: U })
const Wrapper = bcs.struct('Wrapper', { name: BlobKey })
export const SoulAuthoringContentEventBcs = bcs.struct('ContentVersionAppended', {
  content_id: A, soul_id: A, kind: N, kind_name: S, name: S, version_index: U,
  is_public: bcs.bool(), download_policy: bcs.u8(), grant_scope_mask: U, read_mode_mask: U, op_mask: U,
  seal_encrypted: bcs.bool(), blob_object_id: A, created_at_ms: U,
})
export type SoulAuthoringContentEvent = ReturnType<typeof SoulAuthoringContentEventBcs.parse>
/** Prove every initial version, final active binding, public config and exact
 * encrypted envelope against the independently materialized mint. The caller
 * first authenticates/filter-checks the event stream and proves State/Soul roots. */
export async function proveSoulAuthoringContent(params: {
  reader: SoulAuthoringHistoricalReader; originalPackageId: string; soulId: string; contentId: string
  stateConfigTable: { id: string; size: string }; initialContent: readonly InitialContentEntryInput[]
  initialStateConfig: readonly StateConfigEntryInput[]; events: readonly SoulAuthoringContentEvent[]
}) {
  const reader = params.reader, p = structuredClone({ ...params, reader: undefined }), pkg = p.originalPackageId
  const root = await reader.read(p.contentId, `${pkg}::content::SoulContent`, SoulContentPublicBcs), content = root.value
  check(content.id === p.contentId && content.version === '1' && content.soul_id === p.soulId
    && root.reference.owner.Shared?.initialSharedVersion === reader.effects.V2!.lamportVersion, 'INITIAL_CONTENT_ROOT')
  const tables = [content.items, content.count_by_kind, content.active, p.stateConfigTable]
  check(new Set([p.contentId, p.soulId, ...tables.map(t => t.id)]).size === 6, 'INITIAL_TABLE_ALIAS')
  const groups = new Map<string, InitialContentEntryInput[]>(), counts = new Map<number, number>()
  const active = new Map<number, InitialContentEntryInput>(), configs = new Map<string, Uint8Array>()
  for (const config of p.initialStateConfig) {
    check(!configs.has(config.key), 'INITIAL_CONFIG_ALIAS'); configs.set(config.key, new TextEncoder().encode(config.valueUtf8))
  }
  check(p.events.length === p.initialContent.length, 'INITIAL_CONTENT_EVENT_COUNT')
  p.initialContent.forEach((entry, index) => {
    const key = `${entry.kind}:${entry.name}`, entries = groups.get(key) ?? []
    check(String(entry.expectedVersionIndex) === String(entries.length), 'INITIAL_VERSION_ORDER')
    if (!entries.length) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1)
    entries.push(entry); groups.set(key, entries)
    if (entry.setActive) active.set(entry.kind, entry)
    const envelope = contentEnvelopeKey({ contentObjectId: p.contentId, kind: entry.kind, name: entry.name,
      versionIndex: String(entry.expectedVersionIndex), blobObjectId: entry.blobObjectId })
    check(!configs.has(envelope), 'INITIAL_ENVELOPE_ALIAS'); configs.set(envelope, new Uint8Array(entry.encryptedEnvelope))
    const e = p.events[index]
    check(e.content_id === p.contentId && e.soul_id === p.soulId && e.kind === entry.kind && e.name === entry.name
      && e.version_index === String(entry.expectedVersionIndex) && e.blob_object_id === entry.blobObjectId
      && e.read_mode_mask === String(entry.slotReadModeMask) && e.download_policy === downloadPolicyToU8(entry.downloadPolicy)
      && e.is_public === Boolean(entry.slotReadModeMask & 8) && e.seal_encrypted, 'INITIAL_CONTENT_EVENT_MISMATCH')
  })
  check(content.items.size === String(groups.size) && content.count_by_kind.size === String(counts.size)
    && content.active.size === String(active.size) && p.stateConfigTable.size === String(configs.size), 'INITIAL_TABLE_COUNTS')
  let offset = 0
  const events = new Map(p.events.map(e => [`${e.kind}:${e.name}:${e.version_index}`, e]))
  check(events.size === p.events.length, 'INITIAL_EVENT_ALIAS')
  for (const entries of groups.values()) {
    const first = entries[0]
    const slots = await reader.field(content.items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs,
      { kind: first.kind, name: first.name }, `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs))
    check(slots.value.length === entries.length, 'INITIAL_SLOT_COUNT')
    for (const [index, entry] of entries.entries()) {
      const slot = slots.value[index], event = events.get(`${entry.kind}:${entry.name}:${entry.expectedVersionIndex}`)!
      check(slot.version === '1' && slot.kind === entry.kind && slot.blob_object_id === entry.blobObjectId
        && !slot.deleted && !slot.purged && slot.seal_encrypted && slot.is_public === event.is_public
        && slot.download_policy === event.download_policy && slot.read_mode_mask === event.read_mode_mask
        && slot.grant_scope_mask === event.grant_scope_mask && slot.op_mask === event.op_mask
        && slot.created_at_ms === event.created_at_ms, 'INITIAL_SLOT_MISMATCH')
      const wrapper = await reader.field(p.contentId, `0x2::dynamic_object_field::Wrapper<${pkg}::content::ContentBlobKey>`, Wrapper,
        { name: { kind: entry.kind, name: entry.name, version_index: String(index) } }, '0x2::object::ID', A)
      check(wrapper.value === entry.blobObjectId && historicalObjectOutput(reader.effects, entry.blobObjectId, 'mutated').owner.ObjectOwner === wrapper.objectId,
        'INITIAL_BLOB_CONTAINMENT')
      offset++
    }
  }
  check(offset === p.initialContent.length, 'INITIAL_CONTENT_COVERAGE')
  for (const [kind, count] of counts) {
    const field = await reader.field(content.count_by_kind.id, 'u32', N, kind, 'u64', U)
    check(field.value === String(count), 'INITIAL_KIND_COUNT')
  }
  for (const [kind, entry] of active) {
    const field = await reader.field(content.active.id, 'u32', N, kind, `${pkg}::content::ActiveBinding`, SoulDetailStateBcs.Active), value = field.value
    check(value.version === '1' && value.kind === kind && value.name === entry.name
      && value.version_index === String(entry.expectedVersionIndex) && value.download_policy === downloadPolicyToU8(entry.downloadPolicy), 'INITIAL_ACTIVE_MISMATCH')
  }
  for (const [key, bytes] of configs) {
    const field = await reader.field(p.stateConfigTable.id, '0x1::string::String', S, key, 'vector<u8>', V)
    check(toBase64(new Uint8Array(field.value)) === toBase64(bytes), 'INITIAL_CONFIG_OR_ENVELOPE_MISMATCH')
  }
  return content
}
