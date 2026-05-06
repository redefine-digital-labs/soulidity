import { AwsClient } from 'aws4fetch'
import type { WalrusUploaderTokenPayload } from '../../../src/shared/walrus-uploader-token.js'
import type { TokenUsageGuard } from './handler.js'

// CAS retry budget. R2 conditional PUT (`If-Match`/`If-None-Match`) returns
// 412 on conflict; modest concurrency per token converges in a few retries.
// Mirrors the GCS backend's tuning so behaviour stays consistent across
// staging-backend choices.
const CAS_MAX_RETRIES = 8
const CAS_RETRY_BASE_DELAY_MS = 5
const CAS_RETRY_MAX_DELAY_MS = 80

interface UsageRecord {
  expiresAt: number
  fileCount: number
  byteCount: number
}

interface FetchedUsage {
  record: UsageRecord | null
  // ETag for `If-Match` updates. `null` signals "object did not exist", which
  // becomes `If-None-Match: *` on the write side (put-if-not-exists).
  etag: string | null
}

export interface CreateR2TokenUsageGuardParams {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  prefix: string
  nowMs: () => number
  fetchImpl?: typeof fetch
}

function safeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    return null
  }
  return value
}

function parseUsageRecord(raw: string): UsageRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const candidate = parsed as Record<string, unknown>
  const expiresAt = safeInt(candidate.expiresAt)
  const fileCount = safeInt(candidate.fileCount)
  const byteCount = safeInt(candidate.byteCount)
  if (expiresAt == null || fileCount == null || byteCount == null) return null
  if (fileCount < 0 || byteCount < 0) return null
  return { expiresAt, fileCount, byteCount }
}

function serializeUsageRecord(record: UsageRecord): string {
  return JSON.stringify({
    expiresAt: record.expiresAt,
    fileCount: record.fileCount,
    byteCount: record.byteCount,
  })
}

export function createR2TokenUsageGuard(params: CreateR2TokenUsageGuardParams): TokenUsageGuard {
  if (!params.accountId.trim()) throw new Error('R2 accountId is required')
  if (!params.bucket.trim()) throw new Error('R2 bucket is required')
  if (!params.accessKeyId.trim()) throw new Error('R2 accessKeyId is required')
  if (!params.secretAccessKey.trim()) throw new Error('R2 secretAccessKey is required')

  const prefix = params.prefix.replace(/\/+$/, '')
  const endpoint = `https://${params.accountId}.r2.cloudflarestorage.com`
  const aws = new AwsClient({
    accessKeyId: params.accessKeyId,
    secretAccessKey: params.secretAccessKey,
    region: 'auto',
    service: 's3',
  })
  const fetchImpl = params.fetchImpl

  const objectName = (jti: string) => `${prefix}/${encodeURIComponent(jti)}.json`
  const objectUrl = (name: string) => `${endpoint}/${encodeURIComponent(params.bucket)}/${name}`

  async function signedFetch(url: string, init: RequestInit = {}) {
    const signed = await aws.sign(url, init)
    // Node 22 undici-fetch on a Request with a ReadableStream body uses
    // chunked transfer encoding, but R2's S3 API requires Content-Length on
    // PUT and rejects chunked uploads with 411 Length Required. Materialize
    // the signed body so fetch can length-prefix it.
    const bytes = await signed.arrayBuffer()
    const body = bytes.byteLength > 0 ? new Uint8Array(bytes) : undefined
    const requestInit: RequestInit = {
      method: signed.method,
      headers: signed.headers,
      body,
    }
    return (fetchImpl ?? fetch)(signed.url, requestInit)
  }

  async function readUsage(jti: string): Promise<FetchedUsage> {
    const response = await signedFetch(objectUrl(objectName(jti)))
    if (response.status === 404) {
      return { record: null, etag: null }
    }
    if (!response.ok) {
      throw new Error(`Failed to read R2 token usage for ${jti}: HTTP ${response.status}`)
    }
    const etag = response.headers.get('etag') ?? response.headers.get('ETag')
    const record = parseUsageRecord(await response.text())
    return { record, etag }
  }

  // Persist `next` only if R2's view of the object still matches. Returns
  // true on accept (200/204), false on 412 (concurrent writer beat us, caller
  // retries the read-modify-write loop).
  async function writeUsage(jti: string, next: UsageRecord, expectedEtag: string | null): Promise<boolean> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (expectedEtag == null) {
      // First write: succeed only if no object exists. Mirrors GCS
      // `ifGenerationMatch=0`.
      headers['If-None-Match'] = '*'
    } else {
      headers['If-Match'] = expectedEtag
    }
    const response = await signedFetch(objectUrl(objectName(jti)), {
      method: 'PUT',
      headers,
      body: serializeUsageRecord(next),
    })
    if (response.status === 412 || response.status === 409) return false
    if (!response.ok) {
      throw new Error(`Failed to write R2 token usage for ${jti}: HTTP ${response.status}`)
    }
    return true
  }

  // Centralized read-modify-write loop with bounded retries. Same semantics
  // as the GCS backend so callers see identical behaviour regardless of
  // STAGING_BACKEND.
  async function casUpdate<T>(
    jti: string,
    mutate: (current: UsageRecord | null) =>
      | { kind: 'commit'; next: UsageRecord; result: T }
      | { kind: 'error'; result: T },
  ): Promise<T> {
    let lastError: unknown = null
    for (let attempt = 0; attempt < CAS_MAX_RETRIES; attempt += 1) {
      const fetched = await readUsage(jti)
      const decision = mutate(fetched.record)
      if (decision.kind === 'error') return decision.result
      try {
        const accepted = await writeUsage(jti, decision.next, fetched.etag)
        if (accepted) return decision.result
      } catch (error) {
        lastError = error
      }
      const delay = Math.min(
        CAS_RETRY_MAX_DELAY_MS,
        CAS_RETRY_BASE_DELAY_MS * 2 ** attempt,
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    if (lastError) throw lastError
    throw new Error(`R2 token usage CAS for ${jti} did not converge after ${CAS_MAX_RETRIES} retries`)
  }

  function effectiveCurrent(payload: WalrusUploaderTokenPayload, fetched: UsageRecord | null): UsageRecord {
    if (fetched && fetched.expiresAt > params.nowMs()) return fetched
    return { expiresAt: payload.exp * 1000, fileCount: 0, byteCount: 0 }
  }

  async function tryReserve(
    payload: WalrusUploaderTokenPayload,
    claimBytes: number,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const safeClaim = Math.max(0, Math.trunc(claimBytes))
    type Result = { ok: true } | { ok: false; error: string }
    return casUpdate<Result>(payload.jti, (fetched) => {
      const current = effectiveCurrent(payload, fetched)
      const nextFileCount = current.fileCount + 1
      if (nextFileCount > payload.fileCount) {
        return { kind: 'error', result: { ok: false, error: 'Walrus uploader token file count exceeded' } }
      }
      const nextByteCount = current.byteCount + safeClaim
      if (nextByteCount > payload.byteLimit) {
        return { kind: 'error', result: { ok: false, error: 'Walrus uploader token byte limit exceeded' } }
      }
      return {
        kind: 'commit',
        next: {
          expiresAt: current.expiresAt,
          fileCount: nextFileCount,
          byteCount: nextByteCount,
        },
        result: { ok: true },
      }
    })
  }

  async function commitClaim(
    payload: WalrusUploaderTokenPayload,
    claimBytes: number,
    actualBytes: number,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const safeClaim = Math.max(0, Math.trunc(claimBytes))
    const safeActual = Math.max(0, Math.trunc(actualBytes))
    type Result = { ok: true } | { ok: false; error: string }
    return casUpdate<Result>(payload.jti, (fetched) => {
      const current = fetched ?? {
        expiresAt: payload.exp * 1000,
        fileCount: 1,
        byteCount: safeClaim,
      }
      const nextByteCount = Math.max(0, current.byteCount - safeClaim) + safeActual
      if (nextByteCount > payload.byteLimit) {
        return { kind: 'error', result: { ok: false, error: 'Walrus uploader token byte limit exceeded' } }
      }
      return {
        kind: 'commit',
        next: {
          expiresAt: current.expiresAt,
          fileCount: current.fileCount,
          byteCount: nextByteCount,
        },
        result: { ok: true },
      }
    })
  }

  async function releaseClaim(payload: WalrusUploaderTokenPayload, claimBytes: number): Promise<void> {
    const safeClaim = Math.max(0, Math.trunc(claimBytes))
    await casUpdate<void>(payload.jti, (fetched) => {
      if (!fetched) return { kind: 'error', result: undefined }
      const nextFileCount = Math.max(0, fetched.fileCount - 1)
      const nextByteCount = Math.max(0, fetched.byteCount - safeClaim)
      return {
        kind: 'commit',
        next: {
          expiresAt: fetched.expiresAt,
          fileCount: nextFileCount,
          byteCount: nextByteCount,
        },
        result: undefined,
      }
    })
  }

  async function getRemainingByteBudget(payload: WalrusUploaderTokenPayload): Promise<number> {
    const fetched = await readUsage(payload.jti)
    const current = effectiveCurrent(payload, fetched.record)
    return Math.max(0, payload.byteLimit - current.byteCount)
  }

  return { tryReserve, commitClaim, releaseClaim, getRemainingByteBudget }
}
