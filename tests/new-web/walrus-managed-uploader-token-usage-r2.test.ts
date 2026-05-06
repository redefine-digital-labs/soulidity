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
  body: string
}

async function readSignedBody(init: RequestInit | undefined): Promise<string> {
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
    expect(headers.get('Authorization')).toMatch(/^AWS4-HMAC-SHA256 /)

    const parsed = new URL(url)
    const pathParts = parsed.pathname.split('/').filter(Boolean)
    const bucket = pathParts[0]
    const key = pathParts.slice(1).join('/')
    expect(bucket).toBe(BUCKET)

    const method = init?.method ?? 'GET'

    if (method === 'PUT') {
      // Real R2 returns 411 when the PUT body is sent chunked. Make sure the
      // uploader hands fetch a length-prefixable body (Uint8Array | string |
      // undefined), never a ReadableStream / Request with stream body.
      expect(init).not.toBeInstanceOf(Request)
      expect(init?.body instanceof ReadableStream).toBe(false)
      expect(
        init?.body == null
        || typeof init?.body === 'string'
        || init?.body instanceof Uint8Array,
      ).toBe(true)
      // Unconditional write — uploader does NOT use If-Match / If-None-Match
      // (Cloudflare Container outbound can produce spurious 412s on PUTs
      // that R2 actually accepted). Reject any reintroduced conditional.
      expect(headers.get('If-Match')).toBeNull()
      expect(headers.get('If-None-Match')).toBeNull()
      const body = await readSignedBody(init)
      objects.set(key, { body })
      return new Response('', { status: 200, headers: { ETag: `"e${seq += 1}"` } })
    }

    if (method === 'GET') {
      const live = objects.get(key)
      if (!live) return new Response('not found', { status: 404 })
      return new Response(live.body, { status: 200 })
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

  it('persists the first reservation through an unconditional PUT', async () => {
    const { fetchImpl, objects } = buildR2Simulator()
    const guard = createR2TokenUsageGuard({ ...GUARD_PARAMS_BASE, nowMs: () => Date.now(), fetchImpl })
    const payload = makeTokenPayload(5, 1024)

    await expect(guard.tryReserve(payload, 600)).resolves.toEqual({ ok: true })
    expect(objects.size).toBe(1)
    await expect(guard.getRemainingByteBudget(payload)).resolves.toBe(424)
  })

  it('reads the current record and accumulates on the second reservation', async () => {
    const { fetchImpl, objects } = buildR2Simulator()
    const guard = createR2TokenUsageGuard({ ...GUARD_PARAMS_BASE, nowMs: () => Date.now(), fetchImpl })
    const payload = makeTokenPayload(5, 1024)

    await expect(guard.tryReserve(payload, 400)).resolves.toEqual({ ok: true })
    await expect(guard.tryReserve(payload, 200)).resolves.toEqual({ ok: true })
    expect(objects.size).toBe(1)
    await expect(guard.getRemainingByteBudget(payload)).resolves.toBe(424)
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

  it('releaseClaim is a no-op when no record exists', async () => {
    const { fetchImpl } = buildR2Simulator()
    const guard = createR2TokenUsageGuard({ ...GUARD_PARAMS_BASE, nowMs: () => Date.now(), fetchImpl })
    const payload = makeTokenPayload(5, 1024)

    await expect(guard.releaseClaim(payload, 100)).resolves.toBeUndefined()
  })
})
