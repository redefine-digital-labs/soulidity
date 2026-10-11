import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { nativeEquipmentSealFixture } from './fixtures/native-equipment-seal'
import { EquipmentProtectedAssetBcs, EquipmentProtectedKeyBcs, EquipmentSealRegistryBcs, EquipmentSealPolicyBcs,
  equipmentSealBinding, equipmentSealId, readEquipmentProtectedBase } from '../../web/lib/animacraft/native-equipment-seal'
import { EquipmentBaseItemBcs, EquipmentReadSet } from '../../web/lib/animacraft/native-equipment'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { baseSelectionEligibility, equipmentEligibility } from '../../web/lib/animacraft/equipment-eligibility'
const id = (n: number) => `0x${n.toString(16).padStart(64,'0')}`
const Field = bcs.struct('Field', { id: bcs.Address, name: EquipmentProtectedKeyBcs, value: EquipmentProtectedAssetBcs })
it('reads the exact linked Seal type origins and style transport evidence without decryption', async () => {
  const f = nativeEquipmentSealFixture(); const s = await f.readBase(); const entry = s.source!.protectedBase.entries[0]
  expect(s.source!.protectedBase.available).toBe(true)
  expect(entry.proof).toEqual({ sealRegistryId: id(87), sealPolicyId: id(203), ciphertextBlobCommitment: f.asset.ciphertext_blob_commitment,
    certificationCommitment: f.asset.certification_commitment, sealId: f.asset.seal_id })
  expect(entry.bindingCommitment).toEqual(equipmentSealBinding(f.registry,f.asset))
  // The actual package was upgraded, but callable marker defining ID stayed 201.
  expect(f.policy.seal_callable_package_id).not.toBe(id(202))
})
it.each(['registry-root','registry-version','registry-seal','catalog','policy-id','policy-hash','policy-type','policy-owner',
  'callable','linkage','package','type-origin','key','parent','scope','asset-content','blob','sha','seal-id','transport'])
  ('makes protected %s mismatch unavailable without hiding public source choices', async problem => {
    const f = nativeEquipmentSealFixture()
    if (problem === 'registry-root') f.set(id(87),EquipmentSealRegistryBcs,v => { v.root_id = id(999) })
    if (problem === 'registry-version') f.set(id(87),EquipmentSealRegistryBcs,v => { v.version = '7' })
    if (problem === 'registry-seal') f.set(id(87),EquipmentSealRegistryBcs,v => { v.sealed = false })
    if (problem === 'catalog') f.set(id(203),EquipmentSealPolicyBcs,v => { v.catalog_id = id(999) })
    if (problem === 'policy-id') f.set(id(203),EquipmentSealPolicyBcs,v => { v.id = id(999) })
    if (problem === 'policy-hash') f.set(id(203),EquipmentSealPolicyBcs,v => { v.commitment = Array(32).fill(99) })
    if (problem === 'policy-type') f.objects.get(id(203)).objectType = `${id(999)}::seal_v8::SealPolicyConfigV8`
    if (problem === 'policy-owner') f.objects.get(id(203)).owner.kind = 1
    if (problem === 'callable') f.set(id(203),EquipmentSealPolicyBcs,v => { v.seal_callable_package_id = id(202) })
    if (problem === 'linkage') f.objects.get(id(71)).package.linkage.at(-1).upgradedId = id(999)
    if (problem === 'package') f.objects.get(id(202)).owner.kind = 1
    if (problem === 'type-origin') f.objects.get(id(202)).package.typeOrigins = []
    if (problem === 'key') f.set(f.assetId,Field,v => { v.name.asset_key = 'wrong' })
    if (problem === 'parent') f.objects.get(f.assetId).owner.address = id(999)
    if (problem === 'scope') f.set(f.assetId,Field,v => { v.value.scope_kind = 1 })
    if (problem === 'asset-content') f.set(f.assetId,Field,v => { v.value.asset_content_commitment = Array(32).fill(99) })
    if (problem === 'blob') f.set(f.assetId,Field,v => { v.value.ciphertext_blob_id = 'wrong' })
    if (problem === 'sha') f.set(f.assetId,Field,v => { v.value.ciphertext_sha256 = Array(32).fill(99) })
    if (problem === 'seal-id') f.set(f.assetId,Field,v => { v.value.seal_id = Array(32).fill(99) })
    if (problem === 'transport') f.set(f.assetId,Field,v => { v.value.certification_commitment = [] })
    const s = await f.readSource()
    expect(s.source!.styles).toHaveLength(1); expect(s.source!.protectedBase).toEqual({ available: false, entries: [] })
  })
it('uses runtime rows only after actual static-row absence, not static corruption', async () => {
  const f = nativeEquipmentSealFixture(); f.objects.delete(f.assetId); f.putAsset(id(205))
  expect((await f.readSource()).source!.protectedBase.entries[0].proof).not.toBeNull()
  f.putAsset(id(204)); f.set(f.assetId,Field,v => { v.value.ciphertext_blob_id = 'wrong' })
  expect((await f.readSource()).source!.protectedBase.available).toBe(false)
})
it('missing rows do not invent proof or query ciphertext services', async () => {
  const f = nativeEquipmentSealFixture(); f.objects.delete(f.assetId)
  expect((await f.readSource()).source!.protectedBase.entries[0].proof).toBeNull()
})
it('does not use runtime rows after a static lookup transport failure', async () => {
  const f = nativeEquipmentSealFixture(); f.putAsset(id(205))
  const original = f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService); const seen: string[] = []
  ;(f.client.ledgerService as any).batchGetObjects = async (request: any) => {
    seen.push(...request.requests.map((r: any) => r.objectId))
    return request.requests.some((r: any) => r.objectId === f.assetId)
      ? { response: { objects: [{ result: { oneofKind: 'error', error: { code: 14, message: 'offline' } } }] } } : original(request)
  }
  expect((await f.readSource()).source!.protectedBase.available).toBe(false)
  expect(seen).not.toContain(f.runtimeAssetId)
})
it('does not invent decrypt-only count/revision gates for selection', async () => {
  const f = nativeEquipmentSealFixture(); f.set(id(87),EquipmentSealRegistryBcs,v => { v.runtime_revision = '9'; v.expected_complete_count = '99' })
  const s = await f.readSource(); expect(s.source!.protectedBase.available).toBe(true)
  expect(s.source!.protectedBase.entries[0].bindingCommitment).not.toEqual(equipmentSealBinding(f.registry,f.asset))
  expect(equipmentSealId(f.registry,'body/hat/red')).toEqual(f.asset.seal_id)
})
it('allows only exact protected proof for both owned and non-asset Base, never public fallback', async () => {
  const f = nativeEquipmentSealFixture(); f.editLoadout(v => { v.selections = [null]; v.selection_count = '0' })
  f.set(id(84),EquipmentBaseItemBcs,v => { v.equip_lock = null })
  const s = await f.readBase(); const protection = s.source!.protectedBase.entries[0].proof!
  const item = { kind: 'base' as const, itemId: id(84), baseRegistryId: id(85), styleKey: 'red', swatchKey: 'red' }
  expect(equipmentEligibility(s,{ item }).allowed).toBe(false)
  expect(equipmentEligibility(s,{ item: { ...item, protection } }).allowed).toBe(true)
  expect(equipmentEligibility(s,{ item: { ...item, protection: { ...protection, sealId: Array(32).fill(99) } } }).allowed).toBe(false)
  s.source!.definitions.item_assetization = false
  const selection = { baseRegistryId: id(85), partKey: 'body', itemKey: 'hat', styleKey: 'red', swatchKey: 'red', protection }
  expect(baseSelectionEligibility(s,{ selection }).allowed).toBe(true)
  s.source!.styles[0].protected = false
  expect(baseSelectionEligibility(s,{ selection }).allowed).toBe(false)
})
it('skips Seal entirely when no protected style is present on the source page', async () => {
  const f = nativeEquipmentSealFixture(); f.objects.delete(id(87)); f.editStyle(v => { v.protected = false })
  expect((await f.readSource()).source!.protectedBase).toEqual({ available: true, entries: [] })
})
it.each(['registry','policy','asset','runtime-asset'] as const)('rejects changed protected %s at final readback instead of returning a stale proof', async kind => {
  const f = nativeEquipmentSealFixture()
  if (kind === 'runtime-asset') { f.objects.delete(f.assetId); f.putAsset(id(205)) }
  const changedId = kind === 'registry' ? id(87) : kind === 'policy' ? id(203) : kind === 'asset' ? f.assetId : f.runtimeAssetId
  const original = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).getObject = async (request: any) => {
    const result = await original(request)
    if (request.objectId === changedId && request.readMask.paths.length === 3) {
      return { response: { object: { ...result.response.object,version: 99n } } }
    }
    return result
  }
  await expect(f.readSource()).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_CHANGED',status: 409 })
})
it('keeps public choice data when the protected policy is unavailable', async () => {
  const f = nativeEquipmentSealFixture(); f.objects.delete(id(203))
  const s = await f.readSource()
  expect(s.source!.protectedBase).toEqual({ available: false,entries: [] })
  expect(s.source!.items[0].item_key).toBe('hat'); expect(s.equipment).not.toBeNull()
})
it('awaits every protected row before returning an isolated failure, so no background reads escape final verification', async () => {
  const f = nativeEquipmentSealFixture(); const s = await f.readSource()
  f.set(f.assetId,Field,v => { v.value.ciphertext_blob_id = 'corrupt' })
  const secondStyle = { ...s.source!.styles[0],style_key: 'blue' }
  const secondId = deriveDynamicFieldID(id(204),f.type('ProtectedAssetKeyV8'),
    EquipmentProtectedKeyBcs.serialize({ ...f.key,asset_key: 'body/hat/blue' }).toBytes())
  let started!: () => void; let release!: () => void
  const start = new Promise<void>(resolve => { started = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const original = f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).batchGetObjects = async (request: any) => {
    if (request.requests.some((r: any) => r.objectId === secondId)) { started(); await gate }
    return original(request)
  }
  let returned = false
  const reading = readEquipmentProtectedBase(f.client,new EquipmentReadSet(f.client),{ root: s.source!.root,
    styles: [...s.source!.styles,secondStyle],native: f.objects.get(id(5)),runtime: f.objects.get(id(71)) })
    .then(value => { returned = true; return value })
  await start; await new Promise(resolve => setTimeout(resolve,0))
  try { expect(returned).toBe(false) } finally { release() }
  await expect(reading).resolves.toEqual({ available: false,entries: [] })
})
