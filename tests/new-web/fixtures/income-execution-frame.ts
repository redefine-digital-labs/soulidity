import { bcs } from '@mysten/sui/bcs'
import { toBase64 } from '@mysten/sui/utils'
import { expect, vi } from 'vitest'
import { makerProductIncomeWitness, makerProductIncomeInstallation } from './maker-product-income'
import { portableFixture } from './commerce-withdrawal-host'
import { ActivityFixtureEventsBcs, aid, adigest } from './activity-transaction-evidence'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { publicMutationCanonical } from '../../../web/lib/sui/public-mutation-journal'
import { readPinnedMovePackage } from '../../../web/lib/sui/pinned-move-package'
import { historicalExecutionModelDocumentHashV1, HISTORICAL_EXECUTION_MODEL_ASSUMPTIONS_V1 } from '../../../web/lib/sui/historical-execution-frame-v1'
import { createIncomeExecutionRegistryV1 } from '../../../web/lib/soulidity/commerce/income-execution-source-v1'
import { incomeSourceManifestHash } from '../../../web/lib/soulidity/commerce/income-source-qualification'
import { readMakerProductIncomeHistory } from '../../../web/lib/soulidity/commerce/maker-product-income-history'
import { readIncomeWithdrawalHistory } from '../../../web/lib/soulidity/commerce/income-withdrawal-history'

/** These explicit local trust documents are controlled fixtures. No source or
 * execution-model entry is installed in the application's compiled catalogs. */
export function modelInstallation(model: 'STORAGE_TOP_LEVEL_MOVE_CALL' | 'RUNTIME_TOP_LEVEL_MOVE_CALL' = 'STORAGE_TOP_LEVEL_MOVE_CALL') {
  const manifestText = publicMutationCanonical({ schema: 'soulidity.historical-event-execution-model.v1', genesisDigest: MAINNET_GENESIS_DIGEST,
    checkpointRange: { first: '0', last: '100000000' }, protocolVersionRange: { first: '99', last: '99' },
    model, relocateEventModule: { presence: 'EXPLICIT', value: model === 'STORAGE_TOP_LEVEL_MOVE_CALL' },
    executionSource: { revision: 'a'.repeat(40), artifacts: [{ path: 'controlled/execution.rs', sha256: 'b'.repeat(64) }] } })
  const acceptedManifestSha256 = historicalExecutionModelDocumentHashV1(manifestText)
  const auditDocumentText = publicMutationCanonical({ schema: 'soulidity.historical-event-execution-model-audit.v1', manifestSha256: acceptedManifestSha256,
    assumptions: HISTORICAL_EXECUTION_MODEL_ASSUMPTIONS_V1, evidence: Object.fromEntries(HISTORICAL_EXECUTION_MODEL_ASSUMPTIONS_V1.map(key => [key, 'c'.repeat(64)])) })
  return { manifestText, acceptedManifestSha256, auditDocumentText, acceptedAuditDocumentSha256: historicalExecutionModelDocumentHashV1(auditDocumentText) }
}
export async function fixture(domain: 'Product' | 'Foundation') {
  const x = domain === 'Product' ? await makerProductIncomeWitness() : await portableFixture()
  const params = domain === 'Product' ? x as Awaited<ReturnType<typeof makerProductIncomeWitness>> : (x as Awaited<ReturnType<typeof portableFixture>>).params
  const client = params.client, f = x.f, module = domain === 'Product' ? 'maker_catalog' : 'economics'
  const packageId = domain === 'Product' ? (params.target as any).manufacturing.callablePackageId : params.target.foundation.callablePackageId
  f.eventsData.data[0].package_id = packageId; f.eventsData.data[0].transaction_module = module; f.rehashEvents()
  client.ledgerService.getTransaction = vi.fn(async () => ({ response: { transaction: structuredClone(f.ledger) } }))
  const protocol = { epoch: BigInt(f.effectsData.V2!.executedEpoch), protocolConfig: { protocolVersion: 99n, featureFlags: { relocate_event_module: true } } }
  client.ledgerService.getEpoch = vi.fn(async function (this: unknown, request: any) {
    expect(this).toBe(client.ledgerService)
    expect(request).toEqual({ epoch: BigInt(f.effectsData.V2!.executedEpoch), readMask: { paths: ['epoch', 'protocol_config'] } })
    return { response: { epoch: structuredClone(protocol) } }
  })
  let source: any
  if (domain === 'Product') source = (await makerProductIncomeInstallation(x as any)).installation
  else {
    const pkg = await readPinnedMovePackage(client, params.target.foundation, params.signal)
    const manifestText = publicMutationCanonical({ schema: 'soulidity.foundation-income-source.v1', genesisDigest: MAINNET_GENESIS_DIGEST,
      target: params.target, configSchema: 3, configInitialSharedVersion: '1', packageVersion: String(pkg.version),
      moduleHashes: [...pkg.moduleHashes].map(([name, row]) => ({ name, sha256: row.sha256, byteLength: String(row.byteLength) })).sort((a, b) => a.name.localeCompare(b.name)),
      typeOrigins: [...pkg.origins].map(([name, packageId]) => ({ name, packageId })).sort((a, b) => a.name.localeCompare(b.name)),
      linkage: [...pkg.linkage].map(([originalPackageId, row]) => ({ originalPackageId, ...row })).sort((a, b) => a.originalPackageId.localeCompare(b.originalPackageId)),
      source: { commitSha: 'a'.repeat(40), treeSha256: 'b'.repeat(64), buildSha256: 'c'.repeat(64), dependencyLockSha256: 'd'.repeat(64), sourceAuditSha256: 'e'.repeat(64) } })
    source = { manifestText, acceptedManifestSha256: incomeSourceManifestHash(manifestText), acceptedSourceAuditSha256: 'e'.repeat(64) }
  }
  const models = [modelInstallation()]
  const registry = createIncomeExecutionRegistryV1({ models, ...(domain === 'Product' ? { makerSources: [source] } : { foundationSources: [source] }) })
  const query = (executionRegistry: typeof registry | undefined = registry) => domain === 'Product'
    ? readMakerProductIncomeHistory({ ...params, executionRegistry } as any) : readIncomeWithdrawalHistory({ ...params, executionRegistry } as any)
  const clear = () => { vi.mocked(client.ledgerService.getObject).mockClear(); vi.mocked(client.ledgerService.getEpoch).mockClear() }
  return { x, params, f, client, protocol, registry, models, source, query, clear, module, packageId }
}
