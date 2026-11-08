import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { publicMutationCanonical } from '../../../web/lib/sui/public-mutation-journal'
import { readPinnedMovePackage } from '../../../web/lib/sui/pinned-move-package'
import { parseIncomeSourceManifest, incomeSourceManifestHash, type IncomeSourceManifest } from '../../../web/lib/soulidity/commerce/income-source-qualification'
import { createRootIncomeEntryController } from '../../../web/lib/soulidity/commerce/income-entry-controller'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { preflightFixture } from './commerce-withdrawal-host'

/** Controlled full-BCS source tuple. Test-only Root installation; none of this
 * synthetic source/audit/bytecode is installed by the production factory.
 */
export async function incomeEntryFixture() {
  const x = await preflightFixture(), input = x.preflightInput, client = input.client
  const pkg = await readPinnedMovePackage(client, input.target.foundation, input.signal)
  const current = x.rows.get(`${input.target.configId}:9`)!, config = bcs.Object.parse(current.bcs.value)
  const manifest: IncomeSourceManifest = { schema: 'soulidity.foundation-income-source.v1', genesisDigest: MAINNET_GENESIS_DIGEST, target: input.target, configSchema: 3,
    configInitialSharedVersion: config.owner.Shared!.initialSharedVersion, packageVersion: String(pkg.version),
    moduleHashes: [...pkg.moduleHashes].map(([name, row]) => ({ name, sha256: row.sha256, byteLength: String(row.byteLength) })).sort((a, b) => a.name < b.name ? -1 : 1),
    typeOrigins: [...pkg.origins].map(([name, packageId]) => ({ name, packageId })).sort((a, b) => a.name < b.name ? -1 : 1),
    linkage: [...pkg.linkage].map(([originalPackageId, row]) => ({ originalPackageId, upgradedId: row.upgradedId, upgradedVersion: row.upgradedVersion })).sort((a, b) => a.originalPackageId < b.originalPackageId ? -1 : 1),
    source: { commitSha: 'a'.repeat(40), treeSha256: 'b'.repeat(64), buildSha256: 'c'.repeat(64), dependencyLockSha256: 'd'.repeat(64), sourceAuditSha256: 'e'.repeat(64) } }
  const manifestText = publicMutationCanonical(manifest); parseIncomeSourceManifest(manifestText)
  const installation = { manifestText, acceptedManifestSha256: incomeSourceManifestHash(manifestText), acceptedSourceAuditSha256: manifest.source.sourceAuditSha256 }
  const gasId = input.gas.coins[0].objectId
  client.core.getChainIdentifier = vi.fn(client.core.getChainIdentifier)
  client.core.getMoveFunction = vi.fn(client.core.getMoveFunction)
  client.core.listOwnedObjects = vi.fn(async () => ({ objects: [{ objectId: gasId }], hasNextPage: false, cursor: null }))
  client.ledgerService.getTransaction = vi.fn(async () => { throw { code: 'NOT_FOUND' } })
  const selection = { target: input.target, actor: input.actor, adminId: input.adminId, installedSourceId: installation.acceptedManifestSha256 }
  const controller = createRootIncomeEntryController({ installations: [installation], executionModels:x.executionModels, client: () => client })
  const draft = { amount: input.amount, recipient: input.recipient, gasBudget: input.gas.budget, gasPrice: input.gas.price, gasCoinIds: [gasId], expirationEpoch: input.expirationEpoch, attemptHex: x.record.intent.attemptHex }
  return { ...x, client, input, manifest, manifestText, installation, selection, controller, draft, gasId }
}
