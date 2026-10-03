import { describe, expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'
import { Transaction } from '@mysten/sui/transactions'
import { createWalrusBatchHistoryVerifier } from '../../web/lib/upload/walrus-batch-history'
import { batchHistoryFixture } from './fixtures/walrus-batch-history'

describe('batch historical proof', () => {
  it('requires an explicit parent full-business verifier', () => {
    expect(() => createWalrusBatchHistoryVerifier({ client: {} as any, chainIdentifier: '35834a8a' } as any)).toThrow('PARENT_VERIFIER_REQUIRED')
  })
  it('supports an empty public parent registration without reading Walrus objects', async () => {
    const f = await batchHistoryFixture(0)
    expect((await f.proveRegister()).blobs).toEqual([])
    expect(f.transport.ledgerService.getObject).not.toHaveBeenCalled()
    expect(f.parent.mock.calls[0][0].walrusCommandIndices).toEqual([])
    await expect(f.verifier.verifyConsumption({ preparation: f.preparation, registration: await f.proveRegister(), packet: f.register,
      indices: [], certificates: [], signal: f.controller.signal })).rejects.toThrow('INDICES_INVALID')
  })
  it('maps repeated identical payloads one-to-one through raw ordered events', async () => {
    const f = await batchHistoryFixture(), proof = await f.proveRegister()
    expect(proof.blobs.map(b => b.objectId)).toEqual(f.blobValues.map(b => b.id))
    expect(new Set(proof.blobs.map(b => b.blobId)).size).toBe(1)
    expect(f.parent).toHaveBeenCalledOnce()
    expect(f.base.client.core.getObject).not.toHaveBeenCalled()
  })
  it('verifies the default CoinWithBalance shared split for all files', async () => {
    const f = await batchHistoryFixture(3, true)
    expect((await f.proveRegister()).blobs).toHaveLength(3)
  })
  it.each(['address', 'mixed', 'exact', 'merge'] as const)('verifies actual SDK %s WAL funding', async mode => {
    const f = await batchHistoryFixture(3, mode)
    expect((await f.proveRegister()).blobs).toHaveLength(3)
  })
  it('proves consumed Blobs historically after a package upgrade and object custody change', async () => {
    const f = await batchHistoryFixture(), consume = await f.consumption(), proof = await consume.prove()
    expect(proof.blobObjectIds).toEqual(f.blobValues.map(b => b.id))
    expect(f.parent.mock.calls.at(-1)![0].stage).toBe('consume')
    expect(f.base.client.core.executeTransaction).not.toHaveBeenCalled()
  })
  it('supports a proper subset in explicit parent chunk order', async () => {
    const f = await batchHistoryFixture(3), consume = await f.consumption([2, 0])
    expect((await consume.prove()).indices).toEqual([2, 0])
  })
  it('rejects checkpoint effects mismatch', async () => {
    const f = await batchHistoryFixture(), original = f.transport.ledgerService.getCheckpoint.getMockImplementation()!
    f.transport.ledgerService.getCheckpoint.mockImplementation(async (input: any) => {
      f.registerEffects.V2!.gasUsed.computationCost = '999'
      return original(input)
    })
    await expect(f.proveRegister()).rejects.toThrow('CHECKPOINT_MEMBERSHIP')
  })
  it('rejects a canonical receipt-shaped object without authentic full Object BCS', async () => {
    const f = await batchHistoryFixture(), row = f.registeredRows[0]
    row.bcs.value = new Uint8Array(row.bcs.value); row.bcs.value[row.bcs.value.length - 1] ^= 1
    await expect(f.proveRegister()).rejects.toThrow('BCS_DIGEST_MISMATCH')
  })
  it('rejects duplicate same-payload object mapping', async () => {
    const f = await batchHistoryFixture()
    f.registerEvents[1].contents = f.registerEvents[0].contents
    await expect(f.proveRegister()).rejects.toThrow('REGISTER_OBJECT_ALIAS')
  })
  it('rejects an arbitrary parent suffix even when all Walrus evidence is valid', async () => {
    const f = await batchHistoryFixture()
    f.parent.mockRejectedValue(new Error('PARENT_FULL_GRAPH_REJECTED'))
    await expect(f.proveRegister()).rejects.toThrow('PARENT_FULL_GRAPH_REJECTED')
  })
  it('rejects imported consumption registration mapping swaps', async () => {
    const f = await batchHistoryFixture(), consume = await f.consumption()
    const blobs = consume.params.registration.blobs
    ;[blobs[0].objectId, blobs[1].objectId] = [blobs[1].objectId, blobs[0].objectId]
    await expect(consume.prove()).rejects.toThrow('REGISTRATION_PROOF_MISMATCH')
  })
  it.each(['root', 'size', 'term', 'recipient', 'payment', 'extraSplit'] as const)('rejects finalized rehashed %s tampering', async field => {
    const f = await batchHistoryFixture()
    await f.rewriteRegister(tx => {
      const data = tx.getData(), register = data.commands.find(c => c.MoveCall?.function === 'register_blob')!.MoveCall!
      const reserve = data.commands.find(c => c.MoveCall?.function === 'reserve_space')!.MoveCall!
      if (field === 'extraSplit') { tx.splitCoins(tx.object('0x' + '58'.padStart(64, '0')), [tx.pure.u64(1)]); return }
      const argument = field === 'root' ? register.arguments[3] : field === 'size' ? register.arguments[4]
        : field === 'term' ? reserve.arguments[2] : field === 'recipient' ? data.commands.find(c => c.TransferObjects)!.TransferObjects!.address
          : data.commands.find(c => c.SplitCoins)!.SplitCoins!.amounts[0]
      const bytes = field === 'root' || field === 'recipient' ? bcs.Address.serialize('0x' + '1'.padStart(64, '0')).toBase64()
        : field === 'term' ? bcs.u32().serialize(4).toBase64() : bcs.u64().serialize(999).toBase64()
      if (argument.$kind !== 'Input') throw Error('fixture input required')
      data.inputs[argument.Input] = { $kind: 'Pure', Pure: { bytes } }
      return Transaction.from(JSON.stringify(data))
    })
    await expect(f.proveRegister()).rejects.toThrow()
  })
  it('requires the created-and-wrapped embedded Storage UID effect', async () => {
    const f = await batchHistoryFixture(), id = f.blobValues[0].storage.id
    f.registerEffects.V2!.changedObjects = f.registerEffects.V2!.changedObjects.filter(([key]) => key !== id)
    await expect(f.proveRegister()).rejects.toThrow('STORAGE_CREATED_WRAPPED')
  })
  it('rejects forged input BCS even if the certify output is valid', async () => {
    const f = await batchHistoryFixture(), consume = await f.consumption()
    const read = f.transport.ledgerService.getObject.getMockImplementation()!
    let reads = 0
    f.transport.ledgerService.getObject.mockImplementation(async (input: any) => {
      const result = await read(input)
      if (input.objectId === f.blobValues[0].id && input.version === 10n && ++reads === 2) {
        result.response.object.bcs.value[0] ^= 1
      }
      return result
    })
    await expect(consume.prove()).rejects.toThrow('CERTIFY_INPUT_BCS')
  })
  it('refuses missing finality and failed raw effects', async () => {
    const f = await batchHistoryFixture()
    f.registerEffects.V2!.status = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: {
      ...f.registerEffects.V2!, status: { Failure: { error: { InsufficientGas: true }, command: null } },
    } }).toBytes()).V2!.status
    await expect(f.proveRegister()).rejects.toThrow('SUCCESS_REQUIRED')
  })
})
