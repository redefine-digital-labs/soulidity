import { expect, it } from 'vitest'
import { nativeEquipmentPackFixture, packId as id } from './fixtures/native-equipment-pack'
import { packAttachmentEligibility } from '../../web/lib/animacraft/equipment-pack-attachment'
import { equipmentOperationFixture } from './fixtures/equipment-operation'
import { validateEquipmentOperationRecord } from '../../web/lib/animacraft/equipment-operation'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
const pack = { releaseId: id(202), passId: id(201) }
const operation = { kind: 'attach-pack' as const, pack,
  attachment: { definitionCommitment: 'ab'.repeat(32), additionalSlots: 2 } }
async function snapshot() {
  const f = nativeEquipmentPackFixture(); f.addOwnedColor()
  return f.readPack()
}
it('permits explicit zero-Part attachment without selecting a style or purchasing access', async () => {
  const s = await snapshot()
  expect(packAttachmentEligibility(s, pack)).toMatchObject({ allowed: true, attachment: { additionalSlots: 0 } })
  expect(s.equipment!.loadout.selections).toHaveLength(1)
})
it.each(['listed', 'inactive', 'access', 'holder', 'admission', 'definition', 'duplicate', 'capacity', 'revision'])
('rejects attachment %s before preparing a transaction', async problem => {
  const s = await snapshot(); const selected = s.source!.pack!.selected!
  if (problem === 'listed') s.listed = true
  if (problem === 'inactive') selected.release.lifecycle = 1
  if (problem === 'access') s.source!.access = null
  if (problem === 'holder') selected.pass.holder = id(999)
  if (problem === 'admission') selected.admission = null
  if (problem === 'definition') selected.definitionCommitment = null
  if (problem === 'duplicate') s.equipment!.loadout.attached_pack_definitions.push({ release_id: pack.releaseId, definition_commitment: Array(32).fill(1) })
  if (problem === 'capacity') selected.definitionCapacity = 500
  if (problem === 'revision') s.equipment!.loadout.revision = '18446744073709551615'
  expect(packAttachmentEligibility(s, pack).allowed).toBe(false)
})
it('builds attachment then proofs for both existing and newly appended Pack before the final guard', async () => {
  const { record, tx } = await equipmentOperationFixture(operation,
    [{ releaseId: id(2001), paymentCoinType: `${id(2)}::sui::SUI`, definitionCommitment: 'cd'.repeat(32) }])
  expect(validateEquipmentOperationRecord(record)).toBe(record)
  const commands = tx.getData().commands
  expect(commands.map(row => row.MoveCall?.function ?? row.$kind)).toEqual(['begin_update_v8', 'attach_pack_definitions_v8',
    'prove_equipment_pack_definitions_v8', 'prove_equipment_pack_definitions_v8', 'MakeMoveVec', 'finish_update_v8'])
  expect(commands[4].MakeMoveVec?.elements).toEqual([{ $kind: 'Result', Result: 2 }, { $kind: 'Result', Result: 3 }])
})
it.each(['missing-proof', 'changed-pass', 'changed-release', 'missing-plan'])('rejects %s when recovering attachment bytes', async problem => {
  const { record, tx } = await equipmentOperationFixture(structuredClone(operation))
  const data = tx.getData()
  if (record.operation.kind !== 'attach-pack') throw new Error('fixture')
  if (problem === 'missing-proof') data.commands[3].MakeMoveVec!.elements = []
  if (problem === 'changed-pass') record.operation.pack.passId = id(999)
  if (problem === 'changed-release') record.operation.pack.releaseId = id(999)
  if (problem === 'missing-plan') delete record.operation.attachment
  const bytes = await Transaction.from(JSON.stringify(data)).build()
  record.bytes = toBase64(bytes); record.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  expect(() => validateEquipmentOperationRecord(record)).toThrow()
})
