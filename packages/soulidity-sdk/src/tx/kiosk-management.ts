import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'

/**
 * Repoints the caller's registered personal kiosk to a freshly-created one.
 *
 * Preconditions enforced on-chain (see `market::rebind_primary_kiosk`):
 *   - The caller must already have a registered personal kiosk.
 *   - `oldKioskId` must be exactly the currently-registered kiosk.
 *   - The old kiosk must be empty (`item_count == 0`). Souls locked in a
 *     non-empty kiosk would otherwise become orphaned from list/buy paths.
 *   - `oldKioskId` and the kiosk referenced by `newKioskCapOnChainId` must
 *     be different objects.
 *
 * The caller is responsible for obtaining `newKioskCapOnChainId` — typically
 * by creating a fresh personal kiosk in a prior transaction.
 */
export function buildRebindPrimaryKioskTx(params: {
  oldKioskId: string
  newKioskCapOnChainId: string
}) {
  const oldKioskId = params.oldKioskId.trim()
  const newKioskCapOnChainId = params.newKioskCapOnChainId.trim()
  if (!oldKioskId) {
    throw new Error('oldKioskId is required')
  }
  if (!newKioskCapOnChainId) {
    throw new Error('newKioskCapOnChainId is required')
  }
  if (oldKioskId === newKioskCapOnChainId) {
    throw new Error('oldKioskId and newKioskCapOnChainId must differ')
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')

  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::rebind_primary_kiosk`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(oldKioskId),
      tx.object(newKioskCapOnChainId),
    ],
  })

  return tx
}
