import { beforeEach, describe, expect, it } from 'vitest'

import { checkCsrfForCookieAuth, csrfFailureResponse } from '../../web/lib/auth/csrf.ts'
import { generateCsrfToken, hashCsrfToken } from '../../web/lib/auth/session.ts'

function buildRequest(init: {
  method?: string
  origin?: string | null
  referer?: string | null
  host?: string | null
  csrf?: string | null
}): Request {
  const headers = new Headers()
  if (init.host) headers.set('host', init.host)
  if (init.origin !== undefined && init.origin !== null) headers.set('origin', init.origin)
  if (init.referer !== undefined && init.referer !== null) headers.set('referer', init.referer)
  if (init.csrf) headers.set('x-csrf-token', init.csrf)
  return new Request('https://app.example.com/api/test', {
    method: init.method ?? 'POST',
    headers,
  })
}

describe('checkCsrfForCookieAuth', () => {
  let token: string
  let hash: string

  beforeEach(() => {
    token = generateCsrfToken()
    hash = hashCsrfToken(token)
  })

  it('passes when origin matches host and CSRF token is valid', () => {
    const req = buildRequest({
      host: 'app.example.com',
      origin: 'https://app.example.com',
      csrf: token,
    })
    expect(checkCsrfForCookieAuth(req, hash)).toEqual({ ok: true })
  })

  it('passes when only referer is present and matches host', () => {
    const req = buildRequest({
      host: 'app.example.com',
      referer: 'https://app.example.com/some/page',
      csrf: token,
    })
    expect(checkCsrfForCookieAuth(req, hash)).toEqual({ ok: true })
  })

  it('rejects cross-origin requests', () => {
    const req = buildRequest({
      host: 'app.example.com',
      origin: 'https://evil.example.com',
      csrf: token,
    })
    expect(checkCsrfForCookieAuth(req, hash)).toMatchObject({ ok: false, reason: 'same_origin' })
  })

  it('rejects when neither origin nor referer is present', () => {
    const req = buildRequest({
      host: 'app.example.com',
      csrf: token,
    })
    expect(checkCsrfForCookieAuth(req, hash)).toMatchObject({ ok: false, reason: 'same_origin' })
  })

  it('rejects when CSRF header is missing', () => {
    const req = buildRequest({
      host: 'app.example.com',
      origin: 'https://app.example.com',
    })
    expect(checkCsrfForCookieAuth(req, hash)).toMatchObject({ ok: false, reason: 'missing_header' })
  })

  it('rejects when CSRF header does not hash to expected', () => {
    const req = buildRequest({
      host: 'app.example.com',
      origin: 'https://app.example.com',
      csrf: 'wrong-token',
    })
    expect(checkCsrfForCookieAuth(req, hash)).toMatchObject({ ok: false, reason: 'hash_mismatch' })
  })

  it('respects x-forwarded-host over host header', () => {
    const headers = new Headers({
      host: 'internal-loadbalancer.local',
      'x-forwarded-host': 'app.example.com',
      origin: 'https://app.example.com',
      'x-csrf-token': token,
    })
    const req = new Request('https://app.example.com/api/test', { method: 'POST', headers })
    expect(checkCsrfForCookieAuth(req, hash)).toEqual({ ok: true })
  })
})

describe('csrfFailureResponse', () => {
  it('returns a 403 with the standard error body', async () => {
    const response = csrfFailureResponse()
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid or missing CSRF token' })
  })
})
