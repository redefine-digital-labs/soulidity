import { describe, expect, it, vi } from 'vitest'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { nativeEquipmentFixture } from './fixtures/native-equipment'
import { NativeSoulBindingBcs, NativeSoulBcs } from '../../web/lib/animacraft/native-receive'
import { NativeArtworkOutputBcs } from '../../web/lib/animacraft/native-artwork'
import { EquipmentLoadoutBcs, equipmentCommitment } from '../../web/lib/animacraft/native-equipment'
import { CompleteRecipeFieldBcs, CompleteRecipeKeyBcs, readNativeRecipe } from '../../web/lib/animacraft/native-recipe'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const hash = (n: number) => Array(32).fill(n)
function fixture() {
  const f = nativeEquipmentFixture()
  const origin = id(97) // Type introduction differs from original AND callable package IDs.
  const keyType = `${origin}::output_v8::CompleteRecipeKeyV8`
  const valueType = `${origin}::output_v8::CompleteRecipeSnapshotV8`
  f.objects.get(id(4)).package.typeOrigins.push(...['CompleteRecipeKeyV8', 'CompleteRecipeSnapshotV8']
    .map(datatypeName => ({ moduleName: 'output_v8', datatypeName, packageId: origin })))
  const row = EquipmentLoadoutBcs.parse(f.objects.get(id(80)).contents.value).selections[0]!
  const definition_slots = [{ source_definition_id: id(10), part_key: 'body', profile_commitment: hash(1), start: '0', capacity: '4' }]
  const selections = [null, { ...row, selection_index: '1', color_channel_key: 'tint', swatch_key: 'red' }, null,
    { ...row, selection_index: '3', color_channel_key: 'tint', swatch_key: 'blue', source_class: 1,
      protected: true, seal_binding_commitment: hash(8) }]
  const output = { id: id(15), version: '8', root_id: id(10), maker_version: '1', root_content_commitment: hash(1),
    output_registry_id: id(30), output_key: 'main', original_holder: id(11), holder: id(11), loadout_id: id(31), loadout_revision: '42',
    loadout_commitment: [...Buffer.from(equipmentCommitment({ version: '8', root_id: id(10), root_version: '1',
      root_content_commitment: hash(1), attached_pack_definitions: [], definition_slots, selections }), 'hex')], output_policy_commitment: hash(1), renderer_schema_commitment: hash(1),
    recipe_commitment: hash(1), render_commitment: hash(1), render_blob_id: Buffer.alloc(32, 4).toString('base64url'),
    render_sha256: hash(2), render_blob_commitment: hash(1), output_commitment: hash(1),
    protected: false, scope_key: '', asset_key: '', seal_id: null, protection_binding_commitment: [] }
  f.set(id(13), NativeSoulBindingBcs, binding => {
    for (const key of ['root_content_commitment', 'output_policy_commitment', 'recipe_commitment', 'render_commitment', 'output_commitment']) binding[key] = hash(1)
  })
  f.set(id(12), NativeSoulBcs, soul => { soul.image_url = `walrus://${output.render_blob_id}` })
  f.put(id(15), `${id(3)}::output_v8::CompleteOutputV8`, NativeArtworkOutputBcs, output, 4)
  // Literal compiler golden: empty Move struct is dummy_field=false (00).
  const fieldId = deriveDynamicFieldID(id(15), keyType, new Uint8Array([0]))
  f.put(fieldId, `0x2::dynamic_field::Field<${keyType},${valueType}>`, CompleteRecipeFieldBcs,
    { id: fieldId, name: { dummy_field: false }, value: { version: '8', attached_pack_definitions: [], definition_slots, selections } }, 2, id(15))
  return { ...f, fieldId, output, selections, keyType, readRecipe: () => readNativeRecipe(f.client, f.target,
    { soulId: id(12), stateId: id(14) }) }
}

describe('immutable completed native recipe', () => {
  function attachedFixture() {
    const f = fixture()
    const edit = (change: (recipe: ReturnType<typeof CompleteRecipeFieldBcs.parse>['value']) => void, rehash = true) => {
      f.set(f.fieldId, CompleteRecipeFieldBcs, row => {
        change(row.value)
        if (rehash) f.set(id(15), NativeArtworkOutputBcs, output => {
          output.loadout_commitment = [...Buffer.from(equipmentCommitment({ ...row.value, root_id: output.root_id,
            root_version: output.maker_version, root_content_commitment: output.root_content_commitment }), 'hex')]
        })
      })
    }
    edit(recipe => {
      recipe.attached_pack_definitions = [{ release_id: id(17), definition_commitment: hash(2) }]
      recipe.definition_slots.push({ source_definition_id: id(17), part_key: 'body',
        profile_commitment: hash(3), start: '4', capacity: '2' })
      recipe.selections.push(null, { ...recipe.selections[3]!, selection_index: '5', source_definition_id: id(17),
        source_semantic_id: 'winter', access_subject: id(18) })
    })
    return { ...f, edit }
  }
  it('retains historical Pack-owned slot identity, sparse colors and protection without consulting current Pack state', async () => {
    const f = attachedFixture()
    f.objects.delete(id(80)); f.objects.delete(id(17)); f.objects.delete(id(18))
    const result = await f.readRecipe()
    if (result.status !== 'AVAILABLE') throw new Error('Missing recipe')
    expect(result.recipe.definition_slots.map(row => [row.source_definition_id, row.part_key, row.start, row.capacity]))
      .toEqual([[id(10), 'body', '0', '4'], [id(17), 'body', '4', '2']])
    expect(result.recipe.selections[4]).toBeNull()
    expect(result.recipe.selections[5]).toMatchObject({ source_definition_id: id(17), swatch_key: 'blue', protected: true,
      seal_binding_commitment: hash(8) })
    expect(f.calls.some(c => [id(17), id(18), id(80)].includes(c.objectId))).toBe(false)
  })
  it.each(['duplicate', 'root', 'short-hash', 'unknown-slot', 'duplicate-slot', 'foreign-selection', 'base-selection', 'range'])
    ('rejects rehashed historical Pack %s mismatch', async problem => {
      const f = attachedFixture()
      f.edit(recipe => {
        if (problem === 'duplicate') recipe.attached_pack_definitions.push(recipe.attached_pack_definitions[0])
        if (problem === 'root') recipe.attached_pack_definitions[0].release_id = id(10)
        if (problem === 'short-hash') recipe.attached_pack_definitions[0].definition_commitment = [1]
        if (problem === 'unknown-slot') recipe.definition_slots[1].source_definition_id = id(99)
        if (problem === 'duplicate-slot') recipe.definition_slots[1].source_definition_id = id(10)
        if (problem === 'foreign-selection') recipe.selections[5]!.source_definition_id = id(99)
        if (problem === 'base-selection') recipe.selections[5]!.source_class = 0
        if (problem === 'range') recipe.definition_slots[1].start = '3'
      })
      await expect(f.readRecipe()).rejects.toThrow(/Completed recipe/)
    })
  it('binds the exact historical attachment hash to the immutable output loadout commitment', async () => {
    const f = attachedFixture()
    f.edit(recipe => { recipe.attached_pack_definitions[0].definition_commitment[0] ^= 1 }, false)
    await expect(f.readRecipe()).rejects.toThrow('Completed recipe commitment mismatch')
  })
  it('preserves committed Pack attachments even when they add no slots or selections', async () => {
    const f = fixture()
    f.set(f.fieldId, CompleteRecipeFieldBcs, row => {
      row.value.attached_pack_definitions.push({ release_id: id(17), definition_commitment: hash(2) })
      row.value.selections = row.value.selections.map((selection: any) => selection && { ...selection, source_class: 0 })
      f.set(id(15), NativeArtworkOutputBcs, output => {
        output.loadout_commitment = [...Buffer.from(equipmentCommitment({ ...row.value, root_id: output.root_id,
          root_version: output.maker_version, root_content_commitment: output.root_content_commitment }), 'hex')]
      })
    })
    const result = await f.readRecipe()
    expect(result.status).toBe('AVAILABLE')
    if (result.status !== 'AVAILABLE') throw new Error('Missing recipe')
    expect(result.recipe.attached_pack_definitions).toEqual([{ release_id: id(17), definition_commitment: hash(2) }])
    expect(f.calls.some(c => c.objectId === id(17) || c.objectId === id(80))).toBe(false)
  })
  it('requires the fresh snapshot attachment vector before definition slots', async () => {
    const f = fixture(), object = f.objects.get(f.fieldId), bytes = object.contents.value as Uint8Array
    // Field ID (32), empty Move key (1), and snapshot version (8).
    expect([...bytes.slice(41, 43)]).toEqual([0, 1])
    object.contents.value = new Uint8Array([...bytes.slice(0, 41), ...bytes.slice(42)])
    await expect(f.readRecipe()).rejects.toThrow()
  })
  it('requires exact recipe evidence even when the saved completion image is protected', async () => {
    const f = fixture()
    f.set(id(15), NativeArtworkOutputBcs, row => {
      row.protected = true; row.scope_key = 'complete/main'; row.asset_key = 'receipt-fixture'; row.seal_id = hash(4)
    })
    vi.spyOn(f.client.ledgerService, 'batchGetObjects').mockRejectedValue(new Error('recipe unavailable'))
    await expect(f.readRecipe()).rejects.toThrow('recipe unavailable')
  })
  it('uses Move key golden and exact defining types; preserves gaps, per-slot colors and protected metadata', async () => {
    const f = fixture(); const result = await f.readRecipe()
    expect([...CompleteRecipeKeyBcs.serialize({ dummy_field: false }).toBytes()]).toEqual([0])
    expect(result.status).toBe('AVAILABLE')
    if (result.status !== 'AVAILABLE') throw new Error('Expected recipe')
    expect(result.recipe.selections).toEqual(f.selections)
    expect(result.output.loadout_revision).toBe('42')
    expect(f.calls.some(c => c.objectId === id(31) || c.objectId === id(80))).toBe(false)
  })
  it('is unchanged when the original Player is changed/deleted and equipment is changed', async () => {
    const f = fixture(); const before = await f.readRecipe()
    f.editLoadout(v => { v.selections[0].style_key = 'other'; v.revision = '99' })
    f.objects.delete(id(31)); f.objects.delete(f.pointerId)
    expect(await f.readRecipe()).toEqual(before)
  })
  it('only actual NOT_FOUND is missing, never a live Player fallback', async () => {
    const f = fixture(); f.objects.delete(f.fieldId)
    expect(await f.readRecipe()).toMatchObject({ status: 'MISSING', artwork: { outputId: id(15) } })
    expect(f.calls.some(c => c.objectId === id(31))).toBe(false)
  })
  it.each([2, 7, 14])('does not turn RPC status %s into absence', async code => {
    const f = fixture(); vi.spyOn(f.client.ledgerService, 'batchGetObjects').mockResolvedValue({ response: {
      objects: [{ result: { oneofKind: 'error', error: { code } } }],
    } } as never)
    await expect(f.readRecipe()).rejects.toMatchObject({ code: 'NATIVE_RECIPE_UNAVAILABLE', status: 503 })
  })
  it.each(['id', 'parent', 'owner', 'type', 'name', 'version', 'index', 'source', 'swatch', 'hash', 'trailing', 'truncated', 'emptySlots', 'overflow'])(
    'rejects invalid %s without rendering', async mode => {
      const f = fixture(); const object = f.objects.get(f.fieldId)
      if (mode === 'id') object.objectId = id(99)
      if (mode === 'parent') object.owner.address = id(99)
      if (mode === 'owner') object.owner.kind = 4
      if (mode === 'type') object.objectType = object.objectType.replaceAll(id(97), id(3))
      if (mode === 'trailing') object.contents.value = new Uint8Array([...object.contents.value, 0])
      if (mode === 'truncated') object.contents.value = object.contents.value.slice(0, -1)
      if (mode === 'hash') f.set(id(15), NativeArtworkOutputBcs, v => { v.loadout_commitment = hash(99) })
      if (['name', 'version', 'index', 'source', 'swatch', 'emptySlots', 'overflow'].includes(mode)) {
        f.set(f.fieldId, CompleteRecipeFieldBcs, v => {
          if (mode === 'name') v.name.dummy_field = true
          if (mode === 'version') v.value.version = '9'
          if (mode === 'index') v.value.selections[1].selection_index = '0'
          if (mode === 'source') v.value.selections[1].source_class = 3
          if (mode === 'swatch') v.value.selections[1].swatch_key = 'other'
          if (mode === 'emptySlots') v.value.selections = []
          if (mode === 'overflow') v.value.selections = Array(501).fill(null)
        })
      }
      await expect(f.readRecipe()).rejects.toThrow()
    })
  it('validates immutable parent/provenance before reading a recipe', async () => {
    const f = fixture(); const batch = vi.spyOn(f.client.ledgerService, 'batchGetObjects')
    f.objects.get(id(15)).owner.kind = 3
    await expect(f.readRecipe()).rejects.toThrow('custody')
    expect(batch).not.toHaveBeenCalled()
  })
  it('rejects missing or duplicate exact recipe type origins rather than guessing latest IDs', async () => {
    const f = fixture(); const origins = f.objects.get(id(4)).package.typeOrigins
    const row = origins.pop(); await expect(f.readRecipe()).rejects.toThrow('origin')
    origins.push(row, row); await expect(f.readRecipe()).rejects.toThrow('origin')
  })
  it('supports 500 slots and rehashes the full vector including all empty slots', async () => {
    const f = fixture(); const selections = Array(500).fill(null)
    selections[499] = { ...f.selections[1], selection_index: '499' }
    const definition_slots = Array.from({ length: 8 }, (_, index) => ({ source_definition_id: id(10),
      part_key: index === 7 ? 'body' : `part-${index}`, profile_commitment: hash(1),
      start: String(index * 64), capacity: String(index === 7 ? 52 : 64) }))
    f.set(f.fieldId, CompleteRecipeFieldBcs, v => { v.value.selections = selections; v.value.definition_slots = definition_slots })
    f.set(id(15), NativeArtworkOutputBcs, v => { v.loadout_commitment = [...Buffer.from(equipmentCommitment({
      version: '8', root_id: v.root_id, root_version: v.maker_version, root_content_commitment: v.root_content_commitment,
      attached_pack_definitions: [], definition_slots, selections,
    }), 'hex')] })
    const result = await f.readRecipe()
    expect(result.status === 'AVAILABLE' && result.recipe.selections.length).toBe(500)
  })
})
