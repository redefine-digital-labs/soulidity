const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const HEX_PATTERN = /^(?:0x)?[0-9a-fA-F]+$/
const NON_PRINTABLE_UTF8_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

function isByteArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
}

function decodeBase64(value: string): Buffer | null {
  if (!BASE64_PATTERN.test(value) || value.length % 4 !== 0) return null

  try {
    const bytes = Buffer.from(value, 'base64')
    if (bytes.length === 0 && value.length > 0) return null
    return bytes
  } catch {
    return null
  }
}

function looksLikeUtf8Text(value: string): boolean {
  return !value.includes('\uFFFD') && !NON_PRINTABLE_UTF8_PATTERN.test(value)
}

function decodeMoveBytes(value: unknown): Buffer | null {
  if (typeof value === 'string') {
    const base64Decoded = decodeBase64(value)
    if (base64Decoded) return base64Decoded
    return Buffer.from(value, 'utf8')
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value)
  }

  if (isByteArray(value)) {
    return Buffer.from(value)
  }

  return null
}

export function decodeMoveText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  const bytes = decodeMoveBytes(value)
  if (!bytes) {
    throw new Error('Unsupported Move byte representation')
  }

  return bytes.toString('utf8')
}

export function decodeMoveBytesAsUtf8(value: unknown): string {
  if (typeof value === 'string') {
    const base64Decoded = decodeBase64(value)
    if (base64Decoded) {
      const decoded = base64Decoded.toString('utf8')
      if (looksLikeUtf8Text(decoded)) {
        return decoded
      }
    }

    return value
  }

  const bytes = decodeMoveBytes(value)
  if (!bytes) {
    throw new Error('Unsupported Move byte representation')
  }

  return bytes.toString('utf8')
}

export function decodeMoveBytesAsHex(value: unknown): string {
  if (typeof value === 'string' && HEX_PATTERN.test(value)) {
    return value.replace(/^0x/i, '').toLowerCase()
  }

  const bytes = decodeMoveBytes(value)
  if (!bytes) {
    throw new Error('Unsupported Move byte representation')
  }

  return bytes.toString('hex')
}
