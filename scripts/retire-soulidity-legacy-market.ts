import './lib/dotenv'

import { Transaction } from '@mysten/sui/transactions'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { createSuiGrpcCompatClient } from '../packages/soulidity-sdk/src/sui-grpc-compat'

import { loadKeypairFromEnv } from './lib/keypair'
import {
  assertCanonicalSigner,
  assertDeletedObject,
  assertExecutionConfirmation,
  assertLegacyAdminCap,
  assertLegacyMarketConfig,
  assertMainnetDeploymentRecord,
  assertMainnetRpc,
  assertObjectAddressOwner,
  assertObjectShared,
  assertSuccessfulEffects,
  assertUpgradeCap,
  atomicPatchMainnetDeployment,
  moveFields,
  objectAddressOwner,
  objectIdFromMoveField,
  readDeploymentSnapshot,
  requiredAddress,
  SOULIDITY_MAINNET_CONFIRM_PAUSE,
  SOULIDITY_MAINNET_CONFIRM_RETIRE,
  transactionDigest,
} from './lib/soulidity-mainnet-migration'

const DEFAULT_GAS_BUDGET = 500_000_000n

export interface RetirementArgs {
  execute: boolean
  pauseOnly: boolean
  confirm: string | null
  writeManifest: boolean
  callablePackageId: string | null
  privKeyEnv: string
  gasBudget: bigint
}

type MigrationResult = {
  digest?: string | null
  effects?: {
    transactionDigest?: string | null
    status?: { status?: string; error?: string | null } | null
  } | null
  objectChanges?: Array<{
    type?: string
    objectType?: string
    objectId?: string
  }> | null
  events?: Array<{
    type?: string
    parsedJson?: Record<string, unknown>
  }> | null
}

export interface RetirementObjectIds {
  marketConfigV2Id: string
  marketAdminCapV2Id: string
}

function valueFor(argv: string[], index: number, flag: string) {
  const argument = argv[index]
  if (argument === flag) {
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      throw new Error(`${flag} requires a value`)
    }
    return { value: next, consumed: 1 }
  }
  if (argument.startsWith(`${flag}=`)) {
    const value = argument.slice(flag.length + 1)
    if (!value) throw new Error(`${flag} requires a value`)
    return { value, consumed: 0 }
  }
  return null
}

export function parseRetirementArgs(argv: string[]): RetirementArgs {
  let dryRunRequested = false
  const parsed: RetirementArgs = {
    execute: false,
    pauseOnly: false,
    confirm: null,
    writeManifest: false,
    callablePackageId: null,
    privKeyEnv: 'MAINNET_DEPLOYER_PRIV_KEY',
    gasBudget: DEFAULT_GAS_BUDGET,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--dry-run') {
      dryRunRequested = true
      continue
    }
    if (argument === '--execute') {
      parsed.execute = true
      continue
    }
    if (argument === '--pause-only') {
      parsed.pauseOnly = true
      continue
    }
    if (argument === '--write-manifest' || argument === '--write-deployment-records') {
      parsed.writeManifest = true
      continue
    }
    const confirmation = valueFor(argv, index, '--confirm')
    if (confirmation) {
      parsed.confirm = confirmation.value
      index += confirmation.consumed
      continue
    }
    const callable = valueFor(argv, index, '--callable-package-id')
    if (callable) {
      parsed.callablePackageId = requiredAddress(
        callable.value,
        '--callable-package-id',
      )
      index += callable.consumed
      continue
    }
    const keyEnv = valueFor(argv, index, '--mainnet-priv-key-env')
    if (keyEnv) {
      parsed.privKeyEnv = keyEnv.value
      index += keyEnv.consumed
      continue
    }
    const gasBudget = valueFor(argv, index, '--gas-budget')
    if (gasBudget) {
      try {
        parsed.gasBudget = BigInt(gasBudget.value)
      } catch {
        throw new Error('--gas-budget must be an integer MIST amount')
      }
      if (parsed.gasBudget <= 0n) throw new Error('--gas-budget must be positive')
      index += gasBudget.consumed
      continue
    }
    if (argument === '--help' || argument === '-h') {
      throw new Error(
        'Usage: npm run retire:soulidity-legacy-market -- [--pause-only] [--dry-run] '
          + '[--execute --confirm=<exact phrase>] [--write-manifest] '
          + '[--callable-package-id=0x...]',
      )
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  if (parsed.writeManifest && (!parsed.execute || parsed.pauseOnly)) {
    throw new Error(
      '--write-manifest is only allowed for an executed retirement, not dry-run/pause-only',
    )
  }
  if (dryRunRequested && parsed.execute) {
    throw new Error('--dry-run and --execute are mutually exclusive')
  }
  assertExecutionConfirmation(
    parsed.execute,
    parsed.confirm,
    parsed.pauseOnly
      ? SOULIDITY_MAINNET_CONFIRM_PAUSE
      : SOULIDITY_MAINNET_CONFIRM_RETIRE,
  )
  return parsed
}

export function buildLegacyPauseTransaction(input: {
  packageId: string
  legacyConfigId: string
  legacyAdminCapId: string
  sender?: string
  gasBudget?: bigint
}): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${input.packageId}::market::update_paused`,
    arguments: [
      tx.object(input.legacyConfigId),
      tx.object(input.legacyAdminCapId),
      tx.pure.bool(true),
    ],
  })
  if (input.sender) tx.setSender(input.sender)
  if (input.gasBudget) tx.setGasBudget(input.gasBudget)
  return tx
}

export function buildLegacyRetirementTransaction(input: {
  callablePackageId: string
  legacyConfigId: string
  legacyAdminCapId: string
  sender?: string
  gasBudget?: bigint
}): Transaction {
  const tx = new Transaction()
  const config = tx.object(input.legacyConfigId)
  const adminCap = tx.object(input.legacyAdminCapId)

  // Redundant by design: the runbook requires the config to have been paused
  // before the upgrade, and this PTB reasserts that state immediately before
  // consuming the only capability that could ever unpause it.
  tx.moveCall({
    target: `${input.callablePackageId}::market::update_paused`,
    arguments: [config, adminCap, tx.pure.bool(true)],
  })
  tx.moveCall({
    target: `${input.callablePackageId}::market::retire_legacy_market`,
    arguments: [config, adminCap],
  })
  if (input.sender) tx.setSender(input.sender)
  if (input.gasBudget) tx.setGasBudget(input.gasBudget)
  return tx
}

export function extractRetirementObjectIds(
  result: MigrationResult,
  marketConfigV2PackageId: string,
): RetirementObjectIds {
  const definingPackageId = normalizeSuiAddress(marketConfigV2PackageId)
  const expectedConfigType = `${definingPackageId}::market::MarketConfigV2`
  const expectedAdminType = `${definingPackageId}::market::MarketAdminCapV2`
  const created = (result.objectChanges ?? []).filter(
    (change) => change.type === 'created',
  )
  const configChanges = created.filter(
    (change) => change.objectType === expectedConfigType,
  )
  const adminChanges = created.filter(
    (change) => change.objectType === expectedAdminType,
  )
  if (configChanges.length !== 1 || adminChanges.length !== 1) {
    throw new Error(
      'Retirement must create exactly one MarketConfigV2 and one MarketAdminCapV2; '
        + `found ${configChanges.length}/${adminChanges.length}`,
    )
  }
  return {
    marketConfigV2Id: requiredAddress(
      configChanges[0].objectId,
      'created MarketConfigV2 objectId',
    ),
    marketAdminCapV2Id: requiredAddress(
      adminChanges[0].objectId,
      'created MarketAdminCapV2 objectId',
    ),
  }
}

function assertRetirementEvent(
  result: MigrationResult,
  eventTypeOriginPackageId: string,
  legacyConfigId: string,
  ids: RetirementObjectIds,
  retiredBy: string,
) {
  const expectedEventType = `${eventTypeOriginPackageId}::market::LegacyMarketRetired`
  const matches = (result.events ?? []).filter((event) => event.type === expectedEventType)
  if (matches.length !== 1) {
    throw new Error(`Expected one ${expectedEventType} event; found ${matches.length}`)
  }
  const payload = matches[0].parsedJson ?? {}
  const checks: Array<[unknown, string, string]> = [
    [payload.legacy_config_id, legacyConfigId, 'event legacy_config_id'],
    [payload.config_v2_id, ids.marketConfigV2Id, 'event config_v2_id'],
    [payload.admin_cap_v2_id, ids.marketAdminCapV2Id, 'event admin_cap_v2_id'],
    [payload.retired_by, retiredBy, 'event retired_by'],
  ]
  for (const [actualValue, expected, label] of checks) {
    const actual = objectIdFromMoveField(actualValue, label)
    if (actual !== expected) {
      throw new Error(`${label} is ${actual}; expected ${expected}`)
    }
  }
}

async function verifyRetiredState(
  client: SuiJsonRpcClient,
  input: {
    originalPackageId: string
    marketConfigV2PackageId: string
    legacyConfigId: string
    legacyAdminCapId: string
    ids: RetirementObjectIds
    adminOwner: string
  },
) {
  const [legacyConfig, legacyAdmin, successorConfig, successorAdmin] =
    await Promise.all([
      client.getObject({
        id: input.legacyConfigId,
        options: { showContent: true, showOwner: true, showType: true },
      }),
      client.getObject({
        id: input.legacyAdminCapId,
        options: { showContent: true, showOwner: true, showType: true },
      }),
      client.getObject({
        id: input.ids.marketConfigV2Id,
        options: { showContent: true, showOwner: true, showType: true },
      }),
      client.getObject({
        id: input.ids.marketAdminCapV2Id,
        options: { showContent: true, showOwner: true, showType: true },
      }),
    ])

  const legacyState = assertLegacyMarketConfig(
    legacyConfig,
    input.originalPackageId,
  )
  if (!legacyState.paused) {
    throw new Error('P0: finalized legacy MarketConfig is not paused')
  }
  assertDeletedObject(legacyAdmin, 'legacy MarketAdminCap')

  const configType =
    `${input.marketConfigV2PackageId}::market::MarketConfigV2`
  const configFields = moveFields(successorConfig, configType, 'MarketConfigV2')
  assertObjectShared(successorConfig, 'MarketConfigV2')
  if (objectIdFromMoveField(
    configFields.legacy_config_id,
    'MarketConfigV2.legacy_config_id',
  ) !== input.legacyConfigId) {
    throw new Error('MarketConfigV2 does not point to the canonical legacy config')
  }
  if (String(configFields.version) !== '2') {
    throw new Error(`MarketConfigV2.version is ${String(configFields.version)}; expected 2`)
  }
  if (configFields.primary_enabled !== false) {
    throw new Error('Unified MarketConfigV2 primary gate must be disabled at retirement')
  }
  if (configFields.secondary_enabled !== false) {
    throw new Error('Unified MarketConfigV2 secondary gate must be disabled at retirement')
  }

  const adminType =
    `${input.marketConfigV2PackageId}::market::MarketAdminCapV2`
  const adminFields = moveFields(successorAdmin, adminType, 'MarketAdminCapV2')
  assertObjectAddressOwner(
    successorAdmin,
    input.adminOwner,
    'MarketAdminCapV2',
  )
  if (objectIdFromMoveField(
    adminFields.config_id,
    'MarketAdminCapV2.config_id',
  ) !== input.ids.marketConfigV2Id) {
    throw new Error('MarketAdminCapV2 does not control the created MarketConfigV2')
  }
}

async function main() {
  const args = parseRetirementArgs(process.argv.slice(2))
  const snapshot = readDeploymentSnapshot()
  const deployment = assertMainnetDeploymentRecord(snapshot.mainnet)
  const callablePackageId = args.callablePackageId ?? deployment.callablePackageId
  const configuredV2TypeOrigin = snapshot.mainnet.marketConfigV2PackageId?.trim()
  const marketConfigV2PackageId = configuredV2TypeOrigin
    ? requiredAddress(configuredV2TypeOrigin, 'mainnet.marketConfigV2PackageId')
    : callablePackageId === deployment.originalPackageId
      ? deployment.originalPackageId
      : callablePackageId
  if (args.callablePackageId
    && deployment.callablePackageId !== deployment.originalPackageId
    && args.callablePackageId !== deployment.callablePackageId) {
    throw new Error(
      '--callable-package-id conflicts with the non-legacy callable package in the manifest',
    )
  }

  if (args.pauseOnly && callablePackageId !== deployment.originalPackageId) {
    throw new Error(
      '--pause-only must run before the upgrade while callablePackageId equals originalPackageId',
    )
  }
  if (!args.pauseOnly && callablePackageId === deployment.originalPackageId) {
    throw new Error(
      'Retirement requires the upgraded callable package. Run/record the upgrade first or pass '
        + '--callable-package-id with the finalized upgrade package.',
    )
  }

  const client = createSuiGrpcCompatClient('mainnet')
  await assertMainnetRpc(client)
  const [upgradeCapResponse, legacyConfigResponse, legacyAdminResponse] =
    await Promise.all([
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
        options: { showContent: true, showOwner: true, showType: true },
      }),
    ])
  const capabilityOwner = objectAddressOwner(
    legacyAdminResponse,
    'legacy MarketAdminCap',
  )
  const upgradeCapOwner = objectAddressOwner(
    upgradeCapResponse,
    'Soulidity UpgradeCap',
  )
  if (upgradeCapOwner !== capabilityOwner) {
    throw new Error(
      `Soulidity capability owners differ: UpgradeCap=${upgradeCapOwner}, `
        + `MarketAdminCap=${capabilityOwner}`,
    )
  }
  assertUpgradeCap(upgradeCapResponse, callablePackageId, capabilityOwner)
  assertLegacyAdminCap(
    legacyAdminResponse,
    deployment.originalPackageId,
    capabilityOwner,
  )
  const legacyState = assertLegacyMarketConfig(
    legacyConfigResponse,
    deployment.originalPackageId,
  )

  if (args.pauseOnly && legacyState.paused) {
    console.log(JSON.stringify({
      ok: true,
      mode: 'already-paused',
      signed: false,
      legacyConfigId: deployment.legacyConfigId,
      legacyConfigPaused: true,
    }, null, 2))
    return
  }
  if (!args.pauseOnly && !legacyState.paused) {
    throw new Error(
      'P0: retirement requires the legacy config to have been paused and read back before '
        + 'the Soulidity upgrade. Refusing to use the atomic retirement PTB as the first pause.',
    )
  }

  const tx = args.pauseOnly
    ? buildLegacyPauseTransaction({
      packageId: deployment.originalPackageId,
      legacyConfigId: deployment.legacyConfigId,
      legacyAdminCapId: deployment.legacyAdminCapId,
      sender: capabilityOwner,
      gasBudget: args.gasBudget,
    })
    : buildLegacyRetirementTransaction({
      callablePackageId,
      legacyConfigId: deployment.legacyConfigId,
      legacyAdminCapId: deployment.legacyAdminCapId,
      sender: capabilityOwner,
      gasBudget: args.gasBudget,
    })

  const bytes = await tx.build({ client })
  const simulation = await client.dryRunTransactionBlock({
    transactionBlock: bytes,
  })
  assertSuccessfulEffects(
    simulation,
    args.pauseOnly ? 'legacy market pause dry-run' : 'legacy market retirement dry-run',
  )

  const simulatedIds = args.pauseOnly
    ? null
    : extractRetirementObjectIds(simulation as MigrationResult, marketConfigV2PackageId)
  if (simulatedIds) {
    assertRetirementEvent(
      simulation as MigrationResult,
      marketConfigV2PackageId,
      deployment.legacyConfigId,
      simulatedIds,
      capabilityOwner,
    )
  }

  if (!args.execute) {
    console.log(JSON.stringify({
      ok: true,
      mode: args.pauseOnly ? 'pause-dry-run' : 'retirement-dry-run',
      signerLoaded: false,
      callablePackageId,
      legacyConfigId: deployment.legacyConfigId,
      legacyConfigAlreadyPaused: legacyState.paused,
      simulated: simulatedIds,
      gasUsed: simulation.effects?.gasUsed,
      next: `Re-run with --execute --confirm=${
        args.pauseOnly
          ? SOULIDITY_MAINNET_CONFIRM_PAUSE
          : SOULIDITY_MAINNET_CONFIRM_RETIRE
      }`,
    }, null, 2))
    return
  }

  const signer = loadKeypairFromEnv(args.privKeyEnv)
  assertCanonicalSigner(signer.toSuiAddress(), capabilityOwner)
  const execution = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
  })
  assertSuccessfulEffects(
    execution,
    args.pauseOnly ? 'legacy market pause' : 'legacy market retirement',
  )
  const digest = transactionDigest(execution)
  const finalized = await client.waitForTransaction({
    digest,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
  })
  assertSuccessfulEffects(
    finalized,
    args.pauseOnly ? 'finalized legacy market pause' : 'finalized legacy market retirement',
  )

  if (args.pauseOnly) {
    const pausedConfig = await client.getObject({
      id: deployment.legacyConfigId,
      options: { showContent: true, showOwner: true, showType: true },
    })
    if (!assertLegacyMarketConfig(pausedConfig, deployment.originalPackageId).paused) {
      throw new Error('Legacy market pause transaction finalized but paused is not true')
    }
    console.log(JSON.stringify({
      ok: true,
      mode: 'pause-executed',
      digest,
      legacyConfigId: deployment.legacyConfigId,
      legacyConfigPaused: true,
    }, null, 2))
    return
  }

  const ids = extractRetirementObjectIds(
    finalized as MigrationResult,
    marketConfigV2PackageId,
  )
  assertRetirementEvent(
    finalized as MigrationResult,
    marketConfigV2PackageId,
    deployment.legacyConfigId,
    ids,
    capabilityOwner,
  )
  if (simulatedIds
    && (ids.marketConfigV2Id !== simulatedIds.marketConfigV2Id
      || ids.marketAdminCapV2Id !== simulatedIds.marketAdminCapV2Id)) {
    throw new Error('Executed retirement object IDs differ from the exact dry-run')
  }
  await verifyRetiredState(client, {
    originalPackageId: deployment.originalPackageId,
    marketConfigV2PackageId,
    legacyConfigId: deployment.legacyConfigId,
    legacyAdminCapId: deployment.legacyAdminCapId,
    ids,
    adminOwner: capabilityOwner,
  })

  let manifestWritten = false
  if (args.writeManifest) {
    const existingProvenance = snapshot.mainnet.animacraftProvenancePackageId
      ? requiredAddress(
        snapshot.mainnet.animacraftProvenancePackageId,
        'mainnet.animacraftProvenancePackageId',
      )
      : deployment.originalPackageId
    if (existingProvenance !== deployment.originalPackageId
      && existingProvenance !== callablePackageId) {
      throw new Error(
        `Existing AnimacraftProvenance TypeOrigin ${existingProvenance} conflicts with ${callablePackageId}`,
      )
    }
    atomicPatchMainnetDeployment(snapshot, {
      callablePackageId,
      animacraftProvenancePackageId: deployment.animacraftProvenancePackageId,
      marketConfigV2PackageId,
      marketConfigV2Id: ids.marketConfigV2Id,
      marketAdminCapV2Id: ids.marketAdminCapV2Id,
      legacyMarketRetirementTxDigest: digest,
    })
    manifestWritten = true
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'retirement-executed',
    digest,
    callablePackageId,
    animacraftProvenancePackageId: deployment.animacraftProvenancePackageId,
    marketConfigV2PackageId,
    legacyConfigId: deployment.legacyConfigId,
    legacyAdminCapDeleted: true,
    ...ids,
    primaryEnabled: false,
    secondaryEnabled: false,
    manifestWritten,
    manifestPath: snapshot.path,
  }, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
