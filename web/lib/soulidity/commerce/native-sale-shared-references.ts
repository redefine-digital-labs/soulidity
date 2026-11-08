import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { CanonicalNativeWorkbenchTarget } from '../canonical-native-workbench'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { commerceCheck, decodeCommerce, readCommerceObject, type EconomicsTarget } from './economics-read'
import type { readNativeSaleConditions } from './native-sale-conditions'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'

const CLOCK = `0x${'6'.padStart(64, '0')}`
const Clock = bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() })

/** Fresh exact types/Shared owners establish initial-shared references. Current
 * versions are observations, not invented shared-object version locks. Parent
 * still re-runs conditions and funding before wallet approval of saved bytes.
 */
export async function readNativeSaleSharedReferences(input: { client: SuiGrpcClient; target: CanonicalNativeWorkbenchTarget;
  economics: EconomicsTarget; conditions: Awaited<ReturnType<typeof readNativeSaleConditions>>; signal: AbortSignal }) {
  const { client, signal } = input, target = structuredClone(input.target), economics = structuredClone(input.economics), c = structuredClone(input.conditions)
  commerceCheck(publicMutationCanonical(c.release.native) === publicMutationCanonical(target.native)
    && c.release.configId === economics.configId && c.release.registryId === target.registryId, 'SALE_REFERENCES_RELEASE')
  const [native, standard, foundation] = await Promise.all([readPinnedMovePackage(client, target.native, signal),
    readPinnedMovePackage(client, target.standard, signal), readPinnedMovePackage(client, economics.foundation, signal)])
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'SALE_REFERENCES_ORIGIN'); return `${origin}::${module}::${name}` }
  const rows: Array<{ id: string; type: string; mutable: boolean; digest?: string }> = [
    { id: c.offerId, type: type(native.origins, 'market', 'Offer'), mutable: true, digest: c.offer.observed.digest },
    { id: target.registryId, type: type(native.origins, 'registry', 'Registry'), mutable: false },
    { id: economics.configId, type: `${type(foundation.origins, 'economics', 'Config')}<${c.release.coinType}>`, mutable: true, digest: c.source.config.digest },
    { id: c.offer.policyId, type: `0x2::transfer_policy::TransferPolicy<${type(standard.origins, 'soul', 'Soul')}>`, mutable: false },
    { id: c.offer.sellerKioskId, type: '0x2::kiosk::Kiosk', mutable: true },
    { id: c.buyerKioskId, type: '0x2::kiosk::Kiosk', mutable: true },
    { id: CLOCK, type: '0x2::clock::Clock', mutable: false },
  ]
  if (c.offer.collectionId) {
    // The collection type is an actual Native dependency, not a common origin
    // assumption. Its pin/bytes were checked by the current conditions reader.
    const link = [...native.linkage.entries()].find(([family]) => family === c.collectionRelease?.originalPackageId)
    commerceCheck(c.collectionRelease && link?.[1].upgradedId === c.collectionRelease.callablePackageId, 'SALE_REFERENCES_COLLECTION_PIN')
    const collection = await readPinnedMovePackage(client, c.collectionRelease, signal)
    commerceCheck(String(collection.version) === link[1].upgradedVersion, 'SALE_REFERENCES_COLLECTION_VERSION')
    rows.push({ id: c.offer.collectionId, type: type(collection.origins, 'collection', 'Collection'), mutable: false })
  }
  const shared: Array<{ objectId: string; initialSharedVersion: string; mutable: boolean }> = []
  let timestampMs: string | null = null
  for (const row of rows) {
    const object = await readCommerceObject(client, row.id, row.type, signal)
    commerceCheck(object.owner.Shared && (!row.digest || row.digest === object.digest), 'SALE_REFERENCES_OWNER_OR_CHANGED')
    shared.push({ objectId: row.id, initialSharedVersion: object.owner.Shared.initialSharedVersion, mutable: row.mutable })
    if (row.id === CLOCK) { const clock = decodeCommerce(Clock, object.contents); commerceCheck(clock.id === CLOCK, 'SALE_REFERENCES_CLOCK'); timestampMs = clock.timestamp_ms }
  }
  commerceCheck(timestampMs !== null, 'SALE_REFERENCES_CLOCK_REQUIRED')
  return { shared, timestampMs, notAuthorization: true as const }
}
