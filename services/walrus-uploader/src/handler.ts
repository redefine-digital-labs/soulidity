import { randomUUID } from 'node:crypto'
import {
  verifyWalrusUploaderToken,
  type WalrusUploaderTokenPayload,
} from '../../../src/shared/walrus-uploader-token.js'
import {
  bytesToBase64,
  serializeWalrusCertificate,
  type WalrusCertificateLike,
} from './codec.js'
import {
  createFilesystemWalrusUploadStaging,
  createMemoryWalrusUploadStaging,
  type StagedWalrusUpload,
  type WalrusUploadStaging,
} from './staging.js'

export { createFilesystemWalrusUploadStaging, createMemoryWalrusUploadStaging }
export type { WalrusUploadStaging }

const DEFAULT_STAGE_TTL_MS = 24 * 60 * 60 * 1000
const WALRUS_STORAGE_WRITE_TIMEOUT_MS = 10 * 60 * 1000
const WALRUS_STORAGE_WRITE_MAX_ATTEMPTS = 3
const WALRUS_STORAGE_WRITE_RETRY_BASE_DELAY_MS = 1_500
const WALRUS_WEIGHTED_QUORUM_CONFIRMATION_RETRIES = 2
// Headroom above the token's remaining payload budget for multipart framing
// (boundary lines, per-part headers, walletAddress/network fields). The actual
// payload byte-length is still enforced by reserveTokenUsage() after parsing.
const WALRUS_UPLOAD_MULTIPART_OVERHEAD_BYTES = 64 * 1024
// Default throttle for the per-instance staging cleanup. Cleanup runs at most
// once every 5 minutes per warm instance and never blocks the request path
// (see `maybeKickOffStagingCleanup`). The previous behavior awaited cleanup
// on every non-OPTIONS request, turning abandoned local staging files into a
// request-path latency vector.
const DEFAULT_STAGING_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

export interface ManagedWalrusClient {
  encodeBlob: (payload: Uint8Array) => Promise<{
    blobId: string
    rootHash: Uint8Array
    metadata: unknown
    sliversByNode: unknown
  }>
  writeEncodedBlobToNodes: (args: {
    blobId: string
    objectId: string
    metadata: unknown
    sliversByNode: unknown
    deletable: true
  }) => Promise<unknown[]>
  getStorageConfirmations: (args: {
    blobId: string
    objectId: string
    deletable: true
  }) => Promise<unknown[]>
  certificateFromConfirmations: (args: {
    confirmations: unknown[]
    blobId: string
    blobObjectId: string
    deletable: true
  }) => Promise<WalrusCertificateLike>
  systemState: () => Promise<{
    committee: {
      n_shards: number
      members: Array<{ weight: number }>
    }
  }>
}

export interface RegisterValidationParams {
  network: 'testnet' | 'mainnet'
  digest: string
  walletAddress: string
  expected: Array<{ blobId: string; blobObjectId: string }>
}

export interface WalrusUploaderHandlerDeps {
  tokenSecret: string
  staging: WalrusUploadStaging
  createWalrusClient: (network: 'testnet' | 'mainnet') => Promise<ManagedWalrusClient>
  validateRegister: (params: RegisterValidationParams) => Promise<Array<{ blobId: string; blobObjectId: string }>>
  nowMs?: () => number
  stageTtlMs?: number
  corsOrigin?: string
  // Token usage / byte-budget guard. The DigitalOcean deployment is a
  // single Node process, so the default in-memory guard is the production
  // source of truth for a token's short-lived file and byte budget.
  tokenUsage?: TokenUsageGuard
  // Minimum interval between staging cleanup runs from this handler instance.
  // Cleanup is fire-and-forget and never blocks the request response. Tests
  // and single-instance deploys can lower this; the default keeps the cost
  // amortization aligned with `DEFAULT_STAGE_TTL_MS`.
  stagingCleanupIntervalMs?: number
}

export interface TokenUsageGuard {
  tryReserve(
    payload: WalrusUploaderTokenPayload,
    claimBytes: number,
  ): Promise<{ ok: true } | { ok: false; error: string }>
  commitClaim(
    payload: WalrusUploaderTokenPayload,
    claimBytes: number,
    actualBytes: number,
  ): Promise<{ ok: true } | { ok: false; error: string }>
  releaseClaim(payload: WalrusUploaderTokenPayload, claimBytes: number): Promise<void>
  getRemainingByteBudget(payload: WalrusUploaderTokenPayload): Promise<number>
}

interface TokenUsage {
  expiresAt: number
  fileCount: number
  byteCount: number
}

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

function parseBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1] ?? null
}

function parseObjectBody(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

function parseNonNegativeInteger(value: string | null | undefined): number | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function createBoundedRequestBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  onExceeded: () => void,
): ReadableStream<Uint8Array> {
  let total = 0
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength
      if (total > maxBytes) {
        onExceeded()
        controller.error(new Error('Walrus uploader token byte limit exceeded'))
        return
      }
      controller.enqueue(chunk)
    },
  })
  return body.pipeThrough(transform)
}

function parseAllowedCorsOrigins(config: string): string[] {
  const origins = config
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  return origins.length > 0 ? origins : ['*']
}

function resolveCorsOrigin(allowedOrigins: readonly string[], requestOrigin: string | null): string {
  if (allowedOrigins.includes('*')) return '*'
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) return requestOrigin
  return allowedOrigins[0] ?? '*'
}

function withCors(response: Response, origin: string) {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Walrus-Payload-Bytes')
  headers.set('Vary', 'Origin')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function memoryUsageSnapshot() {
  const memory = process.memoryUsage()
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
  }
}

function elapsedMs(nowMs: () => number, startMs: number): number {
  return Math.max(0, nowMs() - startMs)
}

function logWalrusCompleteStage(params: {
  uploadId: string
  stage: string
  payloadBytes?: number
  stageMs?: number
  totalMs?: number
  error?: string
}) {
  console.info('[walrus-uploader] complete', {
    ...params,
    memory: memoryUsageSnapshot(),
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRetryableStorageWriteError(error: unknown): boolean {
  const status = typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : null
  if (status === 429 || (status != null && status >= 500)) return true

  const message = errorMessage(error).toLowerCase()
  return message.includes('too many failures while writing blob')
    || message.includes('timed out writing walrus slivers')
    || message.includes('request timed out')
    || message.includes('connection error')
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function writeEncodedBlobToNodesWithRetry(params: {
  client: ManagedWalrusClient
  upload: StagedWalrusUpload
  blobObjectId: string
}): Promise<unknown[]> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= WALRUS_STORAGE_WRITE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await withTimeout(
        params.client.writeEncodedBlobToNodes({
          blobId: params.upload.blobId,
          objectId: params.blobObjectId,
          metadata: params.upload.metadata,
          sliversByNode: params.upload.sliversByNode,
          deletable: true,
        }),
        WALRUS_STORAGE_WRITE_TIMEOUT_MS,
        `Timed out writing Walrus slivers for upload ${params.upload.uploadId}`,
      )
    } catch (error) {
      lastError = error
      if (attempt >= WALRUS_STORAGE_WRITE_MAX_ATTEMPTS || !isRetryableStorageWriteError(error)) {
        throw error
      }
      console.warn('[walrus-uploader] storage write retry', {
        uploadId: params.upload.uploadId,
        blobId: params.upload.blobId,
        attempt,
        maxAttempts: WALRUS_STORAGE_WRITE_MAX_ATTEMPTS,
        error: errorMessage(error),
      })
      await sleep(WALRUS_STORAGE_WRITE_RETRY_BASE_DELAY_MS * attempt)
    }
  }
  throw lastError ?? new Error(`Walrus storage write failed for upload ${params.upload.uploadId}`)
}

function hasWalrusWeightedQuorum(params: {
  signerWeights: readonly number[]
  nShards: number
}): boolean {
  if (!Number.isFinite(params.nShards) || params.nShards <= 0) return false
  const weight = params.signerWeights.reduce((sum, value) => {
    if (!Number.isFinite(value) || value <= 0) return sum
    return sum + Math.trunc(value)
  }, 0)
  return 3 * weight >= 2 * Math.trunc(params.nShards) + 1
}

async function writeEncodedBlobAndBuildCertificate(params: {
  client: ManagedWalrusClient
  upload: StagedWalrusUpload
  blobObjectId: string
}) {
  const getStorageConfirmations = () =>
    withTimeout(
      params.client.getStorageConfirmations({
        blobId: params.upload.blobId,
        objectId: params.blobObjectId,
        deletable: true,
      }),
      WALRUS_STORAGE_WRITE_TIMEOUT_MS,
      `Timed out fetching Walrus storage confirmations for upload ${params.upload.uploadId}`,
    )

  let confirmations: unknown[]
  let writeError: unknown = null
  try {
    confirmations = await writeEncodedBlobToNodesWithRetry(params)
  } catch (error) {
    writeError = error
    confirmations = await getStorageConfirmations()
  }

  let lastQuorumStatus: { signingWeight: number; nShards: number } | null = null
  for (let attempt = 0; attempt <= WALRUS_WEIGHTED_QUORUM_CONFIRMATION_RETRIES; attempt += 1) {
    let certificate: WalrusCertificateLike
    try {
      certificate = await params.client.certificateFromConfirmations({
        confirmations,
        blobId: params.upload.blobId,
        blobObjectId: params.blobObjectId,
        deletable: true,
      })
    } catch (certificateError) {
      if (writeError) {
        console.warn('[walrus-uploader] certificate build after storage write failure failed', {
          uploadId: params.upload.uploadId,
          blobId: params.upload.blobId,
          confirmations: confirmations.filter(Boolean).length,
          writeError: errorMessage(writeError),
          certificateError: errorMessage(certificateError),
        })
      }
      if (writeError) throw writeError
      throw certificateError
    }

    const systemState = await params.client.systemState()
    const signerWeights = certificate.signers.map((signer) => {
      if (!Number.isInteger(signer) || signer < 0) return 0
      const weight = systemState.committee.members[signer]?.weight
      return Number.isFinite(weight) && weight > 0 ? Math.trunc(weight) : 0
    })
    const signingWeight = signerWeights.reduce((sum, value) => sum + value, 0)
    const nShards = Math.trunc(systemState.committee.n_shards)
    if (hasWalrusWeightedQuorum({ signerWeights, nShards })) {
      return certificate
    }

    lastQuorumStatus = { signingWeight, nShards }
    if (attempt === WALRUS_WEIGHTED_QUORUM_CONFIRMATION_RETRIES) break
    confirmations = await getStorageConfirmations()
  }

  if (lastQuorumStatus) {
    throw new Error(
      'Walrus certificate weighted quorum guard rejected '
      + `upload ${params.upload.uploadId}: signing weight ${lastQuorumStatus.signingWeight} `
      + `did not satisfy n_shards ${lastQuorumStatus.nShards}`,
    )
  }
  throw new Error(`Walrus certificate weighted quorum guard could not evaluate upload ${params.upload.uploadId}`)
}

// Per-process in-memory token usage guard. Suitable for local development,
// tests, and the single-node DigitalOcean uploader deployment.
export function createInMemoryTokenUsageGuard(opts: { nowMs: () => number }): TokenUsageGuard {
  const { nowMs } = opts
  const usages = new Map<string, TokenUsage>()

  function pruneExpired() {
    for (const [tokenId, usage] of usages) {
      if (usage.expiresAt <= nowMs()) usages.delete(tokenId)
    }
  }

  // Atomically reserve a claim of `claimBytes` against the token's byte budget
  // and one slot of its file count. Concurrent requests sharing the same token
  // observe each successful reservation immediately, so a follow-up call to
  // `getRemainingByteBudget` returns the post-reservation remainder. The
  // returned `claim` is later passed to `commitClaim` (replace claim with the
  // actual payload size) or `releaseClaim` (rollback on failure).
  async function tryReserve(
    payload: WalrusUploaderTokenPayload,
    claimBytes: number,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    pruneExpired()

    const current = usages.get(payload.jti) ?? {
      expiresAt: payload.exp * 1000,
      fileCount: 0,
      byteCount: 0,
    }
    const nextFileCount = current.fileCount + 1
    if (nextFileCount > payload.fileCount) {
      return { ok: false, error: 'Walrus uploader token file count exceeded' }
    }
    const safeClaim = Math.max(0, Math.trunc(claimBytes))
    const nextByteCount = current.byteCount + safeClaim
    if (nextByteCount > payload.byteLimit) {
      return { ok: false, error: 'Walrus uploader token byte limit exceeded' }
    }
    usages.set(payload.jti, {
      expiresAt: current.expiresAt,
      fileCount: nextFileCount,
      byteCount: nextByteCount,
    })
    return { ok: true }
  }

  // Replace a previously-reserved `claimBytes` with the post-parse `actualBytes`.
  // Caller must have a successful `tryReserve` for this token. Returns an error
  // when the actual payload bytes overshoot the token's byteLimit (possible when
  // declared Content-Length under-reported, since the bounded body still allows
  // up to `claim + multipart overhead`).
  async function commitClaim(
    payload: WalrusUploaderTokenPayload,
    claimBytes: number,
    actualBytes: number,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    pruneExpired()
    const safeClaim = Math.max(0, Math.trunc(claimBytes))
    const safeActual = Math.max(0, Math.trunc(actualBytes))
    const current = usages.get(payload.jti) ?? {
      expiresAt: payload.exp * 1000,
      fileCount: 1,
      byteCount: safeClaim,
    }
    const nextByteCount = Math.max(0, current.byteCount - safeClaim) + safeActual
    if (nextByteCount > payload.byteLimit) {
      return { ok: false, error: 'Walrus uploader token byte limit exceeded' }
    }
    usages.set(payload.jti, {
      expiresAt: current.expiresAt,
      fileCount: current.fileCount,
      byteCount: nextByteCount,
    })
    return { ok: true }
  }

  // Rollback a previously-reserved claim. Used when the request fails before
  // `commitClaim` so the file slot and byte budget are returned to the pool.
  async function releaseClaim(payload: WalrusUploaderTokenPayload, claimBytes: number) {
    pruneExpired()
    const current = usages.get(payload.jti)
    if (!current) return
    const safeClaim = Math.max(0, Math.trunc(claimBytes))
    const nextFileCount = Math.max(0, current.fileCount - 1)
    const nextByteCount = Math.max(0, current.byteCount - safeClaim)
    if (nextFileCount === 0 && nextByteCount === 0) {
      usages.delete(payload.jti)
      return
    }
    usages.set(payload.jti, {
      expiresAt: current.expiresAt,
      fileCount: nextFileCount,
      byteCount: nextByteCount,
    })
  }

  async function getRemainingByteBudget(payload: WalrusUploaderTokenPayload) {
    pruneExpired()
    const current = usages.get(payload.jti)
    const used = current?.byteCount ?? 0
    return Math.max(0, payload.byteLimit - used)
  }

  return { tryReserve, commitClaim, releaseClaim, getRemainingByteBudget }
}

export function createWalrusUploaderHandler(deps: WalrusUploaderHandlerDeps) {
  const nowMs = deps.nowMs ?? (() => Date.now())
  const stageTtlMs = deps.stageTtlMs ?? DEFAULT_STAGE_TTL_MS
  const allowedCorsOrigins = parseAllowedCorsOrigins(deps.corsOrigin ?? '*')
  const tokenUsage = deps.tokenUsage ?? createInMemoryTokenUsageGuard({ nowMs })
  const stagingCleanupIntervalMs = deps.stagingCleanupIntervalMs ?? DEFAULT_STAGING_CLEANUP_INTERVAL_MS

  // Throttled, fire-and-forget staging cleanup. Previously every non-OPTIONS
  // request blocked on `deps.staging.deleteExpired(nowMs())` before the
  // handler could serve `/health`, `/v1/uploads`, `/complete`, or `/finalize`.
  // The throttle bounds cleanup to once per `stagingCleanupIntervalMs` per
  // process, the kick-off is detached from the request response, and any
  // failure is contained inside this function so it cannot fail request
  // handling.
  let lastStagingCleanupAtMs = 0
  let stagingCleanupInFlight = false
  const maybeKickOffStagingCleanup = () => {
    if (stagingCleanupInFlight) return
    const now = nowMs()
    if (
      lastStagingCleanupAtMs > 0
      && now - lastStagingCleanupAtMs < stagingCleanupIntervalMs
    ) {
      return
    }
    stagingCleanupInFlight = true
    lastStagingCleanupAtMs = now
    void (async () => {
      try {
        await deps.staging.deleteExpired(now)
      } catch (error) {
        console.warn(
          '[walrus-uploader] staging cleanup failed:',
          error instanceof Error ? error.message : error,
        )
      } finally {
        stagingCleanupInFlight = false
      }
    })()
  }

  const authenticate = (request: Request, expected?: {
    walletAddress?: string
    network?: 'testnet' | 'mainnet'
  }) => {
    const token = parseBearerToken(request)
    if (!token) throw Object.assign(new Error('Missing Bearer token'), { status: 401 })
    return verifyWalrusUploaderToken(token, {
      secret: deps.tokenSecret,
      nowMs: nowMs(),
      walletAddress: expected?.walletAddress,
      network: expected?.network,
    })
  }

  return async function handleWalrusUploaderRequest(request: Request): Promise<Response> {
    const corsOrigin = resolveCorsOrigin(allowedCorsOrigins, request.headers.get('origin'))

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), corsOrigin)
    }

    try {
      maybeKickOffStagingCleanup()
      const url = new URL(request.url)
      const path = url.pathname.replace(/\/+$/, '') || '/'

      if (request.method === 'GET' && path === '/health') {
        return withCors(json({ ok: true }), corsOrigin)
      }

      if (request.method === 'POST' && path === '/v1/uploads') {
        const token = authenticate(request)

        // Enforce the token's byte budget BEFORE buffering the multipart body
        // so an oversized payload cannot be parsed/decoded into memory at all.
        // The reservation also blocks concurrent uploads sharing this token
        // from each observing the full remaining budget and over-buffering;
        // every claim is counted immediately and released or committed once
        // the actual payload size is known.
        const remainingByteBudget = await tokenUsage.getRemainingByteBudget(token)
        if (remainingByteBudget <= 0) {
          return withCors(
            json({ error: 'Walrus uploader token byte limit exceeded' }, 413),
            corsOrigin,
          )
        }

        const declaredContentLength = parseNonNegativeInteger(request.headers.get('content-length'))
        // Optional client-provided exact payload byte length. The token's
        // byte budget is summed over PAYLOAD bytes only, while
        // `Content-Length` covers the full multipart envelope (boundary
        // lines, per-part headers, walletAddress/network fields). Reserving
        // against `Content-Length` therefore over-claims by the multipart
        // overhead, which fails concurrent multi-file publishes whose
        // combined payload bytes exactly fit the token. Clients that know
        // the exact payload byte length send `X-Walrus-Payload-Bytes` so the
        // reservation tracks payload bytes 1:1 with the token's accounting.
        const declaredPayloadBytes = parseNonNegativeInteger(request.headers.get('x-walrus-payload-bytes'))
        if (declaredPayloadBytes != null && declaredPayloadBytes > remainingByteBudget) {
          return withCors(
            json({ error: 'Walrus uploader token byte limit exceeded' }, 413),
            corsOrigin,
          )
        }

        // Reserve a payload-aware claim against the token's byte budget
        // before any body parsing. Preference order:
        //   1. Explicit `X-Walrus-Payload-Bytes` (matches the token's
        //      payload-byte budget exactly; lets concurrent multi-file
        //      publishes coexist when total payload bytes fit byteLimit).
        //   2. `Content-Length` clamped to remaining budget (legacy clients
        //      that don't send the explicit header — pessimistic against
        //      multipart overhead but safe).
        //   3. Full remaining budget (no length info — only one such
        //      request can run at a time per token).
        const claimBytes = declaredPayloadBytes != null
          ? declaredPayloadBytes
          : declaredContentLength != null
            ? Math.min(declaredContentLength, remainingByteBudget)
            : remainingByteBudget
        // Bound the actual body size to the claim plus multipart-envelope
        // headroom. With `X-Walrus-Payload-Bytes` this also prevents a
        // client from declaring a small payload and streaming a much larger
        // one — the bounded body errors mid-stream once total bytes exceed
        // `claimBytes + overhead`.
        const maxBodyBytes = claimBytes + WALRUS_UPLOAD_MULTIPART_OVERHEAD_BYTES
        if (declaredContentLength != null && declaredContentLength > maxBodyBytes) {
          return withCors(
            json({ error: 'Walrus uploader token byte limit exceeded' }, 413),
            corsOrigin,
          )
        }

        const reservation = await tokenUsage.tryReserve(token, claimBytes)
        if (!reservation.ok) {
          return withCors(json({ error: reservation.error }, 413), corsOrigin)
        }

        let committed = false
        try {
          let exceededBudgetWhileStreaming = false
          let formSource: Request = request
          if (request.body) {
            const boundedBody = createBoundedRequestBody(
              request.body,
              maxBodyBytes,
              () => { exceededBudgetWhileStreaming = true },
            )
            formSource = new Request(request.url, {
              method: 'POST',
              headers: request.headers,
              body: boundedBody,
              duplex: 'half',
            } as RequestInit & { duplex: 'half' })
          }

          let form: FormData
          try {
            form = await formSource.formData()
          } catch (error) {
            if (exceededBudgetWhileStreaming) {
              return withCors(
                json({ error: 'Walrus uploader token byte limit exceeded' }, 413),
                corsOrigin,
              )
            }
            throw error
          }

          const walletAddress = assertString(form.get('walletAddress'), 'walletAddress')
          const network = assertString(form.get('network'), 'network')
          if (network !== 'testnet' && network !== 'mainnet') {
            return withCors(json({ error: 'network must be testnet or mainnet' }, 400), corsOrigin)
          }
          verifyWalrusUploaderToken(parseBearerToken(request)!, {
            secret: deps.tokenSecret,
            nowMs: nowMs(),
            walletAddress,
            network,
          })

          const payloadPart = form.get('payload')
          if (!(payloadPart instanceof Blob)) {
            return withCors(json({ error: 'payload must be a multipart file' }, 400), corsOrigin)
          }

          const payload = new Uint8Array(await payloadPart.arrayBuffer())
          // When the client declared a payload-byte budget up front, reject
          // any upload whose actual payload exceeds the declared value. The
          // bounded body already caps the total multipart body, but a strict
          // payload-bytes check guarantees that the post-parse `commitClaim`
          // accounting matches what the client promised.
          if (declaredPayloadBytes != null && payload.byteLength > declaredPayloadBytes) {
            return withCors(
              json({ error: 'Walrus uploader token byte limit exceeded' }, 413),
              corsOrigin,
            )
          }
          const commit = await tokenUsage.commitClaim(token, claimBytes, payload.byteLength)
          if (!commit.ok) {
            return withCors(json({ error: commit.error }, 413), corsOrigin)
          }
          committed = true

          const client = await deps.createWalrusClient(network)
          const encoded = await client.encodeBlob(new Uint8Array(payload))
          const upload: StagedWalrusUpload = {
            uploadId: randomUUID(),
            walletAddress,
            network,
            blobId: encoded.blobId,
            rootHash: encoded.rootHash,
            size: payload.byteLength,
            metadata: encoded.metadata,
            sliversByNode: encoded.sliversByNode,
            certificate: null,
            createdAt: nowMs(),
            expiresAt: nowMs() + stageTtlMs,
            tokenId: token.jti,
          }
          await deps.staging.put(upload)
          payload.fill(0)

          return withCors(json({
            uploadId: upload.uploadId,
            blobId: upload.blobId,
            rootHash: bytesToBase64(upload.rootHash),
            size: upload.size,
          }), corsOrigin)
        } finally {
          if (!committed) {
            await tokenUsage.releaseClaim(token, claimBytes)
          }
        }
      }

      const completeMatch = /^\/v1\/uploads\/([^/]+)\/complete$/.exec(path)
      if (request.method === 'POST' && completeMatch) {
        const uploadId = decodeURIComponent(completeMatch[1])
        const completeStartedAtMs = nowMs()
        let payloadBytes: number | undefined
        const logStage = (stage: string, fields: {
          stageMs?: number
          totalMs?: number
          error?: string
        } = {}) => {
          logWalrusCompleteStage({
            uploadId,
            stage,
            payloadBytes,
            ...fields,
          })
        }

        try {
          let stageStartedAtMs = nowMs()
          const upload = await deps.staging.get(uploadId)
          if (!upload) {
            return withCors(json({ error: 'uploadId is unknown or expired' }, 404), corsOrigin)
          }
          payloadBytes = upload.size
          logStage('staged', {
            stageMs: elapsedMs(nowMs, stageStartedAtMs),
            totalMs: elapsedMs(nowMs, completeStartedAtMs),
          })

          stageStartedAtMs = nowMs()
          authenticate(request, {
            walletAddress: upload.walletAddress,
            network: upload.network,
          })
          logStage('authenticated', {
            stageMs: elapsedMs(nowMs, stageStartedAtMs),
            totalMs: elapsedMs(nowMs, completeStartedAtMs),
          })

          stageStartedAtMs = nowMs()
          const body = parseObjectBody(await request.json().catch(() => null))
          if (!body) return withCors(json({ error: 'Request body must be a JSON object' }, 400), corsOrigin)
          const walletAddress = assertString(body.walletAddress, 'walletAddress')
          const network = assertString(body.network, 'network')
          const registerTxDigest = assertString(body.registerTxDigest, 'registerTxDigest')
          const blobObjectId = assertString(body.blobObjectId, 'blobObjectId')
          if (walletAddress.toLowerCase() !== upload.walletAddress.toLowerCase() || network !== upload.network) {
            return withCors(json({ error: 'upload completion does not match staged wallet/network' }, 403), corsOrigin)
          }
          logStage('parsed_request', {
            stageMs: elapsedMs(nowMs, stageStartedAtMs),
            totalMs: elapsedMs(nowMs, completeStartedAtMs),
          })

          stageStartedAtMs = nowMs()
          const client = await deps.createWalrusClient(upload.network)
          await deps.validateRegister({
            network: upload.network,
            digest: registerTxDigest,
            walletAddress,
            expected: [{ blobId: upload.blobId, blobObjectId }],
          })
          logStage('validated_register', {
            stageMs: elapsedMs(nowMs, stageStartedAtMs),
            totalMs: elapsedMs(nowMs, completeStartedAtMs),
          })

          stageStartedAtMs = nowMs()
          const reusedCertificate = !!upload.certificate
          const certificate = upload.certificate ?? await writeEncodedBlobAndBuildCertificate({
            client,
            upload,
            blobObjectId,
          })
          logStage(reusedCertificate ? 'reused_certificate' : 'built_certificate', {
            stageMs: elapsedMs(nowMs, stageStartedAtMs),
            totalMs: elapsedMs(nowMs, completeStartedAtMs),
          })

          stageStartedAtMs = nowMs()
          await deps.staging.put({
            ...upload,
            certificate,
          })
          logStage('persisted_certificate', {
            stageMs: elapsedMs(nowMs, stageStartedAtMs),
            totalMs: elapsedMs(nowMs, completeStartedAtMs),
          })

          return withCors(json({
            uploadId,
            blobId: upload.blobId,
            blobObjectId,
            certificate: serializeWalrusCertificate(certificate),
          }), corsOrigin)
        } catch (error) {
          logStage('failed', {
            totalMs: elapsedMs(nowMs, completeStartedAtMs),
            error: error instanceof Error ? error.message : String(error),
          })
          throw error
        }
      }

      const finalizeMatch = /^\/v1\/uploads\/([^/]+)\/finalize$/.exec(path)
      if (request.method === 'POST' && finalizeMatch) {
        const uploadId = decodeURIComponent(finalizeMatch[1])
        const upload = await deps.staging.get(uploadId)
        if (!upload) {
          return withCors(json({ ok: true, deleted: false }), corsOrigin)
        }
        authenticate(request, {
          walletAddress: upload.walletAddress,
          network: upload.network,
        })
        const body = parseObjectBody(await request.json().catch(() => null))
        if (body) {
          const walletAddress = assertString(body.walletAddress, 'walletAddress')
          const network = assertString(body.network, 'network')
          if (walletAddress.toLowerCase() !== upload.walletAddress.toLowerCase() || network !== upload.network) {
            return withCors(json({ error: 'finalize does not match staged wallet/network' }, 403), corsOrigin)
          }
        }
        await deps.staging.delete(uploadId)
        return withCors(json({ ok: true, deleted: true }), corsOrigin)
      }

      return withCors(json({ error: 'Not found' }, 404), corsOrigin)
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : 400
      const message = error instanceof Error ? error.message : String(error)
      return withCors(json({ error: message }, status), corsOrigin)
    }
  }
}
