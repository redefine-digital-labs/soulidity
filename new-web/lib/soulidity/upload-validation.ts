export const MAX_SOUL_UPLOAD_BYTES = 50 * 1024 * 1024
export const FILE_TOO_LARGE_ERROR = 'File exceeds 50 MB limit'
export const JSON_METADATA_TOO_LARGE_ERROR = 'JSON metadata exceeds 5 MB limit'
const PUBLIC_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const PUBLIC_METADATA_MIME_TYPES = new Set(['application/json'])
const PUBLIC_TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'application/markdown'])
const MAX_PUBLIC_JSON_METADATA_BYTES = 5 * 1024 * 1024
const MAX_PUBLIC_TEXT_BYTES = 5 * 1024 * 1024
const MIN_ENCRYPTED_PAYLOAD_BYTES = 32
export const PUBLIC_UPLOAD_ERROR = 'Public uploads must be JPEG, PNG, WebP, GIF images, JSON metadata, or plain-text skill documents'
const ENCRYPTED_UPLOAD_ERROR = 'Encrypted upload is too small (minimum 32 bytes)'

export function validateSoulUploadFile(file: Pick<File, 'size' | 'type'>, type: 'public' | 'encrypted') {
  if (file.size > MAX_SOUL_UPLOAD_BYTES) {
    return FILE_TOO_LARGE_ERROR
  }

  if (type === 'public') {
    if (file.type === 'application/json' && file.size > MAX_PUBLIC_JSON_METADATA_BYTES) {
      return JSON_METADATA_TOO_LARGE_ERROR
    }
    if (
      !PUBLIC_IMAGE_MIME_TYPES.has(file.type)
      && !PUBLIC_METADATA_MIME_TYPES.has(file.type)
      && !PUBLIC_TEXT_MIME_TYPES.has(file.type)
    ) {
      return PUBLIC_UPLOAD_ERROR
    }
    return null
  }

  if (file.size < MIN_ENCRYPTED_PAYLOAD_BYTES) {
    return ENCRYPTED_UPLOAD_ERROR
  }
  return null
}

function hasPrefix(bytes: Uint8Array, prefix: number[]) {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

function hasJpegSignature(bytes: Uint8Array) {
  return hasPrefix(bytes, [0xff, 0xd8, 0xff])
}

function hasPngSignature(bytes: Uint8Array) {
  return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

function hasWebpSignature(bytes: Uint8Array) {
  return (
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytes.length >= 12
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  )
}

function hasGifSignature(bytes: Uint8Array) {
  return hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
}

function isJsonPayload(bytes: Uint8Array) {
  if (bytes.length > MAX_PUBLIC_JSON_METADATA_BYTES) {
    return false
  }

  try {
    const raw = new TextDecoder().decode(bytes).trim()
    if (!raw.startsWith('{') || !raw.endsWith('}')) {
      return false
    }
    JSON.parse(raw)
    return true
  } catch {
    return false
  }
}

function isPlainTextPayload(bytes: Uint8Array) {
  if (bytes.length > MAX_PUBLIC_TEXT_BYTES) {
    return false
  }

  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      return false
    }

    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)
  } catch {
    return false
  }
}

export function validateSoulUploadSignature(
  bytes: Uint8Array,
  type: 'public' | 'encrypted',
  mimeType = '',
) {
  if (type === 'public') {
    if (mimeType === 'application/json') {
      return isJsonPayload(bytes) ? null : PUBLIC_UPLOAD_ERROR
    }
    if (PUBLIC_TEXT_MIME_TYPES.has(mimeType)) {
      return isPlainTextPayload(bytes) ? null : PUBLIC_UPLOAD_ERROR
    }
    if (hasJpegSignature(bytes) || hasPngSignature(bytes) || hasWebpSignature(bytes) || hasGifSignature(bytes)) {
      return null
    }
    return PUBLIC_UPLOAD_ERROR
  }

  if (bytes.length >= MIN_ENCRYPTED_PAYLOAD_BYTES) {
    return null
  }

  return ENCRYPTED_UPLOAD_ERROR
}
