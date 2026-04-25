import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { sealDekEnvelope } from '@/lib/services/dek-envelope'
import { getBlobUrl, uploadPublic } from '@/lib/services/walrus'
import {
  FILE_TOO_LARGE_ERROR,
  JSON_METADATA_TOO_LARGE_ERROR,
  extractSkillBundleMetadata,
  hasZipSignature,
  validateSoulUploadFile,
  validateSoulUploadSignature,
} from '@/lib/soulidity/upload-validation'

export interface SoulUploadPipelineInput {
  buffer: Buffer
  fileName: string
  fileType: string
  type: 'public' | 'encrypted'
  sendObjectTo?: string | null
  memberWalletAddress?: string | null
}

export interface SoulUploadPipelineSuccess {
  ok: true
  payload: {
    blobId: string
    blobObjectId: string | null
    contentHash: string
    blobUrl: string
    skillName: string | null
    sealDekEnvelope?: string
  }
}

export interface SoulUploadPipelineFailure {
  ok: false
  error: string
  status: number
}

export type SoulUploadPipelineResult = SoulUploadPipelineSuccess | SoulUploadPipelineFailure

export async function runSoulUploadPipeline(
  input: SoulUploadPipelineInput,
): Promise<SoulUploadPipelineResult> {
  const { buffer, fileName, fileType, type } = input

  const pseudoFile = { size: buffer.byteLength, type: fileType }
  const validationError = validateSoulUploadFile(pseudoFile, type)
  if (validationError) {
    const status =
      validationError === FILE_TOO_LARGE_ERROR || validationError === JSON_METADATA_TOO_LARGE_ERROR ? 413 : 400
    return { ok: false, error: validationError, status }
  }

  const signatureError = validateSoulUploadSignature(buffer, type, fileType)
  if (signatureError) {
    return { ok: false, error: signatureError, status: 400 }
  }

  const skillBundleMetadata = hasZipSignature(buffer)
    ? (() => {
        try {
          return extractSkillBundleMetadata(buffer)
        } catch (error) {
          return error instanceof Error ? error : new Error(String(error))
        }
      })()
    : null
  if (skillBundleMetadata instanceof Error) {
    return { ok: false, error: skillBundleMetadata.message, status: 400 }
  }

  const contentHash = createHash('sha256').update(buffer).digest('hex')

  const clientSendTo = input.sendObjectTo?.trim() || null
  if (clientSendTo) {
    if (!input.memberWalletAddress) {
      return { ok: false, error: 'Bind a Sui wallet before specifying upload ownership', status: 403 }
    }
    try {
      if (normalizeSuiAddress(clientSendTo) !== normalizeSuiAddress(input.memberWalletAddress)) {
        return { ok: false, error: 'sendObjectTo does not match the signed-in wallet', status: 403 }
      }
    } catch {
      return { ok: false, error: 'Invalid sendObjectTo address', status: 400 }
    }
  }

  if (type === 'public') {
    const uploaded = await uploadPublic(buffer, clientSendTo ? { sendObjectTo: clientSendTo } : undefined)
    return {
      ok: true,
      payload: {
        blobId: uploaded.blobId,
        blobObjectId: uploaded.blobObjectId,
        contentHash,
        blobUrl: getBlobUrl(uploaded.blobId),
        skillName: skillBundleMetadata?.skillName ?? null,
      },
    }
  }

  if (!input.memberWalletAddress) {
    return { ok: false, error: 'Bind a Sui wallet before uploading encrypted Soul content', status: 403 }
  }

  const dek = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', dek, iv)
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final(), cipher.getAuthTag()])

  const uploaded = await uploadPublic(ciphertext, {
    sendObjectTo: input.memberWalletAddress,
  })
  const envelope = sealDekEnvelope({
    dek,
    iv,
    contentHash,
    mimeType: fileType || 'application/octet-stream',
    fileName: fileName || 'bundle',
  })

  return {
    ok: true,
    payload: {
      blobId: uploaded.blobId,
      blobObjectId: uploaded.blobObjectId,
      contentHash,
      sealDekEnvelope: envelope,
      blobUrl: getBlobUrl(uploaded.blobId),
      skillName: skillBundleMetadata?.skillName ?? null,
    },
  }
}
