import { NextRequest, NextResponse } from 'next/server'
import { del } from '@vercel/blob'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { MAX_SOUL_UPLOAD_BYTES } from '@/lib/soulidity/upload-validation'
import { requireSoulCreateWalletIdentity } from '@/lib/soulidity/server'
import {
  SOUL_UPLOAD_TOKEN_VALID_MS,
  getAllowedContentTypesFor,
  parseSoulUploadClientPayload,
  parseSoulUploadTokenPayload,
  recordSoulUploadBinding,
} from '@/lib/soulidity/soul-upload-binding'

const SOUL_UPLOAD_TOKEN_RATE_LIMIT = {
  max: 10,
  windowMs: 5 * 60 * 1000,
} as const

async function strictDelete(blobUrl: string): Promise<void> {
  // Errors must propagate so binding-driven cleanup
  // (pruneExpiredSoulUploadBindings) keeps the DB row when the underlying
  // Vercel Blob is still present and a later pass can retry deletion.
  await del(blobUrl)
}

export async function POST(req: NextRequest) {
  let body: HandleUploadBody
  try {
    body = (await req.json()) as HandleUploadBody
  } catch {
    return NextResponse.json({ error: 'Invalid upload token request body' }, { status: 400 })
  }

  // Vercel Blob calls this endpoint twice per upload:
  //   1. client `upload()` POSTs { type: 'blob.generate-client-token', ... }
  //      — this carries the user's auth cookie/header, so we enforce auth + rate limit.
  //   2. Vercel Blob POSTs { type: 'blob.upload-completed', ... } as a
  //      server-to-server callback signed with the store's r/w token and
  //      verified internally by `handleUpload`. No user cookie is present, so
  //      forcing `requireSoulCreateWalletIdentity` here would 401 the callback.
  let parsedClientPayload: ReturnType<typeof parseSoulUploadClientPayload> = null
  let tokenPayload: string | null = null
  if (body?.type === 'blob.generate-client-token') {
    const auth = await requireSoulCreateWalletIdentity(req, { mutation: true })
    if ('error' in auth) {
      return auth.error
    }
    parsedClientPayload = parseSoulUploadClientPayload(body.payload.clientPayload)
    if (!parsedClientPayload) {
      return NextResponse.json({ error: 'Invalid upload payload' }, { status: 400 })
    }
    const rateLimit = await takeRateLimitToken(`soul-upload-token:${auth.identity.memberId}`, SOUL_UPLOAD_TOKEN_RATE_LIMIT)
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: 'Upload rate limit exceeded' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      )
    }
    tokenPayload = JSON.stringify({
      kind: parsedClientPayload.kind,
      uploadType: parsedClientPayload.uploadType,
      memberId: auth.identity.memberId,
      nonce: parsedClientPayload.nonce,
    })
  }

  try {
    const result = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async () => {
        if (!parsedClientPayload) {
          // Defense-in-depth: handleUpload only invokes this for
          // `blob.generate-client-token` events, where parsedClientPayload is
          // populated above. If we ever see a stray invocation, fall back to
          // the most permissive policy of the strictest kind.
          return {
            allowedContentTypes: [...getAllowedContentTypesFor('persona-sprite', 'public')],
            maximumSizeInBytes: MAX_SOUL_UPLOAD_BYTES,
            addRandomSuffix: true,
            allowOverwrite: false,
            validUntil: Date.now() + SOUL_UPLOAD_TOKEN_VALID_MS,
            tokenPayload,
          }
        }
        return {
          allowedContentTypes: [
            ...getAllowedContentTypesFor(parsedClientPayload.kind, parsedClientPayload.uploadType),
          ],
          maximumSizeInBytes: MAX_SOUL_UPLOAD_BYTES,
          addRandomSuffix: true,
          allowOverwrite: false,
          validUntil: Date.now() + SOUL_UPLOAD_TOKEN_VALID_MS,
          tokenPayload,
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload: completedTokenPayload }) => {
        const parsedPayload = parseSoulUploadTokenPayload(completedTokenPayload)
        if (!parsedPayload) {
          console.error('[upload/token] upload callback missing valid token payload')
          return
        }
        await recordSoulUploadBinding(
          {
            memberId: parsedPayload.memberId,
            nonce: parsedPayload.nonce,
            blobUrl: blob.url,
            pathname: blob.pathname,
            contentType: blob.contentType,
            kind: parsedPayload.kind,
            uploadType: parsedPayload.uploadType,
          },
          { deleteBlob: strictDelete },
        )
      },
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to authorize upload' },
      { status: 400 },
    )
  }
}
