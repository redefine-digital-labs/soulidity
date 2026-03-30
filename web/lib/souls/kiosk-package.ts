import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

const KIOSK_PACKAGE_ENV_KEY = 'NEXT_PUBLIC_KIOSK_PACKAGE_ID'
const VENDORED_KIOSK_MOVE_TOML_RELATIVE_PATH = path.join('move', 'vendor', 'kiosk', 'Move.toml')
const VENDORED_KIOSK_MOVE_TOML_CANDIDATES = [
  path.resolve(process.cwd(), VENDORED_KIOSK_MOVE_TOML_RELATIVE_PATH),
  path.resolve(process.cwd(), '..', VENDORED_KIOSK_MOVE_TOML_RELATIVE_PATH),
]

let cachedVendoredKioskPackageAddress: string | null = null
let cachedVendoredKioskPackageSourceKey: string | null = null

function resolveVendoredKioskMoveTomlPath() {
  for (const candidate of VENDORED_KIOSK_MOVE_TOML_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(`${KIOSK_PACKAGE_ENV_KEY} must be set when vendored Kiosk Move.toml is unavailable`)
}

function readAddressesSection(source: string) {
  const marker = source.match(/^\[addresses\]\s*$/m)
  if (!marker || marker.index == null) {
    throw new Error('Vendored Kiosk Move.toml is missing an [addresses] section')
  }

  const start = marker.index + marker[0].length
  const remainder = source.slice(start)
  const nextSectionStart = remainder.search(/^\[[^\]]+\]\s*$/m)
  return nextSectionStart === -1 ? remainder : remainder.slice(0, nextSectionStart)
}

function normalizeKioskPackageAddress(value: string, sourceLabel: string) {
  const normalizedAddress = normalizeSuiAddress(value.trim())
  if (!isValidSuiAddress(normalizedAddress)) {
    throw new Error(`${sourceLabel} contains an invalid kiosk package address`)
  }
  return normalizedAddress
}

export function getVendoredKioskPackageAddress() {
  const configuredPackageAddress = process.env[KIOSK_PACKAGE_ENV_KEY]?.trim()
  const sourceKey = configuredPackageAddress
    ? `env:${configuredPackageAddress}`
    : `vendored:${process.cwd()}`

  if (cachedVendoredKioskPackageAddress && cachedVendoredKioskPackageSourceKey === sourceKey) {
    return cachedVendoredKioskPackageAddress
  }

  if (configuredPackageAddress) {
    cachedVendoredKioskPackageAddress = normalizeKioskPackageAddress(configuredPackageAddress, KIOSK_PACKAGE_ENV_KEY)
    cachedVendoredKioskPackageSourceKey = sourceKey
    return cachedVendoredKioskPackageAddress
  }

  const source = readFileSync(resolveVendoredKioskMoveTomlPath(), 'utf8')
  const addressesSection = readAddressesSection(source)
  const kioskAddressMatch = addressesSection.match(/^\s*kiosk\s*=\s*"([^"]+)"\s*$/m)
  if (!kioskAddressMatch) {
    throw new Error('Vendored Kiosk Move.toml is missing addresses.kiosk')
  }

  cachedVendoredKioskPackageAddress = normalizeKioskPackageAddress(
    kioskAddressMatch[1],
    'Vendored Kiosk Move.toml',
  )
  cachedVendoredKioskPackageSourceKey = sourceKey
  return cachedVendoredKioskPackageAddress
}
