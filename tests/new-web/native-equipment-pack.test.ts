import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { nativeEquipmentPackFixture, packId as id } from './fixtures/native-equipment-pack'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { EquipmentPackPassBcs, EquipmentPackReleaseBcs, EquipmentPackStyleBcs, EquipmentPackStyleKeyBcs,
  EquipmentPackAdmissionBcs, equipmentPackPassCommitment } from '../../web/lib/animacraft/native-equipment-pack'
const AdmissionField = bcs.struct('Field', { id: bcs.Address, name: bcs.Address, value: EquipmentPackAdmissionBcs })
const StyleField = bcs.struct('Field', { id: bcs.Address, name: EquipmentPackStyleKeyBcs, value: EquipmentPackStyleBcs })
const SemanticField = bcs.struct('Field', { id: bcs.Address, name: bcs.string(), value: bcs.Address })

it.each(['part', 'track'] as const)('rejects Pack-owned %s definitions instead of resolving Base collisions', async scope => {
  const f = nativeEquipmentPackFixture()
  f.set(f.packStyleId, StyleField, row => { row.value.definition_sources[scope] = 2 })
  await expect(f.readPack()).rejects.toThrow('Pack definitions missing')
})
it.each(['part', 'track', 'color', 'missing-color', 'unexpected-color'])('rejects invalid Pack source marker %s', async problem => {
  const f = nativeEquipmentPackFixture()
  f.set(f.packStyleId, StyleField, row => {
    if (problem === 'missing-color') row.value.definition_sources.color = null
    else if (problem === 'unexpected-color') row.value.color_channel_key = null
    else row.value.definition_sources[problem as 'part' | 'track' | 'color'] = 0
  })
  await expect(f.readPack()).rejects.toThrow('Pack definition sources invalid')
})
it('accepts explicit Base sources with no color and requires the fresh Pack Style wire layout', async () => {
  const f = nativeEquipmentPackFixture()
  const object = f.objects.get(f.packStyleId)
  const bytes = object.contents.value as Uint8Array
  const offset = 32 + EquipmentPackStyleKeyBcs.serialize(f.packStyle).toBytes().length + 8
  expect([...bytes.slice(offset, offset + 4)]).toEqual([1, 1, 1, 1])
  object.contents.value = new Uint8Array([...bytes.slice(0, offset), ...bytes.slice(offset + 4)])
  await expect(f.readPack()).rejects.toThrow()
  object.contents.value = bytes
  f.set(f.packStyleId, StyleField, row => {
    row.value.color_channel_key = null; row.value.default_swatch_key = null; row.value.definition_sources.color = null
  })
  expect((await f.readPack()).source?.pack?.selected).toMatchObject({ colors: [],
    styles: [{ definition_sources: { part: 1, track: 1, color: null } }] })
})

it('keeps old source requests independent of new Pack type origins', async () => {
  const f = nativeEquipmentSourceFixture(); expect((await f.readSource()).source?.pack).toBeNull()
})
it('discovers a real bounded wallet pass page and marks unrelated Maker passes incompatible', async () => {
  const f = nativeEquipmentPackFixture()
  f.set(f.passId, EquipmentPackPassBcs, p => { p.root_id = id(999); p.commitment = equipmentPackPassCommitment(p) })
  f.listPasses.mockResolvedValue({ objects: [f.passHint], hasNextPage: true, cursor: 'bmV4dA==' })
  const pack = (await f.readPack({ cursor: 'Zmlyc3Q=' })).source?.pack
  expect(pack).toMatchObject({ passes: [{ compatible: false }], selected: null, hasNextPage: true, cursor: 'bmV4dA==' })
  expect(f.listPasses).toHaveBeenCalledWith({ owner: id(11), type: f.runtimeType('PackPassV8'), limit: 20, cursor: 'Zmlyc3Q=' })
  expect(f.listStyles).not.toHaveBeenCalled()
})
it('reads the selected pass independently of wallet index plus exact admission, styles and Core colors', async () => {
  const f = nativeEquipmentPackFixture(); f.listPasses.mockRejectedValue(new Error('index unavailable'))
  const { source } = await f.readPack()
  expect(source?.pack?.selected).toMatchObject({ pass: { id: f.passId }, release: { id: f.releaseId, control_epoch: '9', lifecycle: 2 },
    admission: { admission_state: 0 }, semanticReleaseId: f.releaseId, styles: [{ item_key: 'pack-hat', style_key: 'snow' }],
    colors: [{ key: 'pack-tint', swatches: [{ key: 'snow' }, { key: 'gold' }] }], hasNextPage: false, cursor: null })
  expect(source?.colors.map(row => row.key)).toEqual(['tint'])
  expect(f.listPasses).not.toHaveBeenCalled()
  expect(f.listStyles).toHaveBeenCalledWith({ parentId: f.stylesId, limit: 20, cursor: undefined })
})
it('reads exact selected style without relying on dynamic field index order', async () => {
  const f = nativeEquipmentPackFixture(); f.listStyles.mockRejectedValue(new Error('index unavailable'))
  const { source } = await f.readPack({ passId: f.passId, style: { partKey: 'body', itemKey: 'pack-hat', styleKey: 'snow' } })
  expect(source?.pack?.selected?.styles).toEqual([f.packStyle]); expect(f.listStyles).not.toHaveBeenCalled()
})
it('returns real style pagination without treating the style index field as a numeric lookup index', async () => {
  const f = nativeEquipmentPackFixture()
  f.listStyles.mockResolvedValue({ dynamicFields: [f.styleHint], hasNextPage: true, cursor: 'bmV4dA==' })
  const { source } = await f.readPack({ passId: f.passId, styleCursor: 'Zmlyc3Q=' })
  expect(source?.pack?.selected).toMatchObject({ hasNextPage: true, cursor: 'bmV4dA==' })
  expect(f.listStyles).toHaveBeenCalledWith({ parentId: f.stylesId, limit: 20, cursor: 'Zmlyc3Q=' })
})
it('protected Pack styles use identical source authority and retain ciphertext/Seal identity', async () => {
  const f = nativeEquipmentPackFixture()
  f.set(f.packStyleId, StyleField, v => { v.value.protected = true; v.value.seal_binding_commitment = Array(32).fill(4) })
  expect((await f.readPack()).source?.pack?.selected?.styles[0]).toMatchObject({ protected: true, seal_binding_commitment: Array(32).fill(4) })
})
it('control resale and pass object ID are excluded from the immutable entitlement hash', async () => {
  const f = nativeEquipmentPackFixture()
  expect(equipmentPackPassCommitment({ ...f.pass, id: id(999) })).toEqual(f.pass.commitment)
  f.set(f.releaseId, EquipmentPackReleaseBcs, v => { v.owner = id(999); v.control_epoch = '150' })
  expect((await f.readPack()).source?.pack?.selected?.pass.id).toBe(f.passId)
})
it.each(['custody','holder','id','version','hash','release','coin','root','origin','field-key','field-parent','style-key','style-parent','color-parent','semantic-key'])
('rejects selected Pack %s mismatch', async problem => {
  const f = nativeEquipmentPackFixture()
  if (problem === 'custody') f.objects.get(f.passId).owner.address = id(999)
  if (problem === 'holder') f.set(f.passId, EquipmentPackPassBcs, v => { v.holder = id(999) })
  if (problem === 'id') f.set(f.passId, EquipmentPackPassBcs, v => { v.id = id(999) })
  if (problem === 'version') f.set(f.passId, EquipmentPackPassBcs, v => { v.version = '7' })
  if (problem === 'hash') f.set(f.passId, EquipmentPackPassBcs, v => { v.issued_at_ms = '13' })
  if (problem === 'release') f.set(f.releaseId, EquipmentPackReleaseBcs, v => { v.content_commitment = Array(32).fill(77) })
  if (problem === 'coin') f.objects.get(f.releaseId).objectType = `${f.runtimeType('PackReleaseV8')}<0x2::other::Coin>`
  if (problem === 'root') f.set(f.releaseId, EquipmentPackReleaseBcs, v => { v.root_id = id(999) })
  if (problem === 'origin') f.objects.get(id(71)).package.typeOrigins.find((v: any) => v.datatypeName === 'PackStyleV8').packageId = id(999)
  if (problem === 'field-key') f.set(f.admissionId, AdmissionField, v => { v.name = id(999) })
  if (problem === 'field-parent') f.objects.get(f.admissionId).owner.address = id(999)
  if (problem === 'style-key') f.set(f.packStyleId, StyleField, v => { v.value.item_key = 'other' })
  if (problem === 'style-parent') f.objects.get(f.packStyleId).owner.address = id(999)
  if (problem === 'color-parent') f.objects.get(f.colorId).owner.address = id(999)
  if (problem === 'semantic-key') f.set(f.semanticId, SemanticField, v => { v.name = 'other' })
  await expect(f.readPack()).rejects.toThrow(/mismatch/)
})
it('distinguishes absent/revoked admissions and changed semantic mapping for eligibility', async () => {
  const f = nativeEquipmentPackFixture()
  f.set(f.admissionId, AdmissionField, v => { v.value.admission_state = 1 })
  f.set(f.semanticId, SemanticField, v => { v.value = id(999) })
  expect((await f.readPack()).source?.pack?.selected).toMatchObject({ admission: { admission_state: 1 }, semanticReleaseId: id(999) })
  f.objects.delete(f.admissionId); f.objects.delete(f.semanticId)
  expect((await f.readPack()).source?.pack?.selected).toMatchObject({ admission: null, semanticReleaseId: null })
})
it('does not interpret RPC failure as absent admission', async () => {
  const f = nativeEquipmentPackFixture(); const original = f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).batchGetObjects = async (request: any) => request.requests.some((r: any) => r.objectId === f.admissionId)
    ? { response: { objects: [{ result: { oneofKind: 'error', error: { code: 14 } } }] } } : original(request)
  await expect(f.readPack()).rejects.toMatchObject({ status: 503 })
})
it.each(['pass','release','style','admission','color','semantic'])('rechecks mutable %s after dependent reads', async kind => {
  const f = nativeEquipmentPackFixture()
  const objectId = ({ pass: f.passId, release: f.releaseId, style: f.packStyleId, admission: f.admissionId, color: f.colorId, semantic: f.semanticId })[kind as 'pass']
  const original = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).getObject = async (request: any) => {
    const result = await original(request)
    if (request.objectId === objectId && request.readMask.paths.length === 3) return { response: { object: { ...result.response.object, version: 99n } } }
    return result
  }
  await expect(f.readPack()).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_CHANGED', status: 409 })
})
it.each(['duplicate','oversize','bad-cursor','repeat-cursor','empty-next','wrong-type','wrong-id','key-bcs'])('rejects invalid style discovery page %s', async problem => {
  const f = nativeEquipmentPackFixture()
  const page = { dynamicFields: [f.styleHint], hasNextPage: false, cursor: null as string | null }
  if (problem === 'duplicate') page.dynamicFields.push(f.styleHint)
  if (problem === 'oversize') page.dynamicFields = Array(21).fill(f.styleHint)
  if (problem === 'bad-cursor') { page.hasNextPage = true; page.cursor = 'bad' }
  if (problem === 'repeat-cursor') { page.hasNextPage = true; page.cursor = 'bmV4dA==' }
  if (problem === 'empty-next') { page.hasNextPage = true; page.cursor = 'YQ=='; page.dynamicFields = [] }
  if (problem === 'wrong-type') f.styleHint.valueType = 'u64'
  if (problem === 'wrong-id') f.styleHint.fieldId = id(999)
  if (problem === 'key-bcs') f.styleHint.name.bcs = new Uint8Array([255])
  f.listStyles.mockResolvedValue(page)
  await expect(f.readPack({ passId: f.passId, styleCursor: 'bmV4dA==' })).rejects.toThrow()
})
it.each([{ cursor: 'bad' }, { passId: id(201), cursor: 'YQ==' }, { styleCursor: 'YQ==' },
  { passId: id(201), styleCursor: 'YQ==', style: { partKey: 'body', itemKey: 'hat', styleKey: 'red' } },
  { passId: id(201), style: { partKey: 'body', itemKey: 'invalid/key', styleKey: 'red' } }])('validates internal query as well as HTTP %j', async query => {
  await expect(nativeEquipmentPackFixture().readPack(query)).rejects.toThrow()
})
