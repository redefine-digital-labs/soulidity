import { normalizeSuiWalletAddress } from '@/lib/auth/challenge'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)

const ADMIN_WALLET_ADDRESSES = (process.env.ADMIN_WALLET_ADDRESSES ?? '')
  .split(',')
  .map((value) => normalizeSuiWalletAddress(value))
  .filter((value): value is string => !!value)

export function adminAllowlistConfigured(): boolean {
  return ADMIN_EMAILS.length > 0 || ADMIN_WALLET_ADDRESSES.length > 0
}

export function isAdminIdentity(input: {
  email?: string | null
  walletAddress?: string | null
}): boolean {
  if (input.email && ADMIN_EMAILS.includes(input.email.toLowerCase())) {
    return true
  }
  if (input.walletAddress) {
    const normalized = normalizeSuiWalletAddress(input.walletAddress)
    if (normalized && ADMIN_WALLET_ADDRESSES.includes(normalized)) return true
  }
  return false
}
