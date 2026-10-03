import { afterEach, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toBase64 } from '@mysten/sui/utils'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { marketCancelCheckpointFixture } from './fixtures/market-cancel-operation'
import { authoringPaidCoverVerifierFixture } from './fixtures/soul-authoring-verifier'
import { soulAuthoringManifestFixture } from './fixtures/soul-authoring'
import { createWalrusBatchRecord } from '../../web/lib/upload/walrus-batch-store'
import { proveSoulAuthoringRecovery } from '../../web/lib/soulidity/soul-authoring-restore'
import type { SoulAuthoringRecovery } from '../../web/lib/soulidity/soul-authoring-recovery'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'
import { exportSoulAuthoringRecovery } from '../../web/lib/soulidity/soul-authoring-recovery'

afterEach(() => vi.restoreAllMocks())
async function paid() {
  const f = await authoringPaidCoverVerifierFixture()
  f.register.packet.phase = 'SUCCEEDED'; f.register.packet.signature = null
  f.consume.packet.phase = 'SIGNING'; f.consume.packet.signature = null
  const bundle: SoulAuthoringRecovery = { schema: 'soulidity.soul-authoring-recovery.v1', manifest: f.p.manifest,
    upload: f.upload, head: f.consume, history: [f.register] }
  const params = { bundle, client: f.w.transport as any, target: f.p.manifest.request.target,
    lifetime: { signal: f.controller.signal, getAddress: () => f.p.manifest.request.author, isCurrent: () => true } }
  return { ...f, params }
}
it('re-proves paid registration and a mint missed by the local acceptance without another payment', async () => {
  const f = await paid(), transcript = new Map<string, unknown>()
  const encode = (value: unknown) => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? { $bigint: String(v) }
    : v instanceof Uint8Array ? { $bytes: toBase64(v) } : v)
  if (process.env.S3_PAID_RECOVERY_FIXTURE_DIR) {
    for (const [name, method] of Object.entries(f.params.client.ledgerService)) {
      if (typeof method !== 'function') continue
      f.params.client.ledgerService[name] = async (...args: any[]) => {
        const value = await method(...args)
        transcript.set(`${name}:${encode(args[0])}`, JSON.parse(encode(value))); return value
      }
    }
  }
  const restored = await proveSoulAuthoringRecovery(f.params)
  expect(restored.head?.packet.phase).toBe('SUCCEEDED')
  expect(restored.upload.consumptions[0].packet.digest).toBe(f.consume.packet.digest)
  expect(restored.upload.preparation.payloads).toEqual(f.p.preparation.payloads)
  expect(f.params.bundle.upload.consumptions).toEqual([])
  expect(f.params.bundle.head?.packet.phase).toBe('SIGNING')
  if (process.env.S3_PAID_RECOVERY_FIXTURE_DIR) {
    await writeFile(join(process.env.S3_PAID_RECOVERY_FIXTURE_DIR, 'recovery-fixture.json'), exportSoulAuthoringRecovery(f.params.bundle))
    await writeFile(join(process.env.S3_PAID_RECOVERY_FIXTURE_DIR, 'recovery-rpc.json'), JSON.stringify([...transcript]))
  }
})
it('rejects a different wallet or deployment before accepting imported receipts', async () => {
  const f = await paid()
  await expect(proveSoulAuthoringRecovery({ ...f.params, lifetime: { ...f.params.lifetime,
    getAddress: () => '0x' + 'ab'.repeat(32) } })).rejects.toThrow('LIFETIME_CHANGED')
  await expect(proveSoulAuthoringRecovery({ ...f.params, target: { ...f.params.target,
    callablePackageId: '0x' + 'ab'.repeat(32) } })).rejects.toThrow('DEPLOYMENT_MISMATCH')
})
it('does not trust terminal success from the file when its original mint cannot be found', async () => {
  const f = await paid(); f.params.bundle.head!.packet.phase = 'SUCCEEDED'
  f.w.ledgers.delete(f.consume.packet.digest)
  await expect(proveSoulAuthoringRecovery(f.params)).rejects.toThrow()
})
it('imports an unknown mint without dropping its exact packet or accepting consumption', async () => {
  const f = await paid(), transcript = new Map<string, unknown>()
  f.w.ledgers.delete(f.consume.packet.digest)
  const getTransaction = f.params.client.ledgerService.getTransaction
  f.params.client.ledgerService.getTransaction = async (request: any, ...rest: any[]) => {
    if (request.digest === f.consume.packet.digest) throw Object.assign(new Error('Controlled transaction not found'), { code: 'NOT_FOUND' })
    return getTransaction(request, ...rest)
  }
  const encode = (value: unknown) => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? { $bigint: String(v) }
    : v instanceof Uint8Array ? { $bytes: toBase64(v) } : v)
  if (process.env.S3_UNKNOWN_RECOVERY_FIXTURE_DIR) {
    for (const [name, method] of Object.entries(f.params.client.ledgerService)) {
      if (typeof method !== 'function') continue
      f.params.client.ledgerService[name] = async (...args: any[]) => {
        const key = `${name}:${encode(args[0])}`
        try { const value = await method(...args); transcript.set(key, JSON.parse(encode(value))); return value }
        catch (error: any) { transcript.set(key, { $error: { code: error.code, message: error.message ?? 'Controlled missing transaction' } }); throw error }
      }
    }
  }
  const restored = await proveSoulAuthoringRecovery(f.params)
  expect(restored.head?.packet).toEqual(f.consume.packet)
  expect(restored.head?.packet.phase).toBe('SIGNING')
  expect(restored.upload.consumptions).toEqual([])
  expect(restored.upload.registration?.packet.digest).toBe(f.register.packet.digest)
  expect(restored.upload.preparation.payloads).toEqual(f.p.preparation.payloads)
  if (process.env.S3_UNKNOWN_RECOVERY_FIXTURE_DIR) {
    await writeFile(join(process.env.S3_UNKNOWN_RECOVERY_FIXTURE_DIR, 'recovery-fixture.json'), exportSoulAuthoringRecovery(f.params.bundle))
    await writeFile(join(process.env.S3_UNKNOWN_RECOVERY_FIXTURE_DIR, 'recovery-rpc.json'), JSON.stringify([...transcript]))
  }
})
it('keeps a missing current packet and treats unproved cancellation as potentially signed', async () => {
  const f = await paid()
  const client = { ledgerService: { getServiceInfo: async () => ({ response: { chainId: MAINNET_GENESIS_DIGEST } }),
    getTransaction: async () => { throw { code: 'NOT_FOUND' } } } }
  const cancelled = structuredClone(f.register); cancelled.packet.phase = 'CANCELLED'
  const bundle: SoulAuthoringRecovery = { ...f.params.bundle, upload: createWalrusBatchRecord(f.p.preparation), head: cancelled, history: [] }
  const restored = await proveSoulAuthoringRecovery({ ...f.params, bundle, client: client as any })
  expect(restored.head?.packet.phase).toBe('SIGNING')
  expect(restored.head?.packet.bytes).toBe(cancelled.packet.bytes)
  // Moving that unproved cancellation into history must not free a new head.
  const head = structuredClone(f.consume); head.packet.phase = 'SIGNING'
  await expect(proveSoulAuthoringRecovery({ ...f.params, bundle: { ...bundle, head, history: [cancelled] }, client: client as any })).rejects.toThrow()
})
it('pre-payment import keeps the existing encrypted preparation and requires the expected chain', async () => {
  const f = await soulAuthoringManifestFixture()
  const bundle: SoulAuthoringRecovery = { schema: 'soulidity.soul-authoring-recovery.v1', manifest: f.manifest,
    upload: createWalrusBatchRecord(f.preparation), head: null, history: [] }
  const client = { ledgerService: { getServiceInfo: vi.fn(async () => ({ response: { chainId: MAINNET_GENESIS_DIGEST } })) } }
  const params = { bundle, target: f.request.target, client: client as any,
    lifetime: { signal: f.controller.signal, getAddress: () => f.request.author, isCurrent: () => true } }
  expect(await proveSoulAuthoringRecovery(params)).toEqual(bundle)
  client.ledgerService.getServiceInfo.mockResolvedValueOnce({ response: { chainId: 'wrong-chain' } })
  await expect(proveSoulAuthoringRecovery(params)).rejects.toThrow('CHAIN_MISMATCH')
})
it('imported cancellation history requires a later checkpoint and a second missing query before retirement', async () => {
  const f = await paid(), cancelled = structuredClone(f.register)
  cancelled.packet.phase = 'CANCELLED'
  const data = Transaction.from(cancelled.packet.bytes).getData()
  data.gasData.payment![0].version = '999'
  const bytes = TransactionDataBuilder.restore(data).build()
  const head = structuredClone(cancelled)
  head.packet = { ...head.packet, phase: 'PREPARED', bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) }
  const epoch = BigInt(cancelled.packet.expirationEpoch) + 1n
  const checkpoint = marketCancelCheckpointFixture(String(epoch), '100')
  const events: string[] = []
  const client = { ledgerService: {
    getServiceInfo: async () => ({ response: { chainId: MAINNET_GENESIS_DIGEST } }),
    getTransaction: async ({ digest }: { digest: string }) => { events.push(digest); throw { code: 'NOT_FOUND' } },
    getCheckpoint: async () => {
      events.push('checkpoint')
      return { response: { checkpoint: { sequenceNumber: 100n, digest: checkpoint.evidence.digest,
        summary: { bcs: { value: checkpoint.bytes }, digest: checkpoint.evidence.digest, epoch, sequenceNumber: 100n },
        signature: { epoch, signature: new Uint8Array(48), bitmap: new Uint8Array([1]) } } } }
    },
  } }
  const bundle = { ...f.params.bundle, upload: createWalrusBatchRecord(f.p.preparation), head, history: [cancelled] }
  const restored = await proveSoulAuthoringRecovery({ ...f.params, bundle, client: client as any })
  expect(events).toEqual([cancelled.packet.digest, 'checkpoint', cancelled.packet.digest, head.packet.digest])
  expect(restored.history[0].packet.phase).toBe('RETIRED')
  expect(restored.history[0].packet.bytes).toBe(cancelled.packet.bytes)
  expect(restored.history[0].retirement?.checkpoint).toEqual(checkpoint.evidence)
  expect(restored.head?.packet).toEqual(head.packet)
  expect(restored.upload.registration).toBeNull()
  // Re-import must re-check even the retirement evidence saved in the file.
  expect((await proveSoulAuthoringRecovery({ ...f.params, bundle: restored, client: client as any })).history[0]).toEqual(restored.history[0])
  // A transaction discovered after the expiry read cannot be treated as safely
  // cancelled. Use the original real ledger proof, not a mocked success status.
  let queries = 0
  const changedClient = { ...f.params.client, ledgerService: { ...f.params.client.ledgerService, ...client.ledgerService,
    getTransaction: async (request: any) => {
      if (++queries === 1) throw { code: 'NOT_FOUND' }
      return f.params.client.ledgerService.getTransaction(request)
    },
    getObject: f.params.client.ledgerService.getObject,
    getCheckpoint: (request: any) => request.checkpointId?.oneofKind
      ? f.params.client.ledgerService.getCheckpoint(request) : client.ledgerService.getCheckpoint(),
  } }
  await expect(proveSoulAuthoringRecovery({ ...f.params, bundle, client: changedClient as any })).rejects.toThrow('CANCELLED_HISTORY_UNCONFIRMED')
  expect(bundle.history[0].packet.phase).toBe('CANCELLED')
})
