import { NextRequest, NextResponse } from 'next/server'
import { del } from '@vercel/blob'
import { runSoulUploadPipeline, type SoulUploadPipelineResult } from '@/lib/soulidity/soul-upload-pipeline'
import { FILE_TOO_LARGE_ERROR, MAX_SOUL_UPLOAD_BYTES } from '@/lib/soulidity/upload-validation'
import { WalrusUploadError } from '@/lib/services/walrus'
import { requireSoulCreateWalletIdentity } from '@/lib/soulidity/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import {
  SOUL_UPLOAD_WRITE_RATE_LIMIT,
  consumeSoulUploadBinding,
  isSoulUploadKind,
  isSoulUploadType,
  type SoulUploadKind,
  type SoulUploadType,
} from '@/lib/soulidity/soul-upload-binding'

const VERCEL_BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com'

interface FromBlobRequestBody {
  vercelBlobUrl?: unknown
  uploadNonce?: unknown
  kind?: unknown
  uploadType?: unknown
  sendObjectTo?: unknown
  fileName?: unknown
  fileType?: unknown
}

function isVercelBlobUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.hostname.endsWith(VERCEL_BLOB_HOST_SUFFIX)
  } catch {
    return false
  }
}

async function safeDelete(blobUrl: string) {
  try {
    await del(blobUrl)
  } catch (error) {
    console.error('[upload/from-blob] failed to delete temp Vercel Blob', blobUrl, error)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireSoulCreateWalletIdentity(req, { mutation: true })
  if ('error' in auth) {
    return auth.error
  }

  let body: FromBlobRequestBody
  try {
    body = (await req.json()) as FromBlobRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const blobUrl = typeof body.vercelBlobUrl === 'string' ? body.vercelBlobUrl.trim() : ''
  if (!blobUrl || !isVercelBlobUrl(blobUrl)) {
    return NextResponse.json({ error: 'vercelBlobUrl must be a Vercel Blob URL' }, { status: 400 })
  }
  const uploadNonce = typeof body.uploadNonce === 'string' ? body.uploadNonce.trim() : ''
  if (!isSoulUploadKind(body.kind)) {
    return NextResponse.json({ error: 'kind is invalid' }, { status: 400 })
  }
  if (!isSoulUploadType(body.uploadType)) {
    return NextResponse.json({ error: 'uploadType is invalid' }, { status: 400 })
  }
  const kind: SoulUploadKind = body.kind
  const uploadType: SoulUploadType = body.uploadType

  const consumed = await consumeSoulUploadBinding({
    memberId: auth.identity.memberId,
    nonce: uploadNonce,
    blobUrl,
    expectedKind: kind,
    expectedUploadType: uploadType,
  })
  if (!consumed.ok) {
    if (consumed.cleanupBlobUrl) {
      await safeDelete(consumed.cleanupBlobUrl)
    }
    return NextResponse.json({ error: consumed.error }, { status: consumed.status })
  }

  const rateLimit = await takeRateLimitToken(
    `soul-upload:${auth.identity.memberId}`,
    SOUL_UPLOAD_WRITE_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    await safeDelete(blobUrl)
    return NextResponse.json(
      { error: 'Upload rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const fileType = consumed.binding.contentType
  const fileName = typeof body.fileName === 'string' ? body.fileName : 'soul-upload'
  const sendObjectTo = typeof body.sendObjectTo === 'string' ? body.sendObjectTo : null

  let buffer: Buffer
  try {
    const fetchRes = await fetch(blobUrl)
    if (!fetchRes.ok) {
      await safeDelete(blobUrl)
      return NextResponse.json(
        { error: `Failed to fetch uploaded blob (${fetchRes.status})` },
        { status: 502 },
      )
    }
    const contentLengthHeader = fetchRes.headers.get('content-length')
    const advertisedLength = contentLengthHeader ? Number(contentLengthHeader) : null
    if (advertisedLength != null && Number.isFinite(advertisedLength) && advertisedLength > MAX_SOUL_UPLOAD_BYTES) {
      await safeDelete(blobUrl)
      return NextResponse.json({ error: FILE_TOO_LARGE_ERROR }, { status: 413 })
    }
    const arrayBuffer = await fetchRes.arrayBuffer()
    buffer = Buffer.from(arrayBuffer)
  } catch (error) {
    await safeDelete(blobUrl)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch uploaded blob' },
      { status: 502 },
    )
  }

  let result: SoulUploadPipelineResult | null = null
  let finalizeErrorResponse: NextResponse | null = null
  try {
    result = await runSoulUploadPipeline({
      buffer,
      fileName,
      fileType,
      type: uploadType,
      sendObjectTo,
      memberWalletAddress: auth.primarySuiAddress,
    })
  } catch (error) {
    console.error('[upload/from-blob] failed to finalize upload', {
      kind,
      uploadType,
      nonce: consumed.binding.nonce,
      pathname: consumed.binding.pathname,
      error,
    })
    if (error instanceof WalrusUploadError && error.status === 413) {
      finalizeErrorResponse = NextResponse.json(
        { error: 'Upload exceeded the Walrus publisher size cap (~10 MiB). Reduce the file or set WALRUS_PUBLISHER_URL to a publisher with a higher limit.' },
        { status: 413 },
      )
    } else {
      const message = error instanceof Error ? error.message : 'Failed to upload payload'
      finalizeErrorResponse = NextResponse.json({ error: message }, { status: 502 })
    }
  } finally {
    // Whether the pipeline succeeded, rejected the bytes, or threw while
    // writing to Walrus, the Vercel Blob copy is only a temp staging artifact.
    await safeDelete(blobUrl)
  }
  if (finalizeErrorResponse) {
    return finalizeErrorResponse
  }
  if (!result) {
    return NextResponse.json({ error: 'Failed to upload payload' }, { status: 502 })
  }

  if (result.ok === false) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.payload)
}
