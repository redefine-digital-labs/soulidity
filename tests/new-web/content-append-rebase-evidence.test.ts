import { afterEach, expect, it, vi } from 'vitest'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { parseContentAppendIntent } from '../../web/lib/soulidity/content-append-operation'
import { rewrapContentAppendPreparation, contentAppendPreparationFingerprint, contentAppendPreparationMessage } from '../../web/lib/soulidity/content-append-preparation'
import { compactContentAppendPreparation, expandContentAppendPreparation, contentAppendStorageRootHash,
  seedContentAppendRebasePayment, verifyContentAppendRebaseHistory, MAX_CONTENT_APPEND_REBASE_DEPTH } from '../../web/lib/soulidity/content-append-rebase-evidence'
import { contentAppendFixtureId as id } from './fixtures/content-append-preparation'
import { contentAppendRebaseFixture as fixture } from './fixtures/content-append-rebase'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
it('verifies real author rewrapping while retaining identical ciphertext/IV/source and detached evidence', async () => {
  const f = await fixture(), result = await f.verify()
  expect(result.next.ciphertext).toEqual(f.previous.ciphertext)
  expect(result.next.sidecar.iv).toBe(f.previous.sidecar.iv)
  expect(result.next.contentHash).toBe(f.previous.contentHash)
  expect(result.next.payloadHash).toBe(f.previous.payloadHash)
  expect(result.next.sidecar.documentId).not.toBe(f.previous.sidecar.documentId)
  expect(result.next.sidecar.encryptedDek).not.toBe(f.previous.sidecar.encryptedDek)
  expect(result.next.authorSignature).not.toBe(f.previous.authorSignature)
  expect(f.decryptCall).toHaveBeenCalledOnce()
  expect(f.unwrapped.every(bytes => bytes.every(v => v === 0))).toBe(true)
  f.link.previousPayment.approved!.quoteId = 'changed after verification'
  expect(result.previousPayment.approved!.quoteId).toBe('original-paid-quote')
})
it('seeds only new attempt scope and certify gas, retaining register, nonce, certificate and original storage fees', async () => {
  const f = await fixture(), seeded = f.link.nextPayment
  expect(seeded.intent.operationScope).not.toBe(f.previousPayment.intent.operationScope)
  expect(seeded.register).toEqual(f.previousPayment.register)
  expect(seeded.encoding).toEqual(f.previousPayment.encoding)
  expect(seeded.uploaded).toEqual(f.previousPayment.uploaded)
  expect(seeded.approved).toEqual({ ...f.previousPayment.approved, gasBudget: '1400000' })
  expect(seeded.certify).toBeNull(); expect(seeded.acknowledged).toBe(false)
  expect(contentAppendStorageRootHash(seeded)).toBe(contentAppendStorageRootHash(f.previousPayment))
  seeded.encoding!.nonce = 'mutated-copy'; expect(f.previousPayment.encoding!.nonce).toBe('original-relay-nonce')
})
it('allows a gas-only new attempt at the same content version without creating a register packet', async () => {
  const f = await fixture(), next = await f.nextRecord({}, '2'), link = f.linkFor(next)
  await expect(f.verify(link)).resolves.toBeDefined()
  expect(link.nextPayment.register!.bytes).toBe(f.previousPayment.register!.bytes)
  expect(contentAppendPreparationFingerprint(next)).not.toBe(contentAppendPreparationFingerprint(f.previous))
})
it('does not treat local packet status/signature or certify gas as a different paid root', async () => {
  const f = await fixture(), copy = structuredClone(f.previousPayment), hash = contentAppendStorageRootHash(copy)
  copy.uploaded = null
  copy.register!.phase = 'FAILED'; copy.register!.signature = null; copy.approved!.gasBudget = '9000000'
  expect(contentAppendStorageRootHash(copy)).toBe(hash)
})
it.each(['nonce', 'storageCost', 'writeCost', 'relayTip', 'quoteId', 'storageEpochs', 'payloadHash', 'register'])(
  'commits immutable paid-root field %s', async field => {
    const f = await fixture(), copy = structuredClone(f.previousPayment)
    if (field === 'nonce') copy.encoding!.nonce = 'another-nonce'
    else if (field === 'register') copy.register = await f.packet(3)
    else if (field === 'storageEpochs') copy.intent.storageEpochs++
    else if (field === 'payloadHash') copy.intent.payloadHash = 'ff'.repeat(32)
    else Object.assign(copy.approved!, { [field]: field === 'quoteId' ? 'another-quote' : '99' })
    expect(contentAppendStorageRootHash(copy)).not.toBe(contentAppendStorageRootHash(f.previousPayment))
    expect(() => seedContentAppendRebasePayment(f.next, copy)).toThrow('STORAGE_ROOT_MISMATCH')
  })
it.each(['schema', 'extra', 'duplicateCiphertext', 'signature', 'ciphertext'])(
  'rejects invalid link or cryptographic evidence: %s', async mode => {
    const f = await fixture(), link = structuredClone(f.link)
    if (mode === 'schema') Object.assign(link, { schema: 'wrong' })
    if (mode === 'extra') Object.assign(link, { extra: true })
    if (mode === 'duplicateCiphertext') Object.assign(link.previous, { ciphertext: f.previous.ciphertext })
    if (mode === 'signature') link.next.authorSignature = f.previous.authorSignature
    const ciphertext = new Uint8Array(f.previous.ciphertext)
    if (mode === 'ciphertext') ciphertext[0] ^= 1
    await expect(f.verify(link, ciphertext)).rejects.toThrow()
  })
it('compact evidence excludes ciphertext and cannot smuggle a duplicate source during expansion', async () => {
  const f = await fixture(), compact = compactContentAppendPreparation(f.previous)
  expect(Object.hasOwn(compact, 'ciphertext')).toBe(false)
  expect(expandContentAppendPreparation(compact, f.previous.ciphertext)).toEqual(f.previous)
  expect(() => expandContentAppendPreparation({ ...compact, ciphertext: new Uint8Array() } as any, f.previous.ciphertext)).toThrow('DUPLICATE_CIPHERTEXT')
})
it('rejects an author-signed IV substitution even when the paid ciphertext is unchanged', async () => {
  const f = await fixture(), next = structuredClone(f.next)
  next.sidecar.iv = toBase64(new Uint8Array(12).fill(99))
  next.authorSignature = (await f.signer.signPersonalMessage(contentAppendPreparationMessage(next))).signature
  await expect(f.verify({ ...f.link, next: compactContentAppendPreparation(next) })).rejects.toThrow('PAID_PAYLOAD_CHANGED')
})
it.each(['author', 'originalPackageId', 'callablePackageId', 'contentObjectId', 'kind', 'name', 'versionIndex'])(
  'refuses scope-changing or backwards rewrap %s before decrypting', async field => {
    const f = await fixture(), calls = f.decryptCall.mock.calls.length
    const value = field === 'kind' ? 2 : field === 'name' ? 'another' : field === 'versionIndex' ? '1' : id(88)
    await expect(rewrapContentAppendPreparation({ record: f.previous,
      nextScope: { ...f.next.scope, [field]: value }, sealConfig: f.params.sealConfig, wallet: f.params.wallet })).rejects.toThrow(field === 'name' ? 'SLOT_INVALID' : 'REBASE_SCOPE_MISMATCH')
    expect(f.decryptCall).toHaveBeenCalledTimes(calls)
  })
it.each(['soulId', 'stateId', 'kindRegistryId', 'marketConfigId', 'downloadPolicy', 'readModeMask', 'uploadConfig'])(
  'rejects newly author-signed changes to retained user intent %s', async field => {
    const f = await fixture(), changes: Record<string, unknown> = {
      soulId: id(55), stateId: id(56), kindRegistryId: id(57), marketConfigId: id(58),
      downloadPolicy: 'allowlist', readModeMask: 3, uploadConfig: { ...f.intent.uploadConfig, storageEpochs: 4 } }
    const next = await f.nextRecord({ [field]: changes[field] }), link = f.linkFor(next)
    await expect(f.verify(link)).rejects.toThrow('USER_INTENT_CHANGED')
  })
it.each(['fileName', 'mimeType', 'contentHash', 'plaintextByteLength'])(
  'rejects newly signed metadata/source inconsistency %s', async field => {
    const f = await fixture(), change = field === 'plaintextByteLength' ? 999 : field === 'contentHash' ? 'ff'.repeat(32) : 'substituted'
    const next = await f.nextRecord({ [field]: change })
    expect(() => parseContentAppendIntent(next)).toThrow('INTENT_SOURCE_MISMATCH')
  })
it.each([false, true])('rejects newly signed owner/grantee role replacement (previous grantee=%s)', async grant => {
  const f = await fixture({ grant }), next = await f.nextRecord({ grantId: grant ? null : id(88) })
  await expect(f.verify(f.linkFor(next))).rejects.toThrow('AUTHOR_ROLE_CHANGED')
})
it('permits refreshed ownership epoch/grant ID without changing grantee role', async () => {
  const f = await fixture({ grant: true }), next = await f.nextRecord({ ownershipEpoch: '1', grantId: id(88) })
  await expect(f.verify(f.linkFor(next))).resolves.toBeDefined()
})
it('rejects newly signed additions to account-agent auto-grant targets', async () => {
  const f = await fixture({ autoGrant: true }), next = await f.nextRecord({ autoGrantPlan: {
    capacityBefore: '2', capacityAfter: '3', targets: [{ address: id(8), scopeMask: 1 }, { address: id(9), scopeMask: 1 }] } })
  await expect(f.verify(f.linkFor(next))).rejects.toThrow('AUTO_GRANT_TARGET_ADDED')
})
it('permits removal of an old auto-grant target and updated capacity observations', async () => {
  const f = await fixture({ autoGrant: true }), next = await f.nextRecord({ autoGrantPlan: { capacityBefore: '2', capacityAfter: '2', targets: [] } })
  await expect(f.verify(f.linkFor(next))).resolves.toBeDefined()
})
it.each([1, 8])('rejects narrowing an existing auto-grant target from mask 9 to %s across rebases', async scopeMask => {
  const f = await fixture({ autoGrant: true, autoGrantScopeMask: 9 })
  expect(parseContentAppendIntent(f.next).rebase!.autoGrantTargets).toEqual([{ address: id(8), scopeMask: 9 }])
  const narrowed = await f.advance(f.next, f.link.nextPayment, { autoGrantPlan: {
    capacityBefore: '2', capacityAfter: '2', targets: [{ address: id(8), scopeMask }] } })
  await expect(f.verify(narrowed.link)).rejects.toThrow('AUTO_GRANT_TARGET_NARROWED')
})
it('keeps original targets after an empty issue plan and permits restoring the omitted target later', async () => {
  const f = await fixture({ autoGrant: true, autoGrantScopeMask: 9 })
  const omitted = await f.advance(f.next, f.link.nextPayment, { autoGrantPlan: null })
  await expect(f.verify(omitted.link)).resolves.toBeDefined()
  expect(parseContentAppendIntent(omitted.record).rebase!.autoGrantTargets).toEqual([{ address: id(8), scopeMask: 9 }])
  const restored = await f.advance(omitted.record, omitted.payment, { autoGrantPlan: {
    capacityBefore: '2', capacityAfter: '2', targets: [{ address: id(8), scopeMask: 9 }] } })
  await expect(verifyContentAppendRebaseHistory(restored.record, [f.link, omitted.link, restored.link], f.client)).resolves.toHaveLength(3)
  expect(restored.payment.register).toEqual(f.previousPayment.register)
})
it('uses immutable original bits, not incidental expanded bits from a prior issue plan', async () => {
  const f = await fixture({ autoGrant: true, autoGrantScopeMask: 1 })
  const merged = await f.advance(f.next, f.link.nextPayment, { autoGrantPlan: {
    capacityBefore: '2', capacityAfter: '2', targets: [{ address: id(8), scopeMask: 9 }] } })
  await expect(f.verify(merged.link)).resolves.toBeDefined()
  expect(parseContentAppendIntent(merged.record).rebase!.autoGrantTargets).toEqual([{ address: id(8), scopeMask: 1 }])
  const original = await f.advance(merged.record, merged.payment, { autoGrantPlan: {
    capacityBefore: '2', capacityAfter: '2', targets: [{ address: id(8), scopeMask: 1 }] } })
  await expect(f.verify(original.link)).resolves.toBeDefined()
})
it.each(['removed', 'added', 'differentAddress', 'narrowed', 'expanded'])(
  'rejects first-rebase author-signed mutation of immutable target metadata %s', async mode => {
    const f = await fixture({ autoGrant: true, autoGrantScopeMask: 9 })
    const autoGrantTargets = structuredClone(f.rebase.autoGrantTargets)
    if (mode === 'removed') autoGrantTargets.splice(0)
    if (mode === 'added') autoGrantTargets.push({ address: id(9), scopeMask: 1 })
    if (mode === 'differentAddress') autoGrantTargets[0].address = id(9)
    if (mode === 'narrowed') autoGrantTargets[0].scopeMask = 1
    if (mode === 'expanded') autoGrantTargets[0].scopeMask = 15
    const next = await f.nextRecord({ rebase: { ...f.rebase, autoGrantTargets } })
    await expect(f.verify({ ...f.link, next: compactContentAppendPreparation(next) })).rejects.toThrow(/AUTO_GRANT/)
  })
it('rejects an attempt to erase retained metadata after the issue plan omitted its target', async () => {
  const f = await fixture({ autoGrant: true }), omitted = await f.advance(f.next, f.link.nextPayment, { autoGrantPlan: null })
  const rebase = { ...parseContentAppendIntent(omitted.record).rebase!, predecessor: contentAppendPreparationFingerprint(omitted.record),
    nonce: 'ff'.repeat(16), autoGrantTargets: [] }
  const erased = await f.advance(omitted.record, omitted.payment, { rebase })
  await expect(f.verify(erased.link)).rejects.toThrow(/AUTO_GRANT/)
})
it.each(['missing', 'notArray', 'duplicate', 'zeroAddress', 'self', 'zeroMask', 'fractionalMask', 'overflowMask', 'extraTargetField'])(
  'rejects malformed signed immutable auto-grant target metadata %s', async mode => {
    const f = await fixture({ autoGrant: true }), rebase = structuredClone(f.rebase)
    if (mode === 'missing') delete (rebase as Partial<typeof rebase>).autoGrantTargets
    if (mode === 'notArray') Object.assign(rebase, { autoGrantTargets: {} })
    if (mode === 'duplicate') rebase.autoGrantTargets.push({ ...rebase.autoGrantTargets[0] })
    if (mode === 'zeroAddress') rebase.autoGrantTargets[0].address = uidZero()
    if (mode === 'self') rebase.autoGrantTargets[0].address = f.scope.author
    if (mode === 'zeroMask') rebase.autoGrantTargets[0].scopeMask = 0
    if (mode === 'fractionalMask') rebase.autoGrantTargets[0].scopeMask = 1.5
    if (mode === 'overflowMask') rebase.autoGrantTargets[0].scopeMask = 16
    if (mode === 'extraTargetField') Object.assign(rebase.autoGrantTargets[0], { extra: true })
    const next = await f.nextRecord({ rebase })
    expect(() => parseContentAppendIntent(next)).toThrow()
  })
function uidZero() { return `0x${'0'.repeat(64)}` }
it.each(['grantee', 'public'])('rejects nonempty retained auto-grant targets for %s intent', async mode => {
  const f = await fixture()
  const next = await f.nextRecord({ rebase: { ...f.rebase, autoGrantTargets: [{ address: id(8), scopeMask: 1 }] },
    ...(mode === 'grantee' ? { grantId: id(7) } : { readModeMask: 9, downloadPolicy: 'public' as const }) })
  expect(() => parseContentAppendIntent(next)).toThrow('REBASE_GRANT_TARGETS_INVALID')
})
it.each(['predecessor', 'storageRootHash'] as const)('rejects newly signed wrong %s', async field => {
  const f = await fixture(), next = await f.nextRecord({ rebase: { ...f.rebase, [field]: 'ff'.repeat(32) } })
  const link = { ...f.link, next: compactContentAppendPreparation(next) }
  await expect(f.verify(link)).rejects.toThrow(field === 'predecessor' ? 'PREDECESSOR_MISMATCH' : 'STORAGE_ROOT_MISMATCH')
})
it.each(['nonce', 'predecessor', 'storageRootHash', 'zeroGas', 'overflowGas', 'extra'])(
  'rejects malformed newly signed rebase intent %s', async mode => {
    const f = await fixture(), rebase = { ...f.rebase }
    if (mode === 'zeroGas') rebase.certifyGasBudgetMist = '0'
    else if (mode === 'overflowGas') rebase.certifyGasBudgetMist = '9223372036854775808'
    else Object.assign(rebase, { [mode]: 'invalid' })
    const next = await f.nextRecord({ rebase })
    expect(() => parseContentAppendIntent(next)).toThrow()
  })
it.each(['register', 'encoding', 'approved'] as const)('refuses unpaid/missing %s roots', async field => {
  const f = await fixture(), payment = structuredClone(f.previousPayment); payment[field] = null
  expect(() => contentAppendStorageRootHash(payment)).toThrow()
})
it.each(['gas', 'register', 'certify', 'acknowledged'])(
  'rejects seeded payment substitution %s', async mode => {
    const f = await fixture()
    if (mode === 'gas') f.link.nextPayment.approved!.gasBudget = '2'
    if (mode === 'register') f.link.nextPayment.register = await f.packet(4)
    if (mode === 'certify') f.link.nextPayment.certify = await f.packet(2)
    if (mode === 'acknowledged') f.link.nextPayment.acknowledged = true
    await expect(f.verify()).rejects.toThrow('SEEDED_PAYMENT_MISMATCH')
  })
it.each(['falseFailure', 'wrongDigest', 'unexpectedEpoch', 'expiredStorage', 'zeroVersion'])(
  'rejects inconsistent no-packet retirement/inspection %s', async mode => {
    const f = await fixture(), p = f.link.inspection
    if (mode === 'falseFailure') p.retirement.kind = 'FAILED'
    if (mode === 'wrongDigest') p.retirement.digest = 'unrelated'
    if (mode === 'unexpectedEpoch') p.retirement.observedSuiEpoch = '13'
    if (mode === 'expiredStorage') p.storageEndEpoch = p.observedWalrusEpoch
    if (mode === 'zeroVersion') p.blobVersion = '0'
    await expect(f.verify()).rejects.toThrow()
  })
it.each(['FAILED', 'EXPIRED'] as const)('accepts structurally consistent %s evidence but does not perform live retirement checks', async kind => {
  const f = await fixture(), packet = await f.packet(2)
  f.link.previousPayment.certify = { ...packet, phase: 'SIGNED' }
  f.link.inspection.retirement = { kind, digest: packet.digest, observedSuiEpoch: kind === 'EXPIRED' ? '13' : null }
  const priorReads = vi.mocked(f.client.core.getObject).mock.calls.length
  await expect(f.verify()).resolves.toBeDefined()
  expect(vi.mocked(f.client.core.getObject).mock.calls.length).toBe(priorReads)
})
it.each(['equality', 'before', 'wrongDigest', 'noPacket'])(
  'rejects recorded certify retirement %s', async mode => {
    const f = await fixture(), packet = await f.packet(2)
    f.link.previousPayment.certify = { ...packet, phase: 'SIGNED' }
    f.link.inspection.retirement = { kind: 'EXPIRED', digest: packet.digest, observedSuiEpoch: '13' }
    if (mode === 'equality') f.link.inspection.retirement.observedSuiEpoch = '12'
    if (mode === 'before') f.link.inspection.retirement.observedSuiEpoch = '11'
    if (mode === 'wrongDigest') f.link.inspection.retirement.digest = 'wrong'
    if (mode === 'noPacket') f.link.inspection.retirement.kind = 'NO_RECORDED_PACKET'
    await expect(f.verify()).rejects.toThrow('RETIREMENT_MISMATCH')
  })

it.each(['differentBlob', 'shortDigest', 'longDigest', 'badBase58', 'emptyDigest', 'overflowVersion', 'leadingZeroVersion',
  'overflowEpoch', 'fractionalEpoch', 'negativeEpoch', 'extraInspection', 'extraRetirement'])(
  'rejects strengthened inspection boundary %s', async mode => {
    const f = await fixture(), p = f.link.inspection
    if (mode === 'differentBlob') p.blobObjectId = id(101)
    if (mode === 'shortDigest') p.blobDigest = toBase58(new Uint8Array(31))
    if (mode === 'longDigest') p.blobDigest = toBase58(new Uint8Array(33))
    if (mode === 'badBase58') p.blobDigest = '0'.repeat(32)
    if (mode === 'emptyDigest') p.blobDigest = ''
    if (mode === 'overflowVersion') p.blobVersion = '18446744073709551616'
    if (mode === 'leadingZeroVersion') p.blobVersion = '02'
    if (mode === 'overflowEpoch') p.storageEndEpoch = 0x100000000
    if (mode === 'fractionalEpoch') p.observedWalrusEpoch = 9.5
    if (mode === 'negativeEpoch') p.observedWalrusEpoch = -1
    if (mode === 'extraInspection') Object.assign(p, { extra: true })
    if (mode === 'extraRetirement') Object.assign(p.retirement, { extra: true })
    await expect(f.verify()).rejects.toThrow()
  })
it('accepts canonical u64/u32 maxima without rounding the Blob version', async () => {
  const f = await fixture()
  f.link.inspection.blobVersion = '18446744073709551615'
  f.link.inspection.observedWalrusEpoch = 0xfffffffe; f.link.inspection.storageEndEpoch = 0xffffffff
  const verified = await f.verify()
  expect(verified.link.inspection.blobVersion).toBe('18446744073709551615')
})
it('verifies a complete ordered two-step history and returns a detached copy', async () => {
  const f = await fixture(), second = await f.advance(), history = [f.link, second.link]
  const result = await verifyContentAppendRebaseHistory(second.record, history, f.client)
  expect(result).toEqual(history)
  history[0].inspection.blobVersion = '999'
  expect(result[0].inspection.blobVersion).toBe('2')
})
it('accepts an empty history only for a non-rebased preparation', async () => {
  const f = await fixture()
  await expect(verifyContentAppendRebaseHistory(f.previous, [], f.client)).resolves.toEqual([])
  await expect(verifyContentAppendRebaseHistory(f.next, [], f.client)).rejects.toThrow('HISTORY_REQUIRED')
  await expect(verifyContentAppendRebaseHistory(f.previous, [f.link], f.client)).rejects.toThrow('UNEXPECTED_HISTORY')
})
it.each(['missingRoot', 'missingTail', 'wrongOrder', 'duplicateEdge', 'fork', 'corruptSignature'])(
  'rejects incomplete or substituted history %s', async mode => {
    const f = await fixture(), second = await f.advance()
    let history = [f.link, second.link]
    if (mode === 'missingRoot') history = [second.link]
    if (mode === 'missingTail') history = [f.link]
    if (mode === 'wrongOrder') history.reverse()
    if (mode === 'duplicateEdge') history = [f.link, f.link, second.link]
    if (mode === 'fork') history = [f.link, (await f.advance()).link]
    if (mode === 'corruptSignature') history[0].next.authorSignature = f.previous.authorSignature
    await expect(verifyContentAppendRebaseHistory(second.record, history, f.client)).rejects.toThrow()
  })
it('rejects non-array and over-limit histories before reading individual edges', async () => {
  const f = await fixture()
  await expect(verifyContentAppendRebaseHistory(f.next, {} as any, f.client)).rejects.toThrow('HISTORY_LIMIT')
  await expect(verifyContentAppendRebaseHistory(f.next, Array(MAX_CONTENT_APPEND_REBASE_DEPTH + 1).fill(null), f.client)).rejects.toThrow('HISTORY_LIMIT')
})
it('accepts the complete maximum-depth real signed chain and rejects the next edge', async () => {
  const f = await fixture(), history = [f.link]
  let record = f.next, payment = f.link.nextPayment
  for (let n = 1; n < MAX_CONTENT_APPEND_REBASE_DEPTH; n++) {
    const step = await f.advance(record, payment)
    history.push(step.link); record = step.record; payment = step.payment
  }
  await expect(verifyContentAppendRebaseHistory(record, history, f.client)).resolves.toHaveLength(MAX_CONTENT_APPEND_REBASE_DEPTH)
  const extra = await f.advance(record, payment)
  await expect(verifyContentAppendRebaseHistory(extra.record, [...history, extra.link], f.client)).rejects.toThrow('HISTORY_LIMIT')
}, 15000)
