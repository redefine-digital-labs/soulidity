import { afterEach, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { contentAppendOperationFixture } from './fixtures/content-append-operation'
import { contentAppendAttachment } from '../../web/lib/soulidity/content-append-operation'
import { contentAppendPreparedEnvelope, unlockContentAppendPreparation } from '../../web/lib/soulidity/content-append-preparation'
import { contentEnvelopeKey, decodeContentEnvelope } from '../../web/lib/soulidity/content-envelope'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

// Real preparation, runner and raw BCS readback; upload/payment/ACK and the
// resulting ledger rows are controlled, not a chain or browser execution.
it('appends Memory default v1, preserves v0 and active bindings, and recovers its actual encrypted bytes', async () => {
  const f = await contentAppendOperationFixture({ memory: true })
  const before = f.proof.snapshot, old = before.contentVersions.filter(v => v.kind === 1)
  expect(old).toHaveLength(1)
  expect(old[0]).toMatchObject({ name: 'default', versionIndex: '0' })
  expect(f.scope).toMatchObject({ kind: 1, name: 'default', versionIndex: '1', contentObjectId: f.raw.content.id })
  const tx = new Transaction()
  contentAppendAttachment(f.record).append(tx, f.result.blobObjectId)
  expect(tx.getData().commands.map(c => c.MoveCall!.function)).toEqual(['assert_mutation_scope', 'append_version_as_owner'])

  const result = await f.run(), after = (await f.read()).snapshot
  const versions = after.contentVersions.filter(v => v.kind === 1)
  expect(versions).toHaveLength(2)
  expect(versions.find(v => v.versionIndex === '0')).toEqual(old[0])
  expect(result.version).toMatchObject({ kind: 1, name: 'default', versionIndex: '1', slot: { blob_object_id: f.result.blobObjectId,
    op_mask: '7', grant_scope_mask: '2', seal_encrypted: true } })
  expect(versions.find(v => v.versionIndex === '1')).toEqual(result.version)
  expect(after.activeBindings).toEqual(before.activeBindings)
  expect(after.activeBindings.some(v => v.kind === 1)).toBe(false)
  const identity = { contentObjectId: f.raw.content.id, kind: 1, name: 'default', versionIndex: '1', blobObjectId: f.result.blobObjectId }
  const stored = after.config.find(c => c.key === contentEnvelopeKey(identity))!
  expect(stored.valueUtf8).toBe(new TextDecoder().decode(contentAppendPreparedEnvelope(f.record, f.result.blobObjectId)))
  expect(decodeContentEnvelope(stored.valueUtf8, identity, f.scope.originalPackageId).sidecar).toEqual(f.record.sidecar)
  expect(f.record.ciphertext.length).toBe(f.crypto.params.plaintext.length + 16)
  expect(new TextDecoder().decode(f.record.ciphertext)).not.toContain('private memory:')
  expect(JSON.stringify(f.record)).not.toContain('private memory:')
  expect(f.upload).toHaveBeenCalledOnce()
  expect(f.upload.mock.calls[0][0].payload).toEqual(f.record.ciphertext)
  expect(f.acknowledge).toHaveBeenCalledExactlyOnceWith({ recoveryKey: f.result.recoveryKey, certifyDigest: f.result.certifyTxDigest })
  expect(f.sign).not.toHaveBeenCalled()

  // The existing real Seal recovery envelope unlocks this exact prepared
  // ciphertext. This does not stand in for the final raw content-access proof.
  const unlocked = await unlockContentAppendPreparation(f.record, f.crypto.params.wallet)
  try { expect(unlocked.plaintext).toEqual(f.crypto.params.plaintext) }
  finally { unlocked.dek.fill(0); unlocked.plaintext.fill(0) }
  expect(f.crypto.decryptCall).toHaveBeenCalledOnce()
  expect(f.crypto.unwrapped.every(bytes => bytes.every(v => v === 0))).toBe(true)
})
