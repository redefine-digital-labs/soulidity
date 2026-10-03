import type { readNativeEquipment } from './native-equipment'
type Snapshot = Awaited<ReturnType<typeof readNativeEquipment>>
export type EquipmentPackAttachmentChoice = { releaseId: string; passId: string }
export function packAttachmentEligibility(snapshot: Snapshot, choice: EquipmentPackAttachmentChoice) {
  const no = (reason: string) => ({ allowed: false as const, reason })
  const { source, equipment } = snapshot; const pack = source?.pack?.selected
  if (snapshot.listed) return no('Listed Souls cannot change equipment.')
  if (!source || source.root.lifecycle !== 1 || !source.access || !equipment) return no('Load active Maker access and create equipment first.')
  if (!pack || pack.release.id !== choice.releaseId || pack.pass.id !== choice.passId
    || pack.pass.release_id !== choice.releaseId || pack.pass.holder !== snapshot.owner) return no('Load the exact Pack pass from the current owner wallet.')
  const eq = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.every((v, i) => v === b[i])
  if (pack.release.root_id !== source.root.id || pack.release.root_version !== source.root.maker_version
    || !eq(pack.release.root_content_commitment, source.root.content.content_commitment)
    || pack.pass.root_id !== source.root.id || pack.pass.root_version !== source.root.maker_version
    || !eq(pack.pass.root_content_commitment, source.root.content.content_commitment)
    || !eq(pack.pass.release_content_commitment, pack.release.content_commitment)) return no('This Pack belongs to a different Maker source.')
  if (pack.release.lifecycle !== 2 || !pack.admission || pack.admission.admission_state !== 0
    || pack.admission.release_id !== pack.release.id || pack.admission.semantic_pack_id !== pack.release.semantic_pack_id
    || pack.semanticReleaseId !== pack.release.id || !eq(pack.admission.release_content_commitment, pack.release.content_commitment)) return no('This Pack is not active and admitted to this Maker.')
  if (!pack.definitionCommitment || pack.definitionCommitment.length !== 32) return no('This Pack has no authored definitions to attach.')
  if (equipment.loadout.attached_pack_definitions.some(row => row.release_id === choice.releaseId)) return no('This Pack is already attached.')
  if (BigInt(equipment.loadout.revision) === 18446744073709551615n) return no('Equipment revision cannot be advanced.')
  if (!Number.isSafeInteger(pack.definitionCapacity) || pack.definitionCapacity < 0
    || equipment.loadout.selections.length + pack.definitionCapacity > 500
    || equipment.loadout.attached_pack_definitions.length >= 500) return no('This Pack exceeds the equipment capacity limit.')
  return { allowed: true as const, reason: `Ready to attach this Pack (${pack.definitionCapacity} new slots).`,
    attachment: { definitionCommitment: pack.definitionCommitment.map(v => v.toString(16).padStart(2, '0')).join(''),
      additionalSlots: pack.definitionCapacity } }
}
