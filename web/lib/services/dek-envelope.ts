/**
 * Server-side DEK envelope: encrypts the AES-GCM DEK + IV + contentHash + file metadata
 * with a server secret so the frontend can shuttle it back during publish
 * without being able to read the DEK.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const ENVELOPE_IV_BYTES = 12
const AUTH_TAG_BYTES = 16
const DEK_BYTES = 32
const IV_BYTES = 12
const CONTENT_HASH_HEX_LENGTH = 64
const MAX_ENVELOPE_BYTES = 8 * 1024

interface DekEnvelopePayload {
  dek: string       // base64 (32 bytes)
  iv: string        // base64 (12 bytes)
  contentHash: string // 64-char hex
  mimeType: string
  fileName: string
}

function getUploadSecret(): Buffer {
  const hex = process.env.SOUL_UPLOAD_SECRET
  if (!hex || hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('SOUL_UPLOAD_SECRET must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

export function sealDekEnvelope(params: {
  dek: Uint8Array
  iv: Uint8Array
  contentHash: string
  mimeType: string
  fileName: string
}): string {
  if (params.dek.length !== DEK_BYTES) {
    throw new Error('DEK must be 32 bytes')
  }
  if (params.iv.length !== IV_BYTES) {
    throw new Error('IV must be 12 bytes')
  }
  if (params.contentHash.length !== CONTENT_HASH_HEX_LENGTH || !/^[0-9a-f]+$/.test(params.contentHash)) {
    throw new Error('contentHash must be a 64-character lowercase hex string')
  }

  const payload: DekEnvelopePayload = {
    dek: Buffer.from(params.dek).toString('base64'),
    iv: Buffer.from(params.iv).toString('base64'),
    contentHash: params.contentHash,
    mimeType: params.mimeType,
    fileName: params.fileName,
  }

  const secret = getUploadSecret()
  const envelopeIv = randomBytes(ENVELOPE_IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, secret, envelopeIv)

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Envelope: envelopeIv (12) + authTag (16) + ciphertext
  return Buffer.concat([envelopeIv, authTag, encrypted]).toString('base64')
}

export function unsealDekEnvelope(envelope: string): {
  dek: Uint8Array
  iv: Uint8Array
  contentHash: string
  mimeType: string
  fileName: string
} {
  const secret = getUploadSecret()
  const raw = Buffer.from(envelope, 'base64')

  const headerLength = ENVELOPE_IV_BYTES + AUTH_TAG_BYTES
  if (raw.length <= headerLength || raw.length > MAX_ENVELOPE_BYTES) {
    throw new Error('DEK envelope is malformed')
  }

  const envelopeIv = raw.subarray(0, ENVELOPE_IV_BYTES)
  const authTag = raw.subarray(ENVELOPE_IV_BYTES, headerLength)
  const ciphertext = raw.subarray(headerLength)

  const decipher = createDecipheriv(ALGORITHM, secret, envelopeIv)
  decipher.setAuthTag(authTag)

  let plaintext: Buffer
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new Error('DEK envelope is invalid or has been tampered with')
  }

  let payload: DekEnvelopePayload
  try {
    payload = JSON.parse(plaintext.toString('utf8'))
  } catch {
    throw new Error('DEK envelope payload is not valid JSON')
  }

  if (typeof payload.dek !== 'string' || typeof payload.iv !== 'string'
    || typeof payload.contentHash !== 'string' || typeof payload.mimeType !== 'string'
    || typeof payload.fileName !== 'string') {
    throw new Error('DEK envelope payload is missing required fields')
  }

  const dekBytes = Buffer.from(payload.dek, 'base64')
  const ivBytes = Buffer.from(payload.iv, 'base64')

  if (dekBytes.length !== DEK_BYTES) {
    throw new Error('DEK envelope contains invalid DEK')
  }
  if (ivBytes.length !== IV_BYTES) {
    throw new Error('DEK envelope contains invalid IV')
  }
  if (payload.contentHash.length !== CONTENT_HASH_HEX_LENGTH || !/^[0-9a-f]+$/.test(payload.contentHash)) {
    throw new Error('DEK envelope contains invalid content hash')
  }

  return {
    dek: new Uint8Array(dekBytes),
    iv: new Uint8Array(ivBytes),
    contentHash: payload.contentHash,
    mimeType: payload.mimeType,
    fileName: payload.fileName,
  }
}
