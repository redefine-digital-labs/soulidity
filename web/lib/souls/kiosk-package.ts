import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

const KIOSK_PACKAGE_ENV_KEY = 'NEXT_PUBLIC_KIOSK_PACKAGE_ID'

let cachedVendoredKioskPackageAddress: string | null = null
let cachedVendoredKioskPackageSourceKey: string | null = null

function normalizeKioskPackageAddress(value: string, sourceLabel: string) {
  const normalizedAddress = normalizeSuiAddress(value.trim())
  if (!isValidSuiAddress(normalizedAddress)) {
    throw new Error(`${sourceLabel} contains an invalid kiosk package address`)
  }
  return normalizedAddress
}

export function getVendoredKioskPackageAddress() {
  const configuredPackageAddress = process.env[KIOSK_PACKAGE_ENV_KEY]?.trim()
  if (!configuredPackageAddress) {
    throw new Error(`${KIOSK_PACKAGE_ENV_KEY} must be set`)
  }

  const sourceKey = `env:${configuredPackageAddress}`

  if (cachedVendoredKioskPackageAddress && cachedVendoredKioskPackageSourceKey === sourceKey) {
    return cachedVendoredKioskPackageAddress
  }

  cachedVendoredKioskPackageAddress = normalizeKioskPackageAddress(configuredPackageAddress, KIOSK_PACKAGE_ENV_KEY)
  cachedVendoredKioskPackageSourceKey = sourceKey
  return cachedVendoredKioskPackageAddress
}
