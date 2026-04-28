import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

export const KIOSK_PACKAGE_ENV_KEY = 'NEXT_PUBLIC_KIOSK_PACKAGE_ID'

export const OFFICIAL_MAINNET_KIOSK_PACKAGE_ID =
  '0xdfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3'
export const OFFICIAL_MAINNET_KIOSK_TYPE_PACKAGE_ID =
  '0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879'

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
  if (!configuredPackageAddress) {
    throw new Error(`${KIOSK_PACKAGE_ENV_KEY} must be set`)
  }

  return normalizePackageAddress(configuredPackageAddress, KIOSK_PACKAGE_ENV_KEY)
}

export function getPersonalKioskCapTypePackageAddress() {
  const packageId = getKioskPackageAddress()
  return KIOSK_TYPE_PACKAGE_OVERRIDES.get(packageId) ?? packageId
}

export function getPersonalKioskCapStructType() {
  return `${getPersonalKioskCapTypePackageAddress()}::personal_kiosk::PersonalKioskCap`
}
