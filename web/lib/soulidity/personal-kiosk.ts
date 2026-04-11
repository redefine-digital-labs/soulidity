import { ResolvePersonalKioskResult, ResolvedPersonalKiosk } from '@/lib/soulidity/types'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import {
  filterExistingPersonalKiosks,
  getRegisteredPersonalKiosk,
  listOwnedPersonalKioskCaps,
  normalizeSuiValue,
  sameSuiValue,
} from '@/lib/soulidity/queries'
import { getCachedMarketConfig } from '@/lib/soulidity/market-config-cache'

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

function normalizeObjectId(value: string) {
  const normalized = normalizeSuiValue(value)
  if (!normalized) {
    throw new Error('Invalid Sui object id')
  }
  return normalized
}

function dedupeAndSortOwnedPersonalKiosks(kiosks: ResolvedPersonalKiosk[]) {
  const seenCapIds = new Set<string>()
  const deduped = kiosks.filter((kiosk) => {
    const kioskCapId = normalizeObjectId(kiosk.currentKioskCapOnChainId)
    if (seenCapIds.has(kioskCapId)) {
      return false
    }
    seenCapIds.add(kioskCapId)
    return true
  })

  return deduped.sort((left, right) => (
    normalizeObjectId(left.currentKioskId).localeCompare(normalizeObjectId(right.currentKioskId))
  ))
}

export async function resolveOwnedPersonalKiosk(params: {
  ownerAddresses: string[]
}): Promise<ResolvePersonalKioskResult> {
  const ownerAddresses = params.ownerAddresses
    .map((ownerAddress) => normalizeOwnerAddress(ownerAddress))
  const kiosks = await Promise.all(ownerAddresses.map((ownerAddress) => listOwnedPersonalKioskCaps(ownerAddress)))
  const flattened = dedupeAndSortOwnedPersonalKiosks(await filterExistingPersonalKiosks(kiosks.flat()))

  if (flattened.length === 0) {
    return { status: 'missing' }
  }

  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const marketPackageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  await getCachedMarketConfig(marketConfigId, marketPackageId)

  for (const ownerAddress of ownerAddresses) {
    const registered = await getRegisteredPersonalKiosk({
      marketConfigId,
      marketPackageId,
      ownerAddress,
      kioskRegistryId,
    })
    if (!registered) continue

    const ownedByOwner = flattened.filter((kiosk) => sameSuiValue(kiosk.ownerAddress, ownerAddress))

    const matched = ownedByOwner.find((kiosk) => (
      sameSuiValue(kiosk.currentKioskId, registered.kioskId)
      && sameSuiValue(kiosk.currentKioskCapOnChainId, registered.kioskCapOnChainId)
    ))
    if (matched) {
      return { status: 'ready', kiosk: matched }
    }

    if (ownedByOwner.length > 0) {
      return { status: 'ready', kiosk: ownedByOwner[0]! }
    }
  }

  return { status: 'ready', kiosk: flattened[0]! }
}
