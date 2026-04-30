import { getConfiguredSoulidityNetwork } from '../deployment'

// Mirrors web/lib/soulidity/kiosk.ts. The desktop renderer cannot import the
// web copy directly (no path alias), so the canonical addresses are duplicated
// here. The two lists must stay in sync.
const OFFICIAL_MAINNET_KIOSK_PACKAGE_ID =
  '0xdfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3'
const OFFICIAL_TESTNET_KIOSK_PACKAGE_ID =
  '0xc9f6a531d5f4e11ef38dd782c9ab5403fb3c011595384c429285952ff6b31839'

export function resolveKioskPackageId(): string {
  const configured = process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID?.trim()
  if (configured) return configured

  const network = getConfiguredSoulidityNetwork()
  if (network === 'mainnet') return OFFICIAL_MAINNET_KIOSK_PACKAGE_ID
  if (network === 'testnet') return OFFICIAL_TESTNET_KIOSK_PACKAGE_ID

  throw new Error(
    `NEXT_PUBLIC_KIOSK_PACKAGE_ID must be set (no fallback for network=${network})`,
  )
}
