import { afterEach, expect, it, vi } from 'vitest'
import { toBase64 } from '@mysten/sui/utils'
import type { ChainEventDiscoveryOptions, ChainEventDiscoveryPage } from '../../packages/soulidity-sdk/src/chain-event-discovery'
import { createBrowserSoulActivity } from '../../web/lib/soulidity/browser-soul-activity'
import { readActivityCheckpointEvidence, readActivityTransactionEvidence } from '../../web/lib/soulidity/activity-transaction-evidence'
import { SOUL_ACTIVITY_FAMILIES, SoulActivityEventBcs, soulActivityEventType, type SoulActivityFamily } from '../../web/lib/soulidity/soul-activity-model'
import { activityEvidenceFixture, activityGenesis, adigest, aid } from './fixtures/activity-transaction-evidence'
import { browserSoulDetailFixture } from './fixtures/browser-soul-detail-fixture'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// Controlled canonical ledger, not Move execution or a validator certificate.
// Actual SDK bytes, all four hashes, checkpoint membership, package type origins,
// domain payload decoding and reduction run together through production readers.
async function fixture(wrapper = false) {
  const raw = await activityEvidenceFixture({ wrapper }), lifetime = new AbortController()
  const soul = aid(100), grantee = aid(101), grant = aid(102), replacement = aid(103), owner = raw.sender
  const rows: { family: SoulActivityFamily; payload: any }[] = [
    { family: 'SoulCreated', payload: { soul_id: soul, state_id: aid(104), content_id: aid(105), creator: owner, owner, provenance_kind: 3 } },
    { family: 'SoulGrantIssued', payload: { grant_id: grant, soul_id: soul, issued_by: owner, grantee, scope_mask: '15', expires_at_ms: null } },
    { family: 'SoulGrantSuperseded', payload: { old_grant_id: grant, new_grant_id: replacement, soul_id: soul, grantee, superseded_by: owner } },
    { family: 'SoulGrantIssued', payload: { grant_id: replacement, soul_id: soul, issued_by: owner, grantee, scope_mask: '7', expires_at_ms: null } },
    { family: 'SoulGrantRevoked', payload: { grant_id: replacement, soul_id: soul, grantee, revoked_by: owner } },
    { family: 'SoulGrantDestroyed', payload: { grant_id: replacement, soul_id: soul, grantee, destroyed_by: owner } },
  ]
  const header = raw.eventsData.data[1]
  const encodeRows = () => { raw.eventsData.data = rows.map(({ family, payload }) => {
    const [address, module, name] = soulActivityEventType(raw.deployment.originalPackageId, family).split('::')
    return { ...header, type_: { address, module, name, typeParams: [] }, contents: SoulActivityEventBcs[family].serialize(payload as never).toBytes() }
  }); raw.rehashEvents() }
  encodeRows()
  raw.packageData.data.Package!.typeOriginTable = SOUL_ACTIVITY_FAMILIES.map(family => {
    const [packageId, moduleName, datatypeName] = soulActivityEventType(raw.deployment.originalPackageId, family).split('::')
    return { moduleName, datatypeName, package: packageId }
  })
  raw.rehashPackage(); raw.rehashEvents()
  const config = browserSoulDetailFixture().config
  Object.assign(config.native, { soulidityOriginalPackageId: raw.deployment.originalPackageId,
    soulidityCallablePackageId: raw.deployment.callablePackageId, soulidityCallableDigest: raw.deployment.callableDigest })
  config.chainIdentifier = raw.deployment.chainIdentifier; config.discoveryEndpoint = 'https://activity.example/graphql'
  const page = (family: SoulActivityFamily): ChainEventDiscoveryPage => ({
    source: { endpoint: config.discoveryEndpoint!, chainIdentifier: raw.deployment.chainIdentifier, checkpoint: 100,
      scope: { packageId: raw.deployment.originalPackageId, type: soulActivityEventType(raw.deployment.originalPackageId, family) }, authority: 'CANDIDATE_EVENTS_ONLY' },
    events: rows.flatMap((row, eventSequence) => row.family === family ? [{ transactionDigest: raw.ledger.digest,
      eventSequence, type: soulActivityEventType(raw.deployment.originalPackageId, family) }] : []),
    page: { status: 'COMPLETE', hasNextPage: false, endCursor: null, pagesRead: 1, eventsRead: rows.filter(row => row.family === family).length },
  })
  const nexts: ReturnType<typeof vi.fn<() => Promise<ChainEventDiscoveryPage>>>[] = []
  const discovery = vi.fn((options: ChainEventDiscoveryOptions) => {
    const family = SOUL_ACTIVITY_FAMILIES.find(f => soulActivityEventType(raw.deployment.originalPackageId, f) === options.scope.type)!
    const next = vi.fn(async () => page(family)); nexts.push(next)
    return { next }
  })
  const transaction = vi.fn(readActivityTransactionEvidence), checkpoint = vi.fn(readActivityCheckpointEvidence)
  const params = { viewerAddress: owner, config, signal: lifetime.signal }
  const dependencies = { client: () => raw.client as any, discovery, transaction, checkpoint }
  const scan = (limits?: Parameters<typeof createBrowserSoulActivity>[0]['limits']) => createBrowserSoulActivity({ ...params, limits }, dependencies)
  return { raw, lifetime, soul, grantee, grant, replacement, rows, encodeRows, config, page, nexts, discovery, transaction, checkpoint, params, dependencies, scan }
}

it.each([false, true])('connects canonical history to full nine-family grant activity (wrapper=%s)', async wrapper => {
  const f = await fixture(wrapper), scan = f.scan()
  let result = await scan.next()
  expect(result.activity.status).toBe('PARTIAL')
  for (let i = 1; i < SOUL_ACTIVITY_FAMILIES.length; i++) result = await scan.next()
  expect(result).toMatchObject({ pages: 9, verifiedTransactions: 1, verifiedCandidateEvents: 6, notAuthorization: true,
    activity: { status: 'COMPLETE', checkpoint: '100', historyAuthority: 'TYPE_ORIGIN_VERIFIED_HISTORY' } })
  expect(result.activity.grants.map(g => [g.onChainId, g.status])).toEqual([[f.replacement, 'revoked'], [f.grant, 'superseded']])
  expect(result.activity.grants[0]).toMatchObject({ ownershipEpochSnapshot: '0', destroyedAtMs: f.raw.summaryData.timestamp_ms })
  expect(result.activity.grants[1].replacedByGrantOnChainId).toBe(f.replacement)
  expect(f.transaction).toHaveBeenCalledTimes(1); expect(f.checkpoint).toHaveBeenCalledTimes(1)
  expect(f.discovery.mock.calls.slice(1).every(([options]) => options.checkpoint === 100)).toBe(true)
  expect(f.discovery.mock.calls.every(([options]) => !('sender' in options.scope))).toBe(true)
  expect(Object.isFrozen(result.activity.grants[0].scopes)).toBe(true)
  await expect(scan.next()).rejects.toThrow('SCAN_ENDED')
})
it('connects the actual GraphQL candidate discovery to canonical evidence and reducer', async () => {
  const f = await fixture(true)
  const fetch = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
    const request = JSON.parse(String(init?.body)), type = request.variables.filter.type
    const family = SOUL_ACTIVITY_FAMILIES.find(value => soulActivityEventType(f.raw.deployment.originalPackageId, value) === type)!
    const page = f.page(family)
    return new Response(JSON.stringify({ data: { chainIdentifier: activityGenesis, checkpoint: {
      sequenceNumber: 100, query: { events: { nodes: page.events.map(e => ({ sequenceNumber: e.eventSequence,
        transaction: { digest: e.transactionDigest }, contents: { type: { repr: e.type } } })),
      pageInfo: { hasNextPage: false, endCursor: page.events.length ? 'terminal' : null } } } } } }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  const scan = createBrowserSoulActivity(f.params, { client: f.dependencies.client })
  let result = await scan.next()
  for (let i = 1; i < 9; i++) result = await scan.next()
  expect(result.activity.status).toBe('COMPLETE'); expect(result.activity.grants).toHaveLength(2)
  expect(fetch).toHaveBeenCalledTimes(9)
})
it('reuses an accepted terminal candidate page when checkpoint verification fails', async () => {
  const f = await fixture(); f.checkpoint.mockRejectedValueOnce(new Error('checkpoint offline'))
  const scan = f.scan(); await expect(scan.next()).rejects.toThrow('checkpoint offline')
  expect((await scan.next()).verifiedTransactions).toBe(1)
  expect(f.nexts[0]).toHaveBeenCalledTimes(1); expect(f.checkpoint).toHaveBeenCalledTimes(2)
})
it('connects ordinary additive and native gross purchase history through actual raw proof', async () => {
  const f = await fixture(), buyer = f.raw.sender, seller = aid(200)
  f.rows.splice(0)
  for (const [soul, native] of [[aid(201), false], [aid(202), true]] as const) {
    f.rows.push({ family: 'SoulCreated', payload: { soul_id: soul, state_id: aid(native ? 211 : 210), content_id: aid(native ? 221 : 220),
      creator: seller, owner: seller, provenance_kind: native ? 3 : 1 } },
    { family: 'SoulOwnershipRotated', payload: { soul_id: soul, previous_owner: seller, new_owner: buyer, ownership_epoch: '1' } },
    native ? { family: 'AnimacraftV8SoulPurchased', payload: { listing_id: aid(230), soul_id: soul, seller, buyer, provenance_id: aid(231),
      maker_source_recipient: aid(232), price: '10001', protocol_fee: '250', soul_creator_royalty_bps: 100, soul_creator_royalty: '100',
      maker_source_royalty_bps: 300, maker_source_royalty: '300', seller_payout: '9351' } } :
      { family: 'SoulPurchased', payload: { listing_id: aid(240), soul_id: soul, seller, buyer, price: '1', platform_fee: '1', creator_royalty: '1', collection_royalty: '1' } })
  }
  f.encodeRows()
  const scan = f.scan(); let result = await scan.next()
  for (let i = 1; i < 9; i++) result = await scan.next()
  expect(result.activity.purchases.map(row => [row.model, row.paidAtomic, row.totalAtomic])).toEqual([
    ['GROSS_INCLUSIVE', '10001', '10001'], ['BASE_PLUS_FEES', '1', '4']])
  expect(result.verifiedCandidateEvents).toBe(6); expect(f.transaction).toHaveBeenCalledTimes(1)
})
it('retries raw proof failure without advancing a terminal cursor or retaining half a page', async () => {
  const f = await fixture(); f.transaction.mockRejectedValueOnce(new Error('raw unavailable'))
  const scan = f.scan(); await expect(scan.next()).rejects.toThrow('raw unavailable')
  const result = await scan.next()
  expect(result.pages).toBe(1); expect(result.verifiedTransactions).toBe(1); expect(f.nexts[0]).toHaveBeenCalledTimes(1)
})
it('retains a reducer-rejected page and does not count its proof cache until repaired', async () => {
  const f = await fixture(), good = await readActivityTransactionEvidence(f.raw.params())
  f.transaction.mockResolvedValueOnce({ ...good, events: good.events.map((e, i) => i === 1 ? { ...e, contentsBytes: 'AA==' } : e) })
  const scan = f.scan(); await expect(scan.next()).rejects.toThrow()
  const result = await scan.next(); expect(result.pages).toBe(1); expect(result.verifiedTransactions).toBe(1)
  expect(f.nexts[0]).toHaveBeenCalledTimes(1); expect(f.transaction).toHaveBeenCalledTimes(2)
})
it('keeps partial pages in the same family before moving to the next checkpoint-pinned family', async () => {
  const f = await fixture(), original = f.discovery.getMockImplementation()!
  f.discovery.mockImplementationOnce(options => {
    const scan = original(options), page = f.page('SoulCreated')
    scan.next.mockResolvedValueOnce({ ...page, page: { ...page.page, status: 'PARTIAL', hasNextPage: true, endCursor: 'next' } })
      .mockResolvedValueOnce({ ...page, events: [], page: { ...page.page, pagesRead: 2 } })
    return scan
  })
  const scan = f.scan(), first = await scan.next(), second = await scan.next()
  expect(first.activity.coverage.SoulCreated).toBe('PARTIAL'); expect(second.currentFamily).toBe('SoulCreated')
  expect(second.activity.coverage.SoulCreated).toBe('COMPLETE'); expect(second.pages).toBe(2)
  expect((await scan.next()).currentFamily).toBe('SoulOwnershipRotated')
  expect(f.discovery).toHaveBeenCalledTimes(2); expect(f.transaction).toHaveBeenCalledTimes(1)
})
it('does not commit any of four workers after one fails, and ignores a late old rejection after retry', async () => {
  const f = await fixture(), good = await readActivityTransactionEvidence(f.raw.params()), original = f.discovery.getMockImplementation()!
  const proofs = Array.from({ length: 4 }, (_, i) => ({ ...good, transactionDigest: adigest(50 + i), transactionIndex: i,
    events: [{ ...good.events[0], contentsBytes: toBase64(SoulActivityEventBcs.SoulCreated.serialize({ ...f.rows[0].payload,
      soul_id: aid(300 + i), state_id: aid(310 + i), content_id: aid(320 + i) }).toBytes()) }] }))
  f.discovery.mockImplementationOnce(options => {
    const scan = original(options), page = f.page('SoulCreated')
    scan.next.mockResolvedValue({ ...page, events: proofs.map(tx => ({ transactionDigest: tx.transactionDigest, eventSequence: 0, type: tx.events[0].type })) })
    return scan
  })
  let fail!: (reason: Error) => void, failLate!: (reason: Error) => void
  f.transaction.mockImplementation(({ transactionDigest }) => Promise.resolve(proofs.find(p => p.transactionDigest === transactionDigest)!))
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { failLate = reject }))
  const scan = f.scan(), waiting = scan.next(), rejected = expect(waiting).rejects.toThrow('worker offline')
  await vi.waitFor(() => expect(f.transaction).toHaveBeenCalledTimes(4))
  fail(new Error('worker offline')); await rejected
  const result = await scan.next(); expect(result).toMatchObject({ pages: 1, verifiedTransactions: 4, verifiedCandidateEvents: 4 })
  expect(f.transaction).toHaveBeenCalledTimes(8); expect(f.nexts[0]).toHaveBeenCalledTimes(1)
  failLate(new Error('old read failed late')); await Promise.resolve()
  expect((await scan.next()).retainedEvidenceBytes).toBe(result.retainedEvidenceBytes)
})
it('validates each candidate event position even for a transaction cached by an earlier family', async () => {
  const f = await fixture(), original = f.discovery.getMockImplementation()!
  f.discovery.mockImplementation(options => {
    const scan = original(options)
    if (options.scope.type.endsWith('::SoulGrantIssued')) scan.next.mockResolvedValue({ ...f.page('SoulGrantIssued'),
      events: [{ transactionDigest: f.raw.ledger.digest, eventSequence: 2, type: options.scope.type }] })
    return scan
  })
  const scan = f.scan(); await scan.next(); await scan.next()
  await expect(scan.next()).rejects.toThrow('CANDIDATE_NOT_PROVEN')
  f.nexts[2].mockResolvedValue(f.page('SoulGrantIssued'))
  // Repeating retains the rejected page; it cannot silently skip or replace it.
  await expect(scan.next()).rejects.toThrow('CANDIDATE_NOT_PROVEN')
  expect(f.transaction).toHaveBeenCalledTimes(1); expect(f.nexts[2]).toHaveBeenCalledTimes(1)
})
it.each(['chainIdentifier', 'checkpoint', 'type'] as const)('rejects changed candidate %s between families', async field => {
  const f = await fixture(), original = f.discovery.getMockImplementation()!
  f.discovery.mockImplementation(options => {
    const scan = original(options)
    if (options.scope.type.endsWith('::SoulOwnershipRotated')) {
      const page = structuredClone(f.page('SoulOwnershipRotated'))
      scan.next.mockResolvedValue({ ...page, source: { ...page.source,
        ...(field === 'chainIdentifier' ? { chainIdentifier: '00000001' } : field === 'checkpoint' ? { checkpoint: 101 } :
          { scope: { ...page.source.scope, type: soulActivityEventType(f.raw.deployment.originalPackageId, 'SoulCreated') } }) } })
    }
    return scan
  })
  const scan = f.scan(); await scan.next(); await expect(scan.next()).rejects.toThrow(/CANDIDATE_SCOPE_MISMATCH|CHECKPOINT_CHANGED/)
})
it('reports a proof-cache byte limit without claiming an empty completed history', async () => {
  const f = await fixture(), scan = f.scan({ maxEvidenceBytes: 1 }), result = await scan.next()
  expect(result).toMatchObject({ verifiedTransactions: 0, pages: 0, retainedEvidenceBytes: 0, limitReason: 'EVIDENCE_BYTES_LIMIT',
    activity: { status: 'LIMIT_REACHED', coverage: { SoulCreated: 'LIMIT_REACHED' } } })
  await expect(scan.next()).rejects.toThrow('SCAN_ENDED')
})
it('reports a transaction limit before dispatching any over-budget reads', async () => {
  const f = await fixture(), original = f.discovery.getMockImplementation()!
  f.discovery.mockImplementation(options => {
    const scan = original(options), page = f.page('SoulCreated')
    scan.next.mockResolvedValue({ ...page, events: [...page.events, { ...page.events[0], transactionDigest: 'other' }] }); return scan
  })
  expect((await f.scan({ maxTransactions: 1 }).next()).limitReason).toBe('TRANSACTION_LIMIT')
  expect(f.transaction).not.toHaveBeenCalled()
})
it('retains explicit discovery-limit coverage and verified rows without completing subsequent families', async () => {
  const f = await fixture(), original = f.discovery.getMockImplementation()!
  f.discovery.mockImplementation(options => {
    const scan = original(options), page = f.page('SoulCreated')
    scan.next.mockResolvedValue({ ...page, page: { ...page.page, status: 'LIMIT_REACHED', hasNextPage: true, endCursor: 'limit' } }); return scan
  })
  const scan = f.scan(), result = await scan.next()
  expect(result).toMatchObject({ limitReason: 'DISCOVERY_LIMIT', verifiedTransactions: 1, activity: { status: 'LIMIT_REACHED' } })
  expect(result.activity.coverage.SoulGrantIssued).toBe('UNSCANNED')
  await expect(scan.next()).rejects.toThrow('SCAN_ENDED')
})
it('snapshots wallet and release configuration before asynchronous discovery', async () => {
  const f = await fixture(), scan = f.scan()
  f.params.viewerAddress = aid(999); f.config.native.soulidityOriginalPackageId = aid(999); f.config.chainIdentifier = 'ffffffff'
  const result = await scan.next()
  expect(result.activity.viewerAddress).toBe(f.raw.sender)
  expect(result.activity.deployment).toEqual(f.raw.deployment)
})
it('rejects concurrent reads and cancels an old lifetime permanently', async () => {
  const f = await fixture(); f.transaction.mockImplementationOnce(() => new Promise(() => {}))
  const scan = f.scan(), waiting = scan.next(), rejected = expect(waiting).rejects.toThrow('identity replaced')
  await vi.waitFor(() => expect(f.transaction).toHaveBeenCalledTimes(1))
  await expect(scan.next()).rejects.toThrow('BUSY')
  f.lifetime.abort(new Error('identity replaced')); await rejected
  await expect(scan.next()).rejects.toThrow('identity replaced')
})
it.each(['transaction', 'checkpoint', 'candidate'] as const)('releases BUSY on cancellation even when %s ignores abort', async reader => {
  const f = await fixture(), caller = new AbortController()
  let finish!: (value: ChainEventDiscoveryPage) => void
  if (reader === 'transaction') f.transaction.mockImplementationOnce(() => new Promise(() => {}))
  else if (reader === 'checkpoint') f.checkpoint.mockImplementationOnce(() => new Promise(() => {}))
  else f.discovery.mockImplementationOnce(() => {
    const next = vi.fn(() => new Promise<ChainEventDiscoveryPage>(resolve => { finish = resolve })); f.nexts.push(next); return { next }
  })
  const scan = f.scan(), waiting = scan.next({ signal: caller.signal }), rejected = expect(waiting).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(reader === 'transaction' ? f.transaction.mock.calls.length : reader === 'checkpoint' ? f.checkpoint.mock.calls.length : typeof finish === 'function' ? 1 : 0).toBe(1))
  caller.abort(new Error('cancelled')); await rejected
  const retry = scan.next(); if (reader === 'candidate') finish(f.page('SoulCreated'))
  expect((await retry).pages).toBe(1); expect(f.nexts[0]).toHaveBeenCalledTimes(1)
})
it('latches an accepted terminal candidate page when abort wins the cursor handoff', async () => {
  const f = await fixture(), caller = new AbortController()
  const next = vi.fn(async () => { caller.abort(new Error('handoff')); return f.page('SoulCreated') })
  f.discovery.mockImplementationOnce(() => ({ next }))
  const scan = f.scan(); await expect(scan.next({ signal: caller.signal })).rejects.toThrow('handoff')
  expect((await scan.next()).pages).toBe(1); expect(next).toHaveBeenCalledTimes(1)
})
it('bounds a whole page deadline when a proof transport ignores cancellation and allows a retry', async () => {
  const f = await fixture(), deadline = new AbortController(), realTimeout = AbortSignal.timeout.bind(AbortSignal)
  let pageTimeoutCalls = 0
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 120000 && pageTimeoutCalls++ === 0 ? deadline.signal : realTimeout(ms))
  f.transaction.mockImplementationOnce(() => new Promise(() => {}))
  const scan = f.scan(), waiting = scan.next(), rejected = expect(waiting).rejects.toThrow('deadline')
  await vi.waitFor(() => expect(f.transaction).toHaveBeenCalledTimes(1))
  deadline.abort(new Error('deadline')); await rejected
  expect((await scan.next()).pages).toBe(1); expect(f.nexts[0]).toHaveBeenCalledTimes(1)
})
it('rejects raw event tampering through the actual evidence reader, without cursor advance', async () => {
  const f = await fixture(); f.raw.ledger.events.bcs.value[10] ^= 1
  const scan = f.scan(); await expect(scan.next()).rejects.toThrow()
  f.raw.rehashEvents()
  expect((await scan.next()).verifiedTransactions).toBe(1); expect(f.nexts[0]).toHaveBeenCalledTimes(1)
})
it.each([{ pageSize: 0 }, { maxTransactions: 10001 }, { maxEvidenceBytes: 64 * 1024 * 1024 + 1 }])('rejects invalid resource limits %j', async limits => {
  const f = await fixture(); expect(() => f.scan(limits)).toThrow('LIMIT_INVALID')
})
