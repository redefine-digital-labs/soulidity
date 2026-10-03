import { afterEach, describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { validatePrivateBookmarkPublicPlan, validatePrivateBookmarkTransactionPacket } from '../../web/lib/bookmarks/private-bookmark-transaction'
import { privateBookmarkTransactionFixture } from './fixtures/private-bookmark-transaction'
import { bookmarkId } from './fixtures/private-wallet-bookmarks'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('rejects a rehashed V1 no-write/modified-input contradiction but retains genuine no-write replay', async () => {
  const f = await privateBookmarkTransactionFixture({ effectsVersion: 1 })
  f.history.effectsData.V1!.created = []; f.history.effectsData.V1!.mutated = []
  f.history.rehashEffects()
  await expect(f.adapter.query(f.plan, f.packet)).rejects.toThrow('HEAD_LINEAGE_INVALID')
  f.history.effectsData.V1!.modifiedAtVersions = []; f.history.rehashEffects()
  expect(await f.adapter.query(f.plan, f.packet)).toBe('SUCCEEDED')
})
it.each([3, 4, 5])('rejects cancellation during the ledger response handoff at microtask %s', async depth => {
  const f = await privateBookmarkTransactionFixture(); delete f.history.ledger.checkpoint
  f.getTransaction.mockImplementationOnce((() => {
    const tick = (n: number) => queueMicrotask(() => n ? tick(n - 1) : f.lifetime.abort(new Error('handoff-aborted')))
    tick(depth); return Promise.resolve({ response: { transaction: structuredClone(f.history.ledger) } })
  }) as unknown as Parameters<typeof f.getTransaction.mockImplementationOnce>[0])
  await expect(f.adapter.query(f.plan, f.packet)).rejects.toThrow('handoff-aborted')
})
it.each([10, 11, 12, 13])('does not return a signature across cancelled wallet handoff %s', async depth => {
  const f = await privateBookmarkTransactionFixture()
  f.sign.mockImplementationOnce(() => {
    const tick = (n: number) => queueMicrotask(() => n ? tick(n - 1) : f.lifetime.abort(new Error('sign-handoff-aborted')))
    tick(depth); return Promise.resolve({ bytes: f.packet.bytes, signature: f.packet.signature! })
  })
  await expect(f.adapter.sign(f.plan, { ...f.packet, phase: 'SIGNING', signature: null })).rejects.toThrow('sign-handoff-aborted')
})

describe('actual SDK frozen public packets and local signatures', () => {
  it('prepares, preflights, signs exact bytes and submits the same packet once', async () => {
    const f = await privateBookmarkTransactionFixture()
    const prepared = await f.adapter.prepare(f.plan)
    expect(prepared).toMatchObject({ phase: 'PREPARED', signature: null, expirationEpoch: '6' })
    expect(prepared.digest).toBe(TransactionDataBuilder.getDigestFromBytes(fromBase64(prepared.bytes)))
    expect(validatePrivateBookmarkTransactionPacket(f.plan, prepared)).toEqual(prepared)
    const raw = bcs.TransactionData.parse(fromBase64(prepared.bytes)).V1
    expect(raw.sender).toBe(f.owner); expect(raw.gasData.owner).toBe(f.owner)
    expect(raw.kind.ProgrammableTransaction!.commands).toHaveLength(1)
    expect(raw.kind.ProgrammableTransaction!.commands[0].MoveCall).toMatchObject({ package: f.plan.deployment.callablePackageId,
      module: 'profile', function: 'commit_bookmarks', typeArguments: [] })
    expect(f.preflight).toHaveBeenCalledWith(f.plan, true)
    await f.adapter.preflight(f.plan, prepared, false)
    const signed = await f.adapter.sign(f.plan, prepared)
    expect(signed.bytes).toBe(prepared.bytes)
    const packet = { ...prepared, phase: 'SIGNED' as const, signature: signed.signature }
    await f.adapter.verifySignature(f.plan, packet)
    await f.adapter.broadcast(f.plan, packet)
    expect(f.execute).toHaveBeenCalledTimes(1)
    expect(f.execute).toHaveBeenCalledWith({ transaction: fromBase64(packet.bytes), signatures: [signed.signature] })
    expect(f.sign).toHaveBeenCalledTimes(1)
    expect(f.preflight).toHaveBeenLastCalledWith(f.plan, false)
  })
  it('captures plan inputs before asynchronous preflight and preserves u64 expiry/gas bytes', async () => {
    const f = await privateBookmarkTransactionFixture(), expected = structuredClone(f.plan)
    let resume!: () => void
    f.preflight.mockImplementationOnce(() => new Promise(done => { resume = done }))
    const pending = f.adapter.prepare(f.plan)
    while (!resume) await Promise.resolve()
    f.plan.requestId = 'aa'.repeat(32); f.plan.ciphertext.blobId = 'changed'
    resume(); const packet = await pending
    expect(validatePrivateBookmarkTransactionPacket(expected, packet)).toEqual(packet)
    expect(() => validatePrivateBookmarkTransactionPacket(f.plan, packet)).toThrow()
  })
  it.each(['sender', 'gas-owner', 'gas-budget', 'gas-price', 'gas-empty', 'gas-duplicate', 'gas-registry', 'gas-blob', 'gas-package',
    'expiration', 'extra-call', 'call-package', 'call-module', 'call-function', 'type-args', 'unused-input', 'shared-id', 'shared-readonly',
    'shared-birth', 'expected-revision', 'request', 'blob-object', 'blob-id', 'cipher-hash', 'cipher-bytes', 'duplicate-argument'] as const)(
    'rejects fully rebuilt/signed unauthorized packet %s', async problem => {
      const f = await privateBookmarkTransactionFixture()
      const packet = await f.packetFor(f.plan, data => {
        const call = data.commands[0].MoveCall!
        if (problem === 'sender') data.sender = bookmarkId(99)
        if (problem === 'gas-owner') data.gasData.owner = bookmarkId(99)
        if (problem === 'gas-budget') data.gasData.budget = '0'
        if (problem === 'gas-price') data.gasData.price = '0'
        if (problem === 'gas-empty') data.gasData.payment = []
        if (problem === 'gas-duplicate') data.gasData.payment!.push(structuredClone(data.gasData.payment![0]))
        if (problem === 'gas-registry') data.gasData.payment![0].objectId = f.plan.scope.registryId
        if (problem === 'gas-blob') data.gasData.payment![0].objectId = f.plan.ciphertext.blobObjectId
        if (problem === 'gas-package') data.gasData.payment![0].objectId = f.plan.deployment.callablePackageId
        if (problem === 'expiration') data.expiration = { None: true, $kind: 'None' }
        if (problem === 'extra-call') data.commands.push(structuredClone(data.commands[0]))
        if (problem === 'call-package') call.package = bookmarkId(99)
        if (problem === 'call-module') call.module = 'unrelated'
        if (problem === 'call-function') call.function = 'create_profile'
        if (problem === 'type-args') call.typeArguments = ['u64']
        if (problem === 'unused-input') data.inputs.push(structuredClone(data.inputs[1]))
        const shared = data.inputs[0].Object!.SharedObject!
        if (problem === 'shared-id') shared.objectId = bookmarkId(99)
        if (problem === 'shared-readonly') shared.mutable = false
        if (problem === 'shared-birth') shared.initialSharedVersion = '0'
        const pureIndexes = ['expected-revision', 'request', 'blob-object', 'blob-id', 'cipher-hash', 'cipher-bytes']
        const index = pureIndexes.indexOf(problem)
        if (index !== -1) data.inputs[index + 1].Pure!.bytes = toBase64(new Uint8Array([0]))
        if (problem === 'duplicate-argument') call.arguments[6] = structuredClone(call.arguments[1])
      })
      expect(() => validatePrivateBookmarkTransactionPacket(f.plan, packet)).toThrow()
    })
  it.each(['bytes', 'digest', 'expiry', 'phase', 'signature', 'unsigned-signed', 'prepared-signature', 'extra-private-field'] as const)(
    'rejects packet record mismatch %s before I/O', async problem => {
      const f = await privateBookmarkTransactionFixture(), packet: any = structuredClone(f.packet)
      if (problem === 'bytes') packet.bytes += '='
      if (problem === 'digest') packet.digest = f.gas.digest
      if (problem === 'expiry') packet.expirationEpoch = '7'
      if (problem === 'phase') packet.phase = 'UNKNOWN'
      if (problem === 'signature') packet.signature = 'not-base64'
      if (problem === 'unsigned-signed') packet.signature = null
      if (problem === 'prepared-signature') packet.phase = 'PREPARED'
      if (problem === 'extra-private-field') packet.soulIds = [bookmarkId(99)]
      expect(() => validatePrivateBookmarkTransactionPacket(f.plan, packet)).toThrow()
    })
  it('rejects extra plan fields and wrong signer/mutated wallet bytes without broadcasting', async () => {
    const f = await privateBookmarkTransactionFixture()
    expect(() => validatePrivateBookmarkPublicPlan({ ...f.plan, desired: true })).toThrow('PUBLIC_PLAN_INVALID')
    const other = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(92))
    const bad = await other.signTransaction(fromBase64(f.packet.bytes))
    await expect(f.adapter.verifySignature(f.plan, { ...f.packet, signature: bad.signature })).rejects.toThrow()
    f.sign.mockResolvedValueOnce({ bytes: toBase64(new Uint8Array([1])), signature: f.packet.signature! })
    await expect(f.adapter.sign(f.plan, { ...f.packet, signature: null, phase: 'PREPARED' })).rejects.toThrow('TRANSACTION_WALLET_BYTES_CHANGED')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('blocks new signing/broadcast after expiry but leaves historical query available', async () => {
    const f = await privateBookmarkTransactionFixture()
    f.epoch.mockResolvedValue({ response: { epoch: { epoch: 7n } } } as any)
    await expect(f.adapter.preflight(f.plan, f.packet, true)).rejects.toThrow('TRANSACTION_EXPIRED_QUERY_ONLY')
    await expect(f.adapter.broadcast(f.plan, f.packet)).rejects.toThrow('TRANSACTION_EXPIRED_QUERY_ONLY')
    expect(await f.adapter.query(f.plan, f.packet)).toBe('SUCCEEDED')
    expect(f.execute).not.toHaveBeenCalled()
  })
})

describe('complete raw transaction/effects/checkpoint/Field history', () => {
  it.each([[1, 1, '0'], [1, 2, '2'], [2, 1, '2'], [2, 2, '0'], [2, 2, '40']] as const)(
    'proves effects V%i / checkpoint V%i / predecessor revision %s through actual readers', async (effectsVersion, contentsVersion, expectedRevision) => {
      const f = await privateBookmarkTransactionFixture({ effectsVersion, contentsVersion, expectedRevision })
      expect(await f.adapter.query(f.plan, f.packet)).toBe('SUCCEEDED')
      expect(f.getCheckpoint).toHaveBeenCalledTimes(1)
      expect(f.raw.get.mock.calls.filter(([request]) => request.version !== undefined)).toHaveLength(expectedRevision === '0' ? 1 : 2)
      expect(f.preflight).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
    })
  it.each(['row-digest', 'tx-digest', 'tx-bytes', 'effects-digest', 'effects-tx-projection', 'effects-status', 'effects-trailing',
    'events', 'future-epoch', 'checkpoint-type', 'checkpoint-digest', 'checkpoint-contents', 'checkpoint-membership'] as const)(
    'rejects canonical or rehashed evidence contradiction %s', async problem => {
      const f = await privateBookmarkTransactionFixture(), row = f.history.ledger, e = f.history.effectsData.V2!
      if (problem === 'row-digest') row.digest = f.gas.digest
      if (problem === 'tx-digest') row.transaction.digest = f.gas.digest
      if (problem === 'tx-bytes') row.transaction.bcs.value = new Uint8Array([1])
      if (problem === 'effects-digest') row.effects.digest = f.gas.digest
      if (problem === 'effects-tx-projection') row.effects.transactionDigest = f.gas.digest
      if (problem === 'effects-status') row.effects.status.success = false
      if (problem === 'effects-trailing') row.effects.bcs.value = new Uint8Array([...row.effects.bcs.value, 0])
      if (problem === 'events') { e.eventsDigest = f.gas.digest; f.history.rehashEffects() }
      if (problem === 'future-epoch') { e.executedEpoch = '7'; f.history.rehashEffects() }
      if (problem === 'checkpoint-type') row.checkpoint = '100'
      if (problem === 'checkpoint-digest') f.history.checkpoint.digest = f.gas.digest
      if (problem === 'checkpoint-contents') f.history.checkpoint.contents.bcs.value = new Uint8Array([1])
      if (problem === 'checkpoint-membership') {
        f.history.contentsData.V2!.transactions[1].digest.effects = f.gas.digest; f.history.rehashContents()
      }
      await expect(f.adapter.query(f.plan, f.packet)).rejects.toThrow()
    })
  it.each(['object-id', 'object-version', 'object-digest', 'full-hash', 'previous-tx', 'owner', 'type', 'uid', 'key', 'value-owner',
    'value-registry', 'value-revision', 'extra-receipt', 'changed-preserved-receipt', 'type-public-transfer'] as const)(
    'rejects rehashed historical output contradiction %s', async problem => {
      const f = await privateBookmarkTransactionFixture(), key = `${f.raw.headFieldId}@${f.afterVersion}`
      const object = f.historicalObjects.get(key)!, row = f.historicalRows.get(key)
      if (problem === 'object-id') row.objectId = bookmarkId(99)
      if (problem === 'object-version') row.version = 8n
      if (problem === 'object-digest') row.digest = f.gas.digest
      if (problem === 'full-hash') { object.storageRebate = '1'; row.bcs.value = bcs.Object.serialize(object).toBytes() }
      if (problem === 'previous-tx') { object.previousTransaction = f.gas.digest; f.rehashHistorical('after') }
      if (problem === 'owner') { object.owner = { ObjectOwner: bookmarkId(99), $kind: 'ObjectOwner' }; f.rehashHistorical('after') }
      if (problem === 'type') { object.data.Move!.type.Other!.address = bookmarkId(99); f.rehashHistorical('after') }
      if (problem === 'type-public-transfer') { object.data.Move!.hasPublicTransfer = true; f.rehashHistorical('after') }
      if (problem === 'uid') f.rewriteHead('after', field => { field.id = bookmarkId(99) })
      if (problem === 'key') f.rewriteHead('after', field => { field.name.owner = bookmarkId(99) })
      if (problem === 'value-owner') f.rewriteHead('after', field => { field.value.owner = bookmarkId(99) })
      if (problem === 'value-registry') f.rewriteHead('after', field => { field.value.registry_id = bookmarkId(99) })
      if (problem === 'value-revision') f.rewriteHead('after', field => { field.value.revision = '4' })
      if (problem === 'extra-receipt') f.rewriteHead('after', field => { field.value.receipts.push(structuredClone(field.value.receipts[0])) })
      if (problem === 'changed-preserved-receipt') f.rewriteHead('after', field => { field.value.receipts[0].ciphertext.sha256 = Array(32).fill(9) })
      await expect(f.adapter.query(f.plan, f.packet)).rejects.toThrow()
    })
  it.each([1, 2] as const)('rejects old-input mismatch and exact 32-receipt FIFO alteration with effects V%i', async effectsVersion => {
    const f = await privateBookmarkTransactionFixture({ effectsVersion, expectedRevision: '40' })
    f.rewriteHead('after', field => {
      field.value.receipts[0].request_id = Array(32).fill(99)
    })
    await expect(f.adapter.query(f.plan, f.packet)).rejects.toThrow('TRANSACTION_HISTORICAL_RESULT_MISMATCH')
    const g = await privateBookmarkTransactionFixture({ effectsVersion })
    g.rewriteHead('before', field => { field.value.revision = '1'; field.value.receipts = field.value.receipts.slice(0, 1) })
    await expect(g.adapter.query(g.plan, g.packet)).rejects.toThrow('TRANSACTION_PREDECESSOR_MISMATCH')
  })
  it.each(['duplicate-write', 'deleted', 'wrong-input-owner', 'wrong-output-owner', 'created-with-input', 'mutated-without-input', 'readonly-head'] as const)(
    'rejects rehashed V2 effects lineage %s', async problem => {
      const f = await privateBookmarkTransactionFixture(), effects = f.history.effectsData.V2!, change = f.headChange()
      if (problem === 'duplicate-write') effects.changedObjects.push(structuredClone(effects.changedObjects[0]))
      if (problem === 'deleted') change.idOperation = { Deleted: true, $kind: 'Deleted' }
      if (problem === 'wrong-input-owner') change.inputState.Exist![1] = { ObjectOwner: bookmarkId(99), $kind: 'ObjectOwner' }
      if (problem === 'wrong-output-owner') change.outputState.ObjectWrite![1] = { ObjectOwner: bookmarkId(99), $kind: 'ObjectOwner' }
      if (problem === 'created-with-input') change.idOperation = { Created: true, $kind: 'Created' }
      if (problem === 'mutated-without-input') change.inputState = { NotExist: true, $kind: 'NotExist' }
      if (problem === 'readonly-head') effects.unchangedConsensusObjects.push([f.raw.headFieldId, { ReadOnlyRoot: [f.beforeVersion, f.gas.digest], $kind: 'ReadOnlyRoot' }])
      f.history.rehashEffects(); await expect(f.adapter.query(f.plan, f.packet)).rejects.toThrow()
    })
  it.each([1, 2] as const)('returns FAILED only after canonical V%i effects and matching checkpoint membership', async effectsVersion => {
    const f = await privateBookmarkTransactionFixture({ effectsVersion }), e = f.history.effectsData.V2 ?? f.history.effectsData.V1!
    e.status = { Failure: { error: { InsufficientGas: true, $kind: 'InsufficientGas' }, command: null }, $kind: 'Failure' }
    f.history.rehashEffects()
    expect(await f.adapter.query(f.plan, f.packet)).toBe('FAILED')
    expect(f.getCheckpoint).toHaveBeenCalledTimes(1)
    f.history.contentsData.V2!.transactions[1].digest.effects = f.gas.digest; f.history.rehashContents()
    await expect(f.adapter.query(f.plan, f.packet)).rejects.toThrow('TRANSACTION_CHECKPOINT_MEMBERSHIP')
  })
  it.each(['duplicate-write', 'deleted', 'unwrapped', 'wrapped', 'duplicate-input', 'shared-input'] as const)(
    'rejects fully rehashed V1 head lineage %s', async problem => {
      const f = await privateBookmarkTransactionFixture({ effectsVersion: 1 }), effects = f.history.effectsData.V1!
      const [ref, owner] = effects.mutated[0]
      if (problem === 'duplicate-write') effects.created.push([ref, owner])
      if (problem === 'deleted') effects.deleted.push(ref)
      if (problem === 'unwrapped') effects.unwrapped.push([ref, owner])
      if (problem === 'wrapped') effects.wrapped.push(ref)
      if (problem === 'duplicate-input') effects.modifiedAtVersions.push(structuredClone(effects.modifiedAtVersions[0]))
      if (problem === 'shared-input') effects.sharedObjects.push({ ...ref, version: f.beforeVersion })
      f.history.rehashEffects()
      await expect(f.adapter.query(f.plan, f.packet)).rejects.toThrow()
    })
  it('rejects rehashed V1 zero predecessor object version', async () => {
    const f = await privateBookmarkTransactionFixture({ effectsVersion: 1 }), effects = f.history.effectsData.V1!
    effects.modifiedAtVersions[0][1] = '0'
    const key = `${f.raw.headFieldId}@${f.beforeVersion}`, object = structuredClone(f.historicalObjects.get(key)!)
    object.data.Move!.version = '0'
    const row = structuredClone(f.historicalRows.get(key))
    row.version = 0n; row.bcs.value = bcs.Object.serialize(object).toBytes()
    // V1 intentionally lacks an old digest commitment, but canonical version
    // zero is still not a valid persisted user Field reference.
    const { bookmarkObjectDigest } = await import('./fixtures/private-wallet-bookmarks')
    row.digest = bookmarkObjectDigest(row.bcs.value)
    f.historicalRows.set(`${f.raw.headFieldId}@0`, row); f.history.rehashEffects()
    await expect(f.adapter.query(f.plan, f.packet)).rejects.toThrow()
  })
  it.each([1, 2] as const)('does not accept unavailable historical input as a current-state fallback with V%i', async effectsVersion => {
    const f = await privateBookmarkTransactionFixture({ effectsVersion })
    f.historicalRows.delete(`${f.raw.headFieldId}@${f.beforeVersion}`)
    await expect(f.adapter.query(f.plan, f.packet)).rejects.toThrow('TRANSACTION_HISTORICAL_REFERENCE')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it.each(['originalPackageId', 'callablePackageId', 'callableDigest', 'chainIdentifier'] as const)(
    'rejects release drift %s before reading a transaction as success', async field => {
      const f = await privateBookmarkTransactionFixture(), plan = structuredClone(f.plan)
      plan.deployment[field] = field === 'callableDigest' ? f.gas.digest : field === 'chainIdentifier' ? 'ffffffff' : bookmarkId(99)
      await expect(f.adapter.query(plan, f.packet)).rejects.toThrow()
      expect(f.getTransaction).not.toHaveBeenCalled()
    })
  it('keeps missing, unconfirmed and unavailable distinct without preflight/signing', async () => {
    const f = await privateBookmarkTransactionFixture()
    f.preflight.mockRejectedValue(new Error('writes disabled')); f.setAddress(null)
    expect(await f.adapter.query(f.plan, f.packet)).toBe('SUCCEEDED')
    delete f.history.ledger.checkpoint
    expect(await f.adapter.query(f.plan, f.packet)).toBe('PENDING')
    f.getTransaction.mockRejectedValueOnce(Object.assign(new Error('pruned'), { code: 'NOT_FOUND' }))
    expect(await f.adapter.query(f.plan, f.packet)).toBe('MISSING')
    f.getTransaction.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'UNAVAILABLE' }))
    await expect(f.adapter.query(f.plan, f.packet)).rejects.toThrow('offline')
    expect(f.preflight).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
  })
  it('proves no-write idempotency only from the exact retained request revision/ref, aged-out remains pending', async () => {
    const f = await privateBookmarkTransactionFixture()
    f.history.effectsData.V2!.changedObjects = []; f.history.rehashEffects()
    expect(await f.adapter.query(f.plan, f.packet)).toBe('SUCCEEDED')
    f.raw.head.receipts[2].request_id = Array(32).fill(100); f.raw.putHead()
    expect(await f.adapter.query(f.plan, f.packet)).toBe('PENDING')
    f.raw.head.receipts[0].request_id = Array(32).fill(255); f.raw.putHead()
    await expect(f.adapter.query(f.plan, f.packet)).rejects.toThrow('TRANSACTION_REPLAY_MISMATCH')
    f.installCurrent('after'); f.raw.head.ciphertext.sha256 = Array(32).fill(9)
    f.raw.head.receipts[2].ciphertext.sha256 = Array(32).fill(9); f.raw.putHead()
    await expect(f.adapter.query(f.plan, f.packet)).rejects.toThrow('TRANSACTION_REPLAY_MISMATCH')
    expect(f.execute).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
  })
})

describe('wallet lifetime and bounded asynchronous operations', () => {
  it.each(['prepare', 'sign', 'broadcast'] as const)('rejects wrong active wallet for %s before I/O', async method => {
    const f = await privateBookmarkTransactionFixture(); f.setAddress(bookmarkId(99))
    await expect(method === 'prepare' ? f.adapter.prepare(f.plan) : method === 'sign'
      ? f.adapter.sign(f.plan, { ...f.packet, phase: 'PREPARED', signature: null }) : f.adapter.broadcast(f.plan, f.packet)).rejects.toThrow('WALLET_CHANGED')
    expect(f.execute).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
  })
  it('cancels readonly query when its lifetime changes even with a hung ledger', async () => {
    const f = await privateBookmarkTransactionFixture(); let release!: (value: any) => void
    f.getTransaction.mockImplementationOnce(() => new Promise(done => { release = done }) as any)
    const pending = f.adapter.query(f.plan, f.packet)
    while (!release) await Promise.resolve()
    f.lifetime.abort(new Error('client changed'))
    await expect(pending).rejects.toThrow('client changed')
    release({ response: { transaction: f.history.ledger } }); await Promise.resolve()
  })
  it('bounds prepare/read preflight even when callbacks ignore cancellation', async () => {
    const f = await privateBookmarkTransactionFixture(); let release!: () => void
    f.preflight.mockImplementationOnce(() => new Promise(done => { release = done }))
    const pending = f.adapter.prepare(f.plan)
    while (!release) await Promise.resolve()
    f.lifetime.abort(new Error('client changed'))
    await expect(pending).rejects.toThrow('client changed')
    release(); await Promise.resolve()
  })
  it('bounds broadcast by its network deadline and keeps the same ambiguous signed packet', async () => {
    const f = await privateBookmarkTransactionFixture(), network = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      expect([25000, 40000, 45000]).toContain(ms)
      return ms === 45000 ? network.signal : new AbortController().signal
    })
    let release!: (value: any) => void
    f.execute.mockImplementationOnce(() => new Promise(done => { release = done }) as any)
    const pending = f.adapter.broadcast(f.plan, f.packet)
    while (!release) await Promise.resolve()
    network.abort(new DOMException('network deadline', 'TimeoutError'))
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    release({}); await Promise.resolve()
    expect(f.execute).toHaveBeenCalledTimes(1)
    expect(f.packet.phase).toBe('SIGNED')
  })
  it('keeps an explicit wallet prompt pending beyond network deadlines but lifetime cancellation still rejects', async () => {
    const f = await privateBookmarkTransactionFixture(), network = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 45000 ? network.signal : new AbortController().signal)
    let release!: (value: { bytes: string; signature: string }) => void
    f.sign.mockImplementationOnce(() => new Promise(done => { release = done }))
    const pending = f.adapter.sign(f.plan, { ...f.packet, phase: 'PREPARED', signature: null })
    while (!release) await Promise.resolve()
    const observed = pending.then(() => 'resolved', error => (error as Error).message)
    network.abort(new DOMException('network deadline', 'TimeoutError'))
    expect(await Promise.race([observed, new Promise<string>(done => setTimeout(() => done('PROMPT_PENDING'), 25))])).toBe('PROMPT_PENDING')
    f.lifetime.abort(new Error('wallet lifetime ended'))
    expect(await observed).toBe('wallet lifetime ended')
    release({ bytes: f.packet.bytes, signature: f.packet.signature! }); await Promise.resolve()
  })
  it.each(['sign', 'broadcast'] as const)('bounds hung %s and rejects its late result on wallet lifetime cancellation', async method => {
    const f = await privateBookmarkTransactionFixture(); let release!: (value: any) => void
    if (method === 'sign') f.sign.mockImplementationOnce(() => new Promise(done => { release = done }))
    else f.execute.mockImplementationOnce(() => new Promise(done => { release = done }) as any)
    const pending = method === 'sign' ? f.adapter.sign(f.plan, { ...f.packet, phase: 'PREPARED', signature: null })
      : f.adapter.broadcast(f.plan, f.packet)
    while (!release) await Promise.resolve()
    const observed = pending.then(() => 'resolved', error => (error as Error).message)
    f.lifetime.abort(new Error('wallet lifetime ended'))
    const result = await Promise.race([observed, new Promise<string>(done => setTimeout(() => done('STILL_PENDING'), 25))])
    release(method === 'sign' ? { bytes: f.packet.bytes, signature: f.packet.signature } : {})
    await observed
    expect(result).toBe('wallet lifetime ended')
    expect(f.execute.mock.calls.length).toBeLessThanOrEqual(1)
  })
})
