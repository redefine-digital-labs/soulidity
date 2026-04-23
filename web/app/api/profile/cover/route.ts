import { NextRequest, NextResponse } from 'next/server'

import { requireIdentity } from '@/lib/auth/identity'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { getBlobUrl, uploadPublic } from '@/lib/services/walrus'
import { validateSoulUploadSignature } from '@/lib/soulidity/upload-validation'

export const dynamic = 'force-dynamic'

const PROFILE_COVER_UPLOAD_RATE_LIMIT = { max: 5, windowMs: 5 * 60 * 1000 } as const
const PROFILE_COVER_MAX_BYTES = 5 * 1024 * 1024
const PROFILE_COVER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export async function POST(request: NextRequest) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can update profile covers' }, { status: 403 })
  }

  const { limited, retryAfterSeconds } = await takeRateLimitToken(
    `profile-cover-upload:${identity.memberId}`,
    PROFILE_COVER_UPLOAD_RATE_LIMIT,
  )
  if (limited) {
    return NextResponse.json(
      { error: 'Too many profile cover uploads, try again later' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (!PROFILE_COVER_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Profile cover must be PNG, JPEG, or WebP' }, { status: 400 })
  }
  if (file.size > PROFILE_COVER_MAX_BYTES) {
    return NextResponse.json({ error: 'Profile cover exceeds 5 MB limit' }, { status: 413 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const signatureError = validateSoulUploadSignature(buffer, 'public', file.type)
  if (signatureError) {
    return NextResponse.json({ error: signatureError }, { status: 400 })
  }

  const uploaded = await uploadPublic(buffer)

  return NextResponse.json({
    blobId: uploaded.blobId,
    blobObjectId: uploaded.blobObjectId,
    blobUrl: getBlobUrl(uploaded.blobId),
  })
}
