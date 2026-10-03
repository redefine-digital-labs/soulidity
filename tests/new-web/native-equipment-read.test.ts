import { describe, expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { nativeEquipmentReadFixture } from './fixtures/native-equipment-read'
import { completeId as id } from './fixtures/native-complete-read'
import { NativeSoulStateBcs } from '../../web/lib/animacraft/native-receive'
import { EquipmentBaseItemBcs } from '../../web/lib/animacraft/native-equipment'
import { EquipmentMakerBcs, EquipmentAccessPassBcs, EquipmentDefinitionsBcs, EquipmentProfileBcs } from '../../web/lib/animacraft/native-equipment-source-bcs'
import { EquipmentProtectedAssetBcs, EquipmentProtectedKeyBcs, EquipmentSealPolicyBcs } from '../../web/lib/animacraft/native-equipment-seal'
import { EquipmentPackPassBcs, EquipmentPackReleaseBcs, EquipmentPackAdmissionBcs } from '../../web/lib/animacraft/native-equipment-pack'
import { equipmentAccessCommitment } from '../../web/lib/animacraft/native-equipment-source'
import { readNativeEquipmentReadTarget } from '../../web/lib/animacraft/native-equipment-read'
const AssetField = bcs.struct('Field', { id: bcs.Address, name: EquipmentProtectedKeyBcs, value: EquipmentProtectedAssetBcs })

describe('current equipped protected read metadata', () => {
  it.each(['base','owned-base','pack'] as const)('returns exact %s source and Release ORIGINAL namespace', async kind => {
    const f = nativeEquipmentReadFixture(kind), dto = await f.readEquipment()
    expect(dto).toMatchObject({ schema: 'native-equipment-read-v1', kind, loadoutId: id(80), selectionIndex: 0,
      owner: id(11), runtimeDefinitionsId: id(81), makerAccessId: id(83),
      release: { originalPackageId: id(240), callablePackageId: id(241) },
      ciphertext: { blobId: f.blobId, aadBase64: Buffer.from(f.equipmentAad).toString('base64') },
      policy: { threshold: 4, keyServers: [{ objectId: id(270), weight: 2 }, { objectId: id(271), weight: 3 }] } })
    if (kind === 'owned-base') expect(dto).toHaveProperty('ownedBaseItemId', id(84))
    if (kind === 'pack') expect(dto).toMatchObject({ packReleaseId: id(202), packPassId: id(201) })
  })
  it('does not require protected original Complete, read original recipe, or unlisted/write-enabled Soul', async () => {
    const f = nativeEquipmentReadFixture('base')
    for (const key of [id(15), id(16), f.markerId]) f.objects.delete(key)
    f.target.equipmentWritesEnabled = false
    f.set(id(14), NativeSoulStateBcs, state => { state.is_listed = true })
    expect((await f.readEquipment()).kind).toBe('base')
  })
  it.each([-1, 500, 0.5, NaN, 1])('rejects unavailable/invalid slot %s', async slot => {
    await expect(nativeEquipmentReadFixture().readEquipment(slot)).rejects.toThrow()
  })
  it.each(['unprotected','external','empty','part','style','pricing','seal-binding','epoch'])('rejects selected %s substitution', async problem => {
    const f = nativeEquipmentReadFixture('base')
    f.editLoadout(row => {
      const slot = row.selections[0]!
      if (problem === 'unprotected') slot.protected = false
      if (problem === 'external') slot.source_class = 2
      if (problem === 'empty') { row.selections[0] = null; row.selection_count = '0' }
      if (problem === 'part') slot.part_key = 'other'
      if (problem === 'style') slot.style_key = 'other'
      if (problem === 'pricing') slot.pricing_commitment = Array(32).fill(99)
      if (problem === 'seal-binding') slot.seal_binding_commitment = Array(32).fill(99)
      if (problem === 'epoch') slot.source_epoch = '1'
    })
    await expect(f.readEquipment()).rejects.toThrow()
  })
  it.each(['scope','content','blob','sha','seal-id','certification','field-key','parent'])('rejects exact Seal %s substitution', async problem => {
    const f = nativeEquipmentReadFixture()
    f.set(f.protectedAssetId, AssetField, row => {
      if (problem === 'scope') row.value.scope_commitment = Array(32).fill(99)
      if (problem === 'content') row.value.asset_content_commitment = Array(32).fill(99)
      if (problem === 'blob') row.value.ciphertext_blob_id = Buffer.alloc(32, 99).toString('base64url')
      if (problem === 'sha') row.value.ciphertext_sha256 = Array(32).fill(99)
      if (problem === 'seal-id') row.value.seal_id = Array(32).fill(99)
      if (problem === 'certification') row.value.certification_commitment = Array(32).fill(99)
      if (problem === 'field-key') row.name.asset_key = 'other'
    })
    if (problem === 'parent') f.objects.get(f.protectedAssetId).owner.address = id(999)
    await expect(f.readEquipment()).rejects.toThrow()
  })
  it.each(['root-paused','root-archived','access-holder','owned-lock','owned-holder','definitions','policy','runtime'])('rejects current %s authority mismatch', async problem => {
    const f = nativeEquipmentReadFixture()
    if (problem === 'root-paused' || problem === 'root-archived') f.set(id(10), EquipmentMakerBcs, row => { row.lifecycle = problem === 'root-paused' ? 2 : 3 })
    if (problem === 'access-holder') f.set(id(83), EquipmentAccessPassBcs, row => { row.holder = id(999) })
    if (problem === 'owned-lock') f.set(id(84), EquipmentBaseItemBcs, row => { row.equip_lock = null })
    if (problem === 'owned-holder') f.objects.get(id(84)).owner.address = id(999)
    if (problem === 'definitions') f.set(id(81), EquipmentDefinitionsBcs, row => { row.base_registry_id = id(999) })
    if (problem === 'policy') f.set(id(260), EquipmentSealPolicyBcs, row => { row.threshold = 1 })
    if (problem === 'runtime') f.objects.get(id(71)).package.linkage.find((row: any) => row.originalId === id(210)).upgradedId = id(999)
    await expect(f.readEquipment()).rejects.toThrow()
  })
  it('rejects a rehashed pass/loadout that violates the Maker access payment policy', async () => {
    const f = nativeEquipmentReadFixture('base')
    let commitment: number[] = []
    f.set(id(83), EquipmentAccessPassBcs, row => { row.paid_atomic = '1'; commitment = equipmentAccessCommitment(row) })
    f.editLoadout(row => { row.maker_access_commitment = commitment; row.selections[0]!.pricing_commitment = commitment })
    await expect(f.readEquipment()).rejects.toThrow('MakerAccess entitlement mismatch')
  })
  it.each(['pass-holder','pass-hash','release-inactive','admission-revoked','admission-missing','semantic-missing'])('rejects Pack %s', async problem => {
    const f = nativeEquipmentReadFixture('pack'), p = f.pack!
    if (problem === 'pass-holder') f.objects.get(p.passId).owner.address = id(999)
    if (problem === 'pass-hash') f.set(p.passId, EquipmentPackPassBcs, row => { row.paid_atomic = '7' })
    if (problem === 'release-inactive') f.set(p.releaseId, EquipmentPackReleaseBcs, row => { row.lifecycle = 3 })
    if (problem === 'admission-revoked') f.set(p.admissionId, bcs.struct('Field', { id: bcs.Address, name: bcs.Address, value: EquipmentPackAdmissionBcs }), row => { row.value.admission_state = 1 })
    if (problem === 'admission-missing') f.objects.delete(p.admissionId)
    if (problem === 'semantic-missing') f.objects.delete(p.semanticId)
    await expect(f.readEquipment()).rejects.toThrow()
  })
  it.each([id(14), id(80), id(83), id(10), id(260), id(84)])('rejects final readset drift for %s', async changedId => {
    const f = nativeEquipmentReadFixture(), original = f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
    ;(f.client.ledgerService as any).batchGetObjects = async (request: any) => {
      const result = await original(request)
      if (request.requests.some((row: any) => row.objectId === f.protectedAssetId)) f.objects.get(changedId).digest = 'changed-during-protected-read'
      return result
    }
    await expect(f.readEquipment()).rejects.toMatchObject({ status: 409 })
  })
  it('honors an aborted request before reading chain state', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(nativeEquipmentReadFixture().readEquipment(0, controller.signal)).rejects.toThrow()
  })
  it('snapshots the caller slot before any asynchronous reads', async () => {
    const f = nativeEquipmentReadFixture(), input = { soulId: id(12), stateId: id(14), selectionIndex: 0 }
    const pending = readNativeEquipmentReadTarget(f.client, f.target, input)
    input.selectionIndex = 499; input.stateId = id(999)
    expect((await pending).selectionIndex).toBe(0)
  })
  it.each([false, true])('bounds profile RPC concurrency and drains started reads (failure=%s)', async fail => {
    const f = nativeEquipmentReadFixture('base'), keys = ['body', ...Array.from({ length: 31 }, (_, i) => `part-${i}`)]
    const profiles = new Set<string>([f.profileId])
    for (const [index, part_key] of keys.entries()) {
      if (index === 0) continue
      profiles.add(f.field(id(91), f.runtimeType('PartProfileKeyV8'), bcs.struct('PartProfileKeyV8', { part_key: bcs.string() }),
        { part_key }, f.runtimeType('PartProfileV8'), EquipmentProfileBcs, { index: String(index), part_key,
          core_part_payload_commitment: Array(32).fill(1), required: false, wardrobe_mode: 1, behavior: 3,
          capacity: '1', admission_ceiling: 2, profile_commitment: Array(32).fill(1) }))
    }
    f.set(id(81), EquipmentDefinitionsBcs, row => {
      row.profile_keys = keys; row.expected_profile_count = row.observed_profile_count = row.profiles.size = String(keys.length)
    })
    f.editLoadout(row => { row.selections.push(...Array(31).fill(null))
      row.definition_slots = keys.map((part_key, index) => ({ source_definition_id: id(10), part_key,
        profile_commitment: Array(32).fill(1), start: String(index), capacity: '1' })) })
    let active = 0, peak = 0
    const original = f.client.ledgerService.getObject.bind(f.client.ledgerService)
    ;(f.client.ledgerService as any).getObject = async (request: any) => {
      if (!profiles.has(request.objectId) || request.readMask.paths.length === 3) return original(request)
      active++; peak = Math.max(peak, active)
      try {
        await new Promise(resolve => setTimeout(resolve, 2))
        if (fail && request.objectId === f.profileId) throw new Error('profile outage')
        return await original(request)
      } finally { active-- }
    }
    if (fail) await expect(f.readEquipment()).rejects.toThrow('profile outage')
    else expect((await f.readEquipment()).kind).toBe('base')
    expect(active).toBe(0); expect(peak).toBe(16)
  })
})
