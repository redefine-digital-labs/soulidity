import { AwsClient } from 'aws4fetch'
import type { WalrusUploaderTokenPayload } from '../../../src/shared/walrus-uploader-token.js'
import type { TokenUsageGuard } from './handler.js'

// Retry budget for transient network errors during the read-modify-write
// cycle. Conditional writes (`If-Match` / `If-None-Match`) were tried first
// but Cloudflare Container's outbound HTTP path produces spurious 412s on
// PUTs that R2 actually accepted (likely due to L4 retransmission seeing a
// "now exists" precondition fail), so we use unconditional PUTs and accept
// last-writer-wins semantics for the per-jti counter. The retry budget here
// only covers genuine network failures.
const WRITE_MAX_RETRIES = 3
const WRITE_RETRY_BASE_DELAY_MS = 5
const WRITE_RETRY_MAX_DELAY_MS = 80

interface UsageRecord {
  expiresAt: number
  fileCount: number
  byteCount: number
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
    // aws4fetch's sign() returns a Request whose body is a ReadableStream.
    // Inside the Cloudflare Container we observed PUTs whose state R2
    // actually applied still surfaced as 412 to our caller — symptoms of L4
    // retransmission. Take only the signed *headers* from sign() and issue
    // the fetch with our original string body so the underlying transport
    // can length-prefix and not duplicate.
    const signed = await aws.sign(url, init)
    const headers = new Headers(signed.headers)
    return (fetchImpl ?? fetch)(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body ?? undefined,
    })
  }

  async function readUsage(jti: string): Promise<UsageRecord | null> {
    const response = await signedFetch(objectUrl(objectName(jti)))
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Failed to read R2 token usage for ${jti}: HTTP ${response.status}`)
    }
    return parseUsageRecord(await response.text())
  }

  async function writeUsage(jti: string, next: UsageRecord): Promise<void> {
    const response = await signedFetch(objectUrl(objectName(jti)), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: serializeUsageRecord(next),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `Failed to write R2 token usage for ${jti}: HTTP ${response.status} body=${body.slice(0, 200)}`,
      )
    }
  }

  // Read-modify-write with retries on transient network failures only. Two
  // concurrent reservations on the same jti can race — last writer wins,
  // which is acceptable for this counter (5-min TTL, single user per token).
  async function readModifyWrite<T>(
    jti: string,
    mutate: (current: UsageRecord | null) =>
      | { kind: 'commit'; next: UsageRecord; result: T }
      | { kind: 'error'; result: T },
  ): Promise<T> {
    let lastError: unknown = null
    for (let attempt = 0; attempt < WRITE_MAX_RETRIES; attempt += 1) {
      try {
        const current = await readUsage(jti)
        const decision = mutate(current)
        if (decision.kind === 'error') return decision.result
        await writeUsage(jti, decision.next)
        return decision.result
      } catch (error) {
        lastError = error
        const delay = Math.min(
          WRITE_RETRY_MAX_DELAY_MS,
          WRITE_RETRY_BASE_DELAY_MS * 2 ** attempt,
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
    throw lastError ?? new Error(`R2 token usage update for ${jti} failed`)
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
    return readModifyWrite<Result>(payload.jti, (fetched) => {
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
    return readModifyWrite<Result>(payload.jti, (fetched) => {
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
    await readModifyWrite<void>(payload.jti, (fetched) => {
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
    const current = effectiveCurrent(payload, fetched)
    return Math.max(0, payload.byteLimit - current.byteCount)
  }

  return { tryReserve, commitClaim, releaseClaim, getRemainingByteBudget }
}
