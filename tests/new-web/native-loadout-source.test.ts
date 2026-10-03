import { expect, it, vi } from 'vitest'
import { captureNamedLoadout } from '../../web/lib/animacraft/named-loadout'
import { readNativeLoadoutSource } from '../../web/lib/animacraft/native-loadout-source'
import { EquipmentBaseItemBcs, EquipmentExternalItemBcs, EquipmentReadSet } from '../../web/lib/animacraft/native-equipment'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { nativeEquipmentPackFixture, packId as id } from './fixtures/native-equipment-pack'
import { EquipmentPackPassBcs,equipmentPackPassCommitment } from '../../web/lib/animacraft/native-equipment-pack'

it('reads an unchanged Base reference exactly without a style index and reads shared identity once', async () => {
  const f = nativeEquipmentSourceFixture(); const content = captureNamedLoadout(await f.readBase())
  f.objects.delete(f.indexId)
  const batch = vi.spyOn(f.client.ledgerService, 'batchGetObjects')
  const result = await readNativeLoadoutSource(f.client,f.target,{soulId:content.soulId,stateId:content.stateId,content})
  expect(result.source?.styles.map(row => row.style_key)).toEqual(['red'])
  const requests = batch.mock.calls.flatMap(([arg]) => arg.requests!.map(row => row.objectId))
  expect(requests.filter(value => value === id(84))).toHaveLength(1)
  expect(requests.filter(value => value === content.stateId)).toHaveLength(1)
  expect(requests).not.toContain(f.indexId)
})

it('reads 500 exact owned IDs without inventory pagination and deduplicates their shared Base rows', async () => {
  const f = nativeEquipmentSourceFixture(); const content = captureNamedLoadout(await f.readBase())
  const template = EquipmentBaseItemBcs.parse(f.objects.get(id(84)).contents.value)
  content.slots = Array.from({length:500},(_,i) => {
    const itemId = id(1000+i)
    f.put(itemId,f.runtimeType('OwnedBaseItemV8'),EquipmentBaseItemBcs,{...template,id:itemId,equip_lock:null},1,id(11))
    return {...content.slots[0]!,accessSubject:itemId}
  })
  const listing = vi.fn(() => { throw new Error('Inventory scan forbidden') })
  ;(f.client.core as any).listOwnedObjects = listing
  f.objects.delete(f.indexId)
  const batch = vi.spyOn(f.client.ledgerService,'batchGetObjects')
  const result = await readNativeLoadoutSource(f.client,f.target,{soulId:content.soulId,stateId:content.stateId,content})
  expect(result.inventory?.objects).toHaveLength(500)
  expect(result.source?.ownership).toHaveLength(500)
  expect(result.source?.styles).toHaveLength(1)
  expect(listing).not.toHaveBeenCalled()
  const requests = batch.mock.calls.flatMap(([arg]) => arg.requests!.map(row => row.objectId))
  expect(requests.filter(value => value === f.styleId)).toHaveLength(1)
  expect(requests.filter(value => value === f.ownershipId)).toHaveLength(1)
})

it('deduplicates 500 Pack references to one exact pass/release/style read without discovery pages', async () => {
  const f = nativeEquipmentPackFixture(); const content = captureNamedLoadout(await f.readBase())
  const row = {...content.slots[0]!,kind:'pack-selection' as const,accessSubject:f.passId,
    sourceDefinitionId:f.releaseId,partKey:'body',itemKey:'pack-hat',styleKey:'snow'}
  content.slots = Array.from({length:500},() => ({...row}))
  f.objects.delete(f.indexId)
  const batch = vi.spyOn(f.client.ledgerService,'batchGetObjects')
  const result = await readNativeLoadoutSource(f.client,f.target,{soulId:content.soulId,stateId:content.stateId,content})
  expect(result.source?.applyPacks).toHaveLength(1)
  expect(result.source?.applyPacks[0].selected?.styles).toHaveLength(1)
  expect(f.listPasses).not.toHaveBeenCalled(); expect(f.listStyles).not.toHaveBeenCalled()
  const requests = batch.mock.calls.flatMap(([arg]) => arg.requests!.map(row => row.objectId))
  for (const objectId of [f.passId,f.releaseId,f.packStyleId]) expect(requests.filter(value => value === objectId)).toHaveLength(1)
})

it('still rejects current custody loss for an unchanged saved target', async () => {
  const f = nativeEquipmentSourceFixture(); const content = captureNamedLoadout(await f.readBase())
  f.objects.get(id(84)).owner.address = id(999)
  await expect(readNativeLoadoutSource(f.client,f.target,{soulId:content.soulId,stateId:content.stateId,content})).rejects.toThrow(/custody/)
})

it('reads distinct Pack passes concurrently with a bounded fan-out instead of serial group latency',async () => {
  const f = nativeEquipmentPackFixture(); const content = captureNamedLoadout(await f.readBase())
  const passIds = new Set<string>()
  content.slots = Array.from({length:40},(_,i) => {
    const passId = id(4000+i); passIds.add(passId)
    const pass = {...f.pass,id:passId}; pass.commitment = equipmentPackPassCommitment(pass)
    f.put(passId,f.runtimeType('PackPassV8'),EquipmentPackPassBcs,pass,1,id(11))
    return {...content.slots[0]!,kind:'pack-selection' as const,accessSubject:passId,
      sourceDefinitionId:f.releaseId,partKey:'body',itemKey:'pack-hat',styleKey:'snow'}
  })
  const read = f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
  let active = 0; let peak = 0
  vi.spyOn(f.client.ledgerService,'batchGetObjects').mockImplementation(async arg => {
    if (!arg.requests?.some(row => passIds.has(row.objectId!))) return read(arg)
    active++; peak = Math.max(active,peak)
    await new Promise(resolve => setTimeout(resolve,1))
    try {return await read(arg)} finally {active--}
  })
  const result = await readNativeLoadoutSource(f.client,f.target,{soulId:content.soulId,stateId:content.stateId,content})
  expect(result.source!.applyPacks.map(pack => pack.selected!.pass.id)).toEqual([...passIds])
  expect(peak).toBe(16)
})

it('reads more than one page of exact External targets and deduplicates their product/admission', async () => {
  const f = nativeEquipmentSourceFixture(); const external = f.addExternal()
  const content = captureNamedLoadout(await f.readBase())
  const template = EquipmentExternalItemBcs.parse(f.objects.get(external.itemId).contents.value)
  content.slots = Array.from({length:32},(_,i) => {
    const itemId = id(2000+i)
    f.put(itemId,f.runtimeType('OwnedExternalItemV8'),EquipmentExternalItemBcs,{...template,id:itemId},1,id(11))
    return {...content.slots[0]!,kind:'external-item' as const,accessSubject:itemId,sourceDefinitionId:external.productId}
  })
  const batch = vi.spyOn(f.client.ledgerService,'batchGetObjects')
  const result = await readNativeLoadoutSource(f.client,f.target,{soulId:content.soulId,stateId:content.stateId,content})
  expect(result.inventory?.objects).toHaveLength(32)
  expect(result.source?.external).toHaveLength(1)
  const requests = batch.mock.calls.flatMap(([arg]) => arg.requests!.map(row => row.objectId))
  for (const objectId of [external.productId,external.admissionId]) expect(requests.filter(value => value === objectId)).toHaveLength(1)
})

it('bounds concurrent exact read requests to sixteen even for a large caller batch', async () => {
  const f = nativeEquipmentSourceFixture(); const template = EquipmentBaseItemBcs.parse(f.objects.get(id(84)).contents.value)
  const read = f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
  let active = 0; let peak = 0
  vi.spyOn(f.client.ledgerService,'batchGetObjects').mockImplementation(async arg => {
    active++; peak = Math.max(active,peak)
    await new Promise(resolve => setTimeout(resolve,1))
    try { return await read(arg) } finally { active-- }
  })
  const reads = new EquipmentReadSet(f.client,true)
  await Promise.all(Array.from({length:50},(_,i) => {
    const itemId = id(3000+i)
    f.put(itemId,f.runtimeType('OwnedBaseItemV8'),EquipmentBaseItemBcs,{...template,id:itemId},1,id(11))
    return reads.read(itemId,f.runtimeType('OwnedBaseItemV8'),1,id(11))
  }))
  expect(peak).toBe(16)
})

it('cached rows revalidate every requested type and owner and retain final drift checks', async () => {
  const f = nativeEquipmentSourceFixture(); const reads = new EquipmentReadSet(f.client,true)
  await reads.read(id(84),f.runtimeType('OwnedBaseItemV8'),1,id(11))
  await expect(reads.read(id(84),f.runtimeType('OwnedExternalItemV8'),1,id(11))).rejects.toThrow(/type/)
  await expect(reads.read(id(84),f.runtimeType('OwnedBaseItemV8'),1,id(999))).rejects.toThrow(/custody/)
  f.objects.get(id(84)).version += 1n
  await expect(reads.verify()).rejects.toThrow(/changed/)
})
