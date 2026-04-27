import { NextResponse } from 'next/server'

import {
  CSRF_HEADER_NAME,
  hashCsrfToken,
  verifyCsrfToken as verifyCsrfTokenAgainstHash,
} from '@/lib/auth/session'

const FORBIDDEN_BODY = { error: 'Invalid or missing CSRF token' }

function normalizeHost(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    return url.host || null
  } catch {
    return null
  }
}

function getRequestHost(request: Request): string | null {
  const headers = request.headers
  const forwardedHost = headers.get('x-forwarded-host')?.trim()
  if (forwardedHost) return forwardedHost
  const host = headers.get('host')?.trim()
  return host || null
}

export function isSameOrigin(request: Request): boolean {
  const requestHost = normalizeHost(getRequestHost(request))
  if (!requestHost) return false

  const origin = normalizeHost(request.headers.get('origin'))
  const referer = normalizeHost(request.headers.get('referer'))

  // If neither header is present, fail closed for cookie-auth mutations.
  if (!origin && !referer) return false

  if (origin && origin !== requestHost) return false
  if (referer && referer !== requestHost) return false

  return true
}

export interface CsrfCheckResult {
  ok: boolean
  reason?: 'missing_header' | 'hash_mismatch' | 'same_origin'
}

export function checkCsrfForCookieAuth(
  request: Request,
  expectedHash: string,
): CsrfCheckResult {
  if (!isSameOrigin(request)) {
    return { ok: false, reason: 'same_origin' }
  }

  const headerToken = request.headers.get(CSRF_HEADER_NAME)
  if (!headerToken) {
    return { ok: false, reason: 'missing_header' }
  }

  if (!verifyCsrfTokenAgainstHash(headerToken, expectedHash)) {
    return { ok: false, reason: 'hash_mismatch' }
  }

  return { ok: true }
}

export function csrfFailureResponse(): NextResponse {
  return NextResponse.json(FORBIDDEN_BODY, { status: 403 })
}

export { hashCsrfToken }
