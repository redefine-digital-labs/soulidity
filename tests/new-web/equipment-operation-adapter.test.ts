import { expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Inputs } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { createEquipmentOperationAdapter } from '../../web/lib/animacraft/equipment-operation-adapter'
import type { EquipmentSnapshot, EquipmentOperation } from '../../web/lib/animacraft/equipment-operation'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { nativeEquipmentSealFixture } from './fixtures/native-equipment-seal'
import { nativeEquipmentPackFixture } from './fixtures/native-equipment-pack'
import { equipmentOperationFixture, eid, signer } from './fixtures/equipment-operation'
import { packAttachmentEligibility } from '../../web/lib/animacraft/equipment-pack-attachment'
async function fixture(operation?: EquipmentOperation) {
  if (operation?.kind === 'equip' || operation?.kind === 'select-base' || operation?.kind === 'select-pack')
    operation = { ...operation,targetSelectionIndex: operation.targetSelectionIndex ?? '0' }
  const { record, tx } = await equipmentOperationFixture(operation)
  let address: string | null = record.owner
  let snapshot = { soulId: record.soulId, stateId: record.stateId, owner: record.owner, ownershipEpoch: '0',
    release: record.release, listed: false, status: 'BOUND', source: null,
    updateSource: { definitionRegistryId: eid(81), baseRegistryId: eid(85) },
    equipment: { instances: [{ kind: 'base', item: { id: eid(84) } }], loadout: { id: eid(80), revision: '1',
      selection_count: '1', selections: [{}] } } } as unknown as EquipmentSnapshot
  if (operation?.kind === 'create' || operation?.kind === 'equip' || operation?.kind === 'select-base' || operation?.kind === 'clear-selection' || operation?.kind === 'select-pack') {
    const protectedChoice = operation.kind === 'equip' && operation.item.kind === 'base' && operation.item.protection
      || operation.kind === 'select-base' && operation.selection.protection
    const sourceFixture = protectedChoice ? nativeEquipmentSealFixture() : nativeEquipmentSourceFixture()
    snapshot = operation.kind === 'select-pack' ? await nativeEquipmentPackFixture().readPack()
      : operation.kind === 'equip' && operation.item.kind === 'external'
      ? await sourceFixture.addExternal().read() : await sourceFixture.readBase()
    snapshot.owner = record.owner; snapshot.release = record.release
    snapshot.source!.access!.holder = record.owner
    if (snapshot.source!.pack?.selected) snapshot.source!.pack.selected.pass.holder = record.owner
    for (const row of snapshot.inventory?.objects ?? []) row.item.holder = record.owner
    if (operation.kind === 'select-base') snapshot.source!.definitions.item_assetization = false
    if (operation.kind === 'create') { snapshot.status = 'NOT_CREATED'; snapshot.equipment = null }
    else if (operation.kind === 'clear-selection' || operation.replaces?.kind === 'selection') {
      snapshot.equipment!.loadout.selections[0]!.access_subject = snapshot.source!.access!.id
      snapshot.equipment!.instances = []
      if (operation.kind === 'clear-selection') snapshot.source = null
    }
    else if (!operation.replaces) {
      snapshot.equipment!.loadout.selections = [null]; snapshot.equipment!.loadout.selection_count = '0'
      snapshot.equipment!.instances = []
      if (snapshot.inventory?.objects[0]) snapshot.inventory.objects[0].item.equip_lock = null
    }
  }
  if (operation?.kind === 'attach-pack') {
    const packFixture = nativeEquipmentPackFixture(); packFixture.addOwnedColor()
    snapshot = await packFixture.readPack()
    snapshot.owner = record.owner; snapshot.release = record.release
    snapshot.source!.access!.holder = record.owner
    snapshot.source!.pack!.selected!.pass.holder = record.owner
  }
  function effects(success = true, digest = record.digest) {
    return bcs.TransactionEffects.serialize({ V2: {
      status: success ? { Success: true } : { Failure: { error: { InsufficientGas: true }, command: 0 } },
      executedEpoch: '9', gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
      transactionDigest: digest, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '3',
      changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null,
    } }).toBytes()
  }
  const ledger = { digest: record.digest, transaction: { digest: record.digest, bcs: { value: fromBase64(record.bytes) } },
    effects: { transactionDigest: record.digest, bcs: { value: effects() }, status: { success: true } }, checkpoint: 0n as bigint | undefined }
  const client = {
    ledgerService: {
      getServiceInfo: vi.fn(async () => ({ response: { chainId: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S' } })),
      getEpoch: vi.fn(async () => ({ response: { epoch: { epoch: 9n } } })),
      getTransaction: vi.fn(async () => ({ response: { transaction: ledger } })),
    },
    core: {
      simulateTransaction: vi.fn(async (_request: unknown) => ({ $kind: 'Transaction' })),
      executeTransaction: vi.fn(async () => ({})),
      // Resolver fixture supplies real object references and gas to the REAL
      // SDK builder. This is not an RPC/coin-selection integration assertion.
      resolveTransactionPlugin: () => async (data: any, _options: any, next: () => Promise<void>) => {
        data.inputs = data.inputs.map((input: any) => {
          if (!input.UnresolvedObject) return input
          const objectId = input.UnresolvedObject.objectId
          return [eid(84),eid(102),eid(83),eid(13),...(operation?.kind === 'select-pack' ? [operation.selection.passId] : operation?.kind === 'attach-pack' ? [operation.pack.passId] : [])].includes(objectId) ? Inputs.ObjectRef({ objectId, version: '2', digest: record.release.soulidityCallableDigest })
            : Inputs.SharedObjectRef({ objectId, initialSharedVersion: '1', mutable: objectId === eid(80)
              || objectId === eid(14) && ['close_empty_equipment_v8','create_equipment_v8'].includes(data.commands[0].MoveCall.function) })
        })
        data.gasData = tx.getData().gasData; await next()
      },
    },
  }
  const read = vi.fn(async () => snapshot); const sign = vi.fn(async () => signer.signTransaction(fromBase64(record.bytes)))
  const adapter = createEquipmentOperationAdapter({ client: client as any, read, observed: structuredClone(snapshot), getAddress: () => address, sign })
  return { adapter, client, snapshot, record, ledger, effects, read, sign, setAddress: (value: string | null) => { address = value } }
}
it('derives attachment from fresh definitions and rejects drift before signing', async () => {
  const pack = { releaseId: eid(202), passId: eid(201) }
  const f = await fixture({ kind: 'attach-pack', pack, attachment: { definitionCommitment: 'ab'.repeat(32), additionalSlots: 0 } })
  const eligibility = packAttachmentEligibility(f.snapshot, pack)
  if (!eligibility.allowed) throw new Error(eligibility.reason)
  const prepared = await f.adapter.prepare({ kind: 'attach-pack', pack })
  expect(prepared.operation).toEqual({ kind: 'attach-pack', pack, attachment: eligibility.attachment })
  await f.adapter.preflight(prepared, true)
  expect(f.client.core.simulateTransaction).toHaveBeenCalledTimes(2)
  f.snapshot.source!.pack!.selected!.definitionCapacity++
  await expect(f.adapter.preflight(prepared, true)).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  await expect(f.adapter.preflight(prepared, false)).resolves.toBeUndefined()
})
it('prepares native removal without access/Seal source and simulates exact guarded bytes before signing', async () => {
  const f = await fixture(); const result = await f.adapter.prepare({ kind: 'unequip-base', itemId: eid(84) })
  expect(result.bytes).toBe(f.record.bytes); expect(result.digest).toBe(f.record.digest)
  expect(result.phase).toBe('PREPARED'); expect(f.sign).not.toHaveBeenCalled()
  await f.adapter.preflight(result,true); expect(f.read).toHaveBeenCalledTimes(2)
  expect(f.snapshot.source).toBeNull()
  expect(f.client.core.simulateTransaction).toHaveBeenCalledTimes(2)
  for (const [request] of f.client.core.simulateTransaction.mock.calls) {
    expect(request).toEqual({ transaction: fromBase64(result.bytes), checksEnabled: true })
  }
})
it.each(['releaseId', 'paymentCoinType', 'definitionCommitment'] as const)
('rechecks attached Pack %s before signing while preserving exact-byte signed recovery', async key => {
  const f = await fixture()
  f.snapshot.updateSource!.packDefinitions = [{ releaseId: eid(202), paymentCoinType: `${eid(2)}::sui::SUI`,
    definitionCommitment: 'ab'.repeat(32) }]
  const record = await f.adapter.prepare({ kind: 'unequip-base', itemId: eid(84) })
  expect(record.updateSource!.packDefinitions).toEqual(f.snapshot.updateSource!.packDefinitions)
  expect(f.client.core.simulateTransaction).toHaveBeenCalledTimes(1)
  f.snapshot.updateSource!.packDefinitions[0][key] = key === 'releaseId' ? eid(999)
    : key === 'paymentCoinType' ? `${eid(2)}::other::Coin` : 'cd'.repeat(32)
  await expect(f.adapter.preflight(record, true)).rejects.toThrow('validation source changed')
  // Signed recovery queries first and never rebuilds from new source state.
  // Exact saved Move proofs still verify the actual attachment/revision on chain.
  await expect(f.adapter.preflight(record, false)).resolves.toBeUndefined()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
it('rejects final-state simulation failure before preparing a saved operation or entering the wallet', async () => {
  const f = await fixture()
  f.client.core.simulateTransaction.mockResolvedValue({ $kind: 'FailedTransaction' })
  await expect(f.adapter.prepare({ kind: 'unequip-base', itemId: eid(84) })).rejects.toThrow('final-state simulation failed')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
it('resimulates exact saved bytes before signing, but never during signed query recovery', async () => {
  const f = await fixture(), record = await f.adapter.prepare({ kind: 'unequip-base', itemId: eid(84) })
  f.client.core.simulateTransaction.mockResolvedValue({ $kind: 'FailedTransaction' })
  await expect(f.adapter.preflight(record, true)).rejects.toThrow('final-state simulation failed')
  f.snapshot.updateSource = null
  await f.adapter.preflight(record, false)
  expect(f.client.core.simulateTransaction).toHaveBeenCalledTimes(2)
  expect(f.sign).not.toHaveBeenCalled()
})
it.each(['definitionRegistryId', 'baseRegistryId'] as const)('refuses fresh %s retargeting before simulation/signature', async key => {
  const f = await fixture(), record = await f.adapter.prepare({ kind: 'unequip-base', itemId: eid(84) })
  f.snapshot.updateSource![key] = eid(999)
  await expect(f.adapter.preflight(record, true)).rejects.toThrow('validation source changed')
  expect(f.client.core.simulateTransaction).toHaveBeenCalledTimes(1)
  expect(f.sign).not.toHaveBeenCalled()
})
const baseChoice = { kind: 'base' as const, itemId: eid(84), baseRegistryId: eid(85), styleKey: 'red', swatchKey: 'red' }
const externalChoice = { kind: 'external' as const, itemId: eid(102), productId: eid(101) }
const baseSelection = { baseRegistryId: eid(85), partKey: 'body', itemKey: 'hat', styleKey: 'red', swatchKey: 'red' }
const packSelection = { baseRegistryId: eid(85),releaseId: eid(202),passId: eid(201),partKey: 'body',itemKey: 'pack-hat',styleKey: 'snow',swatchKey: 'snow' }
it('prepares sparse replacement at its original slot and retains that exact target during preflight', async () => {
  const operation: EquipmentOperation = {kind:'equip',item:baseChoice,replaces:{kind:'base',itemId:eid(84)}}
  const f = await fixture(operation); const s = f.snapshot
  // Sparse history indexes do not increase the one-item capacity of a Part.
  s.source!.slots[0].capacity = '1'
  s.source!.slots[0].slotStart = 1
  const row = s.equipment!.loadout.selections[0]!
  row.selection_index = '1'; s.equipment!.loadout.selections = [null,row]
  s.equipment!.instances[0].item.equip_lock!.selection_index = '1'
  s.inventory!.objects[0].item.equip_lock!.selection_index = '1'
  const prepared = await f.adapter.prepare(operation)
  expect(prepared.operation).toEqual({...operation,targetSelectionIndex:'1'})
  const expected = await equipmentOperationFixture({...operation,targetSelectionIndex:'1'})
  expect(prepared.bytes).toBe(expected.record.bytes)
  await f.adapter.preflight(prepared,true)
  expect(f.read).toHaveBeenLastCalledWith(prepared.operation)
  expect(f.sign).not.toHaveBeenCalled()
})
it.each([undefined,{ kind: 'base',itemId: eid(84) },{ kind: 'selection',selectionIndex: '0' }] as const)
  ('prepares exact Pack selection and replacement with independent owned pass custody', async replaces => {
    const operation: EquipmentOperation = { kind: 'select-pack',selection: packSelection,...(replaces ? { replaces } : {}) }
    const f = await fixture(operation); const prepared = await f.adapter.prepare(operation)
    expect(prepared.bytes).toBe(f.record.bytes); await f.adapter.preflight(prepared,true)
    expect(f.read).toHaveBeenLastCalledWith(prepared.operation); expect(f.sign).not.toHaveBeenCalled()
    f.snapshot.source!.pack!.selected!.admission!.admission_state = 1
    await expect(f.adapter.preflight(prepared,true)).rejects.toThrow('not admitted')
    f.snapshot.source = null; await f.adapter.preflight(prepared,false)
    await expect(f.adapter.query(prepared)).resolves.toBe('SUCCEEDED')
  })
it.each(['owned','selection'] as const)('prepares protected %s exact bytes and rejects proof drift before the wallet', async kind => {
  const s = await nativeEquipmentSealFixture().readBase()
  const protection = s.source!.protectedBase.entries[0].proof!
  const operation: EquipmentOperation = kind === 'owned' ? { kind: 'equip',item: { ...baseChoice,protection } }
    : { kind: 'select-base',selection: { ...baseSelection,protection } }
  const f = await fixture(operation); const prepared = await f.adapter.prepare(operation)
  expect(prepared.bytes).toBe(f.record.bytes); await f.adapter.preflight(prepared,true)
  f.snapshot.source!.protectedBase.entries[0].proof!.certificationCommitment = Array(32).fill(99)
  await expect(f.adapter.preflight(prepared,true)).rejects.toThrow('protected-content equipment proof')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  // Already signed bytes remain queryable without healthy source/Seal services.
  f.snapshot.source = null; await f.adapter.preflight(prepared,false)
  expect(f.read).toHaveBeenLastCalledWith(undefined)
  await expect(f.adapter.query(prepared)).resolves.toBe('SUCCEEDED')
})
it.each<EquipmentOperation>([{ kind: 'clear-selection', selectionIndex: '0' }, { kind: 'select-base', selection: baseSelection },
  { kind: 'select-base', selection: baseSelection, replaces: { kind: 'selection', selectionIndex: '0' } },
  { kind: 'select-base', selection: baseSelection, replaces: { kind: 'base', itemId: eid(84) } },
  { kind: 'equip', item: externalChoice, replaces: { kind: 'selection', selectionIndex: '0' } }])
  ('prepares and preflights exact $kind $replaces.kind through the durable adapter', async operation => {
    const f = await fixture(operation); const prepared = await f.adapter.prepare(operation)
    expect(prepared.bytes).toBe(f.record.bytes); await f.adapter.preflight(prepared,true)
    expect(f.read).toHaveBeenLastCalledWith(prepared.operation)
    expect(f.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  })
it('clear refuses an owned component slot instead of stranding its lock', async () => {
  const f = await fixture({ kind: 'clear-selection', selectionIndex: '0' })
  f.snapshot.equipment!.loadout.selections[0]!.access_subject = eid(84)
  await expect(f.adapter.prepare({ kind: 'clear-selection', selectionIndex: '0' })).rejects.toThrow('without unlocking')
})
it('non-asset preparation rechecks source/access before signing and never requires current protocol', async () => {
  const operation: EquipmentOperation = { kind: 'select-base', selection: baseSelection }
  const f = await fixture(operation); f.snapshot.source!.currentProtocol = false
  const prepared = await f.adapter.prepare(operation)
  f.snapshot.source!.access = null
  await expect(f.adapter.preflight(prepared,true)).rejects.toThrow('Maker access')
})
it.each<EquipmentOperation>([{ kind: 'create' }, { kind: 'equip', item: baseChoice }, { kind: 'equip', item: externalChoice },
  { kind: 'equip', item: baseChoice, replaces: { kind: 'base', itemId: eid(84) } },
  { kind: 'equip', item: externalChoice, replaces: { kind: 'base', itemId: eid(84) } }])
  ('prepares exact native $kind $item.kind bytes from a fresh eligible source and requests the selected instance', async operation => {
    const f = await fixture(operation); const prepared = await f.adapter.prepare(operation)
    expect(prepared.bytes).toBe(f.record.bytes); expect(prepared.digest).toBe(f.record.digest)
    expect(f.read).toHaveBeenLastCalledWith(operation)
    await f.adapter.preflight(prepared,true)
    expect(f.read).toHaveBeenLastCalledWith(prepared.operation)
    await f.adapter.preflight(prepared,false)
    expect(f.read).toHaveBeenLastCalledWith(undefined)
    expect(f.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  })
it('rechecks exact Base ownership and source choices before the wallet, not just owner/revision', async () => {
  const operation: EquipmentOperation = { kind: 'equip', item: baseChoice }
  const f = await fixture(operation); const prepared = await f.adapter.prepare(operation)
  f.snapshot.source!.ownership[0].record!.ownership_epoch = '99'
  await expect(f.adapter.preflight(prepared,true)).rejects.toThrow('ownership record')
  expect(f.sign).not.toHaveBeenCalled()
})
it('protocol drift blocks creation but not ordinary equip or source-independent query recovery', async () => {
  const c = await fixture({ kind: 'create' }); const createRecord = await c.adapter.prepare({ kind: 'create' })
  c.snapshot.source!.currentProtocol = false
  await expect(c.adapter.preflight(createRecord,true)).rejects.toThrow('protocol')
  const e = await fixture({ kind: 'equip', item: baseChoice }); e.snapshot.source!.currentProtocol = false
  await expect(e.adapter.prepare({ kind: 'equip', item: baseChoice })).resolves.toMatchObject({ phase: 'PREPARED' })
  c.snapshot.source = null; await expect(c.adapter.query(createRecord)).resolves.toBe('SUCCEEDED')
})
it('rejects stale provenance when resuming an unsigned creation', async () => {
  const f = await fixture({ kind: 'create' }); const prepared = await f.adapter.prepare({ kind: 'create' })
  f.snapshot.provenanceBindingId = eid(999)
  await expect(f.adapter.preflight(prepared,true)).rejects.toThrow('provenance changed')
})
it.each(['writes-off','wallet','revision','release','listed','missing-item','network'])('rejects %s before preparing any signature', async problem => {
  const f = await fixture()
  if (problem === 'writes-off') f.snapshot.release.writesEnabled = false
  if (problem === 'wallet') f.setAddress(eid(999))
  if (problem === 'revision') f.snapshot.equipment!.loadout.revision = '2'
  if (problem === 'release') f.snapshot.release.soulidityCallablePackageId = eid(999)
  if (problem === 'listed') f.snapshot.listed = true
  if (problem === 'missing-item') f.snapshot.equipment!.instances = []
  if (problem === 'network') f.client.ledgerService.getServiceInfo.mockResolvedValue({ response: { chainId: 'wrong' } })
  await expect(f.adapter.prepare({ kind: 'unequip-base', itemId: eid(84) })).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
it('refuses nonempty close', async () => {
  const f = await fixture(); await expect(f.adapter.prepare({ kind: 'close' })).rejects.toThrow('Remove every')
})
it.each(['11111111111111111111111111111111','35834a8a'])('rejects wrong full chain digest or short ID %s before preparing or querying', async chainId => {
  const f=await fixture()
  f.client.ledgerService.getServiceInfo.mockResolvedValue({response:{chainId}})
  await expect(f.adapter.prepare({kind:'unequip-base',itemId:eid(84)})).rejects.toThrow('Mainnet equipment RPC required')
  await expect(f.adapter.query(f.record)).rejects.toThrow('Mainnet equipment RPC required')
  expect(f.read).not.toHaveBeenCalled();expect(f.sign).not.toHaveBeenCalled()
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled();expect(f.client.ledgerService.getTransaction).not.toHaveBeenCalled()
})
it('reads exact finalized success/failure BCS, including checkpoint zero', async () => {
  const f = await fixture(); expect(await f.adapter.query(f.record)).toBe('SUCCEEDED')
  f.ledger.effects.bcs.value = f.effects(false); f.ledger.effects.status.success = false
  expect(await f.adapter.query(f.record)).toBe('FAILED')
  f.ledger.checkpoint = undefined; expect(await f.adapter.query(f.record)).toBe('PENDING')
})
it.each(['digest','bytes','effects-digest','effects-status','checkpoint'])('rejects inconsistent Ledger %s', async problem => {
  const f = await fixture()
  if (problem === 'digest') f.ledger.transaction.digest = 'wrong'
  if (problem === 'bytes') f.ledger.transaction.bcs.value = new Uint8Array([1])
  if (problem === 'effects-digest') f.ledger.effects.bcs.value = f.effects(true, f.record.release.soulidityCallableDigest)
  if (problem === 'effects-status') f.ledger.effects.status.success = false
  if (problem === 'checkpoint') f.ledger.checkpoint = -1n
  await expect(f.adapter.query(f.record)).rejects.toThrow()
})
it('distinguishes NOT_FOUND, network failure and expiry without inventing failed transactions', async () => {
  const f = await fixture()
  f.client.ledgerService.getTransaction.mockRejectedValueOnce({ code: 'NOT_FOUND' })
  expect(await f.adapter.query(f.record)).toBe('MISSING')
  f.client.ledgerService.getTransaction.mockRejectedValueOnce({ code: 'UNAVAILABLE' })
  await expect(f.adapter.query(f.record)).rejects.toEqual({ code: 'UNAVAILABLE' })
  f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch: 11n } } })
  await expect(f.adapter.preflight(f.record,false)).rejects.toThrow('expired')
  expect(await f.adapter.query(f.record)).toBe('SUCCEEDED')
})
it('query remains possible after wallet or release write switch changes; sending does not', async () => {
  const f = await fixture(); f.snapshot.release.writesEnabled = false; f.setAddress(null)
  expect(await f.adapter.query(f.record)).toBe('SUCCEEDED')
  await expect(f.adapter.preflight(f.record,false)).rejects.toThrow('wallet')
})
it('verifies the actual wallet signature and broadcasts only persisted bytes/signature', async () => {
  const f = await fixture(); const signature = await signer.signTransaction(fromBase64(f.record.bytes))
  const record = { ...f.record, phase: 'SIGNED' as const, signature: signature.signature }
  await f.adapter.verifySignature(record); await f.adapter.broadcast(record)
  expect(f.client.core.executeTransaction).toHaveBeenCalledWith({ transaction: fromBase64(record.bytes), signatures: [signature.signature] })
  f.setAddress(eid(999)); await expect(f.adapter.broadcast(record)).rejects.toThrow('Wallet changed')
})
