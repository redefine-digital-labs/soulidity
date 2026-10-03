import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { EquipmentMakerBcs, EquipmentBaseRegistryBcs, EquipmentDefinitionsBcs, EquipmentPackRegistryBcs, EquipmentAccessPassBcs,
  EquipmentExternalProductBcs, EquipmentExternalAdmissionBcs, EquipmentProtocolBcs,
  EquipmentBaseHolderKeyBcs, EquipmentBaseOwnershipBcs, EquipmentProfileBcs } from '../../web/lib/animacraft/native-equipment-source-bcs'
import { equipmentProtocolCommitment } from '../../web/lib/animacraft/native-equipment-source'
import { EquipmentBaseItemBcs, readNativeEquipment } from '../../web/lib/animacraft/native-equipment'
const id = (n: number) => `0x${n.toString(16).padStart(64,'0')}`
it('keeps one Soul position when the Maker authoring capacity is three', async () => {
  const f = nativeEquipmentSourceFixture()
  const ProfileField = bcs.struct('Field', { id: bcs.Address,
    name: bcs.struct('PartProfileKeyV8', { part_key: bcs.string() }), value: EquipmentProfileBcs })
  f.set(f.profileId, ProfileField, row => { row.value.capacity = '3' })
  const result = await f.readBase()
  expect(result.source?.slots).toMatchObject([{ part_key: 'body', slotStart: 0, capacity: '1', makerCapacity: '3' }])
  expect(result.equipment?.loadout.selections).toHaveLength(1)
  expect(ProfileField.parse(f.objects.get(f.profileId).contents.value).value.capacity).toBe('3')
})
it('reads actual source registries, access, slots, style and color fields', async () => {
  const f = nativeEquipmentSourceFixture(); const { source } = await f.readSource()
  expect(source).toMatchObject({ eligibility: 'SOURCE_CONFIGURATION_ONLY', slots: [{ part_key: 'body', slotStart: 0, capacity: '1' }],
    access: { id: id(83) }, styles: [{ label: 'Red hat', style_key: 'red' }], colors: [{ key: 'tint', swatches: [{ key: 'red' }] }], stylePage: { start: 0, next: null, total: 1 } })
})
it.each(['root','definitions','packs','base','access'])('rejects mismatched %s source before returning choices', async name => {
  const f = nativeEquipmentSourceFixture()
  const [objectId, schema] = ({ root: [id(10), EquipmentMakerBcs], definitions: [id(81), EquipmentDefinitionsBcs],
    packs: [id(82), EquipmentPackRegistryBcs], base: [id(85), EquipmentBaseRegistryBcs], access: [id(83), EquipmentAccessPassBcs] } as const)[name as 'root']
  f.set(objectId, schema, v => { if (name === 'root') v.content.content_commitment = Array(32).fill(99); else v.root_id = id(99) })
  await expect(f.readSource()).rejects.toThrow(/mismatch/)
})
it('fails when source lookup is missing instead of substituting default slots or styles', async () => {
  const f = nativeEquipmentSourceFixture(); f.objects.delete(f.profileId)
  await expect(f.readSource()).rejects.toThrow('batch lookup')
})
it('allows read-only source inspection after Maker pause, without promising permission to equip', async () => {
  const f = nativeEquipmentSourceFixture(); f.set(id(10), EquipmentMakerBcs, v => { v.lifecycle = 2 })
  expect((await f.readSource()).source?.root.lifecycle).toBe(2)
})
it('supports no access before equipment creation, but rejects loss of an existing equipment pass', async () => {
  const f = nativeEquipmentSourceFixture(); f.objects.delete(f.accessId)
  await expect(f.readSource()).rejects.toThrow('access pointer')
  f.objects.delete(f.pointerId)
  expect((await f.readSource()).source?.access).toBeNull()
})
it('rejects differing native/Runtime Core linkage and malformed style page bounds', async () => {
  const f = nativeEquipmentSourceFixture(); f.objects.get(id(71)).package.linkage.at(-1).upgradedId = id(99)
  await expect(f.readSource()).rejects.toThrow('Core linkage')
  f.objects.get(id(71)).package.linkage.at(-1).upgradedId = id(72)
  await expect(f.readSource(2)).rejects.toThrow('page range')
  expect((await f.readSource(1)).source?.styles).toEqual([])
})
const AdmissionField = bcs.struct('Field', { id: bcs.Address, name: bcs.Address, value: EquipmentExternalAdmissionBcs })
it('reads an external product from wallet discovery and its exact Maker admission field', async () => {
  const f = nativeEquipmentSourceFixture(); const e = f.addExternal(); const result = await e.read()
  expect(result.source?.external).toMatchObject([{ product: { id: e.productId, style_key: 'blue' },
    admission: { product_id: e.productId, admission_state: 0 } }])
  expect(result.inventory?.objects[0]).toMatchObject({ item: { id: e.itemId }, eligibility: 'NOT_EVALUATED' })
})
it('distinguishes absent and revoked external admission without inventing equip permission', async () => {
  const f = nativeEquipmentSourceFixture(); const e = f.addExternal()
  f.set(e.admissionId, AdmissionField, v => { v.value.admission_state = 1 })
  expect((await e.read()).source?.external[0].admission?.admission_state).toBe(1)
  f.objects.delete(e.admissionId)
  expect((await e.read()).source?.external[0].admission).toBeNull()
})
it.each(['product-id','product-owner','field-key','field-value','field-parent'])('rejects external source %s mismatch', async problem => {
  const f = nativeEquipmentSourceFixture(); const e = f.addExternal()
  if (problem === 'product-id') f.set(e.productId, EquipmentExternalProductBcs, v => { v.id = id(999) })
  if (problem === 'product-owner') f.objects.get(e.productId).owner.kind = 1
  if (problem === 'field-key') f.set(e.admissionId, AdmissionField, v => { v.name = id(999) })
  if (problem === 'field-value') f.set(e.admissionId, AdmissionField, v => { v.value.product_id = id(999) })
  if (problem === 'field-parent') f.objects.get(e.admissionId).owner.address = id(999)
  await expect(e.read()).rejects.toThrow(/mismatch/)
})
it('does not interpret an admission RPC failure as absence', async () => {
  const f = nativeEquipmentSourceFixture(); const e = f.addExternal()
  const original = f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).batchGetObjects = async (request: any) => request.requests.some((r: any) => r.objectId === e.admissionId)
    ? { response: { objects: [{ result: { oneofKind: 'error', error: { code: 14, message: 'offline' } } }] } }
    : original(request)
  await expect(e.read()).rejects.toThrow()
})
it('checks the exact access entitlement, not just a matching pass ID', async () => {
  const f = nativeEquipmentSourceFixture(); f.editLoadout(v => { v.maker_access_commitment = Array(32).fill(99) })
  await expect(f.readSource()).rejects.toThrow('entitlement mismatch')
})
it('reads exact Base owner record and locked track; an absent record is explicit', async () => {
  const f = nativeEquipmentSourceFixture(); const result = await f.readBase()
  expect(result.source).toMatchObject({ currentProtocol: true, tracks: [{ key: 'front', locked: true }],
    ownership: [{ itemId: id(84), record: { item_id: id(84), ownership_epoch: '0' } }] })
  f.objects.delete(f.ownershipId)
  expect((await f.readBase()).source!.ownership[0].record).toBeNull()
  f.objects.delete(f.trackId)
  await expect(f.readSource()).rejects.toThrow()
})
it('reads the selected Base ItemRow even outside its style page; does not invent missing styles', async () => {
  const f = nativeEquipmentSourceFixture(); const result = await f.readBase(1)
  expect(result.source!.styles).toEqual([])
  expect(result.source!.items[0].item_key).toBe('hat')
})
it('rejects Base owner field key/parent and network failure, not as harmless absence', async () => {
  const f = nativeEquipmentSourceFixture()
  const schema = bcs.struct('Field', { id: bcs.Address, name: EquipmentBaseHolderKeyBcs, value: EquipmentBaseOwnershipBcs })
  f.set(f.ownershipId,schema,v => { v.name.holder = id(999) })
  await expect(f.readBase()).rejects.toThrow('ownership key')
  f.set(f.ownershipId,schema,v => { v.name.holder = id(11) })
  f.objects.get(f.ownershipId).owner.address = id(999)
  await expect(f.readBase()).rejects.toThrow()
  f.objects.get(f.ownershipId).owner.address = id(95)
  const original = f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).batchGetObjects = async (request: any) => request.requests.some((r: any) => r.objectId === f.ownershipId)
    ? { response: { objects: [{ result: { oneofKind: 'error', error: { code: 14, message: 'offline' } } }] } } : original(request)
  await expect(f.readBase()).rejects.toThrow()
})
it('point reads a chosen instance without the index, still rejecting wrong live custody', async () => {
  const f = nativeEquipmentSourceFixture()
  ;(f.client.core as any).listOwnedObjects = () => { throw new Error('must not list') }
  expect((await f.readBase()).inventory!.objects[0].item.id).toBe(id(84))
  f.objects.get(id(84)).owner.address = id(999)
  await expect(f.readBase()).rejects.toThrow()
})
it('rejects a rehashed loadout whose immutable layout differs from the sealed profile', async () => {
  const f = nativeEquipmentSourceFixture()
  f.editLoadout(value => { value.definition_slots[0].profile_commitment[0] ^= 1 })
  await expect(f.readSource()).rejects.toThrow('Source definition slot profile mismatch')
})
it('keeps another Maker’s wallet Base instance readable without looking up its ownership in this Maker', async () => {
  const f = nativeEquipmentSourceFixture(); f.objects.delete(f.pointerId)
  f.set(id(84),EquipmentBaseItemBcs,v => { v.root_id = id(999); v.equip_lock = null })
  expect((await f.readBase()).source!.ownership).toEqual([])
})
it.each(['disabled','revision','treasury','fees','marker','coin','economics'])('exposes protocol %s drift as create-only unavailable, not a read failure', async problem => {
  const f = nativeEquipmentSourceFixture()
  f.set(id(1),EquipmentProtocolBcs,v => {
    if (problem === 'disabled') v.enabled = false
    if (problem === 'revision') v.revision = '2'
    if (problem === 'treasury') v.treasury_id = null
    if (problem === 'fees') v.fixed_complete_fee_atomic = '1'
    if (problem === 'marker') v.core_callable_package_id = id(72)
    if (problem === 'coin') v.payment_coin_type = `${id(2)}::other::COIN`
    v.commitment = equipmentProtocolCommitment(v)
  })
  if (problem === 'economics') f.set(id(10),EquipmentMakerBcs,v => { v.economics.commitment = Array(32).fill(99) })
  expect((await f.readSource()).source!.currentProtocol).toBe(false)
})
it('rejects corrupt protocol commitments and targeted cursor ambiguity', async () => {
  const f = nativeEquipmentSourceFixture(); f.set(id(1),EquipmentProtocolBcs,v => { v.commitment = Array(32).fill(99) })
  await expect(f.readSource()).rejects.toThrow('Protocol source commitment')
  await expect(readNativeEquipment(f.client,f.target,{ soulId: id(12), stateId: id(14),
    inventory: { kind: 'base', itemId: id(84), cursor: 'YQ==' } })).rejects.toThrow('cannot use a cursor')
})
