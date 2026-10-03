import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createNativeRequestCache, createNativeReceiverSession, nativeReceiverScope, nativeMessageRequest, NATIVE_RECEIVER_SCHEMA, parseNativeRequest, receiveNativeRequest, trustedNativeOrigin, validNativeHandoff } from '../../web/lib/animacraft/native-handoff'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const handoff = { source: 'animacraft-v8', root: id(1), owner: id(2), returnOrigin: 'https://animacraft.soulidity.ai', returnNonce: 'a'.repeat(32) }
const request = { schemaVersion: NATIVE_RECEIVER_SCHEMA, type: 'PREFLIGHT' as const, requestId: 'b'.repeat(32), nonce: handoff.returnNonce, rootId: handoff.root, signer: handoff.owner }
const sidecar = { version: 1, mode: 'seal-envelope', sealPackageId: id(3), documentId: 'aa', encryptedDek: 'AA==', iv: 'AA==', cipher: 'AES-GCM-256', mimeType: 'text/markdown', fileName: 'SOUL.md', contentHash: 'c'.repeat(64) }
const sync = { ...request, type: 'SYNC' as const, payload: { txDigest: 'a'.repeat(44), soulOnChainId: id(4), contentSidecars: [0, 1, 2].map(kind => ({ kind, name: ['soul', 'default', 'skill'][kind], versionIndex: 0, sidecar })) } }
const response = (value: unknown, status = 200) => {
  if (status === 401) throw Object.assign(new Error('Same wallet required'), { code: 'AUTH_REQUIRED' })
  return value
}
describe('native receiver bridge', () => {
  it('uses only explicit production or trusted development origins and rejects retired URLs', () => {
    expect(validNativeHandoff(handoff)).toBe(true)
    expect(validNativeHandoff({ ...handoff, source: 'animacraft-v5' })).toBe(false)
    expect(validNativeHandoff({ ...handoff, returnOrigin: 'https://evil.example' })).toBe(false)
    expect(trustedNativeOrigin('production', 'https://evil.example')).toBe(handoff.returnOrigin)
    expect(trustedNativeOrigin('development', 'http://localhost:5173')).toBe('http://localhost:5173')
    expect(trustedNativeOrigin('development', 'http://evil.example')).toBe('')
    expect(trustedNativeOrigin('development', 'https://trusted.example/path')).toBe('')
  })
  it('binds opener, origin, nonce, root, owner and exact schemas, excluding private data', () => {
    const opener = {} as Window
    expect(nativeMessageRequest({ source: opener, origin: handoff.returnOrigin, data: request }, opener, handoff)).toEqual(request)
    expect(nativeMessageRequest({ source: {} as Window, origin: handoff.returnOrigin, data: request }, opener, handoff)).toBeNull()
    expect(nativeMessageRequest({ source: opener, origin: 'https://evil.example', data: request }, opener, handoff)).toBeNull()
    for (const field of ['nonce', 'rootId', 'signer', 'requestId']) expect(parseNativeRequest({ ...request, [field]: 'wrong' }, handoff)).toBeNull()
    expect(parseNativeRequest(sync, handoff)).toEqual(sync)
    expect(parseNativeRequest({ ...sync, certificate: {} }, handoff)).toBeNull()
    expect(parseNativeRequest({ ...sync, payload: { ...sync.payload, plaintext: 'secret' } }, handoff)).toBeNull()
    const privateSidecar = structuredClone(sync); Object.assign(privateSidecar.payload.contentSidecars[0].sidecar, { dek: 'secret' })
    expect(parseNativeRequest(privateSidecar, handoff)).toBeNull()
    expect(parseNativeRequest({ ...sync, payload: { ...sync.payload, txDigest: 'x'.repeat(512 * 1024) } }, handoff)).toBeNull()
  })
  it('requires bound chain-read results and propagates wallet/envelope recovery without HTTP or private tokens', async () => {
    const read = vi.fn(async (_request: unknown) => ({ ready: true, rootId: handoff.root, signer: handoff.owner }))
    expect(await receiveNativeRequest(request, read)).toMatchObject({ type: 'RESPONSE', requestId: request.requestId, nonce: request.nonce, result: { ready: true } })
    expect(read).toHaveBeenCalledWith(request)
    expect(read.mock.calls[0]?.[0]).not.toBe(request)
    expect(await receiveNativeRequest(request, async () => ({ ready: true }))).toHaveProperty('error')
    expect(await receiveNativeRequest(request, async () => response({}, 401))).toHaveProperty('error.code', 'AUTH_REQUIRED')
    expect(await receiveNativeRequest(sync, async () => ({ status: 'COMPLETE', soulId: sync.payload.soulOnChainId, transactionDigest: sync.payload.txDigest })))
      .toHaveProperty('result.status', 'COMPLETE')
    expect(await receiveNativeRequest(sync, async () => ({ status: 'COMPLETE', soulId: id(9), transactionDigest: sync.payload.txDigest }))).toHaveProperty('error')
    expect(await receiveNativeRequest(sync, async () => { throw Object.assign(new Error('secret should not leak'), { code: 'NATIVE_RECEIVE_ENVELOPE_PENDING' }) }))
      .toMatchObject({ error: { code: 'NATIVE_RECEIVE_ENVELOPE_PENDING', message: expect.stringContaining('do not mint again') } })
  })
  it('deduplicates concurrent/repeated requests and permits an explicit same-request retry', async () => {
    const cache = createNativeRequestCache()
    const operation = vi.fn(() => receiveNativeRequest(request, (async () => response({}, 401))))
    await Promise.all([cache.run(request, operation), cache.run(request, operation)])
    await cache.run(request, operation)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(await cache.run({ ...request, signer: id(9) }, operation)).toBeNull()
    await cache.run(request, operation, true)
    expect(operation).toHaveBeenCalledTimes(2)
    for (let i = 0; i < 65; i++) await cache.run({ ...request, requestId: i.toString(16).padStart(32, '0') }, operation)
    expect(await cache.run(sync, () => receiveNativeRequest(sync, (async () => response({ status: 'COMPLETE', soulId: sync.payload.soulOnChainId, transactionDigest: sync.payload.txDigest })))))
      .toHaveProperty('result.status', 'COMPLETE')
  })
  it('preserves inflight and SYNC dedup and reports capacity exhaustion explicitly', async () => {
    const cache = createNativeRequestCache()
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    const operation = vi.fn(async () => { await wait; return receiveNativeRequest(request, (async () => response({}, 401))) })
    const pending = Array.from({ length: 64 }, (_, n) => cache.run({ ...request, requestId: n.toString(16).padStart(32, '0') }, operation))
    expect(await cache.run(sync, operation)).toMatchObject({ requestId: sync.requestId, error: { code: 'RECEIVER_BUSY' } })
    release(); await Promise.all(pending)
    expect(operation).toHaveBeenCalledTimes(64)
    const protectedCache = createNativeRequestCache()
    const complete = vi.fn(() => receiveNativeRequest(sync, (async () => response({ status: 'COMPLETE', soulId: sync.payload.soulOnChainId, transactionDigest: sync.payload.txDigest }))))
    for (let n = 0; n < 64; n++) await protectedCache.run({ ...sync, requestId: n.toString(16).padStart(32, '0') }, complete)
    expect(await protectedCache.run(request, operation)).toHaveProperty('error.code', 'RECEIVER_BUSY')
    await protectedCache.run({ ...sync, requestId: '0'.repeat(32) }, complete)
    expect(complete).toHaveBeenCalledTimes(64)
  })
  it('invalidates old chain-read continuations and clears complete identity on every account/handoff change', async () => {
    const account = { id: 'account-A', primarySuiAddress: handoff.owner }
    const transitions = [
      nativeReceiverScope(handoff, null, false),
      nativeReceiverScope(handoff, { ...account, id: 'account-B' }, false),
      nativeReceiverScope(handoff, { ...account, primarySuiAddress: id(8) }, false),
      nativeReceiverScope({ ...handoff, root: id(7) }, account, false),
      nativeReceiverScope({ ...handoff, returnNonce: 'd'.repeat(32) }, account, false),
    ]
    for (const next of transitions) {
      const session = createNativeReceiverSession(); const initial = nativeReceiverScope(handoff, account, false)
      session.setScope(initial)
      const post = vi.fn(); const changed = vi.fn()
      const done = () => receiveNativeRequest(sync, (async () => response({ status: 'COMPLETE', soulId: sync.payload.soulOnChainId, transactionDigest: sync.payload.txDigest })))
      await session.run(sync, done, post, changed)
      expect(session.snapshot()).toMatchObject({ status: 'complete', soulId: sync.payload.soulOnChainId, last: sync })
      let release!: (response: unknown) => void
      const http = new Promise<unknown>(resolve => { release = resolve })
      const old = session.run({ ...sync, requestId: 'e'.repeat(32) }, () => receiveNativeRequest(sync, (() => http)), post, changed)
      await Promise.resolve()
      session.setScope(next)
      expect(session.matchesScope(initial)).toBe(false)
      expect(session.snapshot()).toEqual({ status: 'waiting', soulId: null, last: null, pending: false, errorMessage: null })
      post.mockClear(); changed.mockClear()
      release(response({ status: 'COMPLETE', soulId: sync.payload.soulOnChainId, transactionDigest: sync.payload.txDigest }))
      await old
      expect(post).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled()
      expect(session.snapshot().soulId).toBeNull()
      // Same request ID in a different account/handoff generation must not use its old cache.
      const newOperation = vi.fn(done)
      await session.run(sync, newOperation, post, changed)
      expect(newOperation).toHaveBeenCalledTimes(1)
    }
  })
  it('late PREFLIGHT replies keep their exact result without downgrading completed SYNC UI or retry target', async () => {
    const session = createNativeReceiverSession(); session.setScope(nativeReceiverScope(handoff, null, false))
    const post = vi.fn(); const changed = vi.fn()
    let release!: (response: unknown) => void
    const http = new Promise<unknown>(resolve => { release = resolve })
    const slow = session.run(request, () => receiveNativeRequest(request, (() => http)), post, changed)
    const completed = { ...sync, requestId: 'c'.repeat(32) }
    await session.run(completed, () => receiveNativeRequest(completed, (async () => response({ status: 'COMPLETE', soulId: sync.payload.soulOnChainId, transactionDigest: sync.payload.txDigest }))), post, changed)
    release(response({ ready: true, rootId: handoff.root, signer: handoff.owner })); await slow
    expect(session.snapshot()).toMatchObject({ status: 'complete', soulId: sync.payload.soulOnChainId, last: completed, pending: false })
    expect(post.mock.calls[1][0]).toMatchObject({ requestId: request.requestId, result: { ready: true } })
    await session.run({ ...request, requestId: 'd'.repeat(32) }, () => receiveNativeRequest(request, (async () => response({}, 401))), post, changed)
    expect(session.snapshot()).toMatchObject({ status: 'complete', last: completed })
    expect(post.mock.calls[2][0]).toHaveProperty('error.code', 'AUTH_REQUIRED')
  })
  it('replaces the reachable legacy mint UI, preserving login and account navigation', () => {
    const page = readFileSync('web/app/integrations/animacraft/page.tsx', 'utf8')
    const client = readFileSync('web/app/integrations/animacraft/integration-client.tsx', 'utf8')
    const entry = readFileSync('web/app/integrations/animacraft/client-entry.tsx', 'utf8')
    expect(page).toContain('<AnimacraftIntegrationEntry />')
    expect(entry).toContain('source: single(\'source\')')
    expect(client).not.toContain('useAnimacraftMint')
    expect(client).not.toContain('commerceV5')
    expect(client).toContain('useLogin()')
    expect(client).not.toContain('getAuthHeaders')
    expect(client).toContain('receiveBrowserNativeRequest')
    expect(client).toContain('window.opener.postMessage')
    expect(client).toContain('href="/my-souls"')
  })
})
