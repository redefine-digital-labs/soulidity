import { afterEach, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toBase64 } from '@mysten/sui/utils'
import { soulAuthoringPartialRecoveryFixture } from './fixtures/soul-authoring-partial-recovery'
import { proveSoulAuthoringRecovery } from '../../web/lib/soulidity/soul-authoring-restore'
import { exportSoulAuthoringRecovery, importSoulAuthoringRecovery } from '../../web/lib/soulidity/soul-authoring-recovery'
import { advanceCollectionAuthoring } from '../../web/lib/soulidity/collection-authoring-flow'

afterEach(() => vi.restoreAllMocks())
it('re-proves a real 23-row Collection with only its first 10 minted and keeps all remaining encrypted files', async () => {
  const f = await soulAuthoringPartialRecoveryFixture(), transcript = new Map<string, unknown>()
  const encode = (value: unknown) => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? { $bigint: String(v) }
    : v instanceof Uint8Array ? { $bytes: toBase64(v) } : v)
  for (const [name, method] of Object.entries(f.params.client.ledgerService)) {
    if (typeof method !== 'function') continue
    f.params.client.ledgerService[name] = async (...args: any[]) => {
      const value = await method(...args)
      transcript.set(`${name}:${encode(args[0])}`, JSON.parse(encode(value))); return value
    }
  }
  const imported = importSoulAuthoringRecovery(exportSoulAuthoringRecovery(f.bundle))
  const restored = await proveSoulAuthoringRecovery({ ...f.params, bundle: imported })
  expect(restored.manifest.request.mints).toHaveLength(23)
  expect(restored.head?.plan.step).toMatchObject({ kind: 'MINT', chunk: { mintIndices: Array.from({ length: 10 }, (_, i) => i) } })
  expect(restored.upload.consumptions).toHaveLength(1)
  expect(restored.upload.consumptions[0].indices).toEqual(Array.from({ length: 21 }, (_, i) => i))
  expect(restored.upload.preparation.payloads).toEqual(f.p.preparation.payloads)
  expect(restored.upload.preparation.payloads).toHaveLength(47)
  expect(f.bundle.upload.consumptions).toEqual([])
  const progress = vi.fn(), forbidden = vi.fn(() => { throw Error('Read-only recovery attempted a mutation') })
  const outcome = await advanceCollectionAuthoring({ preparation: f.p,
    journal: { read: async () => restored.head, history: async () => restored.history } as any, key: 'fixture',
    execution: { query: (record: any) => f.verifier.query(record, f.params.lifetime.signal), run: forbidden, accept: forbidden } as any,
    signal: f.params.lifetime.signal, queryOnly: true, resolveKiosk: forbidden, progress })
  expect(progress).toHaveBeenLastCalledWith(10, 23)
  expect(outcome).toEqual({ result: null, pending: null }); expect(forbidden).not.toHaveBeenCalled()
  if (process.env.S3_PARTIAL_RECOVERY_FIXTURE_DIR) {
    await writeFile(join(process.env.S3_PARTIAL_RECOVERY_FIXTURE_DIR, 'recovery-fixture.json'), exportSoulAuthoringRecovery(f.bundle))
    await writeFile(join(process.env.S3_PARTIAL_RECOVERY_FIXTURE_DIR, 'recovery-rpc.json'), JSON.stringify([...transcript]))
  }
  // This continuation seam proves only the next requested plan. It neither
  // prepares/signs another packet nor fabricates execution of the remaining 13.
  // Keep it after transcript export so the browser fixture stays read-only.
  const head = restored.head!
  if (head.plan.step.kind !== 'MINT') throw Error('Expected the first completed mint chunk')
  const existingChunk = head.plan.step.chunk
  const query = (record: any) => f.verifier.query(record, f.params.lifetime.signal)
  const accept = vi.fn(async (record: any) => { expect((await query(record)).status).toBe('SUCCEEDED') })
  const stopped = { status: 'MISSING' as const, record: null }
  const run = vi.fn(async (step: any, options: any = {}) => {
    if (options.startNew) return stopped // Controlled boundary; no new chain evidence.
    expect(step).toEqual(head.plan.step)
    const proof = await query(head)
    expect(proof.status).toBe('SUCCEEDED')
    return { ...proof, record: head }
  })
  const continuedProgress = vi.fn()
  const continued = await advanceCollectionAuthoring({ preparation: f.p,
    journal: { read: async () => restored.head, history: async () => [...restored.history] } as any, key: 'fixture',
    execution: { query, run, accept } as any, signal: f.params.lifetime.signal, queryOnly: false,
    resolveKiosk: async () => existingChunk.kiosk, progress: continuedProgress })
  expect(continued).toEqual({ result: null, pending: stopped })
  expect(continuedProgress).toHaveBeenLastCalledWith(10, 23)
  expect(run).toHaveBeenCalledTimes(2)
  expect(accept).toHaveBeenCalledTimes(1)
  expect(accept.mock.calls[0][0]).toEqual(restored.history[0])
  const newRequests = run.mock.calls.filter(([, options]) => options?.startNew)
  expect(newRequests).toEqual([[{ kind: 'MINT', chunk: {
    mintIndices: Array.from({ length: 10 }, (_, i) => i + 10), includePublicFiles: false,
    collectionObjectId: existingChunk.collectionObjectId, kiosk: existingChunk.kiosk,
  } }, { startNew: true, expectedPacket: { bytes: head.packet.bytes, digest: head.packet.digest } }]])
  expect(restored.head).toEqual(head)
  expect(restored.history).toHaveLength(1)
}, 120000)
