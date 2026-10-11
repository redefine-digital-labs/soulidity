import { expect, it } from 'vitest'
import { encryptCollectionDraft, decryptCollectionDraft, type CollectionDraftSnapshot } from '../../web/lib/collections/collection-draft-store'
const draft = (): CollectionDraftSnapshot => ({ fields: { name: 'Private draft', floorPrice: '1.25', unlimitedSupply: false },
  rows: [{ name: 'Soul', description: 'Private source', tags: ['one'], creatorRoyaltyBps: 500 }],
  errors: { batch: [], folders: [] }, files: [{ role: 'memory', row: 1,
    file: new File(['private memory bytes'], 'memory.md', { type: 'text/markdown', lastModified: 123 }) }] })
it('encrypts metadata and files and restores names, MIME, exact bytes and fields', async () => {
  const input = draft(), encrypted = await encryptCollectionDraft('wallet-a', 1, input)
  expect(encrypted.key.extractable).toBe(false)
  expect(new TextDecoder().decode(encrypted.ciphertext)).not.toContain('private memory')
  const restored = await decryptCollectionDraft('wallet-a', encrypted)
  expect(restored.fields).toEqual(input.fields); expect(restored.rows).toEqual(input.rows)
  expect(restored.files[0].file.name).toBe('memory.md'); expect(restored.files[0].file.type).toBe('text/markdown')
  expect(restored.files[0].file.lastModified).toBe(123)
  expect(await restored.files[0].file.text()).toBe('private memory bytes')
})
it('rejects scope/revision changes and altered ciphertext', async () => {
  const encrypted = await encryptCollectionDraft('wallet-a', 1, draft())
  await expect(decryptCollectionDraft('wallet-b', encrypted)).rejects.toThrow()
  await expect(decryptCollectionDraft('wallet-a', { ...encrypted, revision: 2 })).rejects.toThrow()
  new Uint8Array(encrypted.ciphertext)[0] ^= 1
  await expect(decryptCollectionDraft('wallet-a', encrypted)).rejects.toThrow()
})
it('freezes form metadata before asynchronous file reads', async () => {
  const input = draft(), pending = encryptCollectionDraft('wallet-a', 1, input)
  input.fields.name = 'Changed'; input.rows[0].tags.push('later'); input.files.length = 0
  const restored = await decryptCollectionDraft('wallet-a', await pending)
  expect(restored.fields.name).toBe('Private draft'); expect(restored.rows[0].tags).toEqual(['one'])
  expect(restored.files).toHaveLength(1)
})
it('rejects duplicate file identities and invalid rows before an envelope can be committed', async () => {
  const duplicate = draft(); duplicate.files.push({ ...duplicate.files[0] })
  await expect(encryptCollectionDraft('wallet-a', 1, duplicate)).rejects.toThrow('Duplicate draft file')
  const invalid = draft(); invalid.files[0].row = -1
  await expect(encryptCollectionDraft('wallet-a', 1, invalid)).rejects.toThrow('Unreadable draft file')
})
