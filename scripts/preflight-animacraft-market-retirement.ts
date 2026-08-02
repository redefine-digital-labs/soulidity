import { Transaction } from '@mysten/sui/transactions'
import { createSuiGrpcCompatClient } from '../packages/soulidity-sdk/src/sui-grpc-compat'

import {
  assertDeletedObject,
  assertLegacyMarketConfig,
  assertMainnetDeploymentRecord,
  assertMainnetRpc,
  assertUpgradeCap,
  objectAddressOwner,
  readDeploymentSnapshot,
  requiredAddress,
} from './lib/soulidity-mainnet-migration'
import { verifyRetiredState } from './retire-soulidity-legacy-market'

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
      throw new Error(
        'Guarded-launch postflight requires the secondary gate to remain disabled',
      )
    }
    if (argument === '--help' || argument === '-h') {
      throw new Error(
        'Usage: npm run postflight:animacraft-market-retirement -- '
          + '[--expect-secondary=disabled]',
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
  const deployment = assertMainnetDeploymentRecord(snapshot.mainnet)
  if (deployment.callablePackageId === deployment.originalPackageId) {
    throw new Error(
      'callablePackageId still equals originalPackageId; the guarded upgrade is not active',
    )
  }
  const animacraftProvenancePackageId = deployment.animacraftProvenancePackageId
  const marketConfigV2PackageId = deployment.marketConfigV2PackageId
  const marketConfigV6PackageId = requiredAddress(
    deployment.marketConfigV6PackageId ?? snapshot.mainnet.marketConfigV6PackageId,
    'mainnet.marketConfigV6PackageId',
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
  const successorConfigV6Id = requiredAddress(
    process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID
      ?? snapshot.mainnet.marketConfigV6Id,
    'mainnet.marketConfigV6Id',
  )
  const successorAdminCapV6Id = requiredAddress(
    snapshot.mainnet.marketAdminCapV6Id,
    'mainnet.marketAdminCapV6Id',
  )
  const kioskRegistryId = requiredAddress(
    snapshot.mainnet.kioskRegistryId,
    'mainnet.kioskRegistryId',
  )

  const client = createSuiGrpcCompatClient('mainnet')
  await assertMainnetRpc(client)

  const [
    upgradeCap,
    legacyConfig,
    legacyAdmin,
    originalListAbi,
    originalBuyAbi,
    provenanceStruct,
    configV2Struct,
    configV6Struct,
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
    client.getNormalizedMoveStruct({
      package: marketConfigV6PackageId,
      module: 'market',
      struct: 'MarketConfigV6',
    }),
  ])

  const capabilityOwner = objectAddressOwner(upgradeCap, 'Soulidity UpgradeCap')
  assertUpgradeCap(upgradeCap, deployment.callablePackageId, capabilityOwner)
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
  if (!configV6Struct || typeof configV6Struct !== 'object') {
    throw new Error('MarketConfigV6 TypeOrigin struct is unavailable')
  }
  await verifyRetiredState(client, {
    originalPackageId: deployment.originalPackageId,
    marketConfigV2PackageId,
    marketConfigV6PackageId,
    legacyConfigId: deployment.legacyConfigId,
    legacyAdminCapId: deployment.legacyAdminCapId,
    ids: {
      marketConfigV2Id: successorConfigId,
      marketAdminCapV2Id: successorAdminCapId,
      marketConfigV6Id: successorConfigV6Id,
      marketAdminCapV6Id: successorAdminCapV6Id,
    },
    adminOwner: capabilityOwner,
  })

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
    sender: capabilityOwner,
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
    marketConfigV6PackageId,
    legacyConfigId: deployment.legacyConfigId,
    legacyConfigPaused: true,
    legacyAdminCapDeleted: true,
    successorConfigId,
    successorAdminCapId,
    successorConfigV6Id,
    successorAdminCapV6Id,
    primaryEnabled: false,
    v2SecondaryEnabled: false,
    v6SecondaryEnabled: args.expectSecondaryEnabled,
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
