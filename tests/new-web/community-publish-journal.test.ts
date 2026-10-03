import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPublicCommunityPublishIntent, publicCommunityPublishCommitment, type PublicCommunityPublishIntent } from '../../packages/soulidity-sdk/src/community-publish-intent'
import { browserCommunityPublishJournalStore, communityPublishLane, communityPublishUploadScope,
  CommunityJournalPersistenceError, type CommunityPublishJournal, type CommunityPublishLease } from '../../web/lib/community/publish-journal'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
function intent(): PublicCommunityPublishIntent { return createPublicCommunityPublishIntent({
  deployment: { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '35834a8a' }, registryId: id(4) },
  owner: id(5), authorId: id(7), operationId: 'a'.repeat(32), kind: 'post', postType: 0, channel: 0,
  document: { schema: 'soulidity.public-post.v1', title: 'Title', content: 'Body', tags: [] },
}) }
const record = (): CommunityPublishJournal => ({ schema: 'soulidity.community-publish-journal.v1', intent: intent(), receipt: null })
beforeEach(() => {
  vi.restoreAllMocks()
  const rows = new Map<string, string>()
  const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
  vi.stubGlobal('window', { localStorage: storage }); vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', {})
  const locks = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (key: string, _options: unknown, callback: (lock: object | null) => Promise<unknown>) => {
      if (locks.has(key)) return callback(null)
      locks.add(key); try { return await callback({ name: key }) } finally { locks.delete(key) }
    },
  } })
})
afterEach(() => vi.unstubAllGlobals())
describe('community paid-publication parent journal', () => {
  it('recovers frozen intent in a fresh store even from a new operation ID', async () => {
    const store = browserCommunityPublishJournalStore(), r = record()
    await store.exclusive(r.intent, lease => lease.write(r))
    const other = intent(); other.operationId = 'b'.repeat(32)
    expect(await browserCommunityPublishJournalStore().inspect(other)).toEqual(r)
    expect(communityPublishUploadScope(other)).not.toBe(communityPublishUploadScope(r.intent))
    await store.exclusive(other, lease => expect(lease.write({ ...r, intent: other })).rejects.toThrow('FROZEN_OPERATION_REQUIRED'))
  })
  it('isolates wallet, release and comment parents', () => {
    const i = intent(), key = communityPublishLane(i)
    i.owner = id(8); expect(communityPublishLane(i)).not.toBe(key)
    i.owner = id(5); i.deployment.profile.callablePackageId = id(8); expect(communityPublishLane(i)).not.toBe(key)
    const c: PublicCommunityPublishIntent = { deployment: i.deployment, owner: i.owner, authorId: i.authorId,
      operationId: i.operationId, kind: 'comment', postId: id(9), document: { schema: 'soulidity.public-comment.v1', content: 'Reply' } }
    const parent = communityPublishLane(c); c.postId = id(10); expect(communityPublishLane(c)).not.toBe(parent)
  })
  it('persists a matching receipt and forbids clearing or swapping it', async () => {
    const store = browserCommunityPublishJournalStore(), r = record(), c = await publicCommunityPublishCommitment(r.intent)
    await store.exclusive(r.intent, async lease => {
      await lease.write(r)
      r.receipt = { schema: 'soulidity.community-upload.v1', intentHash: c.intentHash,
        reference: { blobObjectId: id(9), blobId: 'A'.repeat(43), sha256: c.contentHash, byteLength: String(c.bytes.length) } }
      await lease.write(r)
      await expect(lease.write({ ...r, receipt: null })).rejects.toThrow('RECEIPT_IMMUTABLE')
      r.receipt.reference.blobObjectId = id(10)
      await expect(lease.write(r)).rejects.toThrow('RECEIPT_IMMUTABLE')
    })
  })
  it('rejects corrupted or another-wallet records rather than reporting empty', async () => {
    const r = record(), key = communityPublishLane(r.intent), store = browserCommunityPublishJournalStore()
    localStorage.setItem(key, '{bad')
    await expect(store.inspect(r.intent)).rejects.toThrow()
    const wrong = record(); wrong.intent.owner = id(8)
    localStorage.setItem(key, JSON.stringify(wrong))
    await expect(store.inspect(r.intent)).rejects.toThrow('SCOPE_MISMATCH')
  })
  it('fails closed without Web Locks', () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    expect(browserCommunityPublishJournalStore).toThrow('STORAGE_AND_LOCKS_REQUIRED')
  })
  it('blocks a second tab while the first lease is held', async () => {
    const a = browserCommunityPublishJournalStore(), b = browserCommunityPublishJournalStore()
    await a.exclusive(intent(), async () => {
      await expect(b.exclusive(intent(), async () => undefined)).rejects.toThrow('BUSY_IN_ANOTHER_TAB')
    })
    await expect(b.exclusive(intent(), async () => 'ok')).resolves.toBe('ok')
  })
  it('rejects writes through a leaked expired lease', async () => {
    let leaked!: CommunityPublishLease
    await browserCommunityPublishJournalStore().exclusive(intent(), async lease => { leaked = lease })
    await expect(leaked.write(record())).rejects.toThrow('LEASE_EXPIRED')
    await expect(leaked.read()).rejects.toThrow('LEASE_EXPIRED')
  })
  it('rejects concurrent writes even inside the same lease', async () => {
    const store = browserCommunityPublishJournalStore(), r = record()
    await store.exclusive(r.intent, async lease => {
      const first = lease.write(r)
      const second = { ...r, intent: intent() }; second.intent.document.content = 'other'
      await expect(lease.write(second)).rejects.toThrow('CONCURRENT_WRITE')
      await first
      expect(await lease.read()).toEqual(r)
    })
  })
  it.each(['quota', 'silent'])('retains exportable record on %s persistence failure', async mode => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { if (mode === 'quota') throw new Error('quota') })
    const r = record(), store = browserCommunityPublishJournalStore()
    await store.exclusive(r.intent, async lease => {
      try { await lease.write(r); throw new Error('Expected failure') }
      catch (error) {
        expect(error).toBeInstanceOf(CommunityJournalPersistenceError)
        const failure = error as CommunityJournalPersistenceError
        expect(failure.record).toEqual(r)
        failure.record.intent.document.content = 'mutate export'
        expect(failure.record).toEqual(r)
      }
    })
  })
  it('retains a paid receipt when reading the previous journal fails', async () => {
    const r = record(), store = browserCommunityPublishJournalStore()
    await store.exclusive(r.intent, async lease => {
      await lease.write(r)
      const c = await publicCommunityPublishCommitment(r.intent)
      r.receipt = { schema: 'soulidity.community-upload.v1', intentHash: c.intentHash,
        reference: { blobObjectId: id(9), blobId: 'A'.repeat(43), sha256: c.contentHash, byteLength: String(c.bytes.length) } }
      vi.spyOn(window.localStorage, 'getItem').mockImplementationOnce(() => { throw new Error('read denied') })
      try { await lease.write(r); throw new Error('Expected failure') }
      catch (error) {
        expect(error).toBeInstanceOf(CommunityJournalPersistenceError)
        expect((error as CommunityJournalPersistenceError).record).toEqual(r)
      }
      expect((await lease.read())?.receipt).toBeNull()
    })
  })
  it('rejects extra fields and oversize storage before parsing', async () => {
    const store = browserCommunityPublishJournalStore(), r = record()
    await store.exclusive(r.intent, lease => expect(lease.write({ ...r, secret: true } as CommunityPublishJournal)).rejects.toThrow('SCHEMA_INVALID'))
    localStorage.setItem(communityPublishLane(r.intent), 'x'.repeat(2 * 1024 * 1024 + 1))
    await expect(store.inspect(r.intent)).rejects.toThrow('TOO_LARGE')
  })
  it('archives exact history before clearing the active lane', async () => {
    const store = browserCommunityPublishJournalStore(), r = record(), key = communityPublishLane(r.intent)
    await store.exclusive(r.intent, async lease => { await lease.write(r); await lease.archive(r) })
    expect(await store.inspect(r.intent)).toBeNull()
    expect(JSON.parse(localStorage.getItem(`${key}:history:${r.intent.operationId}`)!)).toEqual(r)
  })
  it('leaves the active journal if history persistence fails', async () => {
    const store = browserCommunityPublishJournalStore(), r = record()
    await store.exclusive(r.intent, async lease => {
      await lease.write(r)
      vi.spyOn(window.localStorage, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
      await expect(lease.archive(r)).rejects.toBeInstanceOf(CommunityJournalPersistenceError)
      expect(await lease.read()).toEqual(r)
    })
  })
  it('releases the mutation guard when archive input validation fails', async () => {
    const store = browserCommunityPublishJournalStore(), r = record()
    await store.exclusive(r.intent, async lease => {
      await expect(lease.archive({ ...r, schema: 'invalid' } as any)).rejects.toThrow('SCHEMA_INVALID')
      await lease.write(r)
      expect(await lease.read()).toEqual(r)
    })
  })
})
