export const MAX_SOUL_UPLOAD_BYTES = 50 * 1024 * 1024
const PUBLIC_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const ENCRYPTED_ARCHIVE_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
])

export function validateSoulUploadFile(file: Pick<File, 'name' | 'size' | 'type'>, type: 'public' | 'encrypted'): string | null {
  if (file.size > MAX_SOUL_UPLOAD_BYTES) {
    return 'File exceeds 50 MB limit'
  }

  if (type === 'public') {
    if (!PUBLIC_IMAGE_MIME_TYPES.has(file.type)) {
      return 'Public uploads must be JPEG, PNG, WebP, or GIF images'
    }
    return null
  }

  const lowerName = file.name.toLowerCase()
  const hasZipExtension = lowerName.endsWith('.zip')
  const hasAllowedMime = file.type === '' || ENCRYPTED_ARCHIVE_MIME_TYPES.has(file.type)
  if (!hasZipExtension || !hasAllowedMime) {
    return 'Encrypted uploads must be ZIP archives'
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

function hasZipSignature(bytes: Uint8Array): boolean {
  return (
    hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    hasPrefix(bytes, [0x50, 0x4b, 0x07, 0x08])
  )
}

export function validateSoulUploadSignature(bytes: Uint8Array, type: 'public' | 'encrypted'): string | null {
  if (type === 'public') {
    if (hasJpegSignature(bytes) || hasPngSignature(bytes) || hasWebpSignature(bytes) || hasGifSignature(bytes)) {
      return null
    }
    return 'Public uploads must be JPEG, PNG, WebP, or GIF images'
  }

  if (hasZipSignature(bytes)) {
    return null
  }

  return 'Encrypted uploads must be ZIP archives'
}
