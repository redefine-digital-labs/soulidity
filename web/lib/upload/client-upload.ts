'use client'

// Shared two-step Vercel-Blob → Walrus upload helper.
//
// All production-facing soul/sprite/skill upload paths route through here so
// the legacy 4.5 MB Vercel-function inbound body limit never bites a
// legitimate user upload. The browser direct-uploads to Vercel Blob (no
// inbound function hop), the server then pulls the staged blob, runs the
// shared validation/encryption pipeline, persists to Walrus, and deletes the
// staging blob.

const FROM_BLOB_RETRY_ATTEMPTS = 5
const FROM_BLOB_RETRY_DELAY_BASE_MS = 250

export type SoulUploadKind = 'persona-sprite' | 'soul-content'
export type SoulUploadType = 'public' | 'encrypted'

export interface SoulUploadResult {
  blobId: string
  blobObjectId: string
  contentHash: string
  blobUrl: string
  sealDekEnvelope?: string | null
  skillName?: string | null
}

const PUBLIC_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json',
  '.zip': 'application/zip',
}

const ENCRYPTED_MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

function fileExtension(file: File): string {
  const name = file.name.toLowerCase()
  const dotIndex = name.lastIndexOf('.')
  return dotIndex >= 0 ? name.slice(dotIndex) : ''
}

// Browsers and OS integrations sometimes leave `File.type` blank for valid
// uploads (notably ZIP files on macOS). Vercel Blob's `allowedContentTypes`
// rejects empty MIME values, so we infer one from the extension before
// initiating the client upload. The server-side `validateSoulUploadSignature`
// re-validates by byte signature, so a wrong inference can only stage a blob
// that the finalize route will reject.
export function inferSoulUploadContentType(
  file: File,
  uploadType: SoulUploadType,
): string {
  if (file.type) return file.type
  const ext = fileExtension(file)
  if (uploadType === 'public') {
    return PUBLIC_MIME_BY_EXT[ext] ?? 'application/octet-stream'
  }
  return ENCRYPTED_MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

export interface UploadSoulPayloadParams {
  file: File
  uploadType: SoulUploadType
  kind: SoulUploadKind
  authHeaders: Record<string, string>
  sendObjectTo?: string | null
  /** Defaults to a per-kind path under `souls/`. */
  pathnamePrefix?: string
}

export async function uploadSoulPayload(params: UploadSoulPayloadParams): Promise<SoulUploadResult> {
  const { file, uploadType, kind, authHeaders, sendObjectTo, pathnamePrefix } = params

  // Dev + E2E short-circuit: Vercel Blob's `onUploadCompleted` callback is a
  // server-to-server POST that cannot reach `localhost`, so the binding row is
  // never written and `/from-blob` 409s indefinitely. Route the small fixture
  // uploads through the legacy `/api/souls/upload` endpoint instead — it
  // performs the same auth + rate-limit + validation + Walrus upload inline
  // and returns the same `SoulUploadResult` shape.
  if (
    process.env.NODE_ENV === 'development' &&
    process.env.NEXT_PUBLIC_E2E_TEST_MODE === '1'
  ) {
    void kind
    void pathnamePrefix
    const formData = new FormData()
    formData.append('file', file)
    formData.append('type', uploadType)
    if (sendObjectTo) formData.append('sendObjectTo', sendObjectTo)
    const res = await fetch('/api/souls/upload', {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    })
    const payload = (await res.json().catch(() => null)) as Partial<SoulUploadResult> | { error?: string } | null
    if (!res.ok) {
      const message =
        payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
          ? (payload as { error: string }).error
          : 'Failed to upload payload'
      throw new Error(message)
    }
    const finalized = payload as SoulUploadResult
    if (!finalized.blobObjectId) {
      throw new Error('Upload response is missing blobObjectId')
    }
    return finalized
  }

  // Step 1: client direct-upload to Vercel Blob, bypassing the 4.5 MB
  // serverless function inbound body limit.
  const { upload: clientUpload } = await import('@vercel/blob/client')
  const uploadNonce = crypto.randomUUID()
  const contentType = inferSoulUploadContentType(file, uploadType)
  const safeName = file.name && file.name.length > 0 ? file.name : `${kind}-${uploadNonce}`
  const prefix = pathnamePrefix ?? (kind === 'persona-sprite' ? 'souls/sprite' : 'souls/content')
  const uploaded = await clientUpload(`${prefix}/${safeName}`, file, {
    access: 'public',
    handleUploadUrl: '/api/souls/upload/token',
    contentType,
    clientPayload: JSON.stringify({ kind, uploadType, nonce: uploadNonce }),
    headers: authHeaders,
  })

  // Step 2: ask the server to finalize. The Vercel Blob upload-completed
  // callback writes the binding row server-to-server, but the user's POST
  // to /from-blob can race with that callback. A 409 means "binding not
  // ready yet" — retry briefly with backoff so a slow callback doesn't
  // surface as a user-visible failure.
  let payload: unknown = null
  let response: Response | null = null
  for (let attempt = 0; attempt < FROM_BLOB_RETRY_ATTEMPTS; attempt += 1) {
    response = await fetch('/api/souls/upload/from-blob', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vercelBlobUrl: uploaded.url,
        uploadNonce,
        kind,
        uploadType,
        sendObjectTo: sendObjectTo ?? undefined,
        fileName: file.name,
        fileType: file.type,
      }),
    })
    payload = await response.json().catch(() => null)
    if (response.ok || response.status !== 409) break
    await new Promise((resolve) => setTimeout(resolve, FROM_BLOB_RETRY_DELAY_BASE_MS * (attempt + 1)))
  }

  if (!response?.ok) {
    const message =
      payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : 'Failed to upload payload'
    throw new Error(message)
  }
  const finalized = payload as SoulUploadResult
  if (!finalized.blobObjectId) {
    throw new Error('Upload response is missing blobObjectId')
  }
  return finalized
}
