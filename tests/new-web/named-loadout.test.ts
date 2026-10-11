import { expect,it } from 'vitest'
import { captureNamedLoadout,validateNamedLoadoutContent,normalizeNamedLoadoutName,validNamedLoadoutId } from '../../web/lib/animacraft/named-loadout'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { nativeEquipmentPackFixture } from './fixtures/native-equipment-pack'

it.each(['base-item','base-selection','pack-selection','external-item'] as const)('captures verified %s references without a second asset or reusable proof', async kind => {
  const f = nativeEquipmentSourceFixture()
  const snapshot = kind === 'pack-selection' ? await nativeEquipmentPackFixture().readPack()
    : kind === 'external-item' ? await f.addExternal().read() : await f.readBase()
  if (kind === 'base-selection') {
    snapshot.equipment!.loadout.selections[0]!.access_subject = snapshot.equipment!.loadout.maker_access_pass_id
    snapshot.equipment!.instances = []
  }
  if (kind === 'pack-selection') {
    const pack = snapshot.source!.pack!.selected!
    const style = pack.styles[0]
    Object.assign(snapshot.equipment!.loadout.selections[0]!, {source_class:1,source_definition_id:pack.release.id,
      access_subject:pack.pass.id,part_key:style.part_key,item_key:style.item_key,style_key:style.style_key,
      asset_content_commitment:style.asset_content_commitment,protected:style.protected,seal_binding_commitment:style.seal_binding_commitment})
    snapshot.equipment!.instances = []
  }
  // The external fixture offers an unequipped wallet component; explicitly use
  // its already verified product/content identity for this pure capture case.
  if (kind === 'external-item') {
    const external = snapshot.inventory!.objects.find(row => row.kind === 'external')!
    const item = external.item as Extract<typeof external.item,{product_id:string}>
    const row = snapshot.equipment!.loadout.selections[0]!
    row.source_class = 2; row.access_subject = item.id; row.source_definition_id = item.product_id
    row.asset_content_commitment = item.asset_content_commitment
    item.equip_lock = {loadout_id:snapshot.equipment!.loadout.id,selection_index:'0',equip_revision:'1'}
    snapshot.equipment!.instances = [{kind:'external',item}]
  }
  const saved = captureNamedLoadout(snapshot)
  expect(saved.slots[0]?.kind).toBe(kind)
  expect(saved.slots[0]?.accessSubject).toBe(snapshot.equipment!.loadout.selections[0]!.access_subject)
  expect(saved.slots[0]?.assetContentCommitment).toBe(Buffer.from(snapshot.equipment!.loadout.selections[0]!.asset_content_commitment).toString('hex'))
  expect(validateNamedLoadoutContent(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  expect(saved).not.toHaveProperty('source'); expect(saved.slots[0]).not.toHaveProperty('proof')
  expect(saved.slots[0]).not.toHaveProperty('asset_blob_id')
})
it('preserves empty and sparse capacity up to the exact last slot without compacting it', async () => {
  const snapshot = await nativeEquipmentSourceFixture().readBase()
  const row = snapshot.equipment!.loadout.selections[0]!
  row.selection_index = '499'
  snapshot.equipment!.loadout.selections = Array(500).fill(null); snapshot.equipment!.loadout.selections[499] = row
  snapshot.equipment!.instances[0].item.equip_lock!.selection_index = '499'
  const saved = captureNamedLoadout(snapshot)
  expect(saved.slots).toHaveLength(500); expect(saved.slots.slice(0,499).every(row => row === null)).toBe(true)
  expect(saved.slots[499]?.kind).toBe('base-item')
  snapshot.equipment!.loadout.selections[499] = null; snapshot.equipment!.instances = []
  expect(captureNamedLoadout(snapshot).slots.every(row => row === null)).toBe(true)
})
it('refuses an owned capture without the exact current lock or with a forged selection index', async () => {
  const snapshot = await nativeEquipmentSourceFixture().readBase()
  snapshot.equipment!.instances[0].item.equip_lock!.selection_index = '1'
  expect(() => captureNamedLoadout(snapshot)).toThrow(/lock/)
  snapshot.equipment!.loadout.selections[0]!.selection_index = '2'
  expect(() => captureNamedLoadout(snapshot)).toThrow(/slot/)
})
it.each(['unknown','proof','root','access','duplicate','count','hash','id','epoch','key','source-class'])('rejects malformed saved %s instead of treating it as authority', async change => {
  const saved = captureNamedLoadout(await nativeEquipmentSourceFixture().readBase()) as any
  if (change === 'unknown') saved.privateKey = 'must-not-persist'
  if (change === 'proof') saved.slots[0].proof = {sealId:[]}
  if (change === 'root') saved.slots[0].sourceDefinitionId = `0x${'f'.repeat(64)}`
  if (change === 'access') {saved.slots[0].kind='base-selection';saved.slots[0].accessSubject=`0x${'f'.repeat(64)}`}
  if (change === 'duplicate') saved.slots.push({...saved.slots[0]})
  if (change === 'count') saved.slots = Array(501).fill(null)
  if (change === 'hash') saved.slots[0].assetContentCommitment = '00'
  if (change === 'id') saved.soulId = '0x1'
  if (change === 'epoch') saved.capturedOwnershipEpoch = '01'
  if (change === 'key') saved.slots[0].styleKey = 'bad\0key'
  if (change === 'source-class') saved.slots[0].kind = 'guess'
  expect(() => validateNamedLoadoutContent(saved)).toThrow()
})
it('normalizes bounded names and accepts only canonical stable IDs', () => {
  expect(normalizeNamedLoadoutName('  cafe\u0301  ')).toBe('café')
  expect(normalizeNamedLoadoutName('搭'.repeat(80))).toHaveLength(80)
  expect([...normalizeNamedLoadoutName('🦊'.repeat(80))]).toHaveLength(80)
  for (const name of ['', ' ', 'x'.repeat(81), 'bad\nname', null]) expect(() => normalizeNamedLoadoutName(name)).toThrow()
  expect(validNamedLoadoutId('12345678-1234-1234-1234-123456789abc')).toBe(true)
  expect(validNamedLoadoutId('12345678-1234-1234-1234-123456789abC')).toBe(false)
})
it('preserves actual empty unprotected Seal commitments and requires exact protected commitments', async () => {
  const snapshot = await nativeEquipmentSourceFixture().readBase()
  expect(captureNamedLoadout(snapshot).slots[0]?.sealBindingCommitment).toBe('')
  snapshot.equipment!.loadout.selections[0]!.protected = true
  expect(() => captureNamedLoadout(snapshot)).toThrow(/selection/)
  snapshot.equipment!.loadout.selections[0]!.seal_binding_commitment = Array(32).fill(8)
  expect(captureNamedLoadout(snapshot).slots[0]?.sealBindingCommitment).toBe('08'.repeat(32))
})
