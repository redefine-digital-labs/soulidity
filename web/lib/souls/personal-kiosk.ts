import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { getVerifiedPersonalKioskCapStates, sameSuiValue } from '@web/lib/souls/on-chain-verification'
import { getVendoredKioskPackageAddress } from '@web/lib/souls/kiosk-package'
import { suiClient } from '@web/lib/sui'

export type ResolvedPersonalKiosk = {
  ownerAddress: string
  currentKioskId: string
  currentKioskCapOnChainId: string
}

export type ResolvePersonalKioskResult =
  | { status: 'ready'; kiosk: ResolvedPersonalKiosk }
  | { status: 'missing' }

export class SoulPersonalKioskInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SoulPersonalKioskInvariantError'
  }
}

function normalizeOwnerAddress(value: string) {
  const normalized = normalizeSuiAddress(value)
  if (!isValidSuiAddress(normalized)) {
    throw new Error('Invalid Sui owner address')
  }
  return normalized
}

function getPersonalKioskCapType() {
  return `${getVendoredKioskPackageAddress()}::personal_kiosk::PersonalKioskCap`
}

const MAX_KIOSK_CAP_PAGES = 5

async function listPersonalKioskCapObjectIds(ownerAddress: string) {
  const capObjectIds: string[] = []
  let cursor: string | null | undefined = undefined
  let pagesRead = 0

  do {
    const page = await suiClient.getOwnedObjects({
      owner: ownerAddress,
      ...(cursor ? { cursor } : {}),
      filter: { StructType: getPersonalKioskCapType() },
      options: { showType: true },
    })

    for (const entry of page.data) {
      const objectId = entry.data?.objectId
      if (typeof objectId === 'string' && objectId.trim().length > 0) {
        capObjectIds.push(objectId)
      }
    }

    pagesRead++
    if (pagesRead >= MAX_KIOSK_CAP_PAGES) break
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)

  return capObjectIds
}

async function listPersonalKiosksForOwner(ownerAddress: string): Promise<ResolvedPersonalKiosk[]> {
  const normalizedOwnerAddress = normalizeOwnerAddress(ownerAddress)
  const capObjectIds = await listPersonalKioskCapObjectIds(normalizedOwnerAddress)
  const kioskCapStates = await getVerifiedPersonalKioskCapStates(capObjectIds)

  return kioskCapStates.flatMap((kioskCapState) => (
    sameSuiValue(kioskCapState.ownerAddress, normalizedOwnerAddress)
      ? [{
          ownerAddress: kioskCapState.ownerAddress,
          currentKioskId: kioskCapState.kioskId,
          currentKioskCapOnChainId: kioskCapState.objectId,
        }]
      : []
  ))
}

async function resolveOwnedPersonalKiosks(ownerAddresses: string[]): Promise<ResolvedPersonalKiosk[]> {
  const seenCapIds = new Set<string>()
  const kiosks: ResolvedPersonalKiosk[] = []

  const ownerKioskLists = await Promise.all(ownerAddresses.map((ownerAddress) => (
    listPersonalKiosksForOwner(ownerAddress)
  )))

  for (const ownerKiosks of ownerKioskLists) {
    for (const kiosk of ownerKiosks) {
      if (seenCapIds.has(kiosk.currentKioskCapOnChainId)) {
        continue
      }
      seenCapIds.add(kiosk.currentKioskCapOnChainId)
      kiosks.push(kiosk)
    }
  }

  return kiosks
}

/**
 * Find a viewer's personal kiosk that matches the on-chain Soul owner kiosk.
 * Used as a fallback when the DB mirror is stale (e.g. purchase-sync recovery window).
 */
export async function findViewerKioskMatchingOnChain(
  onChainOwnerKioskId: string,
  viewerAddresses: string[],
): Promise<ResolvedPersonalKiosk | null> {
  const kiosks = await resolveOwnedPersonalKiosks(viewerAddresses)
  return kiosks.find((kiosk) => sameSuiValue(kiosk.currentKioskId, onChainOwnerKioskId)) ?? null
}

export async function resolveOwnedPersonalKiosk(params: {
  ownerAddresses: string[]
}): Promise<ResolvePersonalKioskResult> {
  const kiosks = await resolveOwnedPersonalKiosks(params.ownerAddresses)
  if (kiosks.length === 0) {
    return { status: 'missing' }
  }
  if (kiosks.length > 1) {
    throw new SoulPersonalKioskInvariantError(
      'Multiple Soul personal kiosks detected for this wallet set',
    )
  }

  return { status: 'ready', kiosk: kiosks[0]! }
}
