import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

export const KIOSK_PACKAGE_ENV_KEY = 'NEXT_PUBLIC_KIOSK_PACKAGE_ID'

export const OFFICIAL_MAINNET_KIOSK_PACKAGE_ID =
  '0xdfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3'
export const OFFICIAL_MAINNET_KIOSK_TYPE_PACKAGE_ID =
  '0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879'

// Vendored kiosk package linked into the testnet Soulidity deployment
// (see move/vendor/kiosk/Move.toml). The personal_kiosk cap struct lives in
// the same package, so no separate type-package override is needed for testnet.
export const OFFICIAL_TESTNET_KIOSK_PACKAGE_ID =
  '0xc9f6a531d5f4e11ef38dd782c9ab5403fb3c011595384c429285952ff6b31839'

const KIOSK_TYPE_PACKAGE_OVERRIDES = new Map<string, string>([
  [OFFICIAL_MAINNET_KIOSK_PACKAGE_ID, OFFICIAL_MAINNET_KIOSK_TYPE_PACKAGE_ID],
])

function normalizePackageAddress(value: string, label: string) {
  try {
    const normalized = normalizeSuiAddress(value.trim()).toLowerCase()
    if (isValidSuiAddress(normalized)) {
      return normalized
    }
  } catch {
    // Fall through to the consistent error below.
  }

  throw new Error(`${label} contains an invalid kiosk package address`)
}

export function getKioskPackageAddress() {
  const configuredPackageAddress = process.env[KIOSK_PACKAGE_ENV_KEY]?.trim()
  if (configuredPackageAddress) {
    return normalizePackageAddress(configuredPackageAddress, KIOSK_PACKAGE_ENV_KEY)
  }

  const network = process.env.NEXT_PUBLIC_SUI_NETWORK?.trim().toLowerCase()
  if (network === 'mainnet') return OFFICIAL_MAINNET_KIOSK_PACKAGE_ID
  if (network === 'testnet') return OFFICIAL_TESTNET_KIOSK_PACKAGE_ID

  throw new Error(
    `${KIOSK_PACKAGE_ENV_KEY} must be set (no fallback for network=${network ?? 'unset'})`,
  )
}

export function getPersonalKioskCapTypePackageAddress() {
  const packageId = getKioskPackageAddress()
  return KIOSK_TYPE_PACKAGE_OVERRIDES.get(packageId) ?? packageId
}

export function getPersonalKioskCapStructType() {
  return `${getPersonalKioskCapTypePackageAddress()}::personal_kiosk::PersonalKioskCap`
}
