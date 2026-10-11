import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { PrivateNamedLoadoutHeadFieldV1Bcs } from '../../packages/soulidity-sdk/src/private-named-loadout'
import { SoulStatePublicBcs } from '../../packages/soulidity-sdk/src/soul-public-read'
import { validatePrivateLoadoutPublicPlan, validatePrivateLoadoutTransactionPacket } from '../../web/lib/animacraft/private-loadout-transaction'
import { privateLoadoutTransactionFixture as fixture, rewritePrivateTransactionPacket as rewrite } from './fixtures/private-loadout-transaction'
import { privateId, privateDigest } from './fixtures/private-named-loadout'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
it.each([false, true])('builds and validates exact SDK %s head-CAS without signing or executing', async save => {
  const f = await fixture(save), packet = await f.adapter.prepare(f.plan)
  expect(packet).toEqual(f.packet); expect(validatePrivateLoadoutTransactionPacket(f.plan, packet)).toEqual(packet)
  expect(f.resolver).toHaveBeenCalled(); expect(f.preflight).toHaveBeenCalledWith(f.plan, true)
  expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it.each(['intent', 'name', 'content', 'requestHash'])('rejects plaintext or unknown public plan field %s', async key => {
  const f = await fixture(); expect(() => validatePrivateLoadoutPublicPlan({ ...f.plan, [key]: 'private' })).toThrow('INVALID_FIELDS')
})
it.each(['intent', 'requestHash', 'name'])('rejects extra packet field %s', async key => {
  const f = await fixture(); expect(() => validatePrivateLoadoutTransactionPacket(f.plan, { ...f.packet, [key]: 'private' })).toThrow('INVALID_FIELDS')
})
it('captures public inputs before prepare awaits and never accepts preflight mutation', async () => {
  const f = await fixture(); let resume!: () => void
  f.preflight.mockImplementationOnce(async plan => { plan.requestId = 'aa'.repeat(32); await new Promise<void>(resolve => { resume = resolve }) })
  const pending = f.adapter.prepare(f.plan)
  await vi.waitFor(() => expect(f.preflight).toHaveBeenCalled())
  f.plan.requestId = 'bb'.repeat(32); resume()
  expect((await pending).bytes).toBe(f.packet.bytes)
})
it.each(['PREPARED', 'SIGNING', 'CANCELLED'])('rejects signature on unsigned phase %s', async phase => {
  const f = await fixture(), signed = await f.signed()
  expect(() => validatePrivateLoadoutTransactionPacket(f.plan, { ...signed, phase })).toThrow('UNEXPECTED_SIGNATURE')
})
it('rejects missing/noncanonical signatures and bytes/digest/expiration mismatch', async () => {
  const f = await fixture()
  for (const changed of [{ phase: 'SIGNED' }, { signature: 'not base64' }, { bytes: f.packet.bytes + '=' },
    { digest: privateDigest }, { expirationEpoch: '11' }]) expect(() => validatePrivateLoadoutTransactionPacket(f.plan, { ...f.packet, ...changed })).toThrow()
})
const mutatePacket: Array<[string, (raw: any) => void]> = [
  ['sender', raw => { raw.V1.sender = privateId(80) }],
  ['gas owner', raw => { raw.V1.gasData.owner = privateId(80) }],
  ['zero budget', raw => { raw.V1.gasData.budget = '0' }],
  ['zero price', raw => { raw.V1.gasData.price = '0' }],
  ['empty gas', raw => { raw.V1.gasData.payment = [] }],
  ['duplicate gas', raw => { raw.V1.gasData.payment.push(raw.V1.gasData.payment[0]) }],
  ['overlap gas', raw => { raw.V1.gasData.payment[0].objectId = privateId(2) }],
  ['version zero', raw => { raw.V1.gasData.payment[0].version = '0' }],
  ['wrong package', raw => { raw.V1.kind.ProgrammableTransaction.commands[0].MoveCall.package = privateId(80) }],
  ['wrong function', raw => { raw.V1.kind.ProgrammableTransaction.commands[0].MoveCall.function = 'seal_approve' }],
  ['type argument', raw => { raw.V1.kind.ProgrammableTransaction.commands[0].MoveCall.typeArguments = [{ U64: true }] }],
  ['extra command', raw => { raw.V1.kind.ProgrammableTransaction.commands.push(raw.V1.kind.ProgrammableTransaction.commands[0]) }],
  ['gas argument', raw => { raw.V1.kind.ProgrammableTransaction.commands[0].MoveCall.arguments[0] = { GasCoin: true } }],
  ['argument alias', raw => { raw.V1.kind.ProgrammableTransaction.commands[0].MoveCall.arguments[1] = raw.V1.kind.ProgrammableTransaction.commands[0].MoveCall.arguments[2] }],
  ['pure bytes', raw => { raw.V1.kind.ProgrammableTransaction.inputs[0].Pure.bytes = toBase64(new Uint8Array(8).fill(99)) }],
  ['immutable state', raw => { raw.V1.kind.ProgrammableTransaction.inputs.find((i: any) => i.Object)?.Object.SharedObject &&
    (raw.V1.kind.ProgrammableTransaction.inputs.find((i: any) => i.Object).Object.SharedObject.mutable = false) }],
]
it.each(mutatePacket)('rejects canonical transaction with changed %s', async (_name, change) => {
  const f = await fixture(); expect(() => validatePrivateLoadoutTransactionPacket(f.plan, rewrite(f.packet, change))).toThrow()
})
it.each([1, 2])('requires save equipment/protocol input %s to remain read-only shared', async index => {
  const f = await fixture(true)
  const changed = rewrite(f.packet, raw => { const pt = raw.V1.kind.ProgrammableTransaction
    pt.inputs[pt.commands[0].MoveCall.arguments[index].Input].Object.SharedObject.mutable = true })
  expect(() => validatePrivateLoadoutTransactionPacket(f.plan, changed)).toThrow('SHARED_ARGUMENT_MISMATCH')
})
it('signs exact bytes with a real local key and broadcasts only the verified packet', async () => {
  const f = await fixture(), signed = await f.adapter.sign(f.plan, { ...f.packet, phase: 'SIGNING' })
  expect(signed.bytes).toBe(f.packet.bytes)
  const packet = { ...f.packet, phase: 'SIGNED' as const, signature: signed.signature }
  await f.adapter.verifySignature(f.plan, packet); await f.adapter.broadcast(f.plan, packet)
  expect(f.execute).toHaveBeenCalledWith({ transaction: fromBase64(f.packet.bytes), signatures: [signed.signature] })
  expect(f.preflight.mock.calls.map(([, signing]) => signing)).toEqual([true, false])
})
it('rejects a wrong signer and changed wallet bytes before execution', async () => {
  const f = await fixture(), wrong = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(18))
  const signature = (await wrong.signTransaction(f.bytes)).signature
  await expect(f.adapter.broadcast(f.plan, { ...f.packet, phase: 'SIGNED', signature })).rejects.toThrow()
  f.sign.mockResolvedValueOnce({ bytes: toBase64(new Uint8Array([1])), signature })
  await expect(f.adapter.sign(f.plan, f.packet)).rejects.toThrow('WALLET_BYTES_CHANGED'); expect(f.execute).not.toHaveBeenCalled()
})
it.each(['prepare', 'sign', 'broadcast'])('keeps root permission preflight mandatory for %s', async method => {
  const f = await fixture(); f.preflight.mockRejectedValue(new Error('release disabled'))
  const packet = await f.signed()
  await expect(method === 'prepare' ? f.adapter.prepare(f.plan) : method === 'sign' ? f.adapter.sign(f.plan, f.packet)
    : f.adapter.broadcast(f.plan, packet)).rejects.toThrow('release disabled')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it('expired packets remain queryable but never sign or broadcast', async () => {
  const f = await fixture(); f.getEpoch.mockImplementation((async () => ({ response: { epoch: { epoch: 11n } } })) as any)
  await expect(f.adapter.sign(f.plan, f.packet)).rejects.toThrow('EXPIRED_QUERY_ONLY')
  await expect(f.adapter.broadcast(f.plan, await f.signed())).rejects.toThrow('EXPIRED_QUERY_ONLY')
  expect(await f.query()).toBe('SUCCEEDED'); expect(f.execute).not.toHaveBeenCalled()
})
it('aborts signing if the wallet changes while approval is pending', async () => {
  const f = await fixture(), impl = f.sign.getMockImplementation()!
  f.sign.mockImplementationOnce(async tx => { const result = await impl(tx); f.setAddress(privateId(80)); return result })
  await expect(f.adapter.sign(f.plan, f.packet)).rejects.toThrow('WALLET_CHANGED')
})
it.each([false, true])('proves historical %s Head write without current owner/equipment/receipt-window dependencies', async save => {
  const f = await fixture(save); f.setAddress(null)
  f.state.current_owner = privateId(80); f.state.ownership_epoch = '10'; f.putState(); f.rows.delete(f.headFieldId)
  expect(await f.query()).toBe('SUCCEEDED')
  expect(f.preflight).not.toHaveBeenCalled(); expect(f.batch).not.toHaveBeenCalled(); expect(f.getEpoch).not.toHaveBeenCalled()
  expect(f.get.mock.calls.every(([request]) => request.version === 3n)).toBe(true)
  expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it('proves a newly created Head field from the effects created reference', async () => {
  const f = await fixture(false, true); f.effects.V2.changedObjects[1][1].inputState = { NotExist: true }
  f.effects.V2.changedObjects[1][1].idOperation = { Created: true }; f.refreshEffects()
  expect(await f.query()).toBe('SUCCEEDED')
})
function useV1Effects(f: Awaited<ReturnType<typeof fixture>>) {
  const v2 = f.effects.V2
  f.effects.V1 = { status: v2.status, executedEpoch: v2.executedEpoch, gasUsed: v2.gasUsed,
    modifiedAtVersions: [[f.scope.stateId, '2'], [f.headFieldId, '2']],
    sharedObjects: [{ objectId: f.scope.stateId, version: '2', digest: privateDigest }], transactionDigest: f.packet.digest,
    created: [], mutated: [
      [{ objectId: f.scope.stateId, version: '3', digest: privateDigest }, { Shared: { initialSharedVersion: '1' } }],
      [{ objectId: f.headFieldId, version: '3', digest: privateDigest }, { ObjectOwner: f.scope.stateId }],
    ], unwrapped: [], deleted: [], unwrappedThenDeleted: [], wrapped: [],
    gasObject: [{ objectId: privateId(99), version: '3', digest: privateDigest }, { AddressOwner: f.scope.owner }],
    eventsDigest: null, dependencies: [] }
  delete f.effects.V2; f.refreshEffects()
}
it('supports canonical V1 historical object references without synthesizing events', async () => {
  const f = await fixture(); useV1Effects(f); expect(await f.query()).toBe('SUCCEEDED')
  f.effects.V1.modifiedAtVersions.pop(); f.refreshEffects(); await expect(f.query()).rejects.toThrow('INVALID_WRITE_LINEAGE')
})
it.each(['deleted', 'wrapped', 'unwrappedThenDeleted', 'unwrapped', 'modifiedAtVersions'])(
  'never turns explicit V1 Head %s without a write into a no-op receipt replay', async kind => {
    const f = await fixture(); useV1Effects(f)
    const effects = f.effects.V1, [ref, owner] = effects.mutated.pop()
    if (kind !== 'modifiedAtVersions') {
      effects.modifiedAtVersions.pop()
      effects[kind].push(kind === 'unwrapped' ? [ref, owner] : ref)
    }
    f.refreshEffects()
    await expect(f.query()).rejects.toThrow()
    expect(f.batch).not.toHaveBeenCalled()
  },
)
it('preserves genuine V1 no-write replay when there is no Head modification or conflict', async () => {
  const f = await fixture(); useV1Effects(f)
  f.effects.V1.mutated.pop(); f.effects.V1.modifiedAtVersions.pop(); f.refreshEffects()
  expect(await f.query()).toBe('SUCCEEDED'); expect(f.batch).toHaveBeenCalled()
})
it('rejects a no-write Head incorrectly reported as a V2 consensus object', async () => {
  const f = await fixture(); f.effects.V2.changedObjects.pop()
  f.effects.V2.unchangedConsensusObjects.push([f.headFieldId, { ReadOnlyRoot: ['2', privateDigest] }]); f.refreshEffects()
  await expect(f.query()).rejects.toThrow('CONFLICTING_EFFECTS_OBJECT'); expect(f.batch).not.toHaveBeenCalled()
})
it.each(['duplicate', 'owner lineage', 'created state', 'head owner', 'future epoch', 'conflicting unchanged', 'created existing head', 'oversize effects'])(
  'rejects inconsistent effects %s', async kind => {
    const f = await fixture(), v = f.effects.V2
    if (kind === 'duplicate') v.changedObjects.push(v.changedObjects[1])
    else if (kind === 'owner lineage') v.changedObjects[1][1].inputState.Exist[1] = { ObjectOwner: privateId(80) }
    else if (kind === 'created state') { v.changedObjects[0][1].inputState = { NotExist: true }; v.changedObjects[0][1].idOperation = { Created: true } }
    else if (kind === 'head owner') v.changedObjects[1][1].outputState.ObjectWrite[1] = { ObjectOwner: privateId(80) }
    else if (kind === 'future epoch') v.executedEpoch = '11'
    else if (kind === 'conflicting unchanged') v.unchangedConsensusObjects = [[f.scope.stateId, { ReadOnlyRoot: ['2', privateDigest] }]]
    else if (kind === 'created existing head') { v.changedObjects[1][1].inputState = { NotExist: true }; v.changedObjects[1][1].idOperation = { Created: true } }
    f.refreshEffects()
    if (kind === 'oversize effects') f.ledger.effects.bcs.value = new Uint8Array(256 * 1024 + 1)
    await expect(f.query()).rejects.toThrow()
  },
)
it('accepts semantic public fields regardless of caller object-key order', async () => {
  const f = await fixture(true), c = f.plan.ciphertext, capture = f.plan.capture!
  f.plan.ciphertext = { byteLength: c.byteLength, sha256: c.sha256, blobId: c.blobId, blobObjectId: c.blobObjectId }
  f.plan.capture = { commitment: capture.commitment, revision: capture.revision, equipmentId: capture.equipmentId }
  expect(await f.query()).toBe('SUCCEEDED')
})
it('confirms no-op replay only from matching current scope and exact public receipt', async () => {
  const f = await fixture(); f.effects.V2.changedObjects.pop(); f.refreshEffects()
  expect(await f.query()).toBe('SUCCEEDED'); expect(f.batch).toHaveBeenCalled()
})
it.each(['evicted', 'transferred'])('keeps no-op replay %s query-only when receipt proof is unavailable', async kind => {
  const f = await fixture(); f.effects.V2.changedObjects.pop(); f.refreshEffects()
  if (kind === 'evicted') { f.head.receipts[1].request_id = Array(32).fill(3); f.putHead() }
  else { f.state.current_owner = privateId(80); f.state.ownership_epoch = '3'; f.putState() }
  expect(await f.query()).toBe('PENDING')
})
it('rejects a no-op receipt whose ciphertext differs from the saved packet', async () => {
  const f = await fixture(); f.effects.V2.changedObjects.pop(); f.refreshEffects()
  f.head.receipts[1].ciphertext.sha256[0] ^= 1; f.head.ciphertext.sha256[0] ^= 1; f.putHead()
  await expect(f.query()).rejects.toThrow('REPLAY_RECEIPT_MISMATCH')
})
it.each(['objectId', 'version', 'digest', 'objectType', 'owner', 'contents'])('rejects wrong historical Head raw %s', async key => {
  const f = await fixture(), row = f.history.get(f.headFieldId)
  if (key === 'version') row.version = 4n
  else if (key === 'objectId') row.objectId = privateId(80)
  else if (key === 'owner') row.owner.address = privateId(80)
  else if (key === 'contents') row.contents.value = new Uint8Array(16385)
  else row[key] = 'wrong'
  await expect(f.query()).rejects.toThrow()
})
const headTamper: Array<[string, (head: any) => void]> = [
  ['scope', h => { h.value.ownership_epoch = '3' }], ['name key', h => { h.name.version = 2 }],
  ['revision', h => { h.value.revision = '3' }], ['request', h => { h.value.receipts[1].request_id[0] ^= 1 }],
  ['cipher', h => { h.value.ciphertext.sha256[0] ^= 1 }], ['receipt cipher', h => { h.value.receipts[1].ciphertext.sha256[0] ^= 1 }],
  ['capture', h => { h.value.receipts[1].capture.commitment[0] ^= 1 }],
  ['window', h => { h.value.receipts.shift() }], ['order', h => { h.value.receipts[0].revision = '2' }],
  ['duplicate request', h => { h.value.receipts[0].request_id = h.value.receipts[1].request_id }],
]
it.each(headTamper)('rejects canonical historical Head with changed %s', async (_name, change) => {
  const f = await fixture(true), row = f.history.get(f.headFieldId), decoded = PrivateNamedLoadoutHeadFieldV1Bcs.parse(row.contents.value)
  change(decoded); row.contents.value = PrivateNamedLoadoutHeadFieldV1Bcs.serialize(decoded).toBytes()
  await expect(f.query()).rejects.toThrow()
})
it('rejects historical State owner mismatch even when receipt looks correct', async () => {
  const f = await fixture(), row = f.history.get(f.scope.stateId), value = SoulStatePublicBcs.parse(row.contents.value)
  value.current_owner = privateId(80); row.contents.value = SoulStatePublicBcs.serialize(value).toBytes()
  await expect(f.query()).rejects.toThrow('HISTORICAL_SCOPE_MISMATCH')
})
it('rejects same-reference historical bytes changing during the confirmation read', async () => {
  const f = await fixture(), original = f.get.getMockImplementation()!; let count = 0
  f.get.mockImplementation(((request: any, options: any) => {
    if (request.objectId === f.headFieldId && ++count === 2) f.history.get(f.headFieldId).contents.value[40] ^= 1
    return original(request, options)
  }) as any)
  await expect(f.query()).rejects.toThrow('HISTORICAL_BYTES_CHANGED')
})
it.each(['transaction bytes', 'digest', 'effects digest', 'status', 'checkpoint', 'effects trailing'])('rejects inconsistent ledger %s', async key => {
  const f = await fixture()
  if (key === 'transaction bytes') f.ledger.transaction.bcs.value = new Uint8Array([1])
  else if (key === 'digest') f.ledger.digest = privateDigest
  else if (key === 'effects digest') { f.effects.V2.transactionDigest = privateDigest; f.refreshEffects() }
  else if (key === 'status') f.ledger.effects.status.success = false
  else if (key === 'checkpoint') f.ledger.checkpoint = -1n
  else f.ledger.effects.bcs.value = new Uint8Array([...f.ledger.effects.bcs.value, 0])
  await expect(f.query()).rejects.toThrow()
})
it('does not call success before checkpoint and reports canonical finalized failure without a Head proof', async () => {
  const f = await fixture(); f.ledger.checkpoint = undefined; expect(await f.query()).toBe('PENDING')
  f.ledger.checkpoint = 0n; f.effects.V2.status = { Failure: { error: { InsufficientGas: true }, command: 0 } }
  f.ledger.effects.status.success = false; f.refreshEffects(); expect(await f.query()).toBe('FAILED'); expect(f.get).not.toHaveBeenCalled()
})
it('only exact NOT_FOUND is transaction absence; transient status remains an error', async () => {
  const f = await fixture(); f.getTransaction.mockRejectedValueOnce({ code: 'NOT_FOUND' }); expect(await f.query()).toBe('MISSING')
  f.getTransaction.mockRejectedValueOnce({ code: 'UNAVAILABLE' }); await expect(f.query()).rejects.toEqual({ code: 'UNAVAILABLE' })
})
it('bounds an uncooperative read with a deadline', async () => {
  const f = await fixture(); vi.useFakeTimers(); const controller = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { setTimeout(() => controller.abort(new Error('deadline')), ms); return controller.signal })
  f.getTransaction.mockImplementation((() => new Promise(() => {})) as any)
  const pending = expect(f.query()).rejects.toThrow('deadline'); await vi.advanceTimersByTimeAsync(40001); await pending
})
