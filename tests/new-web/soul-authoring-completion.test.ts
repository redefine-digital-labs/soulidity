import { afterEach, expect, it, vi } from 'vitest'
import { authoringPaidCoverVerifierFixture, authoringZeroFileVerifierFixture } from './fixtures/soul-authoring-verifier'
import { proveSoulAuthoringCompletion, type SoulAuthoringCompletion } from '../../web/lib/soulidity/soul-authoring-completion'
import { createWalrusBatchRecord } from '../../web/lib/upload/walrus-batch-store'

afterEach(() => vi.restoreAllMocks())
async function fixture() {
  const f = await authoringPaidCoverVerifierFixture()
  const snapshot: SoulAuthoringCompletion = { schema: 'soulidity.soul-authoring-completion.v1', manifest: f.p.manifest,
    upload: f.upload, head: f.consume, history: [f.register] }
  return { ...f, snapshot, prove: () => proveSoulAuthoringCompletion(f.w.transport as any, snapshot, f.consume.packet.digest, f.controller.signal) }
}
it('re-proves paid public cover completion and recovers acceptance missing after a crash', async () => {
  const f = await fixture(); expect(f.snapshot.upload.consumptions).toEqual([])
  const result = await f.prove()
  expect(result.upload.consumptions).toHaveLength(1)
  expect(result.upload.consumptions[0].packet.digest).toBe(f.consume.packet.digest)
  expect(result.upload.preparation.payloads).toEqual(f.snapshot.upload.preparation.payloads)
  expect(f.snapshot.upload.consumptions).toEqual([])
})
it('storage payment alone cannot complete a public-cover operation', async () => {
  const f = await fixture(); f.snapshot.head = f.register; f.snapshot.history = []
  await expect(proveSoulAuthoringCompletion(f.w.transport as any, f.snapshot, f.register.packet.digest, f.controller.signal)).rejects.toThrow('INCOMPLETE_CREATION')
})
it('missing mint and stale selected digest never free the author lane', async () => {
  const f = await fixture()
  await expect(proveSoulAuthoringCompletion(f.w.transport as any, f.snapshot, f.register.packet.digest, f.controller.signal)).rejects.toThrow('SELECTED_RESULT_CHANGED')
  f.w.ledgers.delete(f.consume.packet.digest)
  await expect(f.prove()).rejects.toThrow()
})
it('rejects duplicate packets and terminal contradictions', async () => {
  const f = await fixture(); f.snapshot.history.push(f.register)
  await expect(f.prove()).rejects.toThrow('PACKET_SET')
  f.snapshot.history.pop(); f.snapshot.head = { ...f.consume, packet: { ...f.consume.packet, phase: 'FAILED' } }
  await expect(f.prove()).rejects.toThrow('TERMINAL_CONTRADICTION')
})
it('zero-file completed registration can recover its missing local acceptance', async () => {
  const f = await authoringZeroFileVerifierFixture()
  const snapshot: SoulAuthoringCompletion = { schema: 'soulidity.soul-authoring-completion.v1', manifest: f.p.manifest,
    upload: createWalrusBatchRecord(f.p.preparation), head: f.record, history: [] }
  const result = await proveSoulAuthoringCompletion(f.client as any, snapshot, f.record.packet.digest, f.controller.signal)
  expect(result.upload.registration?.packet.digest).toBe(f.record.packet.digest)
})
