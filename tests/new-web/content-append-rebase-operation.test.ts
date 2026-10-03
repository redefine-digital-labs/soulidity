import { afterEach, expect, it, vi } from 'vitest'
import { contentAppendRebaseFixture } from './fixtures/content-append-rebase'
import { contentAppendFixtureId as id } from './fixtures/content-append-preparation'
import { contentAppendPreparationFingerprint, rewrapContentAppendPreparation, type ContentAppendPreparation } from '../../web/lib/soulidity/content-append-preparation'
import { assertContentAppendAuthority, parseContentAppendIntent, contentAppendWalrusIntent } from '../../web/lib/soulidity/content-append-operation'
import { prepareContentAppendRebase, contentAppendRebaseContinuation, ContentAppendPredecessorCompleted } from '../../web/lib/soulidity/content-append-rebase'
import { verifyContentAppendRebaseLink, type ContentAppendRebaseLink } from '../../web/lib/soulidity/content-append-rebase-evidence'
import { walrusSingleKey, type WalrusSingleRecord } from '../../web/lib/upload/walrus-single-operation'

// Actual Seal/AES rewrap, Sui BCS packets and author signatures. Stage/payment
// stores and proof/retirement transport are in-memory doubles: not chain E2E,
// IndexedDB transaction durability, network retirement, or a new payment test.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const fingerprint = contentAppendPreparationFingerprint
const paymentKey = (record: ContentAppendPreparation) => walrusSingleKey(contentAppendWalrusIntent(record))
async function fixture(options: Parameters<typeof contentAppendRebaseFixture>[0] = {}) {
  const f = await contentAppendRebaseFixture(options)
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet')
  vi.stubEnv('NEXT_PUBLIC_SEAL_THRESHOLD', String(f.params.sealConfig.threshold))
  vi.stubEnv('NEXT_PUBLIC_SEAL_SESSION_TTL_MIN', String(f.params.sealConfig.ttlMin))
  vi.stubEnv('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', JSON.stringify(f.params.sealConfig.serverConfigs))
  vi.stubEnv('NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS', 'true')
  const events: string[] = [], payments = new Map<string, WalrusSingleRecord>([[paymentKey(f.previous), structuredClone(f.previousPayment)]])
  const links = new Map<string, ContentAppendRebaseLink>()
  let active = f.previous, fail: string | null = null
  const event = (name: string) => { events.push(name); if (fail === name) { fail = null; throw Error(`interrupted:${name}`) } }
  const stageRead = vi.fn(async () => { event(active === f.previous ? 'read-old-stage' : 'read-next-stage'); return active })
  const history = vi.fn(async (record: ContentAppendPreparation) => {
    const result: ContentAppendRebaseLink[] = []; let head = record
    while (parseContentAppendIntent(head).rebase) {
      const link = links.get(parseContentAppendIntent(head).rebase!.predecessor)
      if (!link) throw Error('HISTORY_MISSING')
      result.unshift(structuredClone(link)); head = { ...link.previous, ciphertext: record.ciphertext }
    }
    return result
  })
  const pending = vi.fn(async (record: ContentAppendPreparation) => links.get(fingerprint(record)) ?? null)
  const prepare = vi.fn(async (link: ContentAppendRebaseLink, ciphertext: Uint8Array) => {
    await verifyContentAppendRebaseLink(link, ciphertext, f.client)
    const previous = links.get(fingerprint({ ...link.previous, ciphertext }))
    if (previous) expect(link).toEqual(previous)
    links.set(fingerprint({ ...link.previous, ciphertext }), structuredClone(link)); event('prepared-link')
  })
  const activate = vi.fn(async (link: ContentAppendRebaseLink, ciphertext: Uint8Array) => {
    event('before-activate'); active = (await verifyContentAppendRebaseLink(link, ciphertext, f.client)).next; event('activated-link')
  })
  const readPayment = vi.fn((key: string) => { event(key === paymentKey(f.previous) ? 'read-old-wal' : 'read-next-wal'); return payments.get(key) ?? null })
  const writePayment = vi.fn((key: string, value: WalrusSingleRecord) => { payments.set(key, structuredClone(value)); event('write-next-wal'); return key })
  const paymentLock = vi.fn(async (_key: string, work: () => Promise<any>) => work())
  const signChain = vi.fn(async () => { throw Error('No chain signing in coordinator tests') })
  const execution = { client: f.client, getAddress: f.params.wallet.getAddress, sign: signChain }
  const proof: any = { soulId: f.intent.soulId, stateId: f.intent.stateId, contentId: f.scope.contentObjectId,
    originalPackageId: f.scope.originalPackageId, callablePackageId: f.scope.callablePackageId, kindRegistryId: f.intent.kindRegistryId,
    snapshot: { ownershipEpoch: '0', currentOwner: f.scope.author,
      contentVersions: [0, 1, 2].map(n => ({ kind: f.scope.kind, name: f.scope.name, versionIndex: String(n) })),
      kindDescriptors: [{ kind: f.scope.kind, deprecated: false, op_mask: '1', read_mode_mask: '15', requires_download_policy: true,
        default_grant_scope_mask: '3' }], grants: options.grant ? [{ currentEpoch: true, unexpiredAtObservation: true, grant: {},
        slot: { grantee: f.scope.author, grant_id: id(71), scope_mask: '3' } }] : [], activeGrantCount: '0', grantCapacity: '1' } }
  const read = vi.fn(async () => { event('read-proof'); return structuredClone(proof) })
  const inspect = vi.fn(async ({ record }: { record: WalrusSingleRecord }) => {
    event('inspect'); return { status: 'REBASE_AVAILABLE' as const, record, ...f.link.inspection,
      retirement: record.certify ? { kind: 'FAILED' as const, digest: record.certify.digest, observedSuiEpoch: null } : f.link.inspection.retirement }
  })
  const rewrap = vi.fn(async (args: Parameters<typeof rewrapContentAppendPreparation>[0]) => {
    event('rewrap'); return rewrapContentAppendPreparation(args)
  })
  const approveGas = vi.fn(async () => '700000' as string | null)
  const params = { record: f.previous, config: { kindRegistryId: f.intent.kindRegistryId }, execution,
    wallet: { ...f.params.wallet }, signal: f.controller.signal, approveGas }
  const deps: any = { read, inspect, rewrap, readPayment, writePayment, paymentLock,
    stageStore: { read: stageRead }, transitionStore: { history, pending, prepare, activate } }
  const run = () => prepareContentAppendRebase(params, deps)
  const continuation = (record = active) => contentAppendRebaseContinuation(record, execution, f.controller.signal, deps)
  f.sign.mockClear(); f.decryptCall.mockClear()
  return { ...f, params, deps, events, payments, links, execution, proof, read, inspect, rewrap, approveGas, signChain,
    stageRead, history, pending, prepare, activate, readPayment, writePayment, paymentLock, run, continuation,
    active: () => active, setActive: (record: ContentAppendPreparation) => { active = record }, interrupt: (name: string) => { fail = name } }
}
it('commits a verified link before installing/reading WAL and only then activates the new signed stage', async () => {
  const f = await fixture(), next = (await f.run())!
  const commit = f.events.indexOf('prepared-link'), write = f.events.indexOf('write-next-wal'), activate = f.events.indexOf('before-activate')
  expect(commit).toBeLessThan(write); expect(write).toBeLessThan(activate)
  expect(f.events.slice(write + 1, activate)).toContain('read-next-wal')
  expect(f.events.indexOf('activated-link')).toBeLessThan(f.events.lastIndexOf('read-next-stage'))
  expect(f.active()).toEqual(next); expect(next.ciphertext).toEqual(f.previous.ciphertext)
  expect(f.payments.get(paymentKey(next))!.register).toEqual(f.previousPayment.register)
  expect(f.payments.get(paymentKey(next))!.encoding).toEqual(f.previousPayment.encoding)
  expect(f.payments.get(paymentKey(next))!.approved).toMatchObject({ storageCost: '3', writeCost: '2', relayTip: '1', gasBudget: '1400000' })
  expect(f.approveGas).toHaveBeenCalledWith({ previousVersion: '2', nextVersion: '3', blobObjectId: id(100), remainingWalrusEpochs: 6,
    suggestedGasBudgetMist: '500000', alreadyPrepared: false })
  expect(f.rewrap).toHaveBeenCalledOnce(); expect(f.signChain).not.toHaveBeenCalled()
})
it.each(['prepared-link', 'write-next-wal', 'before-activate'])('cold retry after %s reuses the committed link and register without another rewrap', async point => {
  const f = await fixture(); f.interrupt(point)
  await expect(f.run()).rejects.toThrow(`interrupted:${point}`)
  const stored = structuredClone([...f.links.values()][0]), signs = f.sign.mock.calls.length
  const next = (await f.run())!
  expect(fingerprint(next)).toBe(fingerprint({ ...stored.next, ciphertext: f.previous.ciphertext }))
  expect([...f.links.values()]).toEqual([stored]); expect(f.rewrap).toHaveBeenCalledOnce(); expect(f.sign).toHaveBeenCalledTimes(signs)
  expect(f.approveGas.mock.calls.at(-1)![0]).toMatchObject({ alreadyPrepared: true, suggestedGasBudgetMist: '700000' })
  expect(f.writePayment).toHaveBeenCalledOnce(); expect(f.signChain).not.toHaveBeenCalled()
})
it.each(['activated-link', 'read-next-stage'])('recovers an already activated %s interruption by verifying its continuation, never rewrapping', async point => {
  const f = await fixture(); f.interrupt(point)
  await expect(f.run()).rejects.toThrow(`interrupted:${point}`)
  const active = f.active(), signs = f.sign.mock.calls.length, continuation = await f.continuation()
  await continuation.verify()
  expect(continuation.payment).toEqual(f.payments.get(paymentKey(active)))
  expect(f.rewrap).toHaveBeenCalledOnce(); expect(f.sign).toHaveBeenCalledTimes(signs); expect(f.writePayment).toHaveBeenCalledOnce()
})
it('refuses WAL readback loss before activation, then installs the same pending seed on cold retry', async () => {
  const f = await fixture(); f.writePayment.mockImplementationOnce(() => { f.events.push('lost-write'); return 'lost' })
  await expect(f.run()).rejects.toThrow('PAYMENT_READBACK_MISSING')
  const link = [...f.links.values()][0]
  expect(f.activate).not.toHaveBeenCalled(); expect(f.active()).toBe(f.previous)
  await f.run(); expect([...f.links.values()][0]).toEqual(link); expect(f.rewrap).toHaveBeenCalledOnce()
})
it('creates a new nonce/signed scope for a gas-only rebase while preserving storage and product intent', async () => {
  const f = await fixture(); f.proof.snapshot.contentVersions.pop()
  const next = (await f.run())!, intent = parseContentAppendIntent(next)
  expect(next.scope.versionIndex).toBe(f.previous.scope.versionIndex)
  expect({ ...intent, rebase: null }).toEqual(f.intent)
  expect(intent.rebase).toMatchObject({ predecessor: fingerprint(f.previous), certifyGasBudgetMist: '700000' })
  expect(fingerprint(next)).not.toBe(fingerprint(f.previous)); expect(paymentKey(next)).not.toBe(paymentKey(f.previous))
  expect(next.ciphertext).toEqual(f.previous.ciphertext); expect(f.payments.get(paymentKey(next))!.register).toEqual(f.previousPayment.register)
})
it.each([null, '0', '-1', '1.2', '9223372036854775808'])('cancels or rejects gas value %s before signing or committing', async budget => {
  const f = await fixture(); f.approveGas.mockResolvedValueOnce(budget)
  if (budget === null) expect(await f.run()).toBeNull()
  else await expect(f.run()).rejects.toThrow('GAS_BUDGET_INVALID')
  expect(f.rewrap).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.writePayment).not.toHaveBeenCalled(); expect(f.activate).not.toHaveBeenCalled()
})
it('does not change the gas approval of an already prepared signed transition', async () => {
  const f = await fixture(); f.interrupt('prepared-link'); await expect(f.run()).rejects.toThrow('interrupted')
  f.approveGas.mockResolvedValueOnce('800000')
  await expect(f.run()).rejects.toThrow('PREPARED_GAS_CANNOT_CHANGE')
  expect(f.rewrap).toHaveBeenCalledOnce(); expect(f.activate).not.toHaveBeenCalled()
})
it.each(['initial WAL', 'activated WAL', 'activated history'])('refuses missing %s without new signing or payment', async missing => {
  const f = await fixture()
  if (missing === 'initial WAL') {
    f.payments.clear(); await expect(f.run()).rejects.toThrow('PAID_WAL_MISSING')
  } else {
    await f.run(); f.rewrap.mockClear(); f.writePayment.mockClear()
    if (missing === 'activated WAL') f.payments.delete(paymentKey(f.active()))
    else f.links.clear()
    await expect(f.continuation()).rejects.toThrow(missing === 'activated WAL' ? 'PAID_WAL_MISSING' : 'HISTORY_MISSING')
  }
  expect(f.rewrap).not.toHaveBeenCalled(); expect(f.writePayment).not.toHaveBeenCalled(); expect(f.signChain).not.toHaveBeenCalled()
})
it.each(['PENDING', 'RPC', 'COMPLETED'])('stops predecessor inspection outcome %s before approval or preparation', async status => {
  const f = await fixture()
  f.inspect.mockImplementationOnce(async ({ record }) => {
    if (status !== 'COMPLETED') throw Error(status === 'PENDING' ? 'TRANSACTION_PENDING' : 'RPC unavailable')
    return { status: 'COMPLETED', record, result: { blobObjectId: id(100), certifyTxDigest: 'known-success' } } as any
  })
  if (status === 'COMPLETED') await expect(f.run()).rejects.toBeInstanceOf(ContentAppendPredecessorCompleted)
  else await expect(f.run()).rejects.toThrow(status === 'PENDING' ? 'TRANSACTION_PENDING' : 'RPC unavailable')
  expect(f.approveGas).not.toHaveBeenCalled(); expect(f.rewrap).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled()
})
it('retains the failed predecessor packet as retirement evidence while seeding no replacement register', async () => {
  const f = await fixture(), packet = await f.packet(2)
  f.payments.get(paymentKey(f.previous))!.certify = { ...packet, phase: 'SIGNED' }
  const next = (await f.run())!, link = [...f.links.values()][0]
  expect(link.previousPayment.certify).toMatchObject({ bytes: packet.bytes, signature: packet.signature })
  expect(link.inspection.retirement).toEqual({ kind: 'FAILED', digest: packet.digest, observedSuiEpoch: null })
  expect(f.payments.get(paymentKey(next))!.certify).toBeNull(); expect(f.payments.get(paymentKey(next))!.register).toEqual(f.previousPayment.register)
})
it('merges current, original and required grant masks without narrowing and recalculates capacity', async () => {
  const f = await fixture({ autoGrant: true })
  f.proof.snapshot.grants = [{ currentEpoch: true, unexpiredAtObservation: false, grant: {}, slot: { grantee: id(8), scope_mask: '4' } }]
  f.proof.snapshot.activeGrantCount = '1'
  const next = (await f.run())!
  expect(parseContentAppendIntent(next).autoGrantPlan).toEqual({ capacityBefore: '1', capacityAfter: '1', targets: [{ address: id(8), scopeMask: 7 }] })
})
it('omits already covered grant targets but blocks continuation when that retained coverage later expires', async () => {
  const f = await fixture({ autoGrant: true })
  f.proof.snapshot.grants = [{ currentEpoch: true, unexpiredAtObservation: true, grant: {}, slot: { grantee: id(8), scope_mask: '3' } }]
  f.proof.snapshot.activeGrantCount = '1'
  const next = (await f.run())!, continuation = await f.continuation()
  expect(parseContentAppendIntent(next).autoGrantPlan).toBeNull(); expect(() => continuation.assertAuthority(f.proof)).not.toThrow()
  f.proof.snapshot.grants[0].unexpiredAtObservation = false
  expect(() => continuation.assertAuthority(f.proof)).toThrow('ORIGINAL_AUTO_GRANT_NO_LONGER_COVERED')
})
it('stops coverage expiry between initial approval and the precommit authority read', async () => {
  const f = await fixture({ autoGrant: true })
  f.proof.snapshot.grants = [{ currentEpoch: true, unexpiredAtObservation: true, grant: {}, slot: { grantee: id(8), scope_mask: '3' } }]
  f.approveGas.mockImplementationOnce(async () => { f.proof.snapshot.grants[0].unexpiredAtObservation = false; return '700000' })
  await expect(f.run()).rejects.toThrow('ORIGINAL_AUTO_GRANT_NO_LONGER_COVERED')
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.writePayment).not.toHaveBeenCalled()
})
it('finishes local activation of a prepared target-omitting link but refuses expired coverage at the write gate', async () => {
  const f = await fixture({ autoGrant: true })
  f.proof.snapshot.grants = [{ currentEpoch: true, unexpiredAtObservation: true, grant: {}, slot: { grantee: id(8), scope_mask: '3' } }]
  f.interrupt('prepared-link'); await expect(f.run()).rejects.toThrow('interrupted')
  const link = structuredClone([...f.links.values()][0]); f.approveGas.mockClear()
  f.proof.snapshot.grants[0].unexpiredAtObservation = false
  const next = (await f.run())!, continuation = await f.continuation()
  expect(f.active()).toEqual(next); expect([...f.links.values()]).toEqual([link]); expect(f.approveGas).toHaveBeenCalledOnce()
  expect(f.rewrap).toHaveBeenCalledOnce(); expect(f.activate).toHaveBeenCalledOnce(); expect(f.writePayment).toHaveBeenCalledOnce()
  expect(() => continuation.assertAuthority(f.proof)).toThrow('ORIGINAL_AUTO_GRANT_NO_LONGER_COVERED')
  expect(f.signChain).not.toHaveBeenCalled()
})
it('refreshes grantee grant id and ownership epoch from current authority', async () => {
  const f = await fixture({ grant: true }); f.proof.snapshot.ownershipEpoch = '1'
  const next = (await f.run())!
  expect(parseContentAppendIntent(next)).toMatchObject({ grantId: id(71), ownershipEpoch: '1' })
})
it.each(['wallet', 'abort'])('stops a %s change during explicit gas approval before rewrap or storage mutation', async change => {
  const f = await fixture(); f.approveGas.mockImplementationOnce(async () => {
    if (change === 'wallet') f.setAddress(null); else f.controller.abort()
    return '700000'
  })
  await expect(f.run()).rejects.toThrow(); expect(f.rewrap).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.writePayment).not.toHaveBeenCalled()
})
it('captures call-time config, wallet, execution and approval callbacks before asynchronous work', async () => {
  const f = await fixture(), original = f.stageRead.getMockImplementation()!
  f.stageRead.mockImplementationOnce(async () => {
    f.params.config.kindRegistryId = id(999)
    f.params.wallet.getAddress = () => null; f.params.execution.getAddress = () => null
    f.params.approveGas = async () => { throw Error('late replacement') }
    return original()
  })
  const next = (await f.run())!
  expect(f.read.mock.calls[0][0]).toMatchObject({ config: { kindRegistryId: f.intent.kindRegistryId } })
  expect(f.approveGas).toHaveBeenCalledOnce(); expect(next.scope.versionIndex).toBe('3'); expect(f.signChain).not.toHaveBeenCalled()
})
async function ancestryFixture() {
  const f = await fixture(), second = await f.advance()
  f.links.set(fingerprint(f.previous), structuredClone(f.link)); f.links.set(fingerprint(f.next), structuredClone(second.link))
  f.payments.set(paymentKey(f.next), structuredClone(f.link.nextPayment)); f.payments.set(paymentKey(second.record), structuredClone(second.payment))
  f.setActive(second.record)
  return { ...f, second }
}
it('checks every retained ancestor plus a different locally known signed packet before continuation', async () => {
  const f = await ancestryFixture(), extra = await f.packet(3)
  f.payments.get(paymentKey(f.previous))!.certify = { ...extra, phase: 'SIGNED' }
  const continuation = await f.continuation(); await continuation.verify()
  expect(f.inspect.mock.calls.map(([args]) => [args.record.intent.operationScope, args.record.certify?.digest ?? null])).toEqual([
    [f.previousPayment.intent.operationScope, null], [f.previousPayment.intent.operationScope, extra.digest],
    [f.link.nextPayment.intent.operationScope, null],
  ])
  expect(f.signChain).not.toHaveBeenCalled(); expect(f.rewrap).not.toHaveBeenCalled(); expect(f.writePayment).not.toHaveBeenCalled()
})
it('still inspects stored ancestor packets when their local WAL keys are missing', async () => {
  const f = await ancestryFixture()
  f.payments.delete(paymentKey(f.previous)); f.payments.delete(paymentKey(f.next))
  const continuation = await f.continuation(); await continuation.verify()
  expect(f.inspect.mock.calls.map(([args]) => args.record.intent.operationScope)).toEqual([
    f.previousPayment.intent.operationScope, f.link.nextPayment.intent.operationScope,
  ])
})
it.each(['PENDING', 'RPC', 'COMPLETED'])('a known ancestor %s result blocks the descendant without signing or installing another stage', async status => {
  const f = await ancestryFixture(), original = f.inspect.getMockImplementation()!
  f.inspect.mockImplementation(async args => {
    if (args.record.intent.operationScope !== f.previousPayment.intent.operationScope) return original(args)
    if (status === 'COMPLETED') return { status: 'COMPLETED', record: args.record, result: { blobObjectId: id(100) } } as any
    throw Error(status === 'PENDING' ? 'TRANSACTION_PENDING' : 'RPC unknown')
  })
  const continuation = await f.continuation()
  if (status === 'COMPLETED') await expect(continuation.verify()).rejects.toBeInstanceOf(ContentAppendPredecessorCompleted)
  else await expect(continuation.verify()).rejects.toThrow(status === 'PENDING' ? 'TRANSACTION_PENDING' : 'RPC unknown')
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.writePayment).not.toHaveBeenCalled(); expect(f.signChain).not.toHaveBeenCalled()
})
it('does not discard a locally known ancestor packet whose paid root conflicts with the signed history', async () => {
  const f = await ancestryFixture(); f.payments.get(paymentKey(f.previous))!.approved!.quoteId = 'different quote'
  const continuation = await f.continuation()
  await expect(continuation.verify()).rejects.toThrow('LOCAL_HISTORY_ROOT_CHANGED')
  expect(f.inspect).not.toHaveBeenCalled(); expect(f.writePayment).not.toHaveBeenCalled()
})
it.each(['active', 'WAL', 'history', 'gas'])('rechecks %s at each continuation verification instead of trusting its creation-time snapshot', async changed => {
  const f = await ancestryFixture(), continuation = await f.continuation()
  if (changed === 'active') f.setActive(f.next)
  if (changed === 'WAL') f.payments.delete(paymentKey(f.second.record))
  if (changed === 'history') f.links.delete(fingerprint(f.previous))
  if (changed === 'gas') f.payments.get(paymentKey(f.second.record))!.approved!.gasBudget = '1800000'
  await expect(continuation.verify()).rejects.toThrow(changed === 'active' ? 'ACTIVE_ATTEMPT_CHANGED' : changed === 'WAL' ? 'PAID_WAL_MISSING'
    : changed === 'history' ? 'HISTORY_MISSING' : 'INSTALLED_PAYMENT_MISMATCH')
  expect(f.rewrap).not.toHaveBeenCalled(); expect(f.writePayment).not.toHaveBeenCalled(); expect(f.signChain).not.toHaveBeenCalled()
})
it('rechecks predecessor payment after rewrap and refuses a newly learned packet before committing the transition', async () => {
  const f = await fixture(), original = f.rewrap.getMockImplementation()!, packet = await f.packet(4)
  f.rewrap.mockImplementationOnce(async args => {
    const next = await original(args); f.payments.set(paymentKey(f.previous), { ...f.previousPayment, certify: { ...packet, phase: 'SIGNED' } }); return next
  })
  await expect(f.run()).rejects.toThrow('PREDECESSOR_PAYMENT_CHANGED')
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.writePayment).not.toHaveBeenCalled(); expect(f.activate).not.toHaveBeenCalled()
})
it('blocks wallet change after real encrypted rewrap without committing the late signature', async () => {
  const f = await fixture(), original = f.rewrap.getMockImplementation()!
  f.rewrap.mockImplementationOnce(async args => { const next = await original(args); f.setAddress(null); return next })
  await expect(f.run()).rejects.toThrow('WALLET_CHANGED')
  expect(f.rewrap).toHaveBeenCalledOnce(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.writePayment).not.toHaveBeenCalled()
})
it('refuses activation readback that still points to the predecessor', async () => {
  const f = await fixture(); f.activate.mockImplementationOnce(async () => {})
  await expect(f.run()).rejects.toThrow('ACTIVATION_READBACK_MISMATCH')
  expect(f.active()).toBe(f.previous); expect(f.links.size).toBe(1); expect(f.payments.size).toBe(2)
  await f.run(); expect(f.rewrap).toHaveBeenCalledOnce()
})
it.each(['version', 'grant'])('locally activates a stale pending %s then rejects its write gate and permits another explicit rebase', async changed => {
  const f = await fixture({ grant: changed === 'grant' }); f.interrupt('prepared-link')
  await expect(f.run()).rejects.toThrow('interrupted')
  if (changed === 'version') f.proof.snapshot.contentVersions.push({ kind: f.scope.kind, name: f.scope.name, versionIndex: '3' })
  else f.proof.snapshot.grants[0].unexpiredAtObservation = false
  const next = (await f.run())!
  expect(f.active()).toEqual(next); expect(f.rewrap).toHaveBeenCalledOnce(); expect(f.signChain).not.toHaveBeenCalled()
  expect(() => assertContentAppendAuthority(next, f.proof)).toThrow(changed === 'version' ? 'VERSION_CHANGED_QUERY_OR_REBASE' : 'CURRENT_GRANT_INVALID')
  f.params.record = next
  if (changed === 'grant') {
    await expect(f.run()).rejects.toThrow('CURRENT_GRANT_UNAVAILABLE')
    f.proof.snapshot.grants[0].unexpiredAtObservation = true; f.proof.snapshot.grants[0].slot.grant_id = id(72)
  }
  const latest = (await f.run())!
  expect(() => assertContentAppendAuthority(latest, f.proof)).not.toThrow()
  expect(parseContentAppendIntent(latest).rebase!.predecessor).toBe(fingerprint(next))
  expect(f.links.size).toBe(2); expect(f.rewrap).toHaveBeenCalledTimes(2)
  expect(f.payments.get(paymentKey(latest))!.register).toEqual(f.previousPayment.register); expect(f.signChain).not.toHaveBeenCalled()
})
it.each(['PENDING', 'COMPLETED'])('rechecks the pending link previous packet even when local WAL has another packet (%s)', async status => {
  const f = await fixture(), first = await f.packet(5), local = await f.packet(6)
  f.payments.get(paymentKey(f.previous))!.certify = { ...first, phase: 'SIGNED' }
  f.interrupt('prepared-link'); await expect(f.run()).rejects.toThrow('interrupted')
  f.payments.set(paymentKey(f.previous), { ...f.previousPayment, certify: { ...local, phase: 'SIGNED' } })
  const original = f.inspect.getMockImplementation()!; f.inspect.mockClear(); f.approveGas.mockClear()
  f.inspect.mockImplementation(async args => {
    if (args.record.certify?.digest !== first.digest) return original(args)
    if (status === 'PENDING') throw Error('TRANSACTION_PENDING')
    return { status: 'COMPLETED', record: args.record, result: { blobObjectId: id(100) } } as any
  })
  if (status === 'PENDING') await expect(f.run()).rejects.toThrow('TRANSACTION_PENDING')
  else await expect(f.run()).rejects.toBeInstanceOf(ContentAppendPredecessorCompleted)
  expect(f.inspect.mock.calls.map(([args]) => args.record.certify?.digest)).toEqual([local.digest, first.digest])
  expect(f.approveGas).not.toHaveBeenCalled(); expect(f.activate).not.toHaveBeenCalled(); expect(f.rewrap).toHaveBeenCalledOnce()
})
it('can explicitly rebase an activated omitted target after its grant expires by restoring the historical target', async () => {
  const f = await fixture({ autoGrant: true })
  f.proof.snapshot.grants = [{ currentEpoch: true, unexpiredAtObservation: true, grant: {}, slot: { grantee: id(8), scope_mask: '3' } }]
  const next = (await f.run())!
  expect(parseContentAppendIntent(next).autoGrantPlan).toBeNull()
  expect(parseContentAppendIntent(next).rebase).toMatchObject({ autoGrantTargets: [{ address: id(8), scopeMask: 1 }] })
  f.proof.snapshot.grants[0].unexpiredAtObservation = false; f.params.record = next
  const restored = (await f.run())!
  expect(parseContentAppendIntent(restored).autoGrantPlan?.targets).toEqual([{ address: id(8), scopeMask: 3 }])
  expect(parseContentAppendIntent(restored).rebase?.autoGrantTargets).toEqual(parseContentAppendIntent(next).rebase?.autoGrantTargets)
  expect(() => assertContentAppendAuthority(restored, f.proof)).not.toThrow()
  const continuation = await f.continuation(); expect(() => continuation.assertAuthority(f.proof)).not.toThrow()
  expect(f.payments.get(paymentKey(restored))!.register).toEqual(f.previousPayment.register)
})
