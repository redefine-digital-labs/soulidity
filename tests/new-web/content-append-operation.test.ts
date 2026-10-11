import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'
import { contentAppendOperationFixture } from './fixtures/content-append-operation'
import { contentAppendHistoryFixture } from './fixtures/content-append-history'
import { assertContentAppendAuthority, assertContentAppendFinal, contentAppendAttachment, runContentAppend, queryContentAppend } from '../../web/lib/soulidity/content-append-operation'
import { walrusSingleKey } from '../../web/lib/upload/walrus-single-operation'
import { contentAppendPreparedEnvelope } from '../../web/lib/soulidity/content-append-preparation'
import { contentEnvelopeKey } from '../../web/lib/soulidity/content-envelope'
import { SoulDetailStateBcs as D } from '@soulidity/sdk'

// Actual raw BCS readers and local personal signatures/AES/Seal preparation;
// upload/payment/ACK are injected. This is not a wallet or Walrus broadcast E2E.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
it.each(['before-upload', 'before-write', 'after-upload'])('a changed Seal topology at %s cannot reuse an old signed preparation for a write', async when => {
  const f = await contentAppendOperationFixture()
  const change = () => vi.stubEnv('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', JSON.stringify(f.record.sealConfig.serverConfigs
    .map((server, index) => index === 0 ? { ...server, aggregatorUrl: 'https://changed.example.com/' } : server)))
  if (when === 'before-upload') change()
  else f.upload.mockImplementation(async p => {
    if (when === 'before-write') { change(); await p.execution.beforeWrite() }
    else { f.finalize(); change() }
    return f.result
  })
  await expect(f.run()).rejects.toThrow('SEAL_CONFIGURATION_CHANGED')
  if (when === 'before-upload') expect(f.upload).not.toHaveBeenCalled()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
})
type Fixture = Awaited<ReturnType<typeof contentAppendOperationFixture>>
function pure(tx: Transaction, command: number, argument: number) {
  const data = tx.getData(), arg = data.commands[command].MoveCall!.arguments[argument]
  if (arg.$kind !== 'Input' || data.inputs[arg.Input].$kind !== 'Pure') throw new Error('Expected actual BCS pure input')
  return fromBase64(data.inputs[arg.Input].Pure!.bytes)
}
function rewriteGrantee(f: Fixture) {
  const r = f.raw
  r.field(r.state.active_grants.id, 'address', bcs.Address, r.grant.grantee,
    `${r.deployment.originalPackageId}::soul::ActiveGrantSlot`, D.GrantSlot, r.grantSlot)
  r.putGrant({ kind: 1, address: r.grant.grantee })
}
const envelopeKey = (f: Fixture) => contentEnvelopeKey({ contentObjectId: f.scope.contentObjectId,
  kind: f.scope.kind, name: f.scope.name, versionIndex: f.scope.versionIndex, blobObjectId: f.result.blobObjectId })

describe('ordinary content append operation: raw authority and final state', () => {
  for (const grantee of [false, true]) it(`${grantee ? 'scoped grantee' : 'owner'} appends and acknowledges only after exact raw final state`, async () => {
    const f = await contentAppendOperationFixture({ grantee })
    expect(() => assertContentAppendAuthority(f.record, f.proof)).not.toThrow()
    const result = await f.run()
    expect(result.version.versionIndex).toBe('2')
    expect(f.acknowledge).toHaveBeenCalledExactlyOnceWith({ recoveryKey: f.result.recoveryKey, certifyDigest: f.result.certifyTxDigest })
    expect(f.sign).not.toHaveBeenCalled()
  })

  for (const option of ['newKind', 'newName'] as const) it(`accepts ${option} with no existing slot and CAS zero, using actual registry descriptor`, async () => {
    const f = await contentAppendOperationFixture({ [option]: true })
    expect(f.proof.snapshot.contentVersions.filter(v => v.kind === f.scope.kind && v.name === f.scope.name)).toEqual([])
    expect(f.proof.snapshot.kindDescriptors.some(d => d.kind === f.scope.kind)).toBe(true)
    expect(() => assertContentAppendAuthority(f.record, f.proof)).not.toThrow()
    expect((await f.run()).version.versionIndex).toBe('0')
    expect(f.acknowledge).toHaveBeenCalledTimes(1)
  })

  it('keeps sprite config and active binding atomic with exact append Result', async () => {
    const f = await contentAppendOperationFixture({ intent: { spriteConfigJson: '{"frames":7}', setActive: true } })
    const tx = new Transaction(); contentAppendAttachment(f.record).append(tx, f.result.blobObjectId)
    expect(tx.getData().commands.map(c => c.MoveCall!.function)).toEqual(['assert_mutation_scope', 'append_version_as_owner', 'set_state_config_v2', 'set_active_content_v2'])
    expect(tx.getData().commands[3].MoveCall!.arguments[6]).toMatchObject({ Result: 1 })
    await f.run()
    const final = await f.read()
    expect(final.snapshot.config.find(c => c.key === 'sprite_config_json')!.valueUtf8).toBe('{"frames":7}')
    expect(final.snapshot.activeBindings.find(b => b.kind === 3)!.version_index).toBe('2')
  })

  for (const [label, mutate, expected] of [
    ['new concurrent version', (f: Fixture) => { f.raw.slots.push({ ...f.raw.slots[0] }); f.raw.putSlots() }, 'VERSION_CHANGED_QUERY_OR_REBASE'],
    ['changed owner', (f: Fixture) => { f.raw.state.current_owner = id(9999); f.raw.putState(); f.raw.grant.issued_by = id(9999); f.raw.putGrant() }, 'CURRENT_OWNER_CHANGED'],
    ['changed epoch', (f: Fixture) => { f.raw.state.ownership_epoch = '3'; f.raw.state.active_grant_count = '0'; f.raw.putState() }, 'CURRENT_SCOPE_CHANGED'],
    ['deprecated live descriptor', (f: Fixture) => { f.raw.descriptor.deprecated = true; f.raw.putDescriptor() }, 'KIND_APPEND_NOT_ALLOWED'],
    ['removed append operation', (f: Fixture) => { f.raw.descriptor.op_mask = '14'; f.raw.putDescriptor(); f.raw.slots.forEach(s => { s.op_mask = '14' }); f.raw.putSlots() }, 'KIND_APPEND_NOT_ALLOWED'],
  ] as const) it(`rejects ${label} from freshly decoded raw state`, async () => {
    const f = await contentAppendOperationFixture(); mutate(f)
    const current = await f.read()
    expect(() => assertContentAppendAuthority(f.record, current)).toThrow(`CONTENT_APPEND_${expected}`)
  })

  for (const [label, mutate] of [
    ['expired exactly at Clock', (f: Fixture) => f.raw.putClock('2000')],
    ['scope no longer covers sprite', (f: Fixture) => { f.raw.grantSlot.scope_mask = '1'; f.raw.grant.scope_mask = '1'; rewriteGrantee(f) }],
    ['older ownership epoch', (f: Fixture) => { f.raw.grantSlot.ownership_epoch_snapshot = '1'; f.raw.grant.ownership_epoch_snapshot = '1'; f.raw.state.active_grant_count = '0'; f.raw.putState(); rewriteGrantee(f) }],
  ] as const) it(`rejects grantee ${label}`, async () => {
    const f = await contentAppendOperationFixture({ grantee: true }); mutate(f)
    const proof = await f.read()
    expect(() => assertContentAppendAuthority(f.record, proof)).toThrow('CONTENT_APPEND_CURRENT_GRANT_INVALID')
  })

  it('does not reinterpret an owner-signed intent as a grant append after custody changes', async () => {
    const f = await contentAppendOperationFixture()
    f.raw.state.current_owner = id(9999); f.raw.putState(); f.raw.grant.issued_by = id(9999); f.raw.putGrant()
    f.upload.mockImplementation(async input => { await input.execution.beforeWrite(); throw new Error('unreachable') })
    await expect(f.run()).rejects.toThrow('CURRENT_OWNER_CHANGED')
    expect(f.sign).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
  })
})

describe('attachment exact command template', () => {
  it.each([false, true])('reconstructs exact signed deployment targets without current environment for grantee=%s', async grantee => {
    const f = await contentAppendOperationFixture(grantee ? { grantee: true } : { intent: { spriteConfigJson: '{"frames":7}', setActive: true,
      autoGrantPlan: { capacityBefore: '3', capacityAfter: '4', targets: [{ address: id(6000), scopeMask: 8 }] } } })
    const expected = new Transaction(); contentAppendAttachment(f.record).append(expected, f.result.blobObjectId)
    for (const key of ['NEXT_PUBLIC_SUI_NETWORK', 'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID',
      'NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID', 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID']) vi.stubEnv(key, '')
    const unavailable = new Transaction(); contentAppendAttachment(f.record).append(unavailable, f.result.blobObjectId)
    expect(unavailable.getData()).toEqual(expected.getData())
    for (const key of ['NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID',
      'NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID', 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID']) vi.stubEnv(key, id(9999))
    const changed = new Transaction(); contentAppendAttachment(f.record).append(changed, f.result.blobObjectId)
    expect(changed.getData()).toEqual(expected.getData())
    expect(changed.getData().commands.every(command => command.MoveCall?.package === f.scope.callablePackageId)).toBe(true)
  })
  for (const grantee of [false, true]) it(`binds ${grantee ? 'grantee' : 'owner'} CAS/envelope/Blob and all object inputs`, async () => {
    const f = await contentAppendOperationFixture({ grantee }), tx = new Transaction()
    const attachment = contentAppendAttachment(f.record); attachment.append(tx, f.result.blobObjectId)
    const data = tx.getData(), call = data.commands[1].MoveCall!, at = grantee ? 8 : 7
    expect(data.commands[0].MoveCall).toMatchObject({ package: f.scope.callablePackageId, module: 'content', function: 'assert_mutation_scope' })
    expect(bcs.u64().parse(pure(tx, 0, 2))).toBe(f.intent.ownershipEpoch)
    expect(call).toMatchObject({ package: f.scope.callablePackageId, module: 'content',
      function: grantee ? 'append_version_as_granted_agent' : 'append_version_as_owner' })
    expect(bcs.u64().parse(pure(tx, 1, at))).toBe(f.scope.versionIndex)
    expect(bcs.vector(bcs.u8()).parse(pure(tx, 1, at + 1))).toEqual([...contentAppendPreparedEnvelope(f.record, f.result.blobObjectId)])
    for (const [position, objectId] of [[0, f.scope.contentObjectId], [1, f.intent.stateId], [2, f.intent.kindRegistryId], [at + 2, f.result.blobObjectId]] as const) {
      const arg = call.arguments[position]; expect(arg.$kind).toBe('Input')
      expect(data.inputs[(arg as { Input: number }).Input]).toMatchObject({ UnresolvedObject: { objectId } })
    }
    expect(data.commands).toHaveLength(2)
    const other = new Transaction(); attachment.append(other, id(9001))
    expect(bcs.vector(bcs.u8()).parse(pure(other, 1, at + 1))).not.toEqual(bcs.vector(bcs.u8()).parse(pure(tx, 1, at + 1)))
    expect(attachment.scope).toMatch(/^content-append:[a-f0-9]{64}$/)
  })

  it('does not create grants for an explicit empty target plan', async () => {
    const f = await contentAppendOperationFixture({ intent: { autoGrantPlan: { capacityBefore: '3', capacityAfter: '3', targets: [] } } })
    const tx = new Transaction(); contentAppendAttachment(f.record).append(tx, f.result.blobObjectId)
    expect(tx.getData().commands.map(c => c.MoveCall!.function)).toEqual(['assert_mutation_scope', 'assert_capacity', 'append_version_as_owner'])
    await f.run()
    expect((await f.read()).snapshot.activeGrantCount).toBe('1')
  })

  it('rotates an existing grant without narrowing and issues a new target with bounded capacity', async () => {
    const oldTarget = id(1051), newTarget = id(6000)
    const f = await contentAppendOperationFixture({ intent: { autoGrantPlan: { capacityBefore: '3', capacityAfter: '4',
      targets: [{ address: oldTarget, scopeMask: 13 }, { address: newTarget, scopeMask: 8 }] } } })
    expect(() => assertContentAppendAuthority(f.record, f.proof)).not.toThrow()
    const tx = new Transaction(); contentAppendAttachment(f.record).append(tx, f.result.blobObjectId)
    expect(tx.getData().commands.map(c => c.MoveCall!.function)).toEqual(['assert_mutation_scope', 'assert_capacity', 'assert_preserves_active_scopes', 'assert_preserves_active_scopes', 'append_version_as_owner', 'set_grant_capacity', 'issue_to_grantee', 'issue_to_grantee'])
    await f.run(); const after = await f.read()
    expect(after.snapshot.grantCapacity).toBe('4'); expect(after.snapshot.activeGrantCount).toBe('2')
    expect(after.snapshot.grants.map(g => [g.slot.grantee, g.slot.scope_mask])).toEqual(expect.arrayContaining([[oldTarget, '13'], [newTarget, '8']]))
    expect(after.snapshot.grants.find(g => g.slot.grantee === oldTarget)!.slot.grant_id).not.toBe(f.raw.grant.id)
  })

  for (const [label, plan, error] of [
    ['narrow existing grant', { capacityBefore: '3', capacityAfter: '3', targets: [{ address: id(1051), scopeMask: 8 }] }, 'AUTO_GRANT_WOULD_NARROW'],
    ['missing kind scope', { capacityBefore: '3', capacityAfter: '3', targets: [{ address: id(6000), scopeMask: 1 }] }, 'AUTO_GRANT_WOULD_NARROW'],
    ['stale capacity', { capacityBefore: '2', capacityAfter: '3', targets: [] }, 'GRANT_CAPACITY_CHANGED'],
    ['too many new targets', { capacityBefore: '3', capacityAfter: '3', targets: [6000, 6001, 6002].map(n => ({ address: id(n), scopeMask: 8 })) }, 'AUTO_GRANT_CAPACITY_EXCEEDED'],
  ] as const) it(`rejects auto-grant ${label} before payment`, async () => {
    const f = await contentAppendOperationFixture({ intent: { autoGrantPlan: structuredClone(plan) as any } })
    f.upload.mockImplementation(async input => { await input.confirmQuote({}); throw new Error('unreachable') })
    await expect(f.run()).rejects.toThrow(error)
    expect(f.confirmQuote).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
  })
})

describe('final proof failures retain paid recovery and never ACK', () => {
  for (const [label, mutate, error] of [
    ['missing appended version', (f: Fixture) => { f.raw.slots.pop(); f.raw.putSlots() }, 'FINAL_SLOT_UNAVAILABLE'],
    ['another Blob object', (f: Fixture) => { f.raw.slots[2].blob_object_id = id(9900); f.raw.putSlots() }, 'FINAL_SLOT_UNAVAILABLE'],
    ['deleted append', (f: Fixture) => { f.raw.slots[2].deleted = true; f.raw.putSlots() }, 'FINAL_SLOT_UNAVAILABLE'],
    ['purged append', (f: Fixture) => { f.raw.slots[2].deleted = true; f.raw.slots[2].purged = true; f.raw.putSlots() }, 'FINAL_SLOT_UNAVAILABLE'],
    ['changed read mask', (f: Fixture) => { f.raw.slots[2].read_mode_mask = '1'; f.raw.putSlots() }, 'FINAL_SLOT_UNAVAILABLE'],
    ['changed download policy', (f: Fixture) => { f.raw.slots[2].download_policy = 2; f.raw.putSlots() }, 'FINAL_SLOT_UNAVAILABLE'],
    ['wrong envelope bytes', (f: Fixture) => f.setConfig(envelopeKey(f), new Uint8Array([255, 0])), 'FINAL_ENVELOPE_MISMATCH'],
    ['envelope for another Blob', (f: Fixture) => f.setConfig(envelopeKey(f), contentAppendPreparedEnvelope(f.record, id(9900))), 'FINAL_ENVELOPE_MISMATCH'],
  ] as const) it(`rejects ${label} through the actual final raw reader`, async () => {
    const f = await contentAppendOperationFixture()
    f.upload.mockImplementation(async () => { f.finalize(); mutate(f); return f.result })
    await expect(f.run()).rejects.toThrow(error)
    expect(f.upload).toHaveBeenCalledTimes(1); expect(f.acknowledge).not.toHaveBeenCalled()
  })

  for (const field of ['sprite', 'active'] as const) it(`rejects ${field} output mismatch, not best-effort success`, async () => {
    const f = await contentAppendOperationFixture({ intent: { spriteConfigJson: '{"frames":7}', setActive: true } })
    f.upload.mockImplementation(async () => {
      f.finalize()
      if (field === 'sprite') f.setConfig('sprite_config_json', new TextEncoder().encode('{"frames":8}'))
      else { f.raw.active.version_index = '1'; f.raw.putActive() }
      return f.result
    })
    await expect(f.run()).rejects.toThrow(field === 'sprite' ? 'FINAL_SPRITE_CONFIG_CHANGED' : 'FINAL_ACTIVE_BINDING_CHANGED')
    expect(f.acknowledge).not.toHaveBeenCalled()
  })

  it('rejects narrowed actual auto-grant result despite otherwise matching append', async () => {
    const f = await contentAppendOperationFixture({ intent: { autoGrantPlan: { capacityBefore: '3', capacityAfter: '3', targets: [{ address: id(1051), scopeMask: 13 }] } } })
    f.upload.mockImplementation(async () => {
      f.finalize(); const r = f.raw, grantId = id(8000)
      r.field(r.state.active_grants.id, 'address', bcs.Address, r.grant.grantee,
        `${r.deployment.originalPackageId}::soul::ActiveGrantSlot`, D.GrantSlot,
        { ...r.grantSlot, grant_id: grantId, scope_mask: '9', expires_at_ms: null })
      r.rows.get(grantId)!.contents = { value: D.Grant.serialize({ ...r.grant, id: grantId, scope_mask: '9', expires_at_ms: null }).toBytes() }
      return f.result
    })
    await expect(f.run()).rejects.toThrow('FINAL_AUTO_GRANT_CHANGED')
    expect(f.acknowledge).not.toHaveBeenCalled()
  })

  it('raw transport failure after upload is not acknowledged or converted into an empty success', async () => {
    const f = await contentAppendOperationFixture()
    f.read.mockRejectedValueOnce(new Error('raw-final-network'))
    await expect(f.run()).rejects.toThrow('raw-final-network')
    expect(f.acknowledge).not.toHaveBeenCalled()
  })

  it('requires the durable Walrus recovery key and propagates ACK storage errors', async () => {
    const f = await contentAppendOperationFixture()
    f.result.recoveryKey = undefined
    await expect(f.run()).rejects.toThrow('WALRUS_RECEIPT_REQUIRED')
    expect(f.acknowledge).not.toHaveBeenCalled()
  })
  it('does not return success if ACK itself fails', async () => {
    const f = await contentAppendOperationFixture()
    f.acknowledge.mockRejectedValueOnce(new Error('durable-ack-failed'))
    await expect(f.run()).rejects.toThrow('durable-ack-failed')
    expect(f.acknowledge).toHaveBeenCalledTimes(1)
  })

  for (const field of ['callablePackageId', 'kindRegistryId'] as const) it(`final scope retains exact ${field}`, async () => {
    const f = await contentAppendOperationFixture(); f.finalize()
    const proof = await f.read()
    // Cross-reader identity tuple substitution after a valid raw positive control.
    expect(() => assertContentAppendFinal(f.record, proof, f.result)).not.toThrow()
    expect(() => assertContentAppendFinal(f.record, { ...proof, [field]: id(7777) }, f.result)).toThrow('FINAL_ROOT_MISMATCH')
  })
  it('final raw ownership epoch drift must remain pending, not acknowledge current state as the submitted epoch', async () => {
    const f = await contentAppendOperationFixture()
    f.upload.mockImplementation(async () => {
      f.finalize(); f.raw.state.ownership_epoch = '3'; f.raw.state.active_grant_count = '0'; f.raw.putState(); return f.result
    })
    await expect(f.run()).rejects.toThrow('FINAL_AUTHORITY_CHANGED')
    expect(f.acknowledge).not.toHaveBeenCalled()
  })
  it('final auto-grant capacity must equal the signed postcondition', async () => {
    const f = await contentAppendOperationFixture({ intent: { autoGrantPlan: { capacityBefore: '3', capacityAfter: '4', targets: [{ address: id(1051), scopeMask: 13 }] } } })
    f.upload.mockImplementation(async () => { f.finalize(); f.raw.state.grant_capacity = '3'; f.raw.putState(); return f.result })
    await expect(f.run()).rejects.toThrow('FINAL_AUTO_GRANT_CAPACITY_CHANGED')
    expect(f.acknowledge).not.toHaveBeenCalled()
  })
})

describe('before-payment and before-signature freshness', () => {
  it('uses the signed ciphertext and exact attachment without any owned HTTP endpoint', async () => {
    const f = await contentAppendOperationFixture()
    const fetch = vi.fn(async () => { throw new Error('No HTTP authority or upload in this local run seam') })
    vi.stubGlobal('fetch', fetch)
    f.upload.mockImplementation(async input => {
      expect(input.payload).toEqual(f.record.ciphertext)
      expect(input.contentHash).toBe(f.record.contentHash)
      expect(input.operationScope).toBe(contentAppendAttachment(f.record).scope)
      expect(input.attachment.scope).toBe(input.operationScope)
      expect(input.storageEpochs).toBe(26)
      expect(input.walletAddress).toBe(f.scope.author); expect(input.sendObjectTo).toBe(f.scope.author)
      expect(input).not.toHaveProperty('dek'); expect(input).not.toHaveProperty('authHeaders')
      expect(await input.confirmQuote({})).toBe(true)
      await input.execution.beforeWrite()
      f.finalize(); return f.result
    })
    await f.run()
    expect(f.read).toHaveBeenCalledTimes(4); expect(f.beforeWrite).toHaveBeenCalledTimes(3)
    expect(f.confirmQuote).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled()
  })

  for (const tamper of ['intent', 'ciphertext', 'signature'] as const) it(`actual preparation verification rejects changed ${tamper} before upload`, async () => {
    const f = await contentAppendOperationFixture(), record = structuredClone(f.record)
    if (tamper === 'intent') record.scope.intentJson = JSON.stringify({ ...f.intent, ownershipEpoch: '3' })
    else if (tamper === 'ciphertext') record.ciphertext[0] ^= 1
    else record.authorSignature = (await f.crypto.signer.signPersonalMessage(new Uint8Array([1]))).signature
    await expect(runContentAppend({ record, config: f.config, execution: f.execution,
      signal: f.crypto.controller.signal, confirmQuote: f.confirmQuote }, { upload: f.upload, acknowledge: f.acknowledge, read: f.read as any })).rejects.toThrow()
    expect(f.upload).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
  })

  for (const [label, options, error] of [
    ['grantee sprite setter', { grantee: true, intent: { spriteConfigJson: '{}' } }, 'OWNER_SPRITE_ACTION_REQUIRED'],
    ['grantee active setter', { grantee: true, intent: { setActive: true } }, 'OWNER_SPRITE_ACTION_REQUIRED'],
    ['grantee auto-grant', { grantee: true, intent: { autoGrantPlan: { capacityBefore: '3', capacityAfter: '3', targets: [] } } }, 'AUTO_GRANT_PLAN_INVALID'],
    ['public auto-grant', { intent: { readModeMask: 9, downloadPolicy: 'public', autoGrantPlan: { capacityBefore: '3', capacityAfter: '3', targets: [] } } }, 'AUTO_GRANT_PLAN_INVALID'],
    ['non-sprite active setter', { newKind: true, intent: { setActive: true } }, 'OWNER_SPRITE_ACTION_REQUIRED'],
  ] as const) it(`does not broaden existing permissions for ${label}`, async () => {
    const f = await contentAppendOperationFixture(options as any)
    await expect(f.run()).rejects.toThrow(error)
    expect(f.upload).not.toHaveBeenCalled(); expect(f.confirmQuote).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
  })

  for (const [limit, value, error] of [
    ['max_programmable_tx_commands', '1', 'TOO_MANY_COMMANDS'],
    ['max_pure_argument_size', '1', 'PURE_ARGUMENT_TOO_LARGE'],
    ['max_programmable_tx_commands', '0', 'PROTOCOL_LIMIT_UNAVAILABLE'],
  ]) it(`blocks ${limit}=${value} before invoking uploader`, async () => {
    const f = await contentAppendOperationFixture({ intent: { setActive: true } })
    f.attributes[limit] = value
    await expect(f.run()).rejects.toThrow(error)
    expect(f.upload).not.toHaveBeenCalled(); expect(f.confirmQuote).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
  })

  it('rechecks actual CAS both before and after the explicit quote confirmation', async () => {
    const f = await contentAppendOperationFixture()
    f.confirmQuote.mockImplementation(async () => { f.raw.slots.push({ ...f.raw.slots[0] }); f.raw.putSlots(); return true })
    f.upload.mockImplementation(async input => { await input.confirmQuote({}); throw new Error('unreachable') })
    await expect(f.run()).rejects.toThrow('VERSION_CHANGED_QUERY_OR_REBASE')
    expect(f.confirmQuote).toHaveBeenCalledTimes(1); expect(f.read).toHaveBeenCalledTimes(2)
    expect(f.beforeWrite).toHaveBeenCalledTimes(1); expect(f.sign).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
  })

  it('fresh beforeWrite rejects a grant revoked by expiry after a previous valid read', async () => {
    const f = await contentAppendOperationFixture({ grantee: true })
    f.upload.mockImplementation(async input => {
      await input.execution.beforeWrite()
      f.raw.putClock('2000')
      await input.execution.beforeWrite()
      throw new Error('unreachable')
    })
    await expect(f.run()).rejects.toThrow('CURRENT_GRANT_INVALID')
    expect(f.read).toHaveBeenCalledTimes(2); expect(f.beforeWrite).toHaveBeenCalledTimes(1)
    expect(f.sign).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
  })

  it('explicit fee refusal is passed through without signing or ACK', async () => {
    const f = await contentAppendOperationFixture(); f.confirmQuote.mockResolvedValue(false)
    f.upload.mockImplementation(async input => {
      expect(await input.confirmQuote({})).toBe(false)
      throw new Error('UPLOAD_QUOTE_REJECTED')
    })
    await expect(f.run()).rejects.toThrow('UPLOAD_QUOTE_REJECTED')
    expect(f.read).toHaveBeenCalledTimes(2); expect(f.sign).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
  })

  it('complete fixed transaction byte size is checked before the real signer', async () => {
    const f = await contentAppendOperationFixture(); f.attributes.max_tx_size_bytes = '1'
    f.upload.mockImplementation(async input => {
      const tx = new Transaction()
      // Size-only seam: no unresolved graph is signed or accepted as a transaction.
      vi.spyOn(tx, 'build').mockResolvedValue(new Uint8Array(2))
      await input.execution.sign(tx); throw new Error('unreachable')
    })
    await expect(f.run()).rejects.toThrow('TRANSACTION_TOO_LARGE')
    expect(f.sign).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
  })

  for (const changed of ['wallet', 'environment', 'abort'] as const) it(`${changed} during upload cannot turn into successful ACK`, async () => {
    const f = await contentAppendOperationFixture()
    f.upload.mockImplementation(async () => {
      f.finalize()
      if (changed === 'wallet') f.setWallet(null)
      else if (changed === 'environment') vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(9999))
      else f.crypto.controller.abort(new Error('cancelled-upload'))
      return f.result
    })
    await expect(f.run()).rejects.toThrow(changed === 'wallet' ? 'WALLET_CHANGED' : changed === 'environment' ? 'CONFIGURATION_CHANGED' : 'cancelled-upload')
    expect(f.acknowledge).not.toHaveBeenCalled()
  })
})

describe('historical success and independent current-state classification', () => {
  // Walrus query finality is the controlled boundary in this suite. From its
  // returned effects onward, the actual historical full-Object reader and the
  // actual current raw reader run; no historical result itself is mocked.
  async function historyQueryFixture(options: Parameters<typeof contentAppendHistoryFixture>[0] = {}) {
    const f = await contentAppendHistoryFixture(options), recoveryKey = walrusSingleKey(f.payment.intent)
    const recover = vi.fn(async (p: any) => {
      expect(p.payload).toEqual(f.record.ciphertext); expect(p.record).toEqual(f.payment)
      expect(p.execution.getAddress()).toBeNull(); expect(p.execution.beforeWrite).toBeUndefined()
      return { status: 'CERTIFIED' as const, recoveryKey, record: p.record, effects: f.effects,
        result: { ...f.result, recoveryKey, storageTxDigest: f.payment.register!.digest, certifyTxDigest: f.payment.certify!.digest } }
    })
    const readPayment = vi.fn(() => { throw new Error('Imported query must not read local journals') })
    const getAddress = vi.fn(() => { throw new Error('Historical query must not ask the wallet') })
    const observe = vi.fn(async (): Promise<{ status: 'MATCHES_ORIGINAL' | 'CHANGED' | 'UNAVAILABLE'; reason: string | null }> =>
      ({ status: 'MATCHES_ORIGINAL', reason: null }))
    const query = () => queryContentAppend({ record: f.record, payment: f.payment, config: f.config,
      execution: { ...f.execution, client: f.historicalClient as never, getAddress }, signal: f.crypto.controller.signal },
    { recover, read: f.read, readPayment, observe })
    return { ...f, query, recover, readPayment, getAddress, observe }
  }

  it.each([false, true])('returns proved historical owner/grantee=%s completion and matching current state', async grantee => {
    const f = await historyQueryFixture({ grantee }), result = await f.query()
    expect(result).toMatchObject({ historical: { certifyDigest: f.payment.certify!.digest, versionIndex: '2' },
      currentStatus: 'MATCHES_ORIGINAL', currentReason: null, current: { versionIndex: '2' } })
    expect(f.readPayment).not.toHaveBeenCalled(); expect(f.getAddress).not.toHaveBeenCalled()
    expect(f.sign).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled()
  })

  it.each(['revoked', 'expired'] as const)('retains original grantee history but classifies its %s grant as CHANGED', async kind => {
    const f = await historyQueryFixture({ grantee: true }), r = f.raw
    if (kind === 'expired') r.putClock('2000')
    else {
      for (const table of [r.state.active_grants, r.state.active_grant_ids]) {
        for (const field of r.tables.get(table.id)!) r.rows.delete(field.fieldId)
        r.tables.set(table.id, []); table.size = '0'
      }
      r.state.active_grant_count = '0'; r.putState(); r.rows.delete(f.intent.grantId!)
    }
    const result = await f.query()
    expect(result).toMatchObject({ historical: { certifyDigest: f.payment.certify!.digest },
      currentStatus: 'CHANGED', current: null, currentReason: 'CONTENT_APPEND_CURRENT_ORIGINAL_GRANT_CHANGED' })
    expect(f.sign).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
  })

  it.each(['transferred', 'deleted', 'purged', 'active-changed', 'sprite-changed'] as const)
    ('keeps historical completion after current content is %s', async kind => {
      const f = await historyQueryFixture({ intent: { spriteConfigJson: '{"frames":7}', setActive: true } }), r = f.raw
      if (kind === 'transferred') { r.state.current_owner = id(9999); r.state.ownership_epoch = '3'; r.state.active_grant_count = '0'; r.putState() }
      if (kind === 'deleted' || kind === 'purged') {
        // Move requires selecting another active version before deletion.
        r.active.version_index = '1'; r.putActive()
        r.slots[2].deleted = true; r.slots[2].purged = kind === 'purged'; r.putSlots()
      }
      if (kind === 'active-changed') { r.active.version_index = '1'; r.putActive() }
      if (kind === 'sprite-changed') f.setConfig('sprite_config_json', new TextEncoder().encode('{"frames":8}'))
      const result = await f.query()
      expect(result).toMatchObject({ historical: { certifyDigest: f.payment.certify!.digest }, currentStatus: 'CHANGED', current: null })
      expect(result.currentReason).toBeTruthy(); expect(f.sign).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
    })

  it('retains proved history when current RPC is unavailable without labelling it deletion', async () => {
    const f = await historyQueryFixture(); f.read.mockRejectedValueOnce(new Error('Current RPC offline'))
    await expect(f.query()).resolves.toMatchObject({ historical: { certifyDigest: f.payment.certify!.digest },
      currentStatus: 'UNAVAILABLE', current: null, currentReason: 'Current RPC offline' })
  })
  it.each([['CHANGED', 'Blob storage expired'], ['UNAVAILABLE', 'Current Walrus RPC unavailable']] as const)
    ('retains proved history while current Blob is %s', async (status, reason) => {
      const f = await historyQueryFixture(); f.observe.mockResolvedValueOnce({ status, reason })
      await expect(f.query()).resolves.toMatchObject({ historical: { certifyDigest: f.payment.certify!.digest },
        currentStatus: status, current: null, currentReason: reason })
      expect(f.observe).toHaveBeenCalledWith(expect.objectContaining({ expectedOwner: f.ids.wrapper }))
      expect(f.sign).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
    })
  it('retains proved history when current configuration no longer matches the original release', async () => {
    const f = await historyQueryFixture(); vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(9999))
    await expect(f.query()).resolves.toMatchObject({ historical: { certifyDigest: f.payment.certify!.digest }, currentStatus: 'UNAVAILABLE' })
    expect(f.read).not.toHaveBeenCalled()
  })
  it('rejects forged historical postconditions before asking whether current state matches', async () => {
    const f = await historyQueryFixture(); f.rewrite('slots', v => { v.value[2].blob_object_id = id(9999) })
    await expect(f.query()).rejects.toThrow('CONTENT_APPEND_HISTORY_SLOT_CONTENT_MISMATCH')
    expect(f.read).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
  })
})
