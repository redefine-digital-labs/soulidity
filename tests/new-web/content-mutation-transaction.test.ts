import { afterEach, describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { assertContentMutationAuthority, observeContentMutation, contentMutationKey, parseContentMutationPlan, parseContentMutationRecord,
  type ContentMutationPlan } from '../../web/lib/soulidity/content-mutation-transaction'
import { contentMutationTransactionFixture, mutationId as id, mutationPriorDigest as prior } from './fixtures/content-mutation-transaction'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
type Fixture = Awaited<ReturnType<typeof contentMutationTransactionFixture>>
const routes = [
  ['owner delete', { action: 'delete' }], ['grantee delete', { action: 'delete', grantee: true }],
  ['purge', { action: 'purge' }], ['set-active', { action: 'set-active' }], ['clear-active', { action: 'clear-active' }],
] as const
function prepared(f: Fixture) { return { ...f.record, packet: { ...f.record.packet, phase: 'PREPARED' as const, signature: null } } }
function input(f: Fixture, objectId: string) {
  return Transaction.from(f.record.packet.bytes).getData().inputs.find(row => row.Object?.SharedObject?.objectId === objectId)
}
describe('actual frozen SDK packets, local signatures and historical ledger outputs', () => {
  it.each(routes)('%s prepares, signs, verifies, broadcasts exact bytes and proves finalized outputs', async (_name, options) => {
    const f = await contentMutationTransactionFixture(options)
    expect(() => assertContentMutationAuthority(f.plan, f.proof)).not.toThrow()
    expect(parseContentMutationRecord(f.record)).toEqual(f.record)
    expect(input(f, f.plan.stateId)?.Object?.SharedObject?.mutable).toBe(false)
    expect(input(f, f.plan.contentId)?.Object?.SharedObject?.mutable).toBe(true)
    const p = await f.adapter.prepare(f.plan)
    expect(p).toEqual(prepared(f)); expect(f.resolve).toHaveBeenCalled(); expect(f.simulate).toHaveBeenCalledTimes(1)
    await f.adapter.preflight(p, true)
    const signed = await f.adapter.sign(p)
    expect(signed).toEqual({ bytes: f.record.packet.bytes, signature: f.record.packet.signature })
    await f.adapter.verifySignature(f.record); await f.adapter.broadcast(f.record)
    expect(f.raw.execute).toHaveBeenCalledExactlyOnceWith({ transaction: fromBase64(f.record.packet.bytes), signatures: [f.record.packet.signature] })
    const result = await f.adapter.query(f.record)
    expect(result).toEqual({ status: 'SUCCEEDED', checkpoint: '42', contentVersion: '12' })
    const history = f.raw.get.mock.calls.filter(([request]) => request.version !== undefined).map(([request]) => [request.objectId, request.version])
    expect(history).toContainEqual([f.ids.state, 11n]); expect(history).toContainEqual([f.ids.content, 12n])
    expect(f.objects.get(f.ids.state)!.previousTransaction).toBe(prior)
  })
  it('proves a newly created active field as well as an existing mutated one', async () => {
    const f = await contentMutationTransactionFixture({ action: 'set-active', emptyActive: true })
    expect(f.change('active').idOperation.$kind).toBe('Created')
    expect(await f.adapter.query(f.record)).toMatchObject({ status: 'SUCCEEDED' })
  })
  it.each(routes)('%s cold query has no wallet, current preflight, simulation, sign or broadcast dependency', async (_name, options) => {
    const f = await contentMutationTransactionFixture(options)
    const forbidden = () => { throw new Error('No current authority or write in query') }
    f.setAddress(null); f.getAddress.mockImplementation(forbidden); f.preflight.mockImplementation(forbidden)
    f.sign.mockImplementation(forbidden); f.simulate.mockImplementation(forbidden); f.epoch.mockImplementation(forbidden)
    f.raw.batch.mockImplementation(forbidden); f.raw.list.mockImplementation(forbidden); f.raw.execute.mockImplementation(forbidden)
    vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(999))
    f.raw.state.current_owner = id(999); f.raw.state.ownership_epoch = '999'; f.raw.putState()
    await expect(f.adapter.query(f.record)).resolves.toMatchObject({ status: 'SUCCEEDED' })
    expect(f.getAddress).not.toHaveBeenCalled(); expect(f.preflight).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
    expect(f.simulate).not.toHaveBeenCalled(); expect(f.raw.execute).not.toHaveBeenCalled()
  })
  it('preserves full-u64 ownership epochs in real packet bytes and historical readonly State', async () => {
    const f = await contentMutationTransactionFixture({ ownershipEpoch: '18446744073709551615' })
    expect(parseContentMutationRecord(f.record).plan.ownershipEpoch).toBe('18446744073709551615')
    await expect(f.adapter.query(f.record)).resolves.toMatchObject({ status: 'SUCCEEDED' })
    const data = Transaction.from(f.record.packet.bytes).getData(), ref = data.commands[0].MoveCall!.arguments[2]
    expect(bcs.u64().parse(fromBase64(data.inputs[(ref as { Input: number }).Input].Pure!.bytes))).toBe('18446744073709551615')
  })
})

describe('current observation does not replace original historical completion', () => {
  it.each(routes)('%s classifies the applied result and later changes separately', async (_name, options) => {
    const f = await contentMutationTransactionFixture(options), proof = structuredClone(f.proof), s = proof.snapshot
    const slot = s.contentVersions.find(row => row.kind === f.plan.kind && row.name === 'main' && row.versionIndex === '0')!.slot
    if (f.plan.action === 'delete' || f.plan.action === 'purge') { slot.deleted = true; slot.purged = f.plan.action === 'purge' }
    else if (f.plan.action === 'clear-active') s.activeBindings = []
    else { s.activeBindings[0].name = 'main'; s.activeBindings[0].version_index = '0' }
    expect(observeContentMutation(f.plan, proof)).toBe('STILL_APPLIED')
    if (f.plan.action === 'delete') slot.purged = true
    else if (f.plan.action === 'purge') s.contentVersions = []
    else if (f.plan.action === 'set-active') s.activeBindings = []
    else s.activeBindings = structuredClone(f.proof.snapshot.activeBindings)
    expect(observeContentMutation(f.plan, proof)).toBe('LATER_CONTENT_CHANGED')
    s.ownershipEpoch = '99'
    expect(observeContentMutation(f.plan, proof)).toBe('OWNER_EPOCH_CHANGED')
    await expect(f.adapter.query(f.record)).resolves.toMatchObject({ status: 'SUCCEEDED' })
  })
  it.each(['soulId', 'stateId', 'contentId', 'originalPackageId'] as const)('rejects unrelated current %s instead of describing it as applied', async key => {
    const f = await contentMutationTransactionFixture(), proof = structuredClone(f.proof)
    proof[key] = id(999)
    expect(() => observeContentMutation(f.plan, proof)).toThrow('OBSERVATION_ROOT_MISMATCH')
  })
})

describe('signed template and record rejection', () => {
  const mutators: [string, (data: TransactionDataBuilder, f: Fixture) => void, string][] = [
    ['omitted scope guard', data => { data.commands.shift() }, 'TEMPLATE_MISMATCH'],
    ['omitted active guard', data => { data.commands.splice(1, 1) }, 'TEMPLATE_MISMATCH'],
    ['reordered guards', data => { [data.commands[0], data.commands[1]] = [data.commands[1], data.commands[0]] }, 'TEMPLATE_MISMATCH'],
    ['foreign callable package', data => { data.commands[2].MoveCall!.package = id(999) }, 'TEMPLATE_MISMATCH'],
    ['foreign function', data => { data.commands[2].MoveCall!.function = 'purge_deleted_version_as_owner' }, 'TEMPLATE_MISMATCH'],
    ['type arguments', data => { data.commands[0].MoveCall!.typeArguments = ['u64'] }, 'TEMPLATE_MISMATCH'],
    ['command result substituted for Input', data => { data.commands[2].MoveCall!.arguments[5] = { $kind: 'Result', Result: 0 } }, 'TEMPLATE_MISMATCH'],
    ['extra pure input', data => { data.inputs.push(Inputs.Pure(bcs.u8().serialize(0).toBytes())) }, 'TEMPLATE_MISMATCH'],
    ['wrong epoch', data => { const ref = data.commands[0].MoveCall!.arguments[2] as { Input: number }; data.inputs[ref.Input] = Inputs.Pure(bcs.u64().serialize('3').toBytes()) }, 'PURE_ARGUMENT_MISMATCH'],
    ['wrong active index', data => { const ref = data.commands[1].MoveCall!.arguments[3] as { Input: number }; data.inputs[ref.Input] = Inputs.Pure(bcs.option(bcs.u64()).serialize('0').toBytes()) }, 'PURE_ARGUMENT_MISMATCH'],
    ['State mutable', (data, f) => { data.inputs.find(row => row.Object?.SharedObject?.objectId === f.plan.stateId)!.Object!.SharedObject!.mutable = true }, 'SHARED_REFERENCE_MISMATCH'],
    ['Content readonly', (data, f) => { data.inputs.find(row => row.Object?.SharedObject?.objectId === f.plan.contentId)!.Object!.SharedObject!.mutable = false }, 'SHARED_REFERENCE_MISMATCH'],
    ['State wrong root', (data, f) => { data.inputs.find(row => row.Object?.SharedObject?.objectId === f.plan.stateId)!.Object!.SharedObject!.objectId = id(999) }, 'SHARED_REFERENCE_MISMATCH'],
    ['State owned', (data, f) => { const n = data.inputs.findIndex(row => row.Object?.SharedObject?.objectId === f.plan.stateId); data.inputs[n] = Inputs.ObjectRef({ objectId: f.plan.stateId, version: '1', digest: prior }) }, 'SHARED_REFERENCE_MISMATCH'],
    ['zero shared initial version', (data, f) => { data.inputs.find(row => row.Object?.SharedObject?.objectId === f.plan.stateId)!.Object!.SharedObject!.initialSharedVersion = '0' }, 'INVALID_U64'],
    ['wrong gas owner', data => { data.gasData.owner = id(999) }, 'SENDER_EXPIRATION_MISMATCH'],
    ['wrong sender', data => { data.sender = id(999) }, 'SENDER_EXPIRATION_MISMATCH'],
    ['no expiration', data => { data.expiration = null }, 'SENDER_EXPIRATION_MISMATCH'],
    ['no gas', data => { data.gasData.payment = [] }, 'GAS_REQUIRED'],
    ['gas overlaps root', (data, f) => { data.gasData.payment![0].objectId = f.plan.stateId }, 'GAS_OVERLAP'],
    ['duplicate gas', data => { data.gasData.payment!.push({ ...data.gasData.payment![0] }) }, 'GAS_REQUIRED'],
    ['zero gas budget', data => { data.gasData.budget = '0' }, 'INVALID_U64'],
  ]
  it.each(mutators)('rejects %s even with fresh local signature and recomputed digest', async (_name, mutate, code) => {
    const f = await contentMutationTransactionFixture(), forged = await f.packet(f.plan, data => mutate(data, f))
    expect(() => parseContentMutationRecord(forged)).toThrow(code)
    await expect(f.adapter.query(forged)).rejects.toThrow(code); expect(f.getTransaction).not.toHaveBeenCalled()
  })
  it('requires the original owned grantee reference, never a shared or foreign grant', async () => {
    const f = await contentMutationTransactionFixture({ grantee: true })
    for (const replacement of [Inputs.SharedObjectRef({ objectId: f.plan.grantId!, initialSharedVersion: '1', mutable: false }),
      Inputs.ObjectRef({ objectId: id(999), version: '11', digest: prior })]) {
      const record = await f.packet(f.plan, data => { const n = data.inputs.findIndex(row => row.Object?.ImmOrOwnedObject?.objectId === f.plan.grantId); data.inputs[n] = replacement })
      expect(() => parseContentMutationRecord(record)).toThrow('GRANT_REFERENCE_MISMATCH')
    }
  })
  it('rejects malformed schema, unexpected fields, digest, byte canonicality and phase/signature mismatch', async () => {
    const f = await contentMutationTransactionFixture()
    for (const mutate of [
      (r: any) => { r.extra = 1 }, (r: any) => { r.schema = 'foreign' }, (r: any) => { r.packet.digest = prior },
      (r: any) => { r.packet.bytes += '=' }, (r: any) => { r.packet.signature = null },
      (r: any) => { r.packet.phase = 'PREPARED' }, (r: any) => { r.packet.phase = 'UNKNOWN' },
      (r: any) => { r.packet.expirationEpoch = '01' }, (r: any) => { r.plan.ownershipEpoch = 2 },
      (r: any) => { r.plan.expectedActive.versionIndex = '9007199254740993.0' },
    ]) { const bad = structuredClone(f.record); mutate(bad); expect(() => parseContentMutationRecord(bad)).toThrow() }
  })
  it('full-u64 target and active indices remain exact, never truncated to Number', async () => {
    const f = await contentMutationTransactionFixture({ action: 'set-active' }), plan = structuredClone(f.plan)
    plan.target!.versionIndex = '18446744073709551615'; plan.expectedActive!.versionIndex = '9007199254740993'
    const record = await f.packet(plan), parsed = parseContentMutationRecord(record)
    expect(parsed.plan.target!.versionIndex).toBe(plan.target!.versionIndex)
    expect(parsed.plan.expectedActive!.versionIndex).toBe(plan.expectedActive!.versionIndex)
    expect(contentMutationKey(plan)).toBe(contentMutationKey(f.plan))
  })
  it('plan parsing rejects malformed roots, aliases, incompatible actions and slot preconditions', async () => {
    const f = await contentMutationTransactionFixture()
    for (const mutate of [
      (p: any) => { p.contentId = p.stateId }, (p: any) => { p.soulId = '0x1' },
      (p: any) => { p.deployment.extra = true }, (p: any) => { p.deployment.chainIdentifier = 'INVALID' },
      (p: any) => { p.action = 'purge' }, (p: any) => { p.target = p.expectedActive },
      (p: any) => { p.kind = 4294967296 }, (p: any) => { p.target.name = 'INVALID' },
      (p: any) => { p.action = 'clear-active' }, (p: any) => { p.grantId = p.stateId },
      (p: any) => { p.expectedActive = undefined }, (p: any) => { p.expectedSlot = 'invalid' },
    ]) { const plan = structuredClone(f.plan); mutate(plan); expect(() => parseContentMutationPlan(plan)).toThrow() }
  })
})

describe('wallet, simulation and current authority boundaries', () => {
  it('verifies genuine local signatures and rejects other keys or changed bytes', async () => {
    const f = await contentMutationTransactionFixture()
    await f.adapter.verifySignature(f.record)
    const other = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(22)), signature = await other.signTransaction(fromBase64(f.record.packet.bytes))
    await expect(f.adapter.verifySignature({ ...f.record, packet: { ...f.record.packet, signature: signature.signature } })).rejects.toThrow()
    const changed = await f.packet(f.plan, data => { data.gasData.budget = '1000001' })
    await expect(f.adapter.verifySignature({ ...changed, packet: { ...changed.packet, signature: f.record.packet.signature } })).rejects.toThrow()
  })
  it.each(['before', 'during'] as const)('wallet changes %s sign reject without broadcast', async when => {
    const f = await contentMutationTransactionFixture()
    if (when === 'before') f.setAddress(null)
    else f.sign.mockImplementation(async tx => { const signed = await f.signer.signTransaction(await tx.build()); f.setAddress(null); return signed })
    await expect(f.adapter.sign(prepared(f))).rejects.toThrow('WALLET_CHANGED')
    if (when === 'before') expect(f.sign).not.toHaveBeenCalled()
    expect(f.raw.execute).not.toHaveBeenCalled()
  })
  it('rejects changed bytes returned by a wallet even when correctly signed', async () => {
    const f = await contentMutationTransactionFixture(), different = await f.packet(f.plan, data => { data.gasData.budget = '1000001' })
    f.sign.mockResolvedValue({ bytes: different.packet.bytes, signature: different.packet.signature! })
    await expect(f.adapter.sign(prepared(f))).rejects.toThrow('WALLET_CHANGED_BYTES')
  })
  it.each(['ownershipEpoch', 'currentOwner', 'active', 'slot'] as const)('fresh preflight rejects changed %s using the actual raw reader', async field => {
    const f = await contentMutationTransactionFixture()
    if (field === 'ownershipEpoch') { f.raw.state.ownership_epoch = '3'; f.raw.state.active_grant_count = '0'; f.raw.putState() }
    if (field === 'currentOwner') { f.raw.state.current_owner = id(999); f.raw.putState() }
    if (field === 'active') { f.raw.active.version_index = '0'; f.raw.putActive() }
    if (field === 'slot') { f.raw.slots[0].deleted = true; f.raw.putSlots() }
    await expect(f.adapter.sign(prepared(f))).rejects.toThrow(); expect(f.sign).not.toHaveBeenCalled()
    await expect(f.adapter.broadcast(f.record)).rejects.toThrow(); expect(f.raw.execute).not.toHaveBeenCalled()
  })
  it('rejects a grant expiring before the signature and preserves management of deprecated existing slots', async () => {
    const f = await contentMutationTransactionFixture({ grantee: true })
    f.raw.descriptor.deprecated = true; f.raw.putDescriptor(); await f.adapter.preflight(f.record, false)
    f.raw.putClock('2000'); await expect(f.adapter.sign(prepared(f))).rejects.toThrow('GRANT_INVALID')
    expect(f.sign).not.toHaveBeenCalled()
  })
  it('expired packets become query-only without an additional signature', async () => {
    const f = await contentMutationTransactionFixture()
    f.epoch.mockResolvedValue({ response: { epoch: { epoch: 11n } } } as never)
    await expect(f.adapter.sign(prepared(f))).rejects.toThrow('EXPIRED_QUERY_ONLY')
    await expect(f.adapter.broadcast(f.record)).rejects.toThrow('EXPIRED_QUERY_ONLY')
    expect(f.sign).not.toHaveBeenCalled(); expect(f.raw.execute).not.toHaveBeenCalled()
    await expect(f.adapter.query(f.record)).resolves.toMatchObject({ status: 'SUCCEEDED' })
  })
  it('rejects wrong chain for both writes and historical queries', async () => {
    const f = await contentMutationTransactionFixture()
    f.raw.chain.mockResolvedValue({ chainIdentifier: toBase58(new Uint8Array(32).fill(1)) })
    await expect(f.adapter.sign(prepared(f))).rejects.toThrow('WRONG_CHAIN')
    await expect(f.adapter.query(f.record)).rejects.toThrow('WRONG_CHAIN')
    expect(f.sign).not.toHaveBeenCalled(); expect(f.getTransaction).not.toHaveBeenCalled()
  })
  it('rejects a genuinely signed far-future expiration before signing or rebroadcast', async () => {
    const f = await contentMutationTransactionFixture()
    const record = await f.packet(f.plan, data => { data.expiration = { Epoch: '1000000' } })
    record.packet.expirationEpoch = '1000000'
    expect(() => parseContentMutationRecord(record)).not.toThrow()
    await f.adapter.verifySignature(record)
    await expect(f.adapter.sign({ ...record, packet: { ...record.packet, phase: 'PREPARED', signature: null } }))
      .rejects.toThrow('EXPIRATION_OUTSIDE_PREPARED_WINDOW')
    await expect(f.adapter.broadcast(record)).rejects.toThrow('EXPIRATION_OUTSIDE_PREPARED_WINDOW')
    expect(f.sign).not.toHaveBeenCalled(); expect(f.raw.execute).not.toHaveBeenCalled()
  })
  it('rejects expiration values that the pinned SDK cannot canonically round-trip', async () => {
    const f = await contentMutationTransactionFixture()
    // TransactionData Epoch uses the SDK's unsafe_u64 codec. This is distinct
    // from the pure Move u64 ownership/active arguments, tested losslessly above.
    const record = await f.packet(f.plan, data => { data.expiration = { Epoch: '18446744073709551615' } })
    record.packet.expirationEpoch = '18446744073709551615'
    expect(() => parseContentMutationRecord(record)).toThrow()
    await expect(f.adapter.sign({ ...record, packet: { ...record.packet, phase: 'PREPARED', signature: null } })).rejects.toThrow()
    expect(f.sign).not.toHaveBeenCalled()
  })
  it('the write expiration window never limits read-only historical queries', async () => {
    const f = await contentMutationTransactionFixture()
    f.epoch.mockResolvedValue({ response: { epoch: { epoch: 1n } } } as never)
    await expect(f.adapter.sign(prepared(f))).rejects.toThrow('EXPIRATION_OUTSIDE_PREPARED_WINDOW')
    f.epoch.mockClear(); await expect(f.adapter.query(f.record)).resolves.toMatchObject({ status: 'SUCCEEDED' })
    expect(f.epoch).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
  })
  it('prepare snapshots caller intent before awaiting chain and current checks', async () => {
    const f = await contentMutationTransactionFixture(), original = structuredClone(f.plan)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    f.preflight.mockImplementation(async plan => { await gate; assertContentMutationAuthority(plan, f.proof) })
    const pending = f.adapter.prepare(f.plan)
    f.plan.target!.name = 'different'; f.plan.expectedActive!.versionIndex = '0'; release()
    const result = await pending
    expect(result.plan).toEqual(original); expect(result.packet.bytes).toBe(f.record.packet.bytes)
  })
  it('an unknown broadcast transport outcome preserves the exact packet and can only query that digest', async () => {
    const f = await contentMutationTransactionFixture(), before = structuredClone(f.record)
    f.raw.execute.mockRejectedValue(new Error('transport lost after send'))
    await expect(f.adapter.broadcast(f.record)).rejects.toThrow('transport lost after send')
    expect(f.record).toEqual(before); expect(f.sign).not.toHaveBeenCalled(); expect(f.raw.execute).toHaveBeenCalledTimes(1)
    await expect(f.adapter.query(f.record)).resolves.toMatchObject({ status: 'SUCCEEDED' })
    expect(f.getTransaction.mock.calls[0][0].digest).toBe(before.packet.digest)
  })
  it.each(['effects', 'bytes', 'protocol'] as const)('preflight rejects failed %s simulation/limits', async what => {
    const f = await contentMutationTransactionFixture()
    if (what === 'protocol') f.attributes.max_tx_size_bytes = '1'
    else f.simulate.mockResolvedValue({ response: { transaction: { transaction: { bcs: { value: what === 'bytes'
      ? new Uint8Array([1]) : fromBase64(f.record.packet.bytes) } }, effects: { status: { success: what !== 'effects' } } } } } as never)
    await expect(f.adapter.preflight(f.record, true)).rejects.toThrow(what === 'protocol' ? 'PROTOCOL_LIMIT' : 'SIMULATION_REJECTED')
    expect(f.sign).not.toHaveBeenCalled()
  })
})

describe('query status and typed historical evidence', () => {
  it('distinguishes NOT_FOUND, transport uncertainty, pending and finalized failure', async () => {
    const f = await contentMutationTransactionFixture()
    f.getTransaction.mockRejectedValueOnce(Object.assign(new Error('absent'), { code: 'NOT_FOUND' }))
    await expect(f.adapter.query(f.record)).resolves.toEqual({ status: 'MISSING' })
    f.getTransaction.mockRejectedValueOnce(new Error('network'))
    await expect(f.adapter.query(f.record)).rejects.toThrow('network')
    f.setCheckpoint(undefined); await expect(f.adapter.query(f.record)).resolves.toEqual({ status: 'PENDING' })
    f.setCheckpoint(42n); f.effects.V2!.status = { $kind: 'Failure', Failure: { error: { $kind: 'InsufficientGas', InsufficientGas: true }, command: 2 } }
    await expect(f.adapter.query(f.record)).resolves.toEqual({ status: 'FAILED', checkpoint: '42' })
    expect(f.raw.get.mock.calls.filter(([request]) => request.version !== undefined)).toHaveLength(0)
  })
  it.each(['digest', 'transaction bytes', 'effects digest', 'status', 'checkpoint', 'effects bytes'] as const)('rejects mismatched %s evidence', async what => {
    const f = await contentMutationTransactionFixture()
    f.mutateResponse(value => {
      if (what === 'digest') value.transaction.digest = prior
      if (what === 'transaction bytes') value.transaction.bcs.value = new Uint8Array([1])
      if (what === 'effects digest') value.effects.transactionDigest = prior
      if (what === 'status') value.effects.status.success = false
      if (what === 'checkpoint') value.checkpoint = '42'
      if (what === 'effects bytes') value.effects.bcs.value = new Uint8Array([...value.effects.bcs.value, 0])
    })
    await expect(f.adapter.query(f.record)).rejects.toThrow()
  })
  it('rejects effects whose executed epoch exceeds the frozen expiration', async () => {
    const f = await contentMutationTransactionFixture(); f.effects.V2!.executedEpoch = '11'
    await expect(f.adapter.query(f.record)).rejects.toThrow('STATUS_MISMATCH')
  })
  it.each(['missing', 'duplicate', 'also changed', 'wrong shared birth', 'owned'] as const)('rejects %s readonly State evidence', async what => {
    const f = await contentMutationTransactionFixture(), e = f.effects.V2!
    if (what === 'missing') e.unchangedConsensusObjects = []
    if (what === 'duplicate') e.unchangedConsensusObjects.push(structuredClone(e.unchangedConsensusObjects[0]))
    if (what === 'also changed') e.changedObjects.push([f.ids.state, structuredClone(f.change('content'))])
    if (what === 'wrong shared birth') f.setOwner('state', { Shared: { initialSharedVersion: '2' } })
    if (what === 'owned') f.setOwner('state', { AddressOwner: f.author })
    await expect(f.adapter.query(f.record)).rejects.toThrow()
  })
  it('rejects a fully rehashed readonly State newer than the effects Lamport version', async () => {
    const f = await contentMutationTransactionFixture()
    f.objects.get(f.ids.state)!.data.Move!.version = '13'; f.rows.get(f.ids.state)!.version = 13n
    f.effects.V2!.unchangedConsensusObjects[0][1].ReadOnlyRoot![0] = '13'; f.rehash('state')
    await expect(f.adapter.query(f.record)).rejects.toThrow()
  })
  it.each(['epoch', 'soul', 'content', 'owner'] as const)('rejects fully rehashed historical State %s substitution', async what => {
    const f = await contentMutationTransactionFixture()
    f.rewrite('state', value => {
      if (what === 'epoch') value.ownership_epoch = '3'
      if (what === 'soul') value.soul_id = id(999)
      if (what === 'content') value.content_id = id(999)
      if (what === 'owner') value.current_owner = id(999)
    })
    await expect(f.adapter.query(f.record)).rejects.toThrow('HISTORICAL_STATE_MISMATCH')
  })
  it.each(['content BCS', 'wrong prior owner', 'duplicate output', 'wrong slot', 'field key', 'field parent', 'missing output'] as const)(
    'rejects %s in a delete output', async what => {
      const f = await contentMutationTransactionFixture()
      if (what === 'content BCS') f.rows.get(f.ids.content)!.bcs.value[5] ^= 1
      if (what === 'wrong prior owner') f.setOwner('content', { Shared: { initialSharedVersion: '2' } }, true)
      if (what === 'duplicate output') f.effects.V2!.changedObjects.push([f.ids.slots, structuredClone(f.change('slots'))])
      if (what === 'wrong slot') f.rewrite('slots', value => { value.value[0].deleted = false })
      if (what === 'field key') f.rewrite('slots', value => { value.name.name = 'other' })
      if (what === 'field parent') f.setOwner('slots', { ObjectOwner: id(999) })
      if (what === 'missing output') f.effects.V2!.changedObjects = f.effects.V2!.changedObjects.filter(([objectId]) => objectId !== f.ids.slots)
      await expect(f.adapter.query(f.record)).rejects.toThrow()
    })
  it.each(['wrong name', 'wrong index', 'wrong policy'] as const)('rejects fully rehashed active %s', async what => {
    const f = await contentMutationTransactionFixture({ action: 'set-active' })
    f.rewrite('active', value => {
      if (what === 'wrong name') value.value.name = 'other'
      if (what === 'wrong index') value.value.version_index = '1'
      if (what === 'wrong policy') value.value.download_policy = 0
    })
    await expect(f.adapter.query(f.record)).rejects.toThrow('HISTORICAL_ACTIVE_MISMATCH')
  })
  it.each([false, true])('active lifetime must match the frozen previous binding (empty=%s)', async emptyActive => {
    const f = await contentMutationTransactionFixture({ action: 'set-active', emptyActive }), c = f.change('active')
    c.idOperation = emptyActive ? { $kind: 'None', None: true } : { $kind: 'Created', Created: true }
    c.inputState = emptyActive ? { $kind: 'Exist', Exist: [['11', prior], c.outputState.ObjectWrite![1]] } : { $kind: 'NotExist', NotExist: true }
    await expect(f.adapter.query(f.record)).rejects.toThrow()
  })
  it.each(['wrapper', 'blob'] as const)('purge proves %s deletion, ownership and input lineage', async label => {
    for (const what of ['missing', 'wrong owner', 'not deleted', 'still exists', 'duplicate', 'future version'] as const) {
      const f = await contentMutationTransactionFixture({ action: 'purge' }), c = f.change(label)
      if (what === 'missing') f.effects.V2!.changedObjects = f.effects.V2!.changedObjects.filter(([objectId]) => objectId !== f.ids[label])
      if (what === 'wrong owner') c.inputState.Exist![1] = { $kind: 'ObjectOwner', ObjectOwner: id(999) }
      if (what === 'not deleted') c.idOperation = { $kind: 'None', None: true }
      if (what === 'still exists') c.outputState = { $kind: 'ObjectWrite', ObjectWrite: [prior, c.inputState.Exist![1]] }
      if (what === 'duplicate') f.effects.V2!.changedObjects.push([f.ids[label], structuredClone(c)])
      if (what === 'future version') c.inputState.Exist![0][0] = '12'
      await expect(f.adapter.query(f.record), `${label} ${what}`).rejects.toThrow(/HISTORICAL_DELETION/)
    }
  })
  it('clear requires deletion of the exact active field, not absence inferred from failed RPC', async () => {
    const f = await contentMutationTransactionFixture({ action: 'clear-active' })
    f.change('active').inputState.Exist![1] = { $kind: 'ObjectOwner', ObjectOwner: id(999) }
    await expect(f.adapter.query(f.record)).rejects.toThrow('HISTORICAL_DELETION_MISMATCH')
  })
})
