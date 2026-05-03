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
  const kiosks = await Promise.all(
    ownerAddresses.map((ownerAddress) => listOwnedPersonalKioskCaps(ownerAddress)),
  )
  const flattened = dedupeAndSortOwnedPersonalKiosks(
    await filterExistingPersonalKiosks(kiosks.flat()),
  )

  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const marketPackageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  await getCachedMarketConfig(marketConfigId, marketPackageId)

  // Registry lookup runs before the missing-flattened check: a stale entry from a
  // previously-lost cap will block any future TX that tries to register a new kiosk
  // for this owner (market::insert_or_assert_personal_kiosk_registration aborts with
  // EPersonalKioskMismatch when kiosk_id differs, or EPersonalKioskCapMismatch when
  // only cap_id differs). Surface that as a conflict instead of letting it abort
  // on-chain.
  for (const ownerAddress of ownerAddresses) {
    const registered = await getRegisteredPersonalKiosk({
      marketConfigId,
      marketPackageId,
      ownerAddress,
      kioskRegistryId,
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

    // Distinguish two failure modes so the user sees the right recovery path:
    //   - same kiosk_id, different cap_id  → user rebuilt their PersonalKioskCap
    //     (rare; happens if the user manually unwrapped + re-wrapped the cap).
    //   - different kiosk_id               → user owns caps for a different kiosk
    //     than the one in the registry (lost original cap, or wrong wallet).
    const sameKioskDifferentCap = flattened.some((kiosk) => (
      sameSuiValue(kiosk.ownerAddress, ownerAddress)
      && sameSuiValue(kiosk.currentKioskId, registered.kioskId)
      && !sameSuiValue(kiosk.currentKioskCapOnChainId, registered.kioskCapOnChainId)
    ))
    const recoveryHint = sameKioskDifferentCap
      ? 'Use the original PersonalKioskCap you registered with. Contact support with this wallet address if you cannot recover it.'
      : 'Locate the original cap (search both IDs on Sui Explorer) or use a different wallet. Contact support if you cannot recover it.'

    throw new SoulidityPersonalKioskInvariantError(
      `Wallet ${ownerAddress} has a Soulidity kiosk registration `
      + `(kiosk ${registered.kioskId}, cap ${registered.kioskCapOnChainId}) `
      + `but does not own the matching PersonalKioskCap. `
      + recoveryHint,
      'conflict',
    )
  }

  if (flattened.length === 0) {
    return { status: 'missing' }
  }
  return { status: 'ready', kiosk: flattened[0]! }
}
