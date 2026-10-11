import { expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { equipmentOperationFixture, signer, eid } from './fixtures/equipment-operation'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { appendWireReplacer } from './fixtures/content-append-browser-runtime'
import { nativeEquipmentPackFixture } from './fixtures/native-equipment-pack'
import { packAttachmentEligibility } from '../../web/lib/animacraft/equipment-pack-attachment'

it('exports exact authored Pack attachment for original browser actions and durable recovery', async () => {
  const f = nativeEquipmentPackFixture(); f.addOwnedColor()
  const before = await f.readPack(), pack = { releaseId: f.releaseId, passId: f.passId }
  const eligibility = packAttachmentEligibility(before, pack)
  if (!eligibility.allowed) throw new Error(eligibility.reason)
  const tx = await equipmentOperationFixture({ kind: 'attach-pack', pack, attachment: eligibility.attachment })
  before.owner = tx.record.owner; before.release = tx.record.release
  before.source!.access!.holder = tx.record.owner
  before.source!.pack!.selected!.pass.holder = tx.record.owner
  for (const row of before.inventory?.objects ?? []) row.item.holder = tx.record.owner
  const after = structuredClone(before)
  after.equipment!.loadout.revision = '2'
  after.equipment!.loadout.attached_pack_definitions.push({ release_id: pack.releaseId,
    definition_commitment: before.source!.pack!.selected!.definitionCommitment! })
  after.updateSource!.packDefinitions = [{ releaseId: pack.releaseId,
    paymentCoinType: tx.record.source!.paymentCoinType, definitionCommitment: eligibility.attachment.definitionCommitment }]
  expect(packAttachmentEligibility(after, pack).allowed).toBe(false)
  const signed = await signer.signTransaction(tx.bytes)
  const data = { before, after, record: tx.record, transaction: tx.tx.getData(), signature: signed.signature }
  if (process.env.S8_BROWSER_DIR) await writeFile(path.join(process.env.S8_BROWSER_DIR, 'wardrobe-attach-pack.json'), JSON.stringify(data, appendWireReplacer))
  const selected = structuredClone(after)
  selected.equipment!.loadout.revision = '4'
  const style = selected.source!.pack!.selected!.styles[0]
  selected.equipment!.loadout.selections[0] = { ...selected.equipment!.loadout.selections[0]!,
    source_class: 1, source_definition_id: pack.releaseId, source_semantic_id: 'winter', access_subject: pack.passId,
    source_epoch: '0', part_key: style.part_key, item_key: style.item_key, style_key: style.style_key,
    layer_track_key: style.layer_track_key, color_channel_key: style.color_channel_key, swatch_key: 'violet',
    asset_blob_id: style.asset_blob_id, asset_sha256: style.asset_sha256,
    asset_content_commitment: style.asset_content_commitment, protected: false, seal_binding_commitment: [] }
  selected.equipment!.instances = []
  for (const row of selected.inventory?.objects ?? []) { row.item.equip_lock = null; row.occupancy = 'UNLOCKED' }
  const selection = await equipmentOperationFixture({ kind: 'select-pack', targetSelectionIndex: '0',
    selection: { ...pack, baseRegistryId: eid(85), partKey: 'body', itemKey: 'pack-hat', styleKey: 'snow', swatchKey: 'violet' },
    replaces: { kind: 'base', itemId: eid(84) } }, after.updateSource!.packDefinitions, '2')
  const cleared = structuredClone(selected)
  cleared.equipment!.loadout.revision = '5'; cleared.equipment!.loadout.selections = [null]
  cleared.equipment!.loadout.selection_count = '0'
  const removal = await equipmentOperationFixture({ kind: 'clear-selection', selectionIndex: '0' },
    after.updateSource!.packDefinitions, '4')
  const steps = [data]
  for (const [transaction, before, after] of [[selection, data.after, selected], [removal, selected, cleared]] as const) {
    const signature = await signer.signTransaction(transaction.bytes)
    steps.push({ before, after, record: transaction.record, transaction: transaction.tx.getData(), signature: signature.signature })
  }
  if (process.env.S8_BROWSER_DIR) await writeFile(path.join(process.env.S8_BROWSER_DIR, 'wardrobe-pack-journey.json'), JSON.stringify({ steps }, appendWireReplacer))
})

it.each(['removal','equip'])('exports the existing Wardrobe %s fixture for original hook/browser acceptance', async mode => {
  const f = nativeEquipmentSourceFixture(), tx = await equipmentOperationFixture(mode==='equip' ? {
    kind:'equip',styleStart:0,targetSelectionIndex:'0',item:{kind:'base',itemId:eid(84),baseRegistryId:eid(85),styleKey:'red',swatchKey:'red'}
  } : undefined)
  const before = await f.readBase()
  // This browser seam controls snapshots and ledger; it is NOT raw owner proof.
  before.owner = tx.record.owner; before.release = tx.record.release
  before.source!.access!.holder = tx.record.owner
  for (const row of before.inventory!.objects) row.item.holder = tx.record.owner
  const after = structuredClone(before)
  after.equipment!.loadout.revision = '2'
  const empty=mode==='equip'?before:after
  empty.equipment!.loadout.selections=[null];empty.equipment!.loadout.selection_count='0';empty.equipment!.instances=[]
  empty.inventory!.objects[0].item.equip_lock=null;empty.inventory!.objects[0].occupancy='UNLOCKED'
  if(mode==='equip'){
    const selection=after.equipment!.loadout.selections[0]!
    selection.color_channel_key='tint';selection.swatch_key='red'
    after.equipment!.instances[0].item.equip_lock!.equip_revision='2'
    after.inventory!.objects[0].item.equip_lock!.equip_revision='2'
  }
  expect((mode==='equip'?after:before).equipment!.instances).toHaveLength(1)
  expect(after.inventory!.objects[0].item.id).toBe(eid(84))
  const signed = await signer.signTransaction(tx.bytes)
  const data = {before, after, record:tx.record, transaction:tx.tx.getData(), signature:signed.signature}
  if(process.env.S8_BROWSER_DIR) await writeFile(path.join(process.env.S8_BROWSER_DIR,mode==='removal'?'wardrobe.json':'wardrobe-equip.json'),JSON.stringify(data,appendWireReplacer))
})
