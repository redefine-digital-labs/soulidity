import { afterEach, expect, it, vi } from 'vitest'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { WalrusFile } from '../../web/node_modules/@mysten/walrus/dist/index.mjs'
import { batchDurableFixture } from './fixtures/walrus-batch-durable'
import { exportWalrusBatchPreparation, importWalrusBatchPreparation, parseWalrusBatchPreparation, prepareWalrusBatch,
  unlockWalrusBatchMaterials, walrusBatchHash, walrusBatchJsonHash, walrusBatchPreparationHash } from '../../web/lib/upload/walrus-batch-preparation'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('validates original Files, uses real RS2/AES, wraps all private materials once and clears the callback copy', async () => {
  const f = await batchDurableFixture(), p = f.preparation
  expect(p.manifest.files.map(file => file.uploadType)).toEqual(['public', 'encrypted', 'encrypted'])
  expect(f.protector.protect).toHaveBeenCalledTimes(1); expect(f.protector.verify).toHaveBeenCalledTimes(1)
  expect(f.getRawMaterial().schema).toBe('soulidity.walrus-batch-private.v1')
  expect(f.getRawMaterial().materials.map((entry: any) => entry.index)).toEqual([1, 2])
  expect([...f.getCallbackInput()!].every(byte => byte === 0)).toBe(true)
  expect(p.payloads[0]).toEqual(new Uint8Array(await f.files[0].file.arrayBuffer()))
  for (const index of [1, 2]) {
    expect(p.payloads[index]).not.toEqual(new Uint8Array(await f.files[index].file.arrayBuffer()))
    expect(p.payloads[index].length).toBe(f.files[index].file.size + 16)
    expect(walrusBatchHash(p.payloads[index])).toBe(p.manifest.files[index].payloadHash)
  }
  expect(f.base.sign).not.toHaveBeenCalled(); expect(f.base.client.core.executeTransaction).not.toHaveBeenCalled()
  expect(f.write).not.toHaveBeenCalled(); expect(f.confirmations).not.toHaveBeenCalled()
})
it('cold canonical export retains exactly paid ciphertext, without DEKs, plaintext, Files or SDK closures', async () => {
  const f = await batchDurableFixture(), text = exportWalrusBatchPreparation(f.preparation)
  expect(text).not.toMatch(/"dek"|"iv"|"plaintext"|__continuation|sliversByNode|signAndExecute/)
  expect(text).not.toContain('Private soul document')
  const recovered = importWalrusBatchPreparation(text)
  expect(exportWalrusBatchPreparation(recovered)).toBe(text)
  expect(walrusBatchPreparationHash(recovered)).toBe(walrusBatchPreparationHash(f.preparation))
  for (const [index, bytes] of recovered.payloads.entries()) {
    const encoded = await f.walrus.encodeBlob(bytes)
    expect(encoded.blobId).toBe(recovered.manifest.files[index].encoding.blobId)
    expect(toBase64(encoded.rootHash)).toBe(recovered.manifest.files[index].encoding.rootHash)
  }
  expect(f.protector.protect).toHaveBeenCalledTimes(1)
})
it('canonical commitments and cold export do not depend on nested object insertion order; array order remains binding', async () => {
  const f = await batchDurableFixture(), original = f.preparation
  const reverse = (value: any): any => value instanceof Uint8Array ? new Uint8Array(value)
    : Array.isArray(value) ? value.map(reverse)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverse(entry)])) : value
  const reordered = reverse(original)
  expect(walrusBatchJsonHash(reordered.manifest)).toBe(original.manifestHash)
  expect(walrusBatchPreparationHash(reordered)).toBe(walrusBatchPreparationHash(original))
  expect(exportWalrusBatchPreparation(reordered)).toBe(exportWalrusBatchPreparation(original))
  expect(exportWalrusBatchPreparation(importWalrusBatchPreparation(exportWalrusBatchPreparation(reordered)))).toBe(exportWalrusBatchPreparation(original))
  const changed = structuredClone(original.manifest); changed.files.reverse()
  expect(walrusBatchJsonHash(changed)).not.toBe(original.manifestHash)
})
it('one cold private unlock verifies every AES-GCM payload and never re-encrypts or signs', async () => {
  const f = await batchDurableFixture(), unlock = vi.fn(f.unlock)
  const output = await unlockWalrusBatchMaterials({ preparation: importWalrusBatchPreparation(exportWalrusBatchPreparation(f.preparation)),
    lifetime: f.lifecycle, unlock })
  expect(unlock).toHaveBeenCalledTimes(1); expect(output.map(entry => entry.index)).toEqual([1, 2])
  expect(output).toEqual(f.getRawMaterial().materials)
  expect(f.base.sign).not.toHaveBeenCalled(); expect(f.protector.protect).toHaveBeenCalledTimes(1)
})
it('public duplicate payloads remain separate ordered files and do not invoke private wrapping', async () => {
  const f = await batchDurableFixture({ privateFiles: false })
  expect(f.preparation.manifest.files[0].encoding.blobId).toBe(f.preparation.manifest.files[1].encoding.blobId)
  expect(f.preparation.manifest.files.map(file => file.index)).toEqual([0, 1, 2])
  expect(f.preparation.privateRecovery).toBeNull(); expect(f.protector.protect).not.toHaveBeenCalled()
})
it('WalrusFile restoration uses its actual public from API, without passing ciphertext back through encryption', async () => {
  const f = await batchDurableFixture(), bytes = f.preparation.payloads[1]
  const file = WalrusFile.from({ contents: bytes, identifier: 'private-1', tags: { type: 'ciphertext' } })
  expect(await file.bytes()).toEqual(bytes); expect(await file.getIdentifier()).toBe('private-1')
  expect(await file.getTags()).toEqual({ type: 'ciphertext' })
  expect(f.protector.protect).toHaveBeenCalledTimes(1)
})
it.each(['payload', 'manifest', 'index', 'private missing', 'wrong private binding', 'raw key field', 'wrong source size', 'wrong encoding'])(
  'rejects %s corruption before a recovery record can be used', async mode => {
    const f = await batchDurableFixture(), p: any = structuredClone(f.preparation)
    if (mode === 'payload') p.payloads[1][0] ^= 1
    if (mode === 'manifest') p.manifest.scope.owner = `0x${'c'.repeat(64)}`
    if (mode === 'index') p.manifest.files[1].index = 0
    if (mode === 'private missing') p.privateRecovery = null
    if (mode === 'wrong private binding') p.privateRecovery.contextHash = 'c'.repeat(64)
    if (mode === 'raw key field') p.privateRecovery.dek = 'unsafe'
    if (mode === 'wrong source size') p.manifest.files[1].plaintextByteLength++
    if (mode === 'wrong encoding') p.manifest.files[1].encoding.encodingType = 'RedStuff'
    expect(() => parseWalrusBatchPreparation(p)).toThrow()
    expect(f.write).not.toHaveBeenCalled(); expect(f.base.sign).not.toHaveBeenCalled()
  })
it('refuses a wrong-key private recovery even when outer payload hashes are rewritten consistently', async () => {
  const f = await batchDurableFixture(), p = structuredClone(f.preparation)
  p.payloads[1][0] ^= 1; p.manifest.files[1].payloadHash = walrusBatchHash(p.payloads[1]); p.manifestHash = walrusBatchJsonHash(p.manifest)
  p.privateRecovery!.contextHash = p.manifestHash
  await expect(unlockWalrusBatchMaterials({ preparation: p, lifetime: f.lifecycle, unlock: f.unlock })).rejects.toThrow()
})
it('rejects noncanonical base64 and JSON exports without any adoption/network callback', async () => {
  const f = await batchDurableFixture(), text = exportWalrusBatchPreparation(f.preparation), value = JSON.parse(text)
  expect(() => importWalrusBatchPreparation(` ${text}`)).toThrow('IMPORT_NONCANONICAL')
  value.payloads[0] = value.payloads[0].replace(/=+$/, '')
  expect(() => importWalrusBatchPreparation(JSON.stringify(value))).toThrow()
  expect(fromBase64(f.preparation.privateRecovery!.encrypted).length).toBeGreaterThan(32)
})
it('freezes caller scope and stops on wallet ABA while private wrapping is pending; late raw and wrapped copies are cleared', async () => {
  const f = await batchDurableFixture({ autoPrepare: false })
  let input: Uint8Array | undefined, finish: ((value: Uint8Array) => void) | undefined
  const late = new Uint8Array([1, 2, 3])
  vi.mocked(f.protector.protect).mockImplementation(({ plaintext }) => { input = plaintext; return new Promise(resolve => { finish = resolve }) })
  const pending = prepareWalrusBatch({ scope: f.scope, files: f.files, storageEpochs: 3, client: f.walrus, lifetime: f.lifecycle, protector: f.protector })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  f.scope.operationId = 'replacement'; f.stale(); finish!(late)
  await expect(pending).rejects.toThrow('LIFETIME_CHANGED')
  expect([...input!].every(byte => byte === 0)).toBe(true); expect([...late]).toEqual([0, 0, 0])
  expect(f.protector.verify).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled()
})
it('aborting a private unlock discards its late decrypted key bundle', async () => {
  const f = await batchDurableFixture(), raw = await f.unlock({ protection: f.preparation.privateRecovery! })
  let release: ((value: Uint8Array) => void) | undefined
  const promise = unlockWalrusBatchMaterials({ preparation: f.preparation, lifetime: f.lifecycle,
    unlock: () => new Promise(resolve => { release = resolve }) })
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  f.controller.abort(); await expect(promise).rejects.toThrow(); release!(raw)
  await vi.waitFor(() => expect([...raw].every(byte => byte === 0)).toBe(true))
})
