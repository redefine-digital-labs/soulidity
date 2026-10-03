import { afterEach, describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { readActivityCheckpointEvidence, readActivityTransactionEvidence } from '../../web/lib/soulidity/activity-transaction-evidence'
import { activityEvidenceFixture, aid, adigest, activityHash, capturedActivityCheckpoint, ActivityFixtureEventsBcs } from './fixtures/activity-transaction-evidence'

afterEach(() => vi.useRealTimers())
describe('controlled canonical transaction/event/checkpoint history', () => {
  it.each([[1, 1], [1, 2], [2, 1], [2, 2]] as const)('binds effects V%i and checkpoint contents V%i without a signed WAL or current ownership', async (effectsVersion, contentsVersion) => {
    const f = await activityEvidenceFixture({ effectsVersion, contentsVersion })
    const out = await readActivityTransactionEvidence(f.params())
    expect(out).toMatchObject({ deployment: f.deployment, transactionDigest: f.ledger.digest, sender: f.sender,
      checkpoint: '100', checkpointTimestampMs: '1789464703686', epoch: '5', transactionIndex: 1,
      transactionBytes: f.originalTransactionBytes, effectsBytes: toBase64(f.ledger.effects.bcs.value),
      trust: 'TRUSTED_LEDGER_CANONICAL_EVIDENCE', notAuthorization: true,
      eventAuthority: 'TYPE_ORIGIN_VERIFIED_HISTORY', executionPackageVersion: 'NOT_ATTESTED' })
    expect(out.events.map(e => e.eventSequence)).toEqual([0, 1, 2, 3])
    expect(out.events[0]).toMatchObject({ type: `${aid(42)}::soul::SoulOwnershipRotated`, transactionModule: 'market', packageId: aid(43) })
    expect(out.events[3]).toMatchObject({ type: `${aid(90)}::pool::Swap<vector<u64>>`, transactionModule: 'pool', packageId: aid(90) })
    expect(f.client.ledgerService.getObject).toHaveBeenCalledTimes(1)
    expect(f.client.ledgerService.getObject.mock.calls[0][0]).toMatchObject({ objectId: aid(43) })
    expect(f.client.ledgerService.getCheckpoint.mock.calls[0][0]).toMatchObject({ checkpointId: { oneofKind: 'sequenceNumber', sequenceNumber: 100n } })
    expect(Object.isFrozen(out)).toBe(true); expect(Object.isFrozen(out.deployment)).toBe(true)
    expect(Object.isFrozen(out.events)).toBe(true); expect(Object.isFrozen(out.events[0])).toBe(true)
  })
  it('retains permissionless third-party wrappers rather than treating header as actual emitting package', async () => {
    const f = await activityEvidenceFixture({ wrapper: true })
    const out = await readActivityTransactionEvidence(f.params())
    expect(out.events[1]).toMatchObject({ type: `${aid(42)}::grant::SoulGrantIssued`, packageId: aid(90), transactionModule: 'wrapper' })
    expect(out.eventAuthority).toBe('TYPE_ORIGIN_VERIFIED_HISTORY')
    expect(out.executionPackageVersion).toBe('NOT_ATTESTED')
  })
  it('retains unrelated Publish init events alongside a selected Soul operation', async () => {
    const f = await activityEvidenceFixture()
    f.transactionData.V1.kind.ProgrammableTransaction!.commands.push({ Publish: { modules: [toBase64(new Uint8Array([1]))], dependencies: [aid(2)] }, $kind: 'Publish' })
    f.eventsData.data[3] = { package_id: aid(91), transaction_module: 'initializer', sender: f.sender,
      type_: { address: aid(91), module: 'initializer', name: 'Created', typeParams: [] }, contents: new Uint8Array([9]) }
    f.rehashTransaction()
    const out = await readActivityTransactionEvidence(f.params())
    expect(out.events).toHaveLength(4)
    expect(out.events[3]).toMatchObject({ packageId: aid(91), transactionModule: 'initializer', type: `${aid(91)}::initializer::Created` })
  })
  it('retains selected type-origin history emitted by Publish init with no MoveCall command', async () => {
    const f = await activityEvidenceFixture(), tx = new Transaction()
    tx.setSender(f.sender); tx.setGasOwner(f.sender); tx.setGasPrice(1); tx.setGasBudget(1000)
    tx.setGasPayment([{ objectId: aid(8), version: '2', digest: adigest(8) }])
    // Actual SDK Publish encoding; controlled ledger, not a Move VM execution.
    tx.publish({ modules: [toBase64(new Uint8Array([1]))], dependencies: [f.deployment.callablePackageId] })
    f.transactionData.V1.kind = bcs.TransactionData.parse(await tx.build()).V1.kind
    f.eventsData.data = [f.eventsData.data[1]]
    f.eventsData.data[0].package_id = aid(91); f.eventsData.data[0].transaction_module = 'initializer'
    f.rehashTransaction()
    const out = await readActivityTransactionEvidence(f.params())
    expect(out.events[0]).toMatchObject({ type: `${aid(42)}::grant::SoulGrantIssued`, packageId: aid(91), transactionModule: 'initializer' })
    expect(out.executionPackageVersion).toBe('NOT_ATTESTED')
  })
  it('does not require final grant output objects or deduplicate different events in the same PTB', async () => {
    const f = await activityEvidenceFixture()
    f.eventsData.data.push(structuredClone(f.eventsData.data[1])); f.rehashEvents()
    expect(f.effectsData.V2!.changedObjects).toEqual([])
    const out = await readActivityTransactionEvidence(f.params())
    expect(out.events).toHaveLength(5); expect(out.events[4].eventSequence).toBe(4)
  })
  it('proves success without events only when effects commit to no events', async () => {
    const f = await activityEvidenceFixture({ empty: true })
    expect((await readActivityTransactionEvidence(f.params())).events).toEqual([])
    f.ledger.events = { bcs: { value: new Uint8Array([0]) }, digest: activityHash('TransactionEvents', new Uint8Array([0])) }
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'EVIDENCE_MISMATCH' })
  })
  it('returns detached data even if callers later mutate all RPC projections', async () => {
    const f = await activityEvidenceFixture(), out = await readActivityTransactionEvidence(f.params())
    const expected = structuredClone(out)
    f.ledger.transaction.bcs.value.fill(0); f.ledger.events.bcs.value.fill(0); f.pkg.bcs.value.fill(0)
    f.deployment.originalPackageId = aid(999); f.checkpoint.summary.timestamp.seconds = 0n
    expect(out).toEqual(expected)
  })
  it('captures immutable release parameters before awaiting the service', async () => {
    const f = await activityEvidenceFixture(), expected = structuredClone(f.deployment)
    const params = f.params()
    f.client.ledgerService.getServiceInfo.mockImplementationOnce(async () => {
      f.deployment.callablePackageId = aid(999); f.deployment.callableDigest = adigest(99); params.transactionDigest = adigest(90)
      return { response: { chainId: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S' } }
    })
    const out = await readActivityTransactionEvidence(params)
    expect(out.deployment).toEqual(expected); expect(out.transactionDigest).toBe(f.ledger.digest)
  })
})

describe('checkpoint membership and exact as-of time', () => {
  it('independently decodes captured mainnet Contents V2 and summary wire bytes', async () => {
    const f = await activityEvidenceFixture()
    f.client.ledgerService.getCheckpoint.mockResolvedValue({ response: { checkpoint: capturedActivityCheckpoint() } })
    const out = await readActivityCheckpointEvidence({ ...f.checkpointParams(), checkpoint: '322877185' })
    expect(out).toMatchObject({ checkpoint: '322877185', epoch: '1251', timestampMs: '1789464703463',
      digest: 'FLF59G7m5G9hHhx9iqhVKkQyCg4eS7Yp9XqQWuxY5dco', chainIdentifier: '35834a8a' })
    expect(out.transactions).toHaveLength(14)
  })
  it('can read an as-of checkpoint with no activity transaction and preserves u64 precision', async () => {
    const f = await activityEvidenceFixture()
    f.summaryData.sequence_number = '9007199254740993'; f.summaryData.timestamp_ms = '9007199254740997'; f.summaryData.epoch = '9007199254740995'
    f.rehashSummary()
    const out = await readActivityCheckpointEvidence(f.checkpointParams())
    expect(out).toMatchObject({ chainIdentifier: '35834a8a', checkpoint: '9007199254740993', timestampMs: '9007199254740997', epoch: '9007199254740995',
      trust: 'TRUSTED_LEDGER_CANONICAL_EVIDENCE', notAuthorization: true })
    expect(out.transactions).toHaveLength(2); expect(Object.isFrozen(out.transactions[0])).toBe(true)
    expect(f.client.ledgerService.getTransaction).not.toHaveBeenCalled(); expect(f.client.ledgerService.getObject).not.toHaveBeenCalled()
  })
  it('accepts an empty canonical checkpoint instead of inventing a date from the latest transaction', async () => {
    const f = await activityEvidenceFixture(); f.contentsData.V2!.transactions = []; f.rehashContents()
    expect((await readActivityCheckpointEvidence(f.checkpointParams())).transactions).toEqual([])
  })
  it.each(['absent', 'wrong-effects', 'duplicate'] as const)('rejects rehashed %s checkpoint membership', async issue => {
    const f = await activityEvidenceFixture(), entries = f.contentsData.V2!.transactions
    if (issue === 'absent') entries[1].digest.transaction = adigest(99)
    if (issue === 'wrong-effects') entries[1].digest.effects = adigest(99)
    if (issue === 'duplicate') entries.push(structuredClone(entries[1]))
    f.rehashContents()
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'EVIDENCE_MISMATCH' })
  })
  it.each(['epoch', 'timestamp', 'count', 'previous'] as const)('rejects rehashed contradictory summary %s', async field => {
    const f = await activityEvidenceFixture()
    if (field === 'epoch') f.summaryData.epoch = '6'
    if (field === 'timestamp') f.summaryData.timestamp_ms = '1789464703687'
    if (field === 'count') f.summaryData.network_total_transactions = '1'
    if (field === 'previous') f.summaryData.previous_digest = null
    f.rehashSummary()
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'EVIDENCE_MISMATCH' })
  })
  it('rejects a rehashed V1 signature vector count mismatch', async () => {
    const f = await activityEvidenceFixture({ contentsVersion: 1 }); f.contentsData.V1!.user_signatures.pop(); f.rehashContents()
    await expect(readActivityCheckpointEvidence(f.checkpointParams())).rejects.toMatchObject({ code: 'EVIDENCE_MISMATCH' })
  })
  it('does not treat an unverified signature as a quorum certificate or signature authorization', async () => {
    const f = await activityEvidenceFixture()
    f.checkpoint.signature = { epoch: 999n, signature: new Uint8Array([1]) }
    const out = await readActivityCheckpointEvidence(f.checkpointParams())
    expect(out.trust).toBe('TRUSTED_LEDGER_CANONICAL_EVIDENCE'); expect(out.notAuthorization).toBe(true)
    expect(out).not.toHaveProperty('signature'); expect(out).not.toHaveProperty('quorumVerified')
  })
})

describe('rehashed event/type-origin forgeries', () => {
  it.each(['0', '18446744073709551615'])('accepts canonical linkage u64 %s without attesting VM linking', async version => {
    const f = await activityEvidenceFixture()
    f.packageData.data.Package!.linkageTable.set(aid(1), { upgradedId: aid(1), upgradedVersion: version })
    f.rehashPackage(); delete f.pkg.package
    const out = await readActivityTransactionEvidence(f.params())
    expect(out.executionPackageVersion).toBe('NOT_ATTESTED')
    expect(out.events).toHaveLength(4)
  })
  it.each(['original', 'upgraded'])('rejects invalid linkage %s ID despite a recomputed package digest', async field => {
    const f = await activityEvidenceFixture()
    f.packageData.data.Package!.linkageTable.set(field === 'original' ? aid(0) : aid(1),
      { upgradedId: field === 'upgraded' ? aid(0) : aid(1), upgradedVersion: '0' })
    f.rehashPackage(); delete f.pkg.package
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'BCS_INVALID' })
  })
  it.each(['package', 'scalars', 'storageId', 'originalId', 'version'] as const)
    ('accepts omitted redundant package projection %s using canonical full Object evidence', async field => {
      const f = await activityEvidenceFixture()
      if (field === 'package') delete f.pkg.package
      else if (field === 'scalars') f.pkg.package = { modules: [], typeOrigins: [], linkage: [] }
      else delete f.pkg.package[field]
      const out = await readActivityTransactionEvidence(f.params())
      expect(out.events).toHaveLength(4)
      expect(out.eventAuthority).toBe('TYPE_ORIGIN_VERIFIED_HISTORY')
    })
  it.each(['sender', 'unknown-type', 'module-identifier', 'name-identifier', 'nested-identifier'] as const)
    ('rejects %s despite consistent events/effects/contents/summary hashes', async field => {
      const f = await activityEvidenceFixture(), event = f.eventsData.data[1]
      if (field === 'sender') event.sender = aid(99)
      if (field === 'unknown-type') event.type_.name = 'UnknownGrantEvent'
      if (field === 'module-identifier') event.type_.module = '_'
      if (field === 'name-identifier') event.type_.name = 'Issued::Fake'
      if (field === 'nested-identifier') event.type_.typeParams = [{ struct: { address: aid(2), module: '_', name: 'Fake', typeParams: [] } }]
      f.rehashEvents()
      await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: ['module-identifier', 'name-identifier', 'nested-identifier'].includes(field) ? 'BCS_INVALID' : 'EVIDENCE_MISMATCH' })
    })
  it.each(['package', 'module'] as const)('rejects uncommitted header %s tampering but does not call fully re-committed trusted history a cryptographic forgery', async field => {
    const f = await activityEvidenceFixture(), event = f.eventsData.data[1]
    if (field === 'package') event.package_id = aid(99)
    else event.transaction_module = 'initializer'
    f.ledger.events.bcs.value = ActivityFixtureEventsBcs.serialize(f.eventsData).toBytes()
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'EVIDENCE_MISMATCH' })
    // The trusted ledger boundary is explicit: changing every committed layer
    // is not independently disproven without checkpoint quorum verification.
    f.rehashEvents()
    const out = await readActivityTransactionEvidence(f.params())
    expect(out.executionPackageVersion).toBe('NOT_ATTESTED')
  })
  it.each(['origin', 'duplicate-origin', 'missing-origin', 'immutable', 'id', 'version', 'module-identifier'] as const)
    ('rejects %s even when configured package digest is recomputed and redundant package projection is absent', async field => {
      const f = await activityEvidenceFixture(), pkg = f.packageData.data.Package!
      if (field === 'origin') pkg.typeOriginTable[0].package = aid(99)
      if (field === 'duplicate-origin') pkg.typeOriginTable.push(structuredClone(pkg.typeOriginTable[0]))
      if (field === 'missing-origin') pkg.typeOriginTable.shift()
      if (field === 'immutable') f.packageData.owner = { AddressOwner: aid(99), $kind: 'AddressOwner' }
      if (field === 'id') pkg.id = aid(99)
      if (field === 'version') pkg.version = '0'
      if (field === 'module-identifier') pkg.moduleMap.set('_', new Uint8Array([1]))
      f.rehashPackage()
      delete f.pkg.package
      await expect(readActivityTransactionEvidence(f.params())).rejects.toThrow()
    })
  it('does not claim unrelated same-name events belong to the selected release', async () => {
    const f = await activityEvidenceFixture()
    f.eventsData.data[1].type_.address = aid(99); f.rehashEvents()
    const out = await readActivityTransactionEvidence(f.params())
    expect(out.events[1].type).toBe(`${aid(99)}::grant::SoulGrantIssued`)
    expect(out.deployment.originalPackageId).toBe(aid(42))
  })
  it('accepts SDK canonical map byte order, which differs from lexical module-name order', async () => {
    const f = await activityEvidenceFixture()
    expect([...f.packageData.data.Package!.moduleMap.keys()]).toEqual(['soul', 'grant', 'market'])
    f.packageData.data.Package!.moduleMap = new Map([...f.packageData.data.Package!.moduleMap].reverse())
    f.rehashPackage()
    expect((await readActivityTransactionEvidence(f.params())).events).toHaveLength(4)
  })
  it('rejects a changed canonical transaction digest rather than accepting its JSON sender', async () => {
    const f = await activityEvidenceFixture()
    f.transactionData.V1.sender = aid(99)
    f.ledger.transaction.bcs.value = bcs.TransactionData.serialize(f.transactionData).toBytes()
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'EVIDENCE_MISMATCH' })
  })
  it('rejects invalid rehashed MoveCall identifier context', async () => {
    const f = await activityEvidenceFixture(); f.transactionData.V1.kind.ProgrammableTransaction!.commands[0].MoveCall!.module = '_'; f.rehashTransaction()
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'BCS_INVALID' })
  })
})

describe('unavailable, contradictory and noncanonical evidence never becomes empty activity', () => {
  it.each([
    ['tx-digest', (f: any) => { f.ledger.transaction.digest = adigest(99) }],
    ['tx-sender', (f: any) => { f.ledger.transaction.sender = aid(99) }],
    ['effects-digest', (f: any) => { f.ledger.effects.digest = adigest(99) }],
    ['effects-tx', (f: any) => { f.ledger.effects.transactionDigest = adigest(99) }],
    ['effects-epoch', (f: any) => { f.ledger.effects.epoch = 99n }],
    ['effects-version', (f: any) => { f.ledger.effects.version = 1 }],
    ['effects-status', (f: any) => { f.ledger.effects.status.success = false }],
    ['success-error', (f: any) => { f.ledger.effects.status.error = {} }],
    ['effects-event-digest', (f: any) => { f.ledger.effects.eventsDigest = adigest(99) }],
    ['events-digest', (f: any) => { f.ledger.events.digest = adigest(99) }],
    ['cp-sequence', (f: any) => { f.checkpoint.sequenceNumber = 101n }],
    ['cp-digest', (f: any) => { f.checkpoint.digest = adigest(99) }],
    ['summary-epoch', (f: any) => { f.checkpoint.summary.epoch = 99n }],
    ['summary-timestamp', (f: any) => { f.checkpoint.summary.timestamp.nanos += 1 }],
    ['summary-contents', (f: any) => { f.checkpoint.summary.contentDigest = adigest(99) }],
    ['contents-digest', (f: any) => { f.checkpoint.contents.digest = adigest(99) }],
    ['contents-version', (f: any) => { f.checkpoint.contents.version = 1 }],
    ['package-digest', (f: any) => { f.pkg.digest = adigest(99) }],
    ['package-original', (f: any) => { f.pkg.package.originalId = aid(99) }],
    ['package-storage', (f: any) => { f.pkg.package.storageId = aid(99) }],
    ['package-version', (f: any) => { f.pkg.package.version = 99n }],
    ['package-owner', (f: any) => { f.pkg.owner.kind = 1 }],
  ])('rejects contradictory RPC projection %s', async (_name, mutate) => {
    const f = await activityEvidenceFixture(); (mutate as (f: any) => void)(f)
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'EVIDENCE_MISMATCH' })
  })
  it.each(['transaction', 'effects', 'events', 'summary', 'contents', 'package'] as const)('rejects trailing canonical %s bytes', async part => {
    const f = await activityEvidenceFixture()
    const bcs = part === 'summary' ? f.checkpoint.summary.bcs : part === 'contents' ? f.checkpoint.contents.bcs : part === 'package' ? f.pkg.bcs : f.ledger[part].bcs
    bcs.value = new Uint8Array([...bcs.value, 0])
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'BCS_INVALID' })
  })
  it.each(['transaction', 'effects', 'events', 'summary', 'contents', 'package'] as const)('requires %s raw BCS, not JSON substitutes', async part => {
    const f = await activityEvidenceFixture()
    const row = part === 'summary' ? f.checkpoint.summary : part === 'contents' ? f.checkpoint.contents : part === 'package' ? f.pkg : f.ledger[part]
    delete row.bcs; row.json = { allValid: true }
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })
  it.each([['transaction', 256 * 1024], ['effects', 1024 * 1024], ['events', 1024 * 1024], ['summary', 128 * 1024],
    ['contents', 8 * 1024 * 1024], ['package', 4 * 1024 * 1024]] as const)('bounds %s before decoding', async (part, limit) => {
    const f = await activityEvidenceFixture()
    const row = part === 'summary' ? f.checkpoint.summary : part === 'contents' ? f.checkpoint.contents : part === 'package' ? f.pkg : f.ledger[part]
    row.bcs.value = new Uint8Array(limit + 1)
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'BOUNDS_EXCEEDED' })
  })
  it('distinguishes failed and not-yet-checkpointed transactions from certified activity', async () => {
    const f = await activityEvidenceFixture()
    delete f.ledger.checkpoint
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'UNCONFIRMED' })
    const e = f.effectsData.V2!; e.status = { Failure: { error: { InsufficientGas: true, $kind: 'InsufficientGas' }, command: null }, $kind: 'Failure' }
    f.rehashEffects()
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'FAILED_TRANSACTION' })
  })
  it.each(['35834a8a', adigest(99), 'garbage', '1'.repeat(45)])('rejects nonmatching or invalid full chain identity %s', async chainId => {
    const f = await activityEvidenceFixture(); f.client.ledgerService.getServiceInfo.mockResolvedValue({ response: { chainId } })
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'WRONG_CHAIN' })
    expect(f.client.ledgerService.getTransaction).not.toHaveBeenCalled()
  })
  it.each(['getServiceInfo', 'getTransaction', 'getCheckpoint', 'getObject'] as const)('sanitizes unavailable %s and never retries silently', async method => {
    const f = await activityEvidenceFixture(); f.client.ledgerService[method].mockRejectedValue({ code: 'NOT_FOUND', message: 'private upstream details' })
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'ACTIVITY_UNAVAILABLE: Historical ledger evidence unavailable' })
    expect(f.client.ledgerService[method]).toHaveBeenCalledTimes(1)
  })
  it('does not infer NOT_FOUND from arbitrary error message strings', async () => {
    const f = await activityEvidenceFixture(); f.client.ledgerService.getTransaction.mockRejectedValue(new Error('NOT_FOUND secret'))
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'TRANSPORT', message: 'ACTIVITY_TRANSPORT: Ledger read failed' })
  })
})

describe('explicit bounds, identity capture and cancellation', () => {
  it('rejects too many events even when every hash is consistent', async () => {
    const f = await activityEvidenceFixture()
    f.eventsData.data = Array.from({ length: 1025 }, () => structuredClone(f.eventsData.data[1])); f.rehashEvents()
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'BOUNDS_EXCEEDED' })
  })
  it('rejects an oversized checkpoint transaction vector before accepting membership', async () => {
    const f = await activityEvidenceFixture()
    f.contentsData.V2!.transactions = Array.from({ length: 10001 }, () => structuredClone(f.contentsData.V2!.transactions[0])); f.rehashContents()
    await expect(readActivityCheckpointEvidence(f.checkpointParams())).rejects.toMatchObject({ code: 'BOUNDS_EXCEEDED' })
  })
  it('bounds nested event type recursion while preserving ordinary generics', async () => {
    const f = await activityEvidenceFixture()
    let nested: any = { u64: null }
    for (let i = 0; i < 18; i++) nested = { vector: nested }
    f.eventsData.data[3].type_.typeParams = [nested]; f.rehashEvents()
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'BOUNDS_EXCEEDED' })
  })
  it('rejects non-minimal event vector ULEB even after rehashing its commitments', async () => {
    const f = await activityEvidenceFixture(), raw = f.ledger.events.bcs.value as Uint8Array
    f.ledger.events.bcs.value = new Uint8Array([0x84, 0, ...raw.subarray(1)])
    f.ledger.events.digest = activityHash('TransactionEvents', f.ledger.events.bcs.value)
    f.effectsData.V2!.eventsDigest = f.ledger.events.digest; f.rehashEffects()
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'BCS_INVALID' })
  })
  it.each(['originalPackageId', 'callablePackageId', 'callableDigest', 'chainIdentifier'] as const)('rejects invalid captured release %s before network', async field => {
    const f = await activityEvidenceFixture(); f.deployment[field] = 'bad'
    await expect(readActivityTransactionEvidence(f.params())).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
    expect(f.client.ledgerService.getServiceInfo).not.toHaveBeenCalled()
  })
  it.each(['-1', '01', '1.5', '18446744073709551616'])('rejects invalid as-of checkpoint %s before network', async checkpoint => {
    const f = await activityEvidenceFixture()
    await expect(readActivityCheckpointEvidence({ ...f.checkpointParams(), checkpoint })).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
    expect(f.client.ledgerService.getServiceInfo).not.toHaveBeenCalled()
  })
  it('does not start an already-cancelled read', async () => {
    const f = await activityEvidenceFixture(), controller = new AbortController(); controller.abort()
    await expect(readActivityTransactionEvidence(f.params(controller.signal))).rejects.toMatchObject({ code: 'ABORTED' })
    expect(f.client.ledgerService.getServiceInfo).not.toHaveBeenCalled()
  })
  it.each(['getServiceInfo', 'getTransaction', 'getCheckpoint', 'getObject'] as const)('bounds hung %s and ignores its late result', async method => {
    const f = await activityEvidenceFixture(); let resolve!: (v: any) => void
    f.client.ledgerService[method].mockImplementationOnce(() => new Promise<any>(done => { resolve = done }))
    vi.useFakeTimers()
    const work = readActivityTransactionEvidence(f.params()), rejected = expect(work).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(25_000); await rejected
    expect(vi.getTimerCount()).toBe(0)
    const calls = f.client.ledgerService.getObject.mock.calls.length
    resolve({ response: {} }); await vi.advanceTimersByTimeAsync(0)
    expect(f.client.ledgerService.getObject).toHaveBeenCalledTimes(calls)
  })
  it.each(['getServiceInfo', 'getTransaction', 'getCheckpoint', 'getObject'] as const)('aborts ignored %s without accepting a replacement-identity result', async method => {
    const f = await activityEvidenceFixture(), controller = new AbortController()
    f.client.ledgerService[method].mockImplementationOnce(() => { controller.abort(); return new Promise<any>(() => {}) })
    await expect(readActivityTransactionEvidence(f.params(controller.signal))).rejects.toMatchObject({ code: 'ABORTED' })
    expect(f.client.ledgerService[method]).toHaveBeenCalledTimes(1)
  })
})
