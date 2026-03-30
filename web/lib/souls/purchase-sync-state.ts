import { readNormalizedSuiValue } from '@web/lib/souls/transaction-metadata'

type StoredSoulTxSync = {
  statusCode: number
  body: Record<string, unknown>
} | null

export function readRecoverableStoredPurchaseSync(storedSync: StoredSoulTxSync) {
  if (!storedSync || storedSync.statusCode !== 207) {
    return null
  }

  const body = storedSync.body
  const currentOwnerAddress = readNormalizedSuiValue(body.currentOwnerAddress)
  const currentKioskId = readNormalizedSuiValue(body.currentKioskId)
  const currentKioskCapOnChainId = readNormalizedSuiValue(body.currentKioskCapOnChainId)

  if (
    body.onChainSuccess !== true
    || body.dbSynced !== false
    || typeof body.digest !== 'string'
    || !currentOwnerAddress
    || !currentKioskId
    || !currentKioskCapOnChainId
  ) {
    return null
  }

  return {
    digest: body.digest,
    currentOwnerAddress,
    currentKioskId,
    currentKioskCapOnChainId,
    txSender: readNormalizedSuiValue(body.txSender),
  }
}

export function buildPurchaseOwnershipConflictBody(params: {
  digest: string
  soulOnChainId: string
  currentOwnerAddress: string
  currentKioskId: string
  currentKioskCapOnChainId: string
  ownerLabel: 'buyer' | 'agent'
}) {
  return {
    digest: params.digest,
    soulOnChainId: params.soulOnChainId,
    currentOwnerAddress: params.currentOwnerAddress,
    currentKioskId: params.currentKioskId,
    currentKioskCapOnChainId: params.currentKioskCapOnChainId,
    listingStatus: 'held' as const,
    onChainSuccess: true,
    dbSynced: false,
    ownershipConflict: true,
    error: `Transaction succeeded on chain, but the local Soul mirror no longer matched the expected ${params.ownerLabel} ownership. Refresh the Soul detail instead of retrying.`,
  }
}
