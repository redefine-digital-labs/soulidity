import type { WalrusUploaderTokenPayload } from '../../../src/shared/walrus-uploader-token.js'
import type { TokenUsageGuard } from './handler.js'

const GCS_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write'
// CAS retry budget. GCS `if-generation-match` returns 412 on conflict; with
// modest concurrency per token the contended case converges in a few retries.
// Larger than the worst-case observed concurrency and small enough that a
// pathological hot token still produces a 5xx instead of looping forever.
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
  generation: string
}

export interface CreateGcsTokenUsageGuardParams {
  bucketName: string
  prefix: string
  nowMs: () => number
  // Optional override for tests; defaults to the GCS Cloud Run metadata
  // service-account flow (mirrors the staging-gcs implementation).
  getAccessToken?: () => Promise<string>
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
    parsed = JSON.parse(raw) as unknown
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

async function defaultMetadataAccessToken(fetchImpl: typeof fetch): Promise<string> {
  const explicit = process.env.GCS_ACCESS_TOKEN?.trim() || process.env.GOOGLE_OAUTH_ACCESS_TOKEN?.trim()
  if (explicit) return explicit

  const response = await fetchImpl(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(GCS_SCOPE)}`,
    { headers: { 'Metadata-Flavor': 'Google' } },
  )
  if (!response.ok) {
    throw new Error(`Failed to fetch Cloud Run service-account token: HTTP ${response.status}`)
  }
  const payload = await response.json().catch(() => null) as { access_token?: unknown } | null
  if (typeof payload?.access_token !== 'string' || !payload.access_token) {
    throw new Error('Cloud Run service-account token response did not include access_token')
  }
  return payload.access_token
}

export function createGcsTokenUsageGuard(params: CreateGcsTokenUsageGuardParams): TokenUsageGuard {
  const fetchImpl = params.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  const getAccessToken = params.getAccessToken ?? (() => defaultMetadataAccessToken(fetchImpl))
  const prefix = params.prefix.replace(/\/+$/, '')
  const objectName = (jti: string) => `${prefix}/${encodeURIComponent(jti)}.json`
  const objectMediaUrl = (name: string) =>
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(params.bucketName)}/o/${encodeURIComponent(name)}?alt=media`
  const objectMutateUrl = (name: string, ifGenerationMatch: string) =>
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(params.bucketName)}/o`
    + `?uploadType=media&name=${encodeURIComponent(name)}`
    + `&ifGenerationMatch=${encodeURIComponent(ifGenerationMatch)}`

  async function authedFetch(url: string, init: RequestInit = {}) {
    const token = await getAccessToken()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return fetchImpl(url, { ...init, headers })
  }

  async function readUsage(jti: string): Promise<FetchedUsage> {
    const response = await authedFetch(objectMediaUrl(objectName(jti)))
    if (response.status === 404) {
      return { record: null, generation: '0' }
    }
    if (!response.ok) {
      throw new Error(`Failed to read GCS token usage for ${jti}: HTTP ${response.status}`)
    }
    const generation = response.headers.get('x-goog-generation') ?? '0'
    const record = parseUsageRecord(await response.text())
    return { record, generation }
  }

  // Persist `next` only if the live generation still matches. Returns true
  // when GCS accepted the write, false on 412 (concurrent writer beat us so
  // the caller must restart the read-modify-write).
  async function writeUsage(jti: string, next: UsageRecord, expectedGeneration: string): Promise<boolean> {
    const response = await authedFetch(objectMutateUrl(objectName(jti), expectedGeneration), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: serializeUsageRecord(next),
    })
    if (response.status === 412) return false
    if (!response.ok) {
      throw new Error(`Failed to write GCS token usage for ${jti}: HTTP ${response.status}`)
    }
    return true
  }

  // Centralized read-modify-write loop with bounded retries. Hands the live
  // record to `mutate`, which returns either the next record (and an OK/error
  // hint) or short-circuits with an error before any write.
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
        const accepted = await writeUsage(jti, decision.next, fetched.generation)
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
    throw new Error(`GCS token usage CAS for ${jti} did not converge after ${CAS_MAX_RETRIES} retries`)
  }

  // Treat expired records as a fresh slot keyed at the current generation.
  // Lifecycle rules can reclaim the storage object later; the new record will
  // simply overwrite the stale one on the next reservation.
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
