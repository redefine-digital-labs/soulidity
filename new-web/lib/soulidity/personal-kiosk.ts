import { ResolvePersonalKioskResult } from '@/lib/soulidity/types'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import {
  getMarketConfig,
  getRegisteredPersonalKiosk,
  listOwnedPersonalKioskCaps,
  normalizeSuiValue,
  sameSuiValue,
} from '@/lib/soulidity/queries'

export type SoulidityPersonalKioskInvariantKind = 'conflict' | 'service'

export class SoulidityPersonalKioskInvariantError extends Error {
  readonly kind: SoulidityPersonalKioskInvariantKind

  constructor(message: string, kind: SoulidityPersonalKioskInvariantKind = 'service') {
    super(message)
    this.name = 'SoulidityPersonalKioskInvariantError'
    this.kind = kind
  }
}

function normalizeOwnerAddress(value: string) {
  const normalized = normalizeSuiValue(value)
  if (!normalized) {
    throw new Error('Invalid Sui owner address')
  }
  return normalized
}

export async function resolveOwnedPersonalKiosk(params: {
  ownerAddresses: string[]
}): Promise<ResolvePersonalKioskResult> {
  const ownerAddresses = params.ownerAddresses
    .map((ownerAddress) => normalizeOwnerAddress(ownerAddress))
  const kiosks = await Promise.all(ownerAddresses.map((ownerAddress) => listOwnedPersonalKioskCaps(ownerAddress)))
  const flattened = kiosks.flat()

  if (flattened.length === 0) {
    return { status: 'missing' }
  }

  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const marketPackageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  await getMarketConfig(marketConfigId, marketPackageId)

  for (const ownerAddress of ownerAddresses) {
    const registered = await getRegisteredPersonalKiosk({
      marketConfigId,
      marketPackageId,
      ownerAddress,
    })
    if (!registered) continue

    const matched = flattened.find((kiosk) => (
      sameSuiValue(kiosk.ownerAddress, ownerAddress)
      && sameSuiValue(kiosk.currentKioskId, registered.kioskId)
      && sameSuiValue(kiosk.currentKioskCapOnChainId, registered.kioskCapOnChainId)
    ))
    if (matched) {
      return { status: 'ready', kiosk: matched }
    }

    throw new SoulidityPersonalKioskInvariantError(
      'Soulidity market registry points to a kiosk that is not owned by the current wallet',
      'conflict',
    )
  }

  return { status: 'ready', kiosk: flattened[0]! }
}

