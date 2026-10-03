import { afterEach, expect, it, vi } from 'vitest'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { blobIdFromInt } from '../../web/node_modules/@mysten/walrus/dist/index.mjs'
import { prepareWalrusBatch, unlockWalrusBatchMaterials, walrusBatchHash } from '../../web/lib/upload/walrus-batch-preparation'
import { createWalrusBatchSealProtector, parseWalrusBatchSealContext, verifyWalrusBatchInitialSidecars,
  walrusBatchProtectionCommitment } from '../../web/lib/upload/walrus-batch-seal'
import { contentAppendPreparationFixture, contentAppendFixtureId as id } from './fixtures/content-append-preparation'

afterEach(() => vi.restoreAllMocks())
async function fixture() {
  const f = await contentAppendPreparationFixture()
  let current = true
  const lifetime = { signal: f.controller.signal, getAddress: f.params.wallet.getAddress, isCurrent: () => current }
  const scope = { network: 'mainnet' as const, owner: f.signer.toSuiAddress(), releaseHash: '1'.repeat(64),
    operationId: 'batch-prepared-operation', intentHash: '2'.repeat(64) }
  const context = { schema: 'soulidity.walrus-batch-seal.v1' as const, scope, originalPackageId: id(1), callablePackageId: id(10),
    recoveryNonce: '3'.repeat(32), sealConfig: f.params.sealConfig,
    slots: [{ fileIndex: 0, contentObjectId: id(4), kind: 0, name: 'soul', versionIndex: '0' },
      { fileIndex: 1, contentObjectId: id(4), kind: 1, name: 'default', versionIndex: '0' }] }
  const crypto = createWalrusBatchSealProtector({ context, wallet: f.params.wallet, lifetime })
  const client = { reset: vi.fn(), systemState: vi.fn(async () => ({ committee: { epoch: 10, n_shards: 4 } })),
    encodeBlob: vi.fn(async (bytes: Uint8Array) => ({ blobId: blobIdFromInt(BigInt(`0x${walrusBatchHash(bytes)}`)),
      rootHash: new Uint8Array(32).fill(6), metadata: { V1: { unencoded_length: String(bytes.length), encoding_type: 'RS2' } } })) }
  const files = ['soul', 'memory'].map(name => ({ file: new File([f.params.plaintext], `${name}.md`, { type: 'text/markdown' }),
    kind: 'soul-content' as const, uploadType: 'encrypted' as const }))
  const prepare = () => prepareWalrusBatch({ scope, files, client: client as any, lifetime, protector: crypto.protector, storageEpochs: 5 })
  return { ...f, scope, lifetime, context, crypto, client, prepare, invalidate: () => { current = false } }
}
it('runs actual batch AES + Seal preparation with zero prompts and cold unlocks the entire batch with one session', async () => {
  const f = await fixture(), p = await f.prepare(), sidecars = f.crypto.sidecars(p.manifestHash)
  expect(f.sign).not.toHaveBeenCalled(); expect(f.decryptCall).not.toHaveBeenCalled()
  expect(sidecars).toHaveLength(2)
  expect(verifyWalrusBatchInitialSidecars(f.context, p.manifest, sidecars)).toEqual(sidecars)
  expect(JSON.stringify(p)).not.toContain('private memory:'); expect(JSON.stringify(p)).not.toContain('"dek"')
  const commitment = walrusBatchProtectionCommitment(p.privateRecovery!)
  const cold = createWalrusBatchSealProtector({ context: structuredClone(f.context), wallet: f.params.wallet, lifetime: f.lifetime })
  const materials = await unlockWalrusBatchMaterials({ preparation: structuredClone(p), lifetime: f.lifetime,
    unlock: input => cold.unlock(input, commitment) })
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.decryptCall).toHaveBeenCalledOnce()
  expect(materials.map(m => m.index)).toEqual([0, 1])
  materials.forEach(row => { expect(fromBase64(row.material.dek)).toHaveLength(32); row.material.dek = ''; row.material.iv = '' })
  expect(f.unwrapped.every(bytes => bytes.every(byte => byte === 0))).toBe(true)
  expect(() => cold.sidecars(p.manifestHash)).toThrow('SIDECARS_NOT_PREPARED')
})
it.each(['package', 'nonce', 'owner', 'scope', 'body', 'commitment'])('rejects substituted %s before requesting the cold session', async mutation => {
  const f = await fixture(), p = await f.prepare(), context = structuredClone(f.context), protection = structuredClone(p.privateRecovery!)
  let commitment = walrusBatchProtectionCommitment(protection)
  if (mutation === 'package') context.originalPackageId = id(2)
  if (mutation === 'nonce') context.recoveryNonce = 'a'.repeat(32)
  if (mutation === 'owner') context.scope.owner = id(99)
  if (mutation === 'scope') context.scope.intentHash = 'a'.repeat(64)
  if (mutation === 'body') { const bytes = fromBase64(protection.encrypted); bytes[bytes.length - 1] ^= 1; protection.encrypted = toBase64(bytes) }
  if (mutation === 'commitment') commitment = 'a'.repeat(64)
  const cold = createWalrusBatchSealProtector({ context, wallet: f.params.wallet, lifetime: f.lifetime })
  await expect(cold.unlock({ manifest: p.manifest, protection, signal: f.controller.signal }, commitment)).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.decryptCall).not.toHaveBeenCalled()
})
it.each(['id', 'file', 'order', 'hash', 'keyset', 'extra'])('rejects initial sidecar %s substitution', async mutation => {
  const f = await fixture(), p = await f.prepare(), rows = f.crypto.sidecars(p.manifestHash), context = structuredClone(f.context)
  if (mutation === 'id') context.slots[1].contentObjectId = id(5)
  if (mutation === 'file') rows[1].sidecar.fileName = 'changed.md'
  if (mutation === 'order') rows.reverse()
  if (mutation === 'hash') rows[1].sidecar.contentHash = 'f'.repeat(64)
  if (mutation === 'keyset') context.sealConfig.serverConfigs[0].objectId = id(8)
  if (mutation === 'extra') Object.assign(rows[1].sidecar, { dek: 'not-allowed' })
  expect(() => verifyWalrusBatchInitialSidecars(context, p.manifest, rows)).toThrow()
  expect(f.sign).not.toHaveBeenCalled()
})
it.each(['duplicate', 'order', 'raw-secret', 'zero-id', 'bad-name', 'wrong-kind', 'wrong-version'])('rejects malformed %s context before crypto', async mutation => {
  const f = await fixture(), c = structuredClone(f.context)
  if (mutation === 'duplicate') c.slots[1] = { ...c.slots[0] }
  if (mutation === 'order') c.slots.reverse()
  if (mutation === 'raw-secret') Object.assign(c, { secret: 'secret' })
  if (mutation === 'zero-id') c.slots[0].contentObjectId = id(0)
  if (mutation === 'bad-name') c.slots[1].name = 'other'
  if (mutation === 'wrong-kind') c.slots[1].kind = -1
  if (mutation === 'wrong-version') c.slots[1].versionIndex = '18446744073709551616'
  expect(() => parseWalrusBatchSealContext(c)).toThrow()
  expect(f.sign).not.toHaveBeenCalled()
})
it('lifecycle invalidation blocks preparation and no late sidecars are exposed', async () => {
  const f = await fixture(), pending = f.prepare()
  f.invalidate()
  await expect(pending).rejects.toThrow('LIFETIME_CHANGED')
  expect(() => f.crypto.sidecars('a'.repeat(64))).toThrow('SIDECARS_NOT_PREPARED'); expect(f.sign).not.toHaveBeenCalled()
})
it('wallet change at the cold signature boundary prevents decryption', async () => {
  const f = await fixture(), p = await f.prepare()
  f.sign.mockImplementation(async message => { f.setAddress(null); return (await f.signer.signPersonalMessage(message)).signature })
  await expect(f.crypto.unlock({ manifest: p.manifest, protection: p.privateRecovery!, signal: f.controller.signal },
    walrusBatchProtectionCommitment(p.privateRecovery!))).rejects.toThrow('LIFETIME_CHANGED')
  expect(f.decryptCall).not.toHaveBeenCalled()
})
it('reserves the protector before awaiting and never exposes another concurrent preparation\'s keys', async () => {
  const f = await fixture(), attempts = await Promise.allSettled([f.prepare(), f.prepare()])
  expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const rejected = attempts.find(result => result.status === 'rejected') as PromiseRejectedResult
  expect(rejected.reason.message).toContain('PROTECTOR_ALREADY_USED')
  const completed = attempts.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof f.prepare>>>
  expect(f.crypto.sidecars(completed.value.manifestHash)).toHaveLength(2)
  expect(() => f.crypto.sidecars('a'.repeat(64))).toThrow('SIDECAR_MANIFEST_MISMATCH')
  expect(f.sign).not.toHaveBeenCalled()
})
