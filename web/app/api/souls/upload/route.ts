import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { requireIdentity } from '@web/lib/auth/identity'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import {
  MAX_SOUL_UPLOAD_BYTES,
  validateSoulUploadFile,
  validateSoulUploadSignature,
} from '@web/lib/souls/upload-validation'
import { uploadEncrypted, uploadPublic } from '@web/lib/services/walrus'

const MAX_UPLOAD_FORMDATA_BYTES = MAX_SOUL_UPLOAD_BYTES + 1_024 * 1_024
const SOUL_UPLOAD_RATE_LIMIT = {
  max: 10,
  windowMs: 5 * 60 * 1000,
} as const

function parseContentLength(rawValue: string | null): number | null {
  if (!rawValue) return null
  const parsedValue = Number(rawValue)
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null
  }

  return parsedValue
}

export async function POST(req: NextRequest) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can upload' }, { status: 403 })
  }

  const uploadRateLimit = takeRateLimitToken(
    `soul-upload:${identity.memberId}`,
    SOUL_UPLOAD_RATE_LIMIT,
  )
  if (uploadRateLimit.limited) {
    return NextResponse.json(
      { error: 'Upload rate limit exceeded' },
      {
        status: 429,
        headers: { 'Retry-After': String(uploadRateLimit.retryAfterSeconds) },
      },
    )
  }

  const contentLength = parseContentLength(req.headers.get('content-length'))
  if (contentLength == null) {
    return NextResponse.json({ error: 'Content-Length header is required for uploads' }, { status: 411 })
  }
  if (contentLength > MAX_UPLOAD_FORMDATA_BYTES) {
    return NextResponse.json({ error: 'File exceeds 50 MB limit' }, { status: 413 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const type = formData.get('type') as string | null // 'encrypted' or 'public'

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (type !== 'public' && type !== 'encrypted') {
    return NextResponse.json({ error: 'Invalid upload type' }, { status: 400 })
  }

  const validationError = validateSoulUploadFile(file, type)
  if (validationError) {
    const status = validationError === 'File exceeds 50 MB limit' ? 413 : 400
    return NextResponse.json({ error: validationError }, { status })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const signatureError = validateSoulUploadSignature(buffer, type)
  if (signatureError) {
    return NextResponse.json({ error: signatureError }, { status: 400 })
  }
  const contentHash = createHash('sha256').update(buffer).digest('hex')
  const uploadFn = type === 'public' ? uploadPublic : uploadEncrypted
  const blobId = await uploadFn(buffer)

  return NextResponse.json({ blobId, contentHash })
}
