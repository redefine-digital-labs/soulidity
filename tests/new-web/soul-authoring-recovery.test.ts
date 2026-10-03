import { afterEach, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { soulAuthoringManifestFixture } from './fixtures/soul-authoring'
import { authoringPaidCoverVerifierFixture } from './fixtures/soul-authoring-verifier'
import { createWalrusBatchRecord } from '../../web/lib/upload/walrus-batch-store'
import { exportSoulAuthoringRecovery, importSoulAuthoringRecovery, type SoulAuthoringRecovery } from '../../web/lib/soulidity/soul-authoring-recovery'

afterEach(() => vi.restoreAllMocks())
it('preserves encrypted payloads and protected recovery before the first wallet transaction', async () => {
  const f = await soulAuthoringManifestFixture()
  const snapshot: SoulAuthoringRecovery = { schema: 'soulidity.soul-authoring-recovery.v1', manifest: f.manifest,
    upload: createWalrusBatchRecord(f.preparation), head: null, history: [] }
  const encoded = exportSoulAuthoringRecovery(snapshot), decoded = importSoulAuthoringRecovery(encoded)
  expect(decoded).toEqual(snapshot)
  expect(decoded.upload.preparation.payloads[0]).toBeInstanceOf(Uint8Array)
  expect(encoded).not.toContain(new TextDecoder().decode(f.params.plaintext))
  expect(decoded.upload.preparation.privateRecovery).toEqual(f.preparation.privateRecovery)
  expect(exportSoulAuthoringRecovery(decoded)).toBe(encoded)
  // Optional browser-fixture artifact: generated test ciphertext, never user data.
  if (process.env.S3_RECOVERY_FIXTURE_DIR) {
    await writeFile(join(process.env.S3_RECOVERY_FIXTURE_DIR, 'recovery-fixture.json'), encoded)
    const other = await soulAuthoringManifestFixture(request => { request.operationId = '2'.repeat(32); request.mints[0].name = 'Other creation' })
    await writeFile(join(process.env.S3_RECOVERY_FIXTURE_DIR, 'recovery-conflict.json'), exportSoulAuthoringRecovery({
      schema: 'soulidity.soul-authoring-recovery.v1', manifest: other.manifest,
      upload: createWalrusBatchRecord(other.preparation), head: null, history: [] }))
  }
})
it('retains paid REGISTER and current MINT exact bytes and rejects missing or duplicate history', async () => {
  const f = await authoringPaidCoverVerifierFixture()
  f.register.packet.phase = 'SUCCEEDED'
  f.consume.packet.phase = 'SUCCEEDED'
  const snapshot: SoulAuthoringRecovery = { schema: 'soulidity.soul-authoring-recovery.v1', manifest: f.p.manifest,
    upload: f.upload, head: f.consume, history: [f.register] }
  const decoded = importSoulAuthoringRecovery(exportSoulAuthoringRecovery(snapshot))
  expect(decoded.head).toEqual(f.consume); expect(decoded.history).toEqual([f.register])
  expect(decoded.upload).toEqual(f.upload)
  expect(() => exportSoulAuthoringRecovery({ ...snapshot, history: [] })).toThrow('REGISTER_PACKET_MISSING')
  expect(() => exportSoulAuthoringRecovery({ ...snapshot, history: [f.register, f.consume] })).toThrow('DUPLICATE_PACKET')
  expect(() => exportSoulAuthoringRecovery({ ...snapshot, head: null })).toThrow('HISTORY_WITHOUT_HEAD')
})
it('rejects payload tampering, extra fields and a changed parent intent', async () => {
  const f = await soulAuthoringManifestFixture()
  const snapshot: SoulAuthoringRecovery = { schema: 'soulidity.soul-authoring-recovery.v1', manifest: f.manifest,
    upload: createWalrusBatchRecord(f.preparation), head: null, history: [] }
  const text = exportSoulAuthoringRecovery(snapshot), value = JSON.parse(text)
  value.upload.preparation.payloads[0] = 'AAAA'
  expect(() => importSoulAuthoringRecovery(JSON.stringify(value))).toThrow()
  expect(() => importSoulAuthoringRecovery(JSON.stringify({ ...JSON.parse(text), privateKey: 'never accepted' }))).toThrow()
  const changed = structuredClone(snapshot); changed.manifest.request.operationId = 'a'.repeat(32)
  expect(() => exportSoulAuthoringRecovery(changed)).toThrow()
  expect(() => importSoulAuthoringRecovery(' ' + text)).toThrow('NONCANONICAL')
})
