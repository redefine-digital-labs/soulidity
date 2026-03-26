import { createHmac, timingSafeEqual } from 'node:crypto'

const CLAIM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const FULL_CLAIM_TOKEN_SIGNATURE_HEX_LENGTH = 64

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET environment variable is required')
  return secret
}

function signClaimToken(memberId: string, issuedAt: number): string {
  return createHmac('sha256', getAuthSecret())
    .update(`agent-claim:${memberId}:${issuedAt}`)
    .digest('hex')
}

export function createClaimToken(memberId: string, issuedAt = Date.now()): string {
  return `${issuedAt}.${signClaimToken(memberId, issuedAt)}`
}

export function isValidClaimToken(memberId: string, token: string, now = Date.now()): boolean {
  const separatorIndex = token.indexOf('.')
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
    return false
  }

  const rawIssuedAt = token.slice(0, separatorIndex)
  const signature = token.slice(separatorIndex + 1).toLowerCase()
  if (
    !/^\d+$/.test(rawIssuedAt)
    || !/^[a-f0-9]+$/.test(signature)
    || signature.length !== FULL_CLAIM_TOKEN_SIGNATURE_HEX_LENGTH
  ) {
    return false
  }

  const issuedAt = Number.parseInt(rawIssuedAt, 10)
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
    return false
  }

  if (issuedAt > now) {
    return false
  }

  if (now - issuedAt > CLAIM_TOKEN_TTL_MS) {
    return false
  }

  const expectedSignature = signClaimToken(memberId, issuedAt)
  const receivedBytes = Buffer.from(signature, 'utf8')
  const expectedBytes = Buffer.from(expectedSignature, 'utf8')

  return receivedBytes.length === expectedBytes.length
    && timingSafeEqual(receivedBytes, expectedBytes)
}
