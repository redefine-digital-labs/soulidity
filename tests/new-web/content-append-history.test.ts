import { afterEach, describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { toBase58 } from '@mysten/sui/utils'
import { contentAppendHistoryFixture, historyId as id } from './fixtures/content-append-history'
import { contentAppendPreparedEnvelope, contentAppendPreparationFingerprint } from '../../web/lib/soulidity/content-append-preparation'
import { assertContentAppendWalrusRecord } from '../../web/lib/soulidity/content-append-operation'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
type Fixture = Awaited<ReturnType<typeof contentAppendHistoryFixture>>
const optional = { intent: { spriteConfigJson: '{"frames":7}', setActive: true,
  autoGrantPlan: { capacityBefore: '3', capacityAfter: '4', targets: [{ address: id(1051), scopeMask: 13 }, { address: id(6000), scopeMask: 8 }] } } }

describe('historical append domain proof at caller-proved certify effects', () => {
  it.each([
    ['owner existing slot', {}], ['grantee existing slot', { grantee: true }],
    ['owner new name', { newName: true }], ['owner new kind', { newKind: true }],
    ['sprite active and rotated/new grants', optional],
    ['explicit empty grant plan', { intent: { autoGrantPlan: { capacityBefore: '3', capacityAfter: '3', targets: [] } } }],
  ] as const)('proves %s through full typed Object BCS without any current read', async (_label, options) => {
    const f = await contentAppendHistoryFixture(options as any)
    expect(() => assertContentAppendWalrusRecord(f.record, f.payment)).not.toThrow()
    const result = await f.readHistory()
    expect(result).toMatchObject({ preparationFingerprint: contentAppendPreparationFingerprint(f.record), certifyDigest: f.payment.certify!.digest,
      blobObjectId: f.result.blobObjectId, versionIndex: f.scope.versionIndex, stateVersion: '12', contentVersion: '12' })
    expect(f.getObject.mock.calls.every(([request]) => request.version === 12n)).toBe(true)
    expect(f.getObject.mock.calls.map(([request]) => request.objectId).sort()).toEqual(Object.entries(f.ids)
      .filter(([label]) => label !== 'blob').map(([, objectId]) => objectId).sort())
    expect(f.forbidden).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled()
  })

  it('keeps historical success after current transfer, grant revocation, expiry, deletion and optional state changes', async () => {
    const f = await contentAppendHistoryFixture(optional)
    f.raw.state.current_owner = id(999); f.raw.state.ownership_epoch = '50'; f.raw.state.grant_capacity = '0'
    f.raw.slots[2].deleted = true; f.raw.slots[2].purged = true; f.raw.active.version_index = '0'
    f.raw.rows.clear(); f.raw.tables.clear(); f.setWallet(null); f.crypto.setAddress(null)
    vi.stubEnv('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', '[]')
    await expect(f.readHistory()).resolves.toMatchObject({ versionIndex: '2' })
    expect(f.forbidden).not.toHaveBeenCalled(); expect(f.crypto.decryptCall).not.toHaveBeenCalled()
  })
  it('proves original grantee append with the current grant deleted and no connected wallet', async () => {
    const f = await contentAppendHistoryFixture({ grantee: true })
    f.raw.rows.delete(f.intent.grantId!); f.raw.tables.set(f.raw.state.active_grants.id, [])
    f.raw.putClock('99999'); f.setWallet(null)
    await expect(f.readHistory()).resolves.toMatchObject({ versionIndex: '2' })
    expect(f.forbidden).not.toHaveBeenCalled()
    expect(f.getObject.mock.calls.some(([request]) => request.objectId === f.intent.grantId)).toBe(false)
  })

  it.each(['type', 'uid', 'version', 'previousTransaction', 'owner'] as const)('rejects fully rehashed wrong %s inside the authenticated State object', async field => {
    const f = await contentAppendHistoryFixture(), object = f.objects.get(f.ids.state)!, move = object.data.Move!
    if (field === 'type') move.type.Other!.name = 'WrongState'
    if (field === 'uid') move.contents[31] ^= 1
    if (field === 'version') move.version = '13'
    if (field === 'previousTransaction') object.previousTransaction = toBase58(new Uint8Array(32).fill(9))
    if (field === 'owner') object.owner = bcs.Owner.parse(bcs.Owner.serialize({ AddressOwner: id(9) }).toBytes())
    f.rehash('state')
    await expect(f.readHistory()).rejects.toThrow('HISTORICAL_OBJECT_BCS_OBJECT_MISMATCH')
  })

  it('rejects envelope contents relabelled under genuine full Object BCS and digest', async () => {
    const f = await contentAppendHistoryFixture()
    f.rows.get(f.ids.envelope)!.contents.value[40] ^= 1
    await expect(f.readHistory()).rejects.toThrow('HISTORICAL_OBJECT_BCS_OBJECT_MISMATCH')
  })
  it('rejects Object BCS changed without updating the effects digest', async () => {
    const f = await contentAppendHistoryFixture(), object = f.objects.get(f.ids.state)!
    object.storageRebate = '90'; f.rows.get(f.ids.state)!.bcs.value = bcs.Object.serialize(object).toBytes()
    await expect(f.readHistory()).rejects.toThrow('HISTORICAL_OBJECT_BCS_DIGEST_MISMATCH')
  })

  it.each(['slots', 'envelope', 'wrapper'])('rejects a rehashed %s field under the wrong output parent', async label => {
    const f = await contentAppendHistoryFixture(); f.setOwner(label, { ObjectOwner: id(999) })
    await expect(f.readHistory()).rejects.toThrow('CONTENT_APPEND_HISTORY_FIELD_PARENT_MISMATCH')
  })
  it('rejects a mutated slot that moved from another input parent', async () => {
    const f = await contentAppendHistoryFixture(); f.setOwner('slots', { ObjectOwner: id(999) }, true)
    await expect(f.readHistory()).rejects.toThrow('CONTENT_APPEND_HISTORY_FIELD_PARENT_MISMATCH')
  })

  for (const [label, mutate, error] of [
    ['wrong owner', (f: Fixture) => f.rewrite('state', v => { v.current_owner = id(999) }), 'STATE_SCOPE_MISMATCH'],
    ['wrong epoch', (f: Fixture) => f.rewrite('state', v => { v.ownership_epoch = '3' }), 'STATE_SCOPE_MISMATCH'],
    ['wrong State Soul pointer', (f: Fixture) => f.rewrite('state', v => { v.soul_id = id(999) }), 'STATE_SCOPE_MISMATCH'],
    ['wrong State Content pointer', (f: Fixture) => f.rewrite('state', v => { v.content_id = id(999) }), 'STATE_SCOPE_MISMATCH'],
    ['wrong Content Soul pointer', (f: Fixture) => f.rewrite('content', v => { v.soul_id = id(999) }), 'CONTENT_SCOPE_MISMATCH'],
    ['wrong field key', (f: Fixture) => f.rewrite('slots', v => { v.name.name = 'another' }), 'FIELD_KEY_MISMATCH'],
    ['missing appended slot', (f: Fixture) => f.rewrite('slots', v => { v.value.pop() }), 'SLOT_VERSION_MISMATCH'],
    ['extra appended slot', (f: Fixture) => f.rewrite('slots', v => { v.value.push(v.value.at(-1)) }), 'SLOT_VERSION_MISMATCH'],
    ['wrong Blob wrapper value', (f: Fixture) => f.rewrite('wrapper', v => { v.value = id(999) }), 'BLOB_CONTAINMENT_MISMATCH'],
    ['wrong Blob owner', (f: Fixture) => f.setOwner('blob', { ObjectOwner: id(999) }), 'BLOB_CONTAINMENT_MISMATCH'],
    ['another Blob envelope', (f: Fixture) => f.rewrite('envelope', v => { v.value = [...contentAppendPreparedEnvelope(f.record, id(999))] }), 'ENVELOPE_MISMATCH'],
    ['missing config table', (f: Fixture) => f.rewrite('state', v => { v.config_ext.id = id(999) }), 'HISTORICAL_OBJECT_OUTPUT_NOT_UNIQUE'],
    ['missing items table', (f: Fixture) => f.rewrite('content', v => { v.items.id = id(999) }), 'HISTORICAL_OBJECT_OUTPUT_NOT_UNIQUE'],
  ] as const) it(`rejects rehashed ${label}`, async () => {
    const f = await contentAppendHistoryFixture(); mutate(f)
    await expect(f.readHistory()).rejects.toThrow(error)
  })
  it.each([
    ['version', '2'], ['kind', 4], ['blob_object_id', id(999)], ['read_mode_mask', '1'],
    ['download_policy', 2], ['is_public', true], ['seal_encrypted', false], ['deleted', true], ['purged', true],
  ])('rejects rehashed slot %s mismatch', async (key, value) => {
    const f = await contentAppendHistoryFixture(); f.rewrite('slots', v => { v.value.at(-1)[key as string] = value })
    await expect(f.readHistory()).rejects.toThrow('SLOT_CONTENT_MISMATCH')
  })

  it.each(['state', 'content', 'slots', 'wrapper', 'blob'])('requires correct %s created/mutated lifetime', async label => {
    const f = await contentAppendHistoryFixture(), change = f.change(label)
    if (change.idOperation.$kind === 'Created') {
      change.idOperation = { $kind: 'None', None: true }; change.inputState = structuredClone(f.change('blob').inputState)
    } else { change.idOperation = { $kind: 'Created', Created: true }; change.inputState = { $kind: 'NotExist', NotExist: true } }
    await expect(f.readHistory()).rejects.toThrow('HISTORICAL_OBJECT_LIFETIME_MISMATCH')
  })
  it('requires creation of the zero-index slot field', async () => {
    const f = await contentAppendHistoryFixture({ newName: true }), change = f.change('slots')
    change.idOperation = { $kind: 'None', None: true }; change.inputState = structuredClone(f.change('blob').inputState)
    await expect(f.readHistory()).rejects.toThrow('HISTORICAL_OBJECT_LIFETIME_MISMATCH')
  })
  it.each(['output owner', 'input owner', 'birth'])('binds shared root %s to original packet', async mode => {
    const f = await contentAppendHistoryFixture()
    if (mode === 'birth') f.setOwner('state', { Shared: { initialSharedVersion: '2' } })
    else f.setOwner('state', { AddressOwner: f.scope.author }, mode === 'input owner')
    await expect(f.readHistory()).rejects.toThrow('ROOT_SHARED_REFERENCE_MISMATCH')
  })
  it.each([[false, '1'], [true, '2']] as const)('rejects signed packet root mutable=%s birth=%s despite coherent rewritten effects', async (mutable, birth) => {
    const f = await contentAppendHistoryFixture(); await f.replacePacket(mutable, birth)
    await expect(f.readHistory()).rejects.toThrow('ROOT_SHARED_REFERENCE_MISMATCH')
  })

  for (const [label, mutate, error] of [
    ['sprite', (f: Fixture) => f.rewrite('sprite', v => { v.value = [...new TextEncoder().encode('{"frames":8}')] }), 'SPRITE_CONFIG_MISMATCH'],
    ['active version', (f: Fixture) => f.rewrite('active', v => { v.value.version_index = '1' }), 'ACTIVE_BINDING_MISMATCH'],
    ['active name', (f: Fixture) => f.rewrite('active', v => { v.value.name = 'other' }), 'ACTIVE_BINDING_MISMATCH'],
    ['active policy', (f: Fixture) => f.rewrite('active', v => { v.value.download_policy = 2 }), 'ACTIVE_BINDING_MISMATCH'],
    ['grant capacity', (f: Fixture) => f.rewrite('state', v => { v.grant_capacity = '3' }), 'GRANT_CAPACITY_MISMATCH'],
    ['grant slot', (f: Fixture) => f.rewrite('grantSlot0', v => { v.value.scope_mask = '8' }), 'GRANT_SLOT_MISMATCH'],
    ['grant expiry', (f: Fixture) => f.rewrite('grantSlot1', v => { v.value.expires_at_ms = '9999' }), 'GRANT_SLOT_MISMATCH'],
    ['grant reverse', (f: Fixture) => f.rewrite('grantReverse0', v => { v.value = id(999) }), 'GRANT_REVERSE_MISMATCH'],
    ['grant recipient', (f: Fixture) => f.setOwner('grant1', { AddressOwner: id(999) }), 'GRANT_RECIPIENT_MISMATCH'],
    ['grant issuer', (f: Fixture) => f.rewrite('grant0', v => { v.issued_by = id(999) }), 'GRANT_CONTENT_MISMATCH'],
    ['grant epoch', (f: Fixture) => f.rewrite('grant1', v => { v.ownership_epoch_snapshot = '3' }), 'GRANT_CONTENT_MISMATCH'],
    ['grant Soul', (f: Fixture) => f.rewrite('grant1', v => { v.soul_id = id(999) }), 'GRANT_CONTENT_MISMATCH'],
  ] as const) it(`rejects rehashed optional ${label}`, async () => {
    const f = await contentAppendHistoryFixture(optional); mutate(f)
    await expect(f.readHistory()).rejects.toThrow(error)
  })
  it.each(['grant0', 'grantReverse1'])('requires newly created optional %s', async label => {
    const f = await contentAppendHistoryFixture(optional), change = f.change(label)
    change.idOperation = { $kind: 'None', None: true }; change.inputState = structuredClone(f.change('blob').inputState)
    await expect(f.readHistory()).rejects.toThrow('HISTORICAL_OBJECT_LIFETIME_MISMATCH')
  })

  it.each(['operationScope', 'attachmentScope', 'contentHash', 'payloadHash', 'storageEpochs', 'relayUrl', 'recipient'] as const)
    ('rejects valid-shaped but different payment intent %s before historical reads', async field => {
      const f = await contentAppendHistoryFixture()
      if (field === 'storageEpochs') f.payment.intent[field] += 1
      else if (field === 'contentHash' || field === 'payloadHash') f.payment.intent[field] = 'ab'.repeat(32)
      else if (field === 'recipient') f.payment.intent[field] = id(999)
      else f.payment.intent[field] = `${f.payment.intent[field]}-changed`
      await expect(f.readHistory()).rejects.toThrow('WALRUS_PREPARATION_MISMATCH')
      expect(f.getObject).not.toHaveBeenCalled()
    })
  it('does not accept another effects transaction as the signed packet', async () => {
    const f = await contentAppendHistoryFixture(); f.effects.V2!.transactionDigest = f.payment.register!.digest
    await expect(f.readHistory()).rejects.toThrow('CERTIFIED_EFFECTS_REQUIRED'); expect(f.getObject).not.toHaveBeenCalled()
  })
  it('retains historical unavailability and cancellation as failures', async () => {
    const f = await contentAppendHistoryFixture(); f.getObject.mockRejectedValueOnce(new Error('Historical RPC unavailable'))
    await expect(f.readHistory()).rejects.toThrow('Historical RPC unavailable')
    f.crypto.controller.abort(new Error('historical-query-cancelled'))
    await expect(f.readHistory()).rejects.toThrow('historical-query-cancelled')
  })
})
