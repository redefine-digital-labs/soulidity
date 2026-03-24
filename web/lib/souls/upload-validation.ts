export const MAX_SOUL_UPLOAD_BYTES = 50 * 1024 * 1024
export const FILE_TOO_LARGE_ERROR = 'File exceeds 50 MB limit'
export const JSON_METADATA_TOO_LARGE_ERROR = 'JSON metadata exceeds 5 MB limit'
const PUBLIC_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const PUBLIC_METADATA_MIME_TYPES = new Set(['application/json'])
const MAX_PUBLIC_JSON_METADATA_BYTES = 5 * 1024 * 1024
const MIN_ENCRYPTED_PAYLOAD_BYTES = 32
export const PUBLIC_UPLOAD_ERROR = 'Public uploads must be JPEG, PNG, WebP, GIF images, or JSON metadata'
const ENCRYPTED_UPLOAD_ERROR = 'Encrypted upload is too small (minimum 32 bytes)'

export function validateSoulUploadFile(file: Pick<File, 'name' | 'size' | 'type'>, type: 'public' | 'encrypted'): string | null {
  if (file.size > MAX_SOUL_UPLOAD_BYTES) {
    return FILE_TOO_LARGE_ERROR
  }

  if (type === 'public') {
    if (file.type === 'application/json' && file.size > MAX_PUBLIC_JSON_METADATA_BYTES) {
      return JSON_METADATA_TOO_LARGE_ERROR
    }
    if (!PUBLIC_IMAGE_MIME_TYPES.has(file.type) && !PUBLIC_METADATA_MIME_TYPES.has(file.type)) {
      return PUBLIC_UPLOAD_ERROR
    }
    return null
  }

  // Encrypted uploads accept any MIME type: the raw bundle (pre-Seal) can be
  // any format (JSON, text, zip, etc.) and post-Seal blobs are opaque binary.
  // Size validation is the only meaningful check here.
  if (file.size < MIN_ENCRYPTED_PAYLOAD_BYTES) {
    return ENCRYPTED_UPLOAD_ERROR
  }
  return null
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

function hasJpegSignature(bytes: Uint8Array): boolean {
  return hasPrefix(bytes, [0xff, 0xd8, 0xff])
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

function hasWebpSignature(bytes: Uint8Array): boolean {
  return (
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
}

function hasGifSignature(bytes: Uint8Array): boolean {
  return hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
}

function isJsonPayload(bytes: Uint8Array): boolean {
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

export function validateSoulUploadSignature(
  bytes: Uint8Array,
  type: 'public' | 'encrypted',
  mimeType = '',
): string | null {
  if (type === 'public') {
    if (mimeType === 'application/json') {
      return isJsonPayload(bytes) ? null : PUBLIC_UPLOAD_ERROR
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
