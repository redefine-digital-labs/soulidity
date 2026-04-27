import { NextRequest, NextResponse } from 'next/server'
import { requireMutationIdentity } from '@/lib/auth/identity'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { uploadPublic, getBlobUrl } from '@/lib/services/walrus'

export const dynamic = 'force-dynamic'

const MAX_IMAGE_BYTES = 2 * 1024 * 1024 // 2 MB
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])
const UPLOAD_RATE_LIMIT = {
  max: 20,
  windowMs: 5 * 60 * 1000,
} as const

export async function POST(request: NextRequest) {
  const { error, identity } = await requireMutationIdentity(request)
  if (error) return error

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can upload images' }, { status: 403 })
  }

  const { limited, retryAfterSeconds } = await takeRateLimitToken(
    `collection-upload-image:${identity.memberId}`,
    UPLOAD_RATE_LIMIT,
  )
  if (limited) {
    return NextResponse.json(
      { error: 'Upload rate limit exceeded, try again later' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  }

  const formData = await request.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Request must be multipart/form-data with a "file" field' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" field in form data' }, { status: 400 })
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type "${file.type}". Use PNG, JPEG, WebP, or GIF.` },
      { status: 400 },
    )
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `Image exceeds 2 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB)` },
      { status: 400 },
    )
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const stored = await uploadPublic(buffer)
    const imageUrl = getBlobUrl(stored.blobId)

    return NextResponse.json({ imageUrl, blobId: stored.blobId })
  } catch (uploadError) {
    console.error('[collection-upload-image] Walrus upload failed', {
      memberId: identity.memberId,
      error: uploadError instanceof Error ? uploadError.message : String(uploadError),
    })
    return NextResponse.json({ error: 'Image upload failed' }, { status: 500 })
  }
}
