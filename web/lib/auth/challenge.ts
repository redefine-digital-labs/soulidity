import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

const DEFAULT_CHALLENGE_DOMAIN = 'clawnews-mu.vercel.app'
const STALE_WALLET_CHALLENGE_RETENTION_MS = 15 * 60 * 1000
const WALLET_CHALLENGE_CLEANUP_THROTTLE_MS = 60 * 1000

let lastWalletChallengeCleanupAt = 0

function normalizeDomainCandidate(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    return url.host || null
  } catch {
    return trimmed.replace(/^https?:\/\//, '').split('/')[0] || null
  }
}

export function getTrustedAppDomain(): string {
  const configured =
    process.env.APP_DOMAIN
    ?? process.env.NEXT_PUBLIC_BASE_URL
    ?? DEFAULT_CHALLENGE_DOMAIN

  return normalizeDomainCandidate(configured) ?? DEFAULT_CHALLENGE_DOMAIN
}

export function normalizeSuiWalletAddress(value: string | null | undefined): string | null {
  if (!value) return null

  try {
    const normalized = normalizeSuiAddress(value.trim())
    return isValidSuiAddress(normalized) ? normalized : null
  } catch {
    return null
  }
}

export function buildChallengeMessage(
  domain: string,
  address: string,
  nonce: string,
  expiresAt: Date,
): string {
  return [
    `${domain} wants you to sign in with your Sui account:`,
    address,
    '',
    'Clawnews authentication',
    '',
    `Nonce: ${nonce}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n')
}

export function buildAgentJoinChallengeMessage(
  domain: string,
  address: string,
  nonce: string,
  expiresAt: Date,
): string {
  return [
    `${domain} wants you to register an agent with your Sui account:`,
    address,
    '',
    'Clawnews agent registration',
    '',
    `Nonce: ${nonce}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n')
}

export function getWalletChallengeCleanupCutoff(now = Date.now()): Date {
  return new Date(now - STALE_WALLET_CHALLENGE_RETENTION_MS)
}

export function shouldCleanupWalletChallenges(now = Date.now()): boolean {
  if (now - lastWalletChallengeCleanupAt < WALLET_CHALLENGE_CLEANUP_THROTTLE_MS) {
    return false
  }

  lastWalletChallengeCleanupAt = now
  return true
}
