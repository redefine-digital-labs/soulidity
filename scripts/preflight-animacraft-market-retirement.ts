import {
  getJsonRpcFullnodeUrl,
  SuiJsonRpcClient,
} from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'

import {
  assertCanonicalMainnetDeployment,
  assertDeletedObject,
  assertLegacyMarketConfig,
  assertMainnetRpc,
  assertObjectAddressOwner,
  assertObjectShared,
  assertUpgradeCap,
  moveFields,
  objectIdFromMoveField,
  readDeploymentSnapshot,
  requiredAddress,
  SOULIDITY_MAINNET_ADMIN,
} from './lib/soulidity-mainnet-migration'

interface PostflightArgs {
  expectSecondaryEnabled: boolean
}

export function parsePostflightArgs(argv: string[]): PostflightArgs {
  let expectSecondaryEnabled = false
  for (const argument of argv) {
    if (argument === '--expect-secondary=disabled') {
      expectSecondaryEnabled = false
      continue
    }
    if (argument === '--expect-secondary=enabled') {
      expectSecondaryEnabled = true
      continue
    }
    if (argument === '--help' || argument === '-h') {
      throw new Error(
        'Usage: npm run postflight:animacraft-market-retirement -- '
          + '[--expect-secondary=disabled|enabled]',
      )
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return { expectSecondaryEnabled }
}

export function assertLegacyPauseAbort(result: {
  error?: string | null
  effects?: { status?: { status?: string; error?: string | null } | null } | null
}): string {
  const status = result.effects?.status
  const error = [result.error, status?.error].filter(Boolean).join(' | ')
  if (status?.status !== 'failure') {
    throw new Error(
      `Original-package runtime probe unexpectedly succeeded: ${JSON.stringify(status)}`,
    )
  }
  if (!/MoveAbort/i.test(error)
    || !/(?:abort code[:\s]+11\b|,\s*11\)|\b11\b)/i.test(error)
    || !/market/i.test(error)) {
    throw new Error(
      `Original-package runtime probe did not abort with market::EMarketPaused (11): ${error}`,
    )
  }
  return error
}

function normalizedFunctionUsesLegacyConfig(
  value: unknown,
  originalPackageId: string,
  functionName: string,
) {
  if (!value || typeof value !== 'object') {
    throw new Error(`Original ${functionName} normalized ABI is unavailable`)
  }
  const parameters = (value as { parameters?: unknown }).parameters
  const serialized = JSON.stringify(parameters)
  const normalizedAddressWithoutPrefix = originalPackageId.slice(2).replace(/^0+/, '')
  if (!serialized.includes('MarketConfig')
    || (!serialized.includes(originalPackageId)
      && !serialized.includes(normalizedAddressWithoutPrefix))) {
    throw new Error(
      `Original ${functionName} no longer exposes the canonical legacy MarketConfig parameter`,
    )
  }
}

async function main() {
  const args = parsePostflightArgs(process.argv.slice(2))
  const snapshot = readDeploymentSnapshot()
  const deployment = assertCanonicalMainnetDeployment(snapshot.mainnet)
  if (deployment.callablePackageId === deployment.originalPackageId) {
    throw new Error(
      'callablePackageId still equals originalPackageId; the guarded upgrade is not active',
    )
  }
  const animacraftProvenancePackageId = requiredAddress(
    snapshot.mainnet.animacraftProvenancePackageId,
    'mainnet.animacraftProvenancePackageId',
  )
  const marketConfigV2PackageId = requiredAddress(
    snapshot.mainnet.marketConfigV2PackageId,
    'mainnet.marketConfigV2PackageId',
  )
  const successorConfigId = requiredAddress(
    process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID
      ?? snapshot.mainnet.marketConfigV2Id,
    'mainnet.marketConfigV2Id',
  )
  const successorAdminCapId = requiredAddress(
    snapshot.mainnet.marketAdminCapV2Id,
    'mainnet.marketAdminCapV2Id',
  )
  const kioskRegistryId = requiredAddress(
    snapshot.mainnet.kioskRegistryId,
    'mainnet.kioskRegistryId',
  )

  if (animacraftProvenancePackageId === deployment.originalPackageId) {
    throw new Error(
      'AnimacraftProvenance TypeOrigin still points at the original package',
    )
  }
  if (marketConfigV2PackageId === deployment.originalPackageId) {
    throw new Error('MarketConfigV2 TypeOrigin still points at the original package')
  }

  const client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl('mainnet'),
    network: 'mainnet',
  })
  await assertMainnetRpc(client)

  const [
    upgradeCap,
    legacyConfig,
    legacyAdmin,
    successorConfig,
    successorAdmin,
    originalListAbi,
    originalBuyAbi,
    provenanceStruct,
    configV2Struct,
  ] = await Promise.all([
    client.getObject({
      id: deployment.upgradeCapId,
      options: { showContent: true, showOwner: true, showType: true },
    }),
    client.getObject({
      id: deployment.legacyConfigId,
      options: { showContent: true, showOwner: true, showType: true },
    }),
    client.getObject({
      id: deployment.legacyAdminCapId,
      options: { showOwner: true, showType: true },
    }),
    client.getObject({
      id: successorConfigId,
      options: { showContent: true, showOwner: true, showType: true },
    }),
    client.getObject({
      id: successorAdminCapId,
      options: { showContent: true, showOwner: true, showType: true },
    }),
    client.getNormalizedMoveFunction({
      package: deployment.originalPackageId,
      module: 'market',
      function: 'list_soul_fixed_price',
    }),
    client.getNormalizedMoveFunction({
      package: deployment.originalPackageId,
      module: 'market',
      function: 'buy_soul_fixed_price',
    }),
    client.getNormalizedMoveStruct({
      package: animacraftProvenancePackageId,
      module: 'animacraft_provenance',
      struct: 'AnimacraftProvenance',
    }),
    client.getNormalizedMoveStruct({
      package: marketConfigV2PackageId,
      module: 'market',
      struct: 'MarketConfigV2',
    }),
  ])

  assertUpgradeCap(upgradeCap, deployment.callablePackageId)
  const legacyFields = assertLegacyMarketConfig(
    legacyConfig,
    deployment.originalPackageId,
  )
  if (!legacyFields.paused) {
    throw new Error(
      'P0: legacy MarketConfig is not paused; old package entrypoints remain callable',
    )
  }
  assertDeletedObject(legacyAdmin, 'legacy MarketAdminCap')
  normalizedFunctionUsesLegacyConfig(
    originalListAbi,
    deployment.originalPackageId,
    'market::list_soul_fixed_price',
  )
  normalizedFunctionUsesLegacyConfig(
    originalBuyAbi,
    deployment.originalPackageId,
    'market::buy_soul_fixed_price',
  )
  if (!provenanceStruct || typeof provenanceStruct !== 'object') {
    throw new Error('AnimacraftProvenance TypeOrigin struct is unavailable')
  }
  if (!configV2Struct || typeof configV2Struct !== 'object') {
    throw new Error('MarketConfigV2 TypeOrigin struct is unavailable')
  }

  const successorType =
    `${marketConfigV2PackageId}::market::MarketConfigV2`
  const successorFields = moveFields(
    successorConfig,
    successorType,
    'MarketConfigV2',
  )
  assertObjectShared(successorConfig, 'MarketConfigV2')
  if (objectIdFromMoveField(
    successorFields.legacy_config_id,
    'MarketConfigV2.legacy_config_id',
  ) !== deployment.legacyConfigId) {
    throw new Error('Successor config is not bound to the canonical legacy MarketConfig')
  }
  if (String(successorFields.version) !== '2') {
    throw new Error(`MarketConfigV2.version is ${String(successorFields.version)}; expected 2`)
  }
  if (successorFields.primary_enabled !== true) {
    throw new Error('Unified MarketConfigV2 primary gate is not enabled')
  }
  if (successorFields.secondary_enabled !== args.expectSecondaryEnabled) {
    throw new Error(
      `Unified MarketConfigV2 secondary gate is ${String(successorFields.secondary_enabled)}; `
        + `expected ${String(args.expectSecondaryEnabled)}`,
    )
  }

  const successorAdminType =
    `${marketConfigV2PackageId}::market::MarketAdminCapV2`
  const successorAdminFields = moveFields(
    successorAdmin,
    successorAdminType,
    'MarketAdminCapV2',
  )
  assertObjectAddressOwner(
    successorAdmin,
    SOULIDITY_MAINNET_ADMIN,
    'MarketAdminCapV2',
  )
  if (objectIdFromMoveField(
    successorAdminFields.config_id,
    'MarketAdminCapV2.config_id',
  ) !== successorConfigId) {
    throw new Error('MarketAdminCapV2 does not control the canonical successor config')
  }

  // A production list/buy fixture cannot be fabricated safely by a read-only
  // script. Instead, exercise an original-package function whose first guard
  // is the same legacy MarketConfig pause invariant and which needs only the
  // canonical shared registry. This proves the immutable original bytecode
  // observes paused=true without creating or signing anything.
  const runtimeProbe = new Transaction()
  runtimeProbe.moveCall({
    target: `${deployment.originalPackageId}::market::init_personal_kiosk`,
    arguments: [
      runtimeProbe.object(deployment.legacyConfigId),
      runtimeProbe.object(kioskRegistryId),
    ],
  })
  const runtimeResult = await client.devInspectTransactionBlock({
    sender: SOULIDITY_MAINNET_ADMIN,
    transactionBlock: runtimeProbe,
  })
  const pauseAbortEvidence = assertLegacyPauseAbort(runtimeResult)

  console.log(JSON.stringify({
    ok: true,
    mode: 'read-only-postflight',
    callablePackageId: deployment.callablePackageId,
    originalPackageId: deployment.originalPackageId,
    animacraftProvenancePackageId,
    marketConfigV2PackageId,
    legacyConfigId: deployment.legacyConfigId,
    legacyConfigPaused: true,
    legacyAdminCapDeleted: true,
    successorConfigId,
    successorAdminCapId,
    primaryEnabled: true,
    secondaryEnabled: args.expectSecondaryEnabled,
    successorCrossReferencesVerified: true,
    immutableOriginalAbiVerified: [
      'market::list_soul_fixed_price(&MarketConfig, ...)',
      'market::buy_soul_fixed_price(&MarketConfig, ...)',
    ],
    originalPackageRuntimeProbe: {
      target: 'market::init_personal_kiosk',
      expectedAbort: 'market::EMarketPaused (11)',
      observed: pauseAbortEvidence,
      signed: false,
    },
    fixtureLimitation:
      'This read-only postflight has no safe live listing/buyer fixtures, so it does not '
      + 'devInspect original list/buy directly. Retain separate fixture-specific list/buy '
      + 'abort evidence before enabling production gates.',
  }, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
