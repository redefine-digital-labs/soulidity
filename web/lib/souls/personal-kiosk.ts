import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
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

export type SoulPersonalKioskInvariantKind = 'conflict' | 'service'

export class SoulPersonalKioskInvariantError extends Error {
  readonly kind: SoulPersonalKioskInvariantKind

  constructor(message: string, kind: SoulPersonalKioskInvariantKind = 'service') {
    super(message)
    this.name = 'SoulPersonalKioskInvariantError'
    this.kind = kind
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
let cachedMarketConfigId: string | null = null
let cachedMarketPackageId: string | null = null

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function normalizeObjectId(value: string) {
  return normalizeSuiAddress(value).toLowerCase()
}

async function getMarketConfigPackageId() {
  const marketConfigId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID')
  if (cachedMarketConfigId === marketConfigId && cachedMarketPackageId) {
    return cachedMarketPackageId
  }

  const response = await suiClient.getObject({
    id: marketConfigId,
    options: { showType: true },
  })
  const objectType = typeof response.data?.type === 'string' ? response.data.type : null
  if (!objectType || !objectType.includes('::market::MarketConfig')) {
    throw new SoulPersonalKioskInvariantError('Soul market config type is unavailable on chain', 'service')
  }

  const packageId = objectType.split('::', 1)[0]
  if (!packageId) {
    throw new SoulPersonalKioskInvariantError('Soul market config type is malformed on chain', 'service')
  }

  cachedMarketConfigId = marketConfigId
  cachedMarketPackageId = normalizeSuiAddress(packageId).toLowerCase()
  return cachedMarketPackageId
}

function isDynamicFieldNotFound(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return (message.includes('dynamic field') && message.includes('not found'))
    || message.includes('no dynamic field found')
}

function readRegisteredPersonalKiosk(value: unknown): { kioskId: string; kioskCapOnChainId: string } | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const kioskId = typeof record.kiosk_id === 'string'
    ? record.kiosk_id
    : typeof record.kioskId === 'string'
      ? record.kioskId
      : null
  const kioskCapId = typeof record.kiosk_cap_id === 'string'
    ? record.kiosk_cap_id
    : typeof record.kioskCapOnChainId === 'string'
      ? record.kioskCapOnChainId
      : typeof record.kiosk_cap_on_chain_id === 'string'
        ? record.kiosk_cap_on_chain_id
        : null

  if (kioskId && kioskCapId) {
    return {
      kioskId: normalizeObjectId(kioskId),
      kioskCapOnChainId: normalizeObjectId(kioskCapId),
    }
  }

  return readRegisteredPersonalKiosk(record.fields)
    ?? readRegisteredPersonalKiosk(record.value)
}

async function getRegisteredPersonalKiosk(ownerAddress: string) {
  const marketConfigId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID')
  const marketPackageId = await getMarketConfigPackageId()

  try {
    const response = await suiClient.getDynamicFieldObject({
      parentId: marketConfigId,
      name: {
        type: `${marketPackageId}::market::PersonalKioskOwnerKey`,
        value: { owner: ownerAddress },
      },
    })
    const content = response.data?.content
    return readRegisteredPersonalKiosk(content && 'fields' in content ? content.fields : null)
  } catch (error) {
    if (isDynamicFieldNotFound(error)) {
      return null
    }
    throw error
  }
}

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

  return kiosks.sort((left, right) => (
    normalizeObjectId(left.currentKioskId).localeCompare(normalizeObjectId(right.currentKioskId))
  ))
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

  for (const ownerAddress of params.ownerAddresses) {
    const normalizedOwnerAddress = normalizeOwnerAddress(ownerAddress)
    const registeredKiosk = await getRegisteredPersonalKiosk(normalizedOwnerAddress)
    if (!registeredKiosk) {
      continue
    }

    const matched = kiosks.find((kiosk) => (
      sameSuiValue(kiosk.ownerAddress, normalizedOwnerAddress)
      && sameSuiValue(kiosk.currentKioskId, registeredKiosk.kioskId)
      && sameSuiValue(kiosk.currentKioskCapOnChainId, registeredKiosk.kioskCapOnChainId)
    ))
    if (matched) {
      return { status: 'ready', kiosk: matched }
    }

    throw new SoulPersonalKioskInvariantError(
      'Soul market registry points to a kiosk that is not owned by the current wallet',
      'conflict',
    )
  }

  return { status: 'ready', kiosk: kiosks[0]! }
}
