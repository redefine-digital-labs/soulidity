import { describe, expect, it, vi } from 'vitest'
import { KioskItemFieldBcs } from '@soulidity/sdk'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { nativeReceiveFixture } from './fixtures/native-receive'
import { NativeSoulBindingBcs, NativeSoulStateBcs, readNativeReceiveTarget } from '../../web/lib/animacraft/native-receive'
import { readNativeEquipment, EquipmentLoadoutBcs, EquipmentDefinitionSlotBcs, EquipmentAttachedPackDefinitionBcs, EquipmentBindingFieldBcs, EquipmentPointerBcs,
  EquipmentBaseItemBcs, EquipmentExternalItemBcs, equipmentCommitment } from '../../web/lib/animacraft/native-equipment'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const hash = (n: number) => Array(32).fill(n)
import { nativeEquipmentFixture as fixture } from './fixtures/native-equipment'

describe('native equipment exact object readback', () => {
  it('commits attached Pack identity and definition hash in canonical wire order', () => {
    const f = fixture(), loadout = EquipmentLoadoutBcs.parse(f.objects.get(id(80)).contents.value)
    const original = equipmentCommitment(loadout)
    const attached = { release_id: id(17), definition_commitment: hash(2) }
    expect(Buffer.from(EquipmentAttachedPackDefinitionBcs.serialize(attached).toBytes()).toString('hex'))
      .toBe('00'.repeat(31) + '11' + '20' + '02'.repeat(32))
    loadout.attached_pack_definitions.push(attached)
    const attachedHash = equipmentCommitment(loadout)
    expect(attachedHash).not.toBe(original)
    attached.definition_commitment[0] ^= 1
    expect(equipmentCommitment(loadout)).not.toBe(attachedHash)
    attached.definition_commitment[0] ^= 1; attached.release_id = id(18)
    expect(equipmentCommitment(loadout)).not.toBe(attachedHash)
  })
  it('retains committed attachment identity in raw reads without claiming source or write authority', async () => {
    const f = fixture()
    f.editLoadout(value => { value.attached_pack_definitions.push({ release_id: id(17), definition_commitment: hash(2) }) })
    const snapshot = await f.read()
    expect(snapshot.equipment!.loadout.attached_pack_definitions).toEqual([{ release_id: id(17), definition_commitment: hash(2) }])
    expect(snapshot.source).toBeNull(); expect(snapshot.updateSource).toBeNull()
  })
  it('requires the attachment vector before definition slots with no old loadout fallback', async () => {
    const f = fixture(), object = f.objects.get(id(80)), bytes = object.contents.value as Uint8Array
    // Fixed-width fields plus the two 32-byte hash vectors end at offset 282.
    expect([...bytes.slice(282, 284)]).toEqual([0, 1])
    object.contents.value = new Uint8Array([...bytes.slice(0, 282), ...bytes.slice(283)])
    await expect(f.read()).rejects.toThrow()
  })
  it('matches the Move DefinitionSlotV8 canonical field order', () => {
    const bytes = EquipmentDefinitionSlotBcs.serialize({ source_definition_id: id(17), part_key: 'body',
      profile_commitment: hash(2), start: '0', capacity: '2' }).toBytes()
    expect(bytes.length).toBe(86)
    expect(Buffer.from(bytes).toString('hex')).toBe('00'.repeat(31) + '11' + '04626f6479'
      + '20' + '02'.repeat(32) + '0000000000000000' + '0200000000000000')
  })
  it.each(['source', 'start', 'capacity', 'profile', 'part', 'duplicate'])(
    'rejects rehashed definition layout %s substitution', async mutation => {
      const f = fixture()
      f.editLoadout(value => {
        const slot = value.definition_slots[0]
        if (mutation === 'source') slot.source_definition_id = id(999)
        if (mutation === 'start') slot.start = '1'
        if (mutation === 'capacity') slot.capacity = '2'
        if (mutation === 'profile') slot.profile_commitment = []
        if (mutation === 'part') slot.part_key = 'other'
        if (mutation === 'duplicate') value.definition_slots.push({ ...slot, start: '1' })
      })
      await expect(f.read()).rejects.toThrow(/definition slot/)
    })
  it('commits the complete immutable definition layout', () => {
    const f = fixture()
    const loadout = EquipmentLoadoutBcs.parse(f.objects.get(id(80)).contents.value)
    const original = equipmentCommitment(loadout)
    loadout.definition_slots[0].profile_commitment[0] ^= 1
    expect(equipmentCommitment(loadout)).not.toBe(original)
  })
  it('uses the compiled empty Move key byte and rejects a true dummy field', async () => {
    const f = fixture()
    expect(f.bindingId).toBe(deriveDynamicFieldID(id(80), f.runtimeType('SoulEquipmentKeyV8'), new Uint8Array([0])))
    expect(f.bindingId).not.toBe(deriveDynamicFieldID(id(80), f.runtimeType('SoulEquipmentKeyV8'), new Uint8Array()))
    f.set(f.bindingId, EquipmentBindingFieldBcs, v => { v.name.dummy_field = true })
    await expect(f.read()).rejects.toThrow('binding/owner epoch')
  })
  it('reads actual Soul/State/provenance/equipment/instance links and rechecks mutable versions', async () => {
    const f = fixture(); const result = await f.read()
    expect(result.status).toBe('BOUND'); expect(result.equipment?.loadout.id).toBe(id(80))
    expect(result.equipment?.instances).toMatchObject([{ kind: 'base', item: { id: id(84), holder: id(11) } }])
    for (const objectId of [id(12), id(14), id(80), id(84), f.bindingId, f.itemFieldId]) {
      expect(f.calls.filter(c => c.objectId === objectId)).toHaveLength(2)
    }
  })
  it.each(['missing', 'parent', 'type', 'field-id', 'key', 'value', 'trailing', 'direct-kiosk', 'missing-digest'] as const)(
    'rejects non-framework Kiosk Item custody: %s', async problem => {
      const f = fixture(), row = f.objects.get(f.itemFieldId)
      if (problem === 'missing') f.objects.delete(f.itemFieldId)
      if (problem === 'parent') row.owner.address = id(99)
      if (problem === 'type') row.objectType = '0x2::dynamic_field::Field<0x2::kiosk::Item,0x2::object::ID>'
      if (problem === 'missing-digest') delete row.digest
      if (problem === 'direct-kiosk') f.objects.get(id(12)).owner.address = id(18)
      if (['field-id', 'key', 'value'].includes(problem)) f.set(f.itemFieldId, KioskItemFieldBcs, value => {
        if (problem === 'field-id') value.id = id(99)
        if (problem === 'key') value.name.name.id = id(99)
        if (problem === 'value') value.value = id(99)
      })
      if (problem === 'trailing') row.contents.value = new Uint8Array([...row.contents.value, 0])
      await expect(f.read()).rejects.toThrow()
    })
  it('rejects wrapper movement during dependent equipment reads', async () => {
    const f = fixture(), read = f.client.ledgerService.getObject.bind(f.client.ledgerService)
    vi.spyOn(f.client.ledgerService, 'getObject').mockImplementation((async (request: any) => {
      if (request.objectId === f.itemFieldId && request.readMask.paths.length === 3) f.objects.get(f.itemFieldId).version++
      return read(request)
    }) as any)
    await expect(f.read()).rejects.toThrow('Equipment changed')
  })
  it('accepts a genuine NOT_FOUND pointer only after verifying native ownership/provenance', async () => {
    const f = fixture(); f.objects.delete(f.pointerId)
    expect(await f.read()).toMatchObject({ status: 'NOT_CREATED', equipment: null, owner: id(11) })
  })
  it.each([2, 7, 14])('does not confuse RPC status %s with an empty wardrobe', async code => {
    const f = fixture()
    ;(f.client.ledgerService as any).batchGetObjects = async () => ({ response: { objects: [{ result: { oneofKind: 'error', error: { code } } }] } })
    await expect(f.read()).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_UNAVAILABLE', status: 503 })
  })
  it('does not confuse a thrown timeout or malformed response with no equipment', async () => {
    const f = fixture()
    ;(f.client.ledgerService as any).batchGetObjects = async () => { throw new Error('timeout') }
    await expect(f.read()).rejects.toThrow('timeout')
    ;(f.client.ledgerService as any).batchGetObjects = async () => ({ response: { objects: [] } })
    await expect(f.read()).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_INVALID' })
  })
  it.each(['soul_id', 'soul_state_id', 'holder', 'protocol_config_id', 'ownership_epoch'])('rejects wrong binding %s', async field => {
    const f = fixture(); f.set(f.bindingId, EquipmentBindingFieldBcs, v => { v.value[field] = field === 'ownership_epoch' ? '1' : id(99) })
    await expect(f.read()).rejects.toThrow('binding/owner epoch')
  })
  it.each(['root_id', 'root_version', 'holder', 'id'])('rejects loadout %s mismatch', async field => {
    const f = fixture(); f.set(id(80), EquipmentLoadoutBcs, v => { v[field] = field === 'root_version' ? '2' : id(99) })
    await expect(f.read()).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_INVALID' })
  })
  it.each(['selection_count', 'commitment', 'selections'])('rejects corrupted %s', async field => {
    const f = fixture(); f.set(id(80), EquipmentLoadoutBcs, v => {
      if (field === 'selection_count') v.selection_count = '2'
      if (field === 'commitment') v.commitment = hash(99)
      if (field === 'selections') v.selections[0].style_key = 'tampered'
    })
    await expect(f.read()).rejects.toThrow('commitment/count')
  })
  it.each(['owner', 'type', 'parent', 'bcs', 'slot'])('rejects wrong pointer %s', async field => {
    const f = fixture(); const obj = f.objects.get(f.pointerId)
    if (field === 'owner') obj.owner.kind = 3
    if (field === 'type') obj.objectType = '0x2::dynamic_field::Field<u64,0x2::object::ID>'
    if (field === 'parent') obj.owner.address = id(99)
    if (field === 'bcs') obj.contents.value = new Uint8Array([...obj.contents.value, 0])
    if (field === 'slot') f.set(f.pointerId, EquipmentPointerBcs, v => { v.name = 9 })
    await expect(f.read()).rejects.toThrow()
  })
  it.each(['holder', 'ownership_epoch', 'loadout_id', 'selection_index', 'equip_revision', 'missing_lock'])('rejects wrong component %s', async field => {
    const f = fixture(); f.set(id(84), EquipmentBaseItemBcs, v => {
      if (field === 'holder') v.holder = id(99)
      else if (field === 'ownership_epoch') v.ownership_epoch = '1'
      else if (field === 'missing_lock') v.equip_lock = null
      else v.equip_lock[field] = field === 'loadout_id' ? id(99) : '2'
    })
    await expect(f.read()).rejects.toThrow('instance lock/owner')
  })
  it('rejects component custody/type mismatch and wrong Base source', async () => {
    const f = fixture(); f.objects.get(id(84)).owner.address = id(99)
    await expect(f.read()).rejects.toThrow('custody')
    f.objects.get(id(84)).owner.address = id(11)
    f.set(id(84), EquipmentBaseItemBcs, v => { v.definition_registry_id = id(99) })
    await expect(f.read()).rejects.toThrow('Base source')
  })
  it('reads external item locks and does not reinterpret usage rights as owned instances', async () => {
    const f = fixture()
    f.editLoadout(v => { v.selections[0].source_class = 2; v.selections[0].source_definition_id = id(86) })
    f.put(id(84), f.runtimeType('OwnedExternalItemV8'), EquipmentExternalItemBcs, { id: id(84), version: '8', product_id: id(86),
      product_content_commitment: hash(7), asset_content_commitment: hash(4), holder: id(11), ownership_epoch: '0', transferable: true,
      equip_lock: { loadout_id: id(80), equip_revision: '1', selection_index: '0' } }, 1, id(11))
    expect((await f.read()).equipment?.instances[0].kind).toBe('external')
    f.editLoadout(v => { v.selections[0].source_class = 1 })
    expect((await f.read()).equipment?.instances).toEqual([])
  })
  it.each([14, 80, 84])('rejects object %s changed between dependent reads', async changed => {
    const f = fixture(); const get = f.client.ledgerService.getObject.bind(f.client.ledgerService)
    ;(f.client.ledgerService as any).getObject = async (request: any) => {
      if (request.objectId === id(changed) && request.readMask.paths.length === 3) f.objects.get(id(changed)).version++
      return get(request)
    }
    await expect(f.read()).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_CHANGED', status: 409 })
  })
  it('rejects missing Runtime pin, mismatched linkage/digest and missing type origin', async () => {
    const f = fixture()
    await expect(readNativeEquipment(f.client, f.target.runtime ? { ...f.target, runtime: undefined } : f.target,
      { soulId: id(12), stateId: id(14) })).rejects.toMatchObject({ status: 503 })
    f.objects.get(id(5)).package.linkage.at(-1).upgradedId = id(99)
    await expect(f.read()).rejects.toThrow('linkage')
    f.objects.get(id(5)).package.linkage.at(-1).upgradedId = id(71)
    f.objects.get(id(71)).digest = 'wrong'
    await expect(f.read()).rejects.toThrow('release')
    f.objects.get(id(71)).digest = f.target.runtime.callableDigest
    f.objects.get(id(71)).package.typeOrigins.pop()
    await expect(f.read()).rejects.toThrow('origin')
  })
  it('reads Runtime pin from the same release config, rejects malformed optional pin', () => {
    const f = fixture()
    const env = { NEXT_PUBLIC_SUI_NETWORK: 'mainnet', NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(f.target),
      NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: f.target.soulidityCallablePackageId,
      NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: f.target.soulidityOriginalPackageId }
    expect(readNativeReceiveTarget(env as NodeJS.ProcessEnv).runtime).toEqual(f.target.runtime)
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify({ ...f.target, runtime: { ...f.target.runtime, callableDigest: '' } })
    expect(() => readNativeReceiveTarget(env as NodeJS.ProcessEnv)).toThrow('configuration')
  })
  it('keeps equipment writes disabled unless the same exact release explicitly enables them', async () => {
    const f = fixture(); expect((await f.read()).release.writesEnabled).toBe(false)
    const env = { NEXT_PUBLIC_SUI_NETWORK: 'mainnet', NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify({ ...f.target, equipmentWritesEnabled: true }),
      NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: f.target.soulidityCallablePackageId,
      NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: f.target.soulidityOriginalPackageId }
    expect(readNativeReceiveTarget(env as NodeJS.ProcessEnv).equipmentWritesEnabled).toBe(true)
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify({ ...f.target, equipmentWritesEnabled: 'true' })
    expect(() => readNativeReceiveTarget(env as NodeJS.ProcessEnv)).toThrow('configuration')
    const { runtime: _, ...withoutRuntime } = f.target
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify({ ...withoutRuntime, equipmentWritesEnabled: true })
    expect(() => readNativeReceiveTarget(env as NodeJS.ProcessEnv)).toThrow('configuration')
  })
  it('paginates wallet discovery for the live Soul holder, rereads instances and does not claim admission', async () => {
    const f = fixture(); const calls: unknown[] = []
    ;(f.client.core as any).listOwnedObjects = async (request: unknown) => {
      calls.push(request)
      return { objects: [{ objectId: id(84), type: f.runtimeType('OwnedBaseItemV8'),
        owner: { $kind: 'AddressOwner', AddressOwner: id(11) } }], hasNextPage: true, cursor: 'bmV4dA==' }
    }
    const result = await f.read({ kind: 'base', cursor: 'cGFnZQ==' })
    expect(calls).toEqual([{ owner: id(11), type: f.runtimeType('OwnedBaseItemV8'), limit: 20, cursor: 'cGFnZQ==' }])
    expect(result.inventory).toMatchObject({ hasNextPage: true, cursor: 'bmV4dA==',
      objects: [{ kind: 'base', eligibility: 'NOT_EVALUATED', occupancy: 'THIS_SOUL', item: { id: id(84) } }] })
  })
  it('reports unlocked/other-loadout inventory without inventing empty equipment or admission', async () => {
    const f = fixture(); f.objects.delete(f.pointerId)
    ;(f.client.core as any).listOwnedObjects = async () => ({ objects: [{ objectId: id(84), type: f.runtimeType('OwnedBaseItemV8'),
      owner: { $kind: 'AddressOwner', AddressOwner: id(11) } }], hasNextPage: false, cursor: null })
    expect((await f.read({ kind: 'base' })).inventory?.objects[0].occupancy).toBe('OTHER_LOADOUT')
    f.set(id(84), EquipmentBaseItemBcs, v => { v.equip_lock = null })
    const result = await f.read({ kind: 'base' })
    expect(result.status).toBe('NOT_CREATED')
    expect(result.inventory?.objects[0]).toMatchObject({ occupancy: 'UNLOCKED', eligibility: 'NOT_EVALUATED' })
  })
  it('returns a retryable conflict when an instance changes between wallet discovery and equipment read', async () => {
    const f = fixture()
    ;(f.client.core as any).listOwnedObjects = async () => ({ objects: [{ objectId: id(84), type: f.runtimeType('OwnedBaseItemV8'),
      owner: { $kind: 'AddressOwner', AddressOwner: id(11) } }], hasNextPage: false, cursor: null })
    const get = f.client.ledgerService.getObject.bind(f.client.ledgerService); let reads = 0
    ;(f.client.ledgerService as any).getObject = async (request: any) => {
      if (request.objectId === id(84) && ++reads === 2) f.objects.get(id(84)).version++
      return get(request)
    }
    await expect(f.read({ kind: 'base' })).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_CHANGED', status: 409 })
  })
  it.each(['duplicate', 'wrong-owner', 'stale-owner', 'missing-cursor', 'oversize'])('rejects inconsistent inventory %s', async problem => {
    const f = fixture()
    const row = { objectId: id(84), type: f.runtimeType('OwnedBaseItemV8'), owner: { $kind: 'AddressOwner', AddressOwner: id(11) } }
    if (problem === 'wrong-owner') row.owner.AddressOwner = id(99)
    if (problem === 'stale-owner') f.objects.get(id(84)).owner.address = id(99)
    ;(f.client.core as any).listOwnedObjects = async () => ({ objects: Array.from({ length: problem === 'oversize' ? 21 : problem === 'duplicate' ? 2 : 1 }, () => row),
      hasNextPage: problem === 'missing-cursor', cursor: null })
    await expect(f.read({ kind: 'base' })).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_INVALID' })
  })
  it('fails rather than returning an empty inventory on index outages and bad cursors', async () => {
    const f = fixture()
    ;(f.client.core as any).listOwnedObjects = async () => { throw new Error('index unavailable') }
    await expect(f.read({ kind: 'base' })).rejects.toThrow('index unavailable')
    await expect(f.read({ kind: 'base', cursor: 'bad' })).rejects.toThrow('cursor')
  })
})
