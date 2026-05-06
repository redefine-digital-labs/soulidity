import { afterEach, describe, expect, it, vi } from 'vitest'

import { createR2TokenUsageGuard } from '../../services/walrus-uploader/src/token-usage-r2'
import { createWalrusUploaderToken } from '../../src/shared/walrus-uploader-token'

const SECRET = 'uploader-secret-with-enough-entropy'
const WALLET = `0x${'1'.repeat(64)}`
const ACCOUNT_ID = 'a46a11e68237ae993416885d2133403a'
const BUCKET = 'walrus-uploader-staging'

function makeTokenPayload(fileCount: number, byteLimit: number) {
  const token = createWalrusUploaderToken({
    secret: SECRET,
    nowMs: Date.now(),
    ttlMs: 60_000,
    walletAddress: WALLET,
    network: 'mainnet',
    fileCount,
    byteLimit,
  })
  const parts = token.split('.')
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}

interface FakeR2Object {
  etag: string
  body: string
}

async function readSignedBody(init: RequestInit | undefined): Promise<string> {
  // The uploader's signedFetch materializes the signed body as Uint8Array so
  // fetch can length-prefix it (R2 rejects chunked PUT with 411). Decode it
  // back to text for the simulator to parse. Older path (Request with stream
  // body) kept as a defensive fallback.
  if (!init) return ''
  if (init instanceof Request) return await init.clone().text()
  if (init.body instanceof Uint8Array) {
    return new TextDecoder().decode(init.body)
  }
  if (init.body instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(init.body))
  }
  if (init.body instanceof ReadableStream) {
    return await new Response(init.body).text()
  }
  if (typeof init.body === 'string') return init.body
  return ''
}

function buildR2Simulator() {
  const objects = new Map<string, FakeR2Object>()
  let seq = 0
  const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String((input as Request).url ?? input)
    const headers = new Headers(init?.headers)
    const authorization = headers.get('Authorization')
    expect(authorization).toMatch(/^AWS4-HMAC-SHA256 /)

    // Path is `/{bucket}/{encodedKey}`. We treat the rest of the path as the
    // key in encoded form so the simulator stays agnostic of how the
    // production code spells `prefix/jti.json`.
    const parsed = new URL(url)
    const pathParts = parsed.pathname.split('/').filter(Boolean)
    const bucket = pathParts[0]
    const key = pathParts.slice(1).join('/')
    expect(bucket).toBe(BUCKET)

    const method = init?.method ?? 'GET'

    if (method === 'PUT') {
      // Real R2 returns 411 when the PUT body is sent chunked. Make sure the
      // uploader hands fetch a length-prefixable body (Uint8Array | string |
      // undefined), never a ReadableStream or a Request with a stream body.
      expect(init).not.toBeInstanceOf(Request)
      expect(init?.body instanceof ReadableStream).toBe(false)
      expect(
        init?.body == null
        || typeof init?.body === 'string'
        || init?.body instanceof Uint8Array,
      ).toBe(true)
      const body = await readSignedBody(init)
      const ifMatch = headers.get('If-Match')
      const ifNoneMatch = headers.get('If-None-Match')
      const live = objects.get(key)
      if (ifNoneMatch === '*') {
        if (live) return new Response('precondition failed', { status: 412 })
        const etag = `"etag-${(seq += 1)}"`
        objects.set(key, { etag, body })
        return new Response('', { status: 200, headers: { ETag: etag } })
      }
      if (ifMatch != null) {
        if (!live || live.etag !== ifMatch) {
          return new Response('precondition failed', { status: 412 })
        }
        const etag = `"etag-${(seq += 1)}"`
        objects.set(key, { etag, body })
        return new Response('', { status: 200, headers: { ETag: etag } })
      }
      return new Response('missing precondition', { status: 400 })
    }

    if (method === 'GET') {
      const live = objects.get(key)
      if (!live) return new Response('not found', { status: 404 })
      return new Response(live.body, { status: 200, headers: { ETag: live.etag } })
    }

    return new Response('unexpected', { status: 500 })
  })
  return { fetchImpl, objects }
}

const GUARD_PARAMS_BASE = {
  accountId: ACCOUNT_ID,
  bucket: BUCKET,
  accessKeyId: 'test-key-id',
  secretAccessKey: 'test-secret-key',
  prefix: 'walrus-uploader/token-usage',
}

describe('walrus-uploader R2 token usage guard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses If-None-Match: * for the first write and accepts the reservation', async () => {
    const { fetchImpl, objects } = buildR2Simulator()
    const guard = createR2TokenUsageGuard({ ...GUARD_PARAMS_BASE, nowMs: () => Date.now(), fetchImpl })
    const payload = makeTokenPayload(5, 1024)

    await expect(guard.tryReserve(payload, 600)).resolves.toEqual({ ok: true })
    expect(objects.size).toBe(1)
    // The PUT must have included `If-None-Match: *` for the first write.
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const firstPut = calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(firstPut).toBeDefined()
    const headers = new Headers((firstPut![1] as RequestInit).headers)
    expect(headers.get('If-None-Match')).toBe('*')
  })

  it('converges on the per-token byte budget under concurrent CAS conflict', async () => {
    const { fetchImpl, objects } = buildR2Simulator()
    const guardA = createR2TokenUsageGuard({ ...GUARD_PARAMS_BASE, nowMs: () => Date.now(), fetchImpl })
    const guardB = createR2TokenUsageGuard({ ...GUARD_PARAMS_BASE, nowMs: () => Date.now(), fetchImpl })

    const payload = makeTokenPayload(5, 1024)

    // Three parallel reservations of 600 bytes each — only one fits the
    // 1024-byte budget. The other two must lose CAS races and exit cleanly.
    const reservations = await Promise.all([
      guardA.tryReserve(payload, 600),
      guardB.tryReserve(payload, 600),
      guardA.tryReserve(payload, 600),
    ])
    const accepted = reservations.filter((r) => r.ok).length
    expect(accepted).toBe(1)
    const rejected = reservations.filter((r) => !r.ok)
    expect(rejected).toHaveLength(2)
    for (const result of rejected) {
      if (result.ok) continue
      expect(result.error).toBe('Walrus uploader token byte limit exceeded')
    }

    expect(objects.size).toBe(1)
    await expect(guardA.getRemainingByteBudget(payload)).resolves.toBe(424)
    await expect(guardB.getRemainingByteBudget(payload)).resolves.toBe(424)

    await guardB.releaseClaim(payload, 600)
    await expect(guardA.getRemainingByteBudget(payload)).resolves.toBe(1024)
  })

  it('fails the reservation when the byte budget would overflow', async () => {
    const { fetchImpl } = buildR2Simulator()
    const guard = createR2TokenUsageGuard({ ...GUARD_PARAMS_BASE, nowMs: () => Date.now(), fetchImpl })
    const payload = makeTokenPayload(5, 1024)

    await expect(guard.tryReserve(payload, 1024)).resolves.toEqual({ ok: true })
    await expect(guard.tryReserve(payload, 1)).resolves.toEqual({
      ok: false,
      error: 'Walrus uploader token byte limit exceeded',
    })
  })

  it('rejects file count beyond the token-issued cap', async () => {
    const { fetchImpl } = buildR2Simulator()
    const guard = createR2TokenUsageGuard({ ...GUARD_PARAMS_BASE, nowMs: () => Date.now(), fetchImpl })
    const payload = makeTokenPayload(1, 1024)

    await expect(guard.tryReserve(payload, 100)).resolves.toEqual({ ok: true })
    await expect(guard.tryReserve(payload, 100)).resolves.toEqual({
      ok: false,
      error: 'Walrus uploader token file count exceeded',
    })
  })
})
