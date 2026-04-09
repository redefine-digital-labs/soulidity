import { NextRequest, NextResponse } from 'next/server'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { requireIdentity } from '@web/lib/auth/identity'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { isMultipleSuiWalletBindingsError } from '@web/lib/auth/sui-wallet-errors'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { sealDekEnvelope } from '@web/lib/services/dek-envelope'
import {
  FILE_TOO_LARGE_ERROR,
  JSON_METADATA_TOO_LARGE_ERROR,
  MAX_SOUL_UPLOAD_BYTES,
  extractSkillBundleMetadata,
  hasZipSignature,
  validateSoulUploadFile,
  validateSoulUploadSignature,
} from '@/lib/soulidity/upload-validation'

import { uploadPublic, getBlobUrl } from '@web/lib/services/walrus'

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

  const uploadRateLimit = await takeRateLimitToken(
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

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }
  const file = formData.get('file')
  const type = formData.get('type')
  const clientSendObjectTo = formData.get('sendObjectTo')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (type !== 'public' && type !== 'encrypted') {
    return NextResponse.json({ error: 'Invalid upload type' }, { status: 400 })
  }


  const validationError = validateSoulUploadFile(file, type)
  if (validationError) {
    const status =
      validationError === FILE_TOO_LARGE_ERROR || validationError === JSON_METADATA_TOO_LARGE_ERROR
        ? 413
        : 400
    return NextResponse.json({ error: validationError }, { status })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const signatureError = validateSoulUploadSignature(buffer, type, file.type)
  if (signatureError) {
    return NextResponse.json({ error: signatureError }, { status: 400 })
  }
  const skillBundleMetadata = hasZipSignature(buffer)
    ? (() => {
        try {
          return extractSkillBundleMetadata(buffer)
        } catch (error) {
          if (error instanceof Error) {
            return error
          }
          throw error
        }
      })()
    : null
  if (skillBundleMetadata instanceof Error) {
    return NextResponse.json({ error: skillBundleMetadata.message }, { status: 400 })
  }
  const contentHash = createHash('sha256').update(buffer).digest('hex')

  // Resolve the member's bound wallet for ownership validation
  let memberWalletAddress: string | null
  try {
    memberWalletAddress = await getMemberPrimarySuiWalletAddress(identity.memberId)
  } catch (walletError) {
    if (isMultipleSuiWalletBindingsError(walletError)) {
      return NextResponse.json({ error: (walletError as Error).message }, { status: 409 })
    }
    throw walletError
  }

  // Validate client-provided sendObjectTo against the member's wallet
  const clientSendTo = typeof clientSendObjectTo === 'string' && clientSendObjectTo.trim() ? clientSendObjectTo.trim() : null
  if (clientSendTo) {
    if (!memberWalletAddress) {
      return NextResponse.json({ error: 'Bind a Sui wallet before specifying upload ownership' }, { status: 403 })
    }
    try {
      if (normalizeSuiAddress(clientSendTo) !== normalizeSuiAddress(memberWalletAddress)) {
        return NextResponse.json({ error: 'sendObjectTo does not match the signed-in wallet' }, { status: 403 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid sendObjectTo address' }, { status: 400 })
    }
  }

  if (type === 'public') {
    const uploaded = await uploadPublic(buffer, clientSendTo ? { sendObjectTo: clientSendTo } : undefined)
    return NextResponse.json({
      ...uploaded,
      contentHash,
      blobUrl: getBlobUrl(uploaded.blobId),
      skillName: skillBundleMetadata?.skillName ?? null,
    })
  }

  // type === 'encrypted': AES-GCM-256 encrypt before uploading to Walrus
  if (!memberWalletAddress) {
    return NextResponse.json({ error: 'Bind a Sui wallet before uploading encrypted Soul content' }, { status: 403 })
  }
  const ownerAddress = memberWalletAddress

  const dek = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', dek, iv)
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final(), cipher.getAuthTag()])

  const uploaded = await uploadPublic(ciphertext, {
    sendObjectTo: ownerAddress,
  })
  const envelope = sealDekEnvelope({ dek, iv, contentHash, mimeType: file.type || 'application/octet-stream', fileName: file.name || 'bundle' })

  return NextResponse.json({
    ...uploaded,
    contentHash,
    sealDekEnvelope: envelope,
    blobUrl: getBlobUrl(uploaded.blobId),
    skillName: skillBundleMetadata?.skillName ?? null,
  })
}
