import './lib/dotenv'

import { createHash } from 'node:crypto'

import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
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
  assertNoPendingMainnetMutationAttempt,
  assertObjectAddressOwner,
  assertObjectShared,
  assertSuccessfulEffects,
  assertUpgradeCap,
  ambiguousMainnetMutationError,
  atomicPatchMainnetDeployment,
  beginMainnetMutationAttempt,
  clearMainnetMutationAttempt,
  initializeMainnetMutationJournal,
  type MainnetMutationAttempt,
  moveFields,
  objectAddressOwner,
  objectIdFromMoveField,
  readMainnetMutationAttempt,
  readDeploymentSnapshot,
  requiredAddress,
  SOULIDITY_MAINNET_CONFIRM_PAUSE,
  SOULIDITY_MAINNET_CONFIRM_RETIRE,
  SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL,
  submittedMainnetMutationError,
  transactionDigest,
  updateMainnetMutationAttempt,
} from './lib/soulidity-mainnet-migration'

const DEFAULT_GAS_BUDGET = 500_000_000n

export interface RetirementArgs {
  execute: boolean
  reconcileFromJournal: boolean
  initializeMutationJournal: boolean
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
  marketConfigV6Id: string
  marketAdminCapV6Id: string
}

type MainnetClient = ReturnType<typeof createSuiGrpcCompatClient>

interface RetirementAttemptContext {
  originalPackageId: string
  callablePackageId: string
  upgradeCapId: string
  legacyConfigId: string
  legacyAdminCapId: string
  marketConfigV2PackageId: string
  marketConfigV6PackageId: string
  animacraftProvenancePackageId: string
  simulatedMarketConfigV2Id: string | null
  simulatedMarketAdminCapV2Id: string | null
  simulatedMarketConfigV6Id: string | null
  simulatedMarketAdminCapV6Id: string | null
  writeManifest: boolean
  priorManifestSha256: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function contextString(
  context: MainnetMutationAttempt['context'],
  key: string,
): string {
  const value = context[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Retirement journal context.${key} is missing`)
  }
  return value.trim()
}

function contextNullableAddress(
  context: MainnetMutationAttempt['context'],
  key: string,
): string | null {
  const value = context[key]
  if (value === null) return null
  return requiredAddress(value, `retirement journal context.${key}`)
}

function retirementAttemptContext(
  attempt: MainnetMutationAttempt,
): RetirementAttemptContext {
  if (
    attempt.operation !== 'pause-legacy-market'
    && attempt.operation !== 'retire-legacy-market'
  ) {
    throw new Error(`Expected a market migration journal; found ${attempt.operation}`)
  }
  return {
    originalPackageId: requiredAddress(
      contextString(attempt.context, 'originalPackageId'),
      'retirement journal originalPackageId',
    ),
    callablePackageId: requiredAddress(
      contextString(attempt.context, 'callablePackageId'),
      'retirement journal callablePackageId',
    ),
    upgradeCapId: requiredAddress(
      contextString(attempt.context, 'upgradeCapId'),
      'retirement journal upgradeCapId',
    ),
    legacyConfigId: requiredAddress(
      contextString(attempt.context, 'legacyConfigId'),
      'retirement journal legacyConfigId',
    ),
    legacyAdminCapId: requiredAddress(
      contextString(attempt.context, 'legacyAdminCapId'),
      'retirement journal legacyAdminCapId',
    ),
    marketConfigV2PackageId: requiredAddress(
      contextString(attempt.context, 'marketConfigV2PackageId'),
      'retirement journal marketConfigV2PackageId',
    ),
    marketConfigV6PackageId: requiredAddress(
      contextString(attempt.context, 'marketConfigV6PackageId'),
      'retirement journal marketConfigV6PackageId',
    ),
    animacraftProvenancePackageId: requiredAddress(
      contextString(attempt.context, 'animacraftProvenancePackageId'),
      'retirement journal animacraftProvenancePackageId',
    ),
    simulatedMarketConfigV2Id: contextNullableAddress(
      attempt.context,
      'simulatedMarketConfigV2Id',
    ),
    simulatedMarketAdminCapV2Id: contextNullableAddress(
      attempt.context,
      'simulatedMarketAdminCapV2Id',
    ),
    simulatedMarketConfigV6Id: contextNullableAddress(
      attempt.context,
      'simulatedMarketConfigV6Id',
    ),
    simulatedMarketAdminCapV6Id: contextNullableAddress(
      attempt.context,
      'simulatedMarketAdminCapV6Id',
    ),
    writeManifest: attempt.context.writeManifest === true,
    priorManifestSha256: contextString(attempt.context, 'priorManifestSha256'),
  }
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
    reconcileFromJournal: false,
    initializeMutationJournal: false,
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
    if (argument === '--reconcile-from-journal') {
      parsed.reconcileFromJournal = true
      continue
    }
    if (argument === '--initialize-mutation-journal') {
      parsed.initializeMutationJournal = true
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
          + '[--callable-package-id=0x...] | [--reconcile-from-journal] | '
          + '[--initialize-mutation-journal '
          + '--confirm=INITIALIZE_SOULIDITY_MAINNET_MUTATION_JOURNAL]',
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
  if (parsed.reconcileFromJournal && (
    parsed.execute
    || parsed.pauseOnly
    || dryRunRequested
    || parsed.confirm !== null
    || parsed.writeManifest
    || parsed.callablePackageId !== null
    || parsed.privKeyEnv !== 'MAINNET_DEPLOYER_PRIV_KEY'
    || parsed.gasBudget !== DEFAULT_GAS_BUDGET
  )) {
    throw new Error(
      '--reconcile-from-journal is an isolated read-only-chain mode; remove all signing, '
        + 'pause, dry-run, package, key, gas, confirmation and manifest flags',
    )
  }
  if (parsed.initializeMutationJournal && (
    parsed.execute
    || parsed.reconcileFromJournal
    || parsed.pauseOnly
    || dryRunRequested
    || parsed.writeManifest
    || parsed.callablePackageId !== null
    || parsed.privKeyEnv !== 'MAINNET_DEPLOYER_PRIV_KEY'
    || parsed.gasBudget !== DEFAULT_GAS_BUDGET
  )) {
    throw new Error(
      '--initialize-mutation-journal is an isolated local-state operation; remove all '
        + 'execute, reconcile, pause, dry-run, package, key, gas and manifest flags',
    )
  }
  if (
    parsed.initializeMutationJournal
    && parsed.confirm !== SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL
  ) {
    throw new Error(
      `Journal initialization requires --confirm=${SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL}`,
    )
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
  marketConfigV6PackageId: string,
): RetirementObjectIds {
  const v2PackageId = normalizeSuiAddress(marketConfigV2PackageId)
  const v6PackageId = normalizeSuiAddress(marketConfigV6PackageId)
  const legacyEvents = (result.events ?? []).filter(
    (event) => event.type === `${v2PackageId}::market::LegacyMarketRetired`,
  )
  const v6Events = (result.events ?? []).filter(
    (event) => event.type === `${v6PackageId}::market::MarketV6Initialized`,
  )
  if (legacyEvents.length !== 1 || v6Events.length !== 1) {
    throw new Error(
      `Retirement must emit exactly one LegacyMarketRetired and MarketV6Initialized event; `
        + `found legacy=${legacyEvents.length}, v6=${v6Events.length}`,
    )
  }
  const legacy = legacyEvents[0].parsedJson ?? {}
  const v6 = v6Events[0].parsedJson ?? {}
  const ids: RetirementObjectIds = {
    marketConfigV2Id: objectIdFromMoveField(legacy.config_v2_id, 'event config_v2_id'),
    marketAdminCapV2Id: objectIdFromMoveField(legacy.admin_cap_v2_id, 'event admin_cap_v2_id'),
    marketConfigV6Id: objectIdFromMoveField(v6.config_v6_id, 'event config_v6_id'),
    marketAdminCapV6Id: objectIdFromMoveField(v6.admin_cap_v6_id, 'event admin_cap_v6_id'),
  }
  if (
    objectIdFromMoveField(v6.config_v2_id, 'v6 event config_v2_id') !== ids.marketConfigV2Id
    || objectIdFromMoveField(v6.admin_cap_v2_id, 'v6 event admin_cap_v2_id')
      !== ids.marketAdminCapV2Id
  ) {
    throw new Error('MarketV6Initialized does not reference the V2 objects created by retirement')
  }

  const topLevelTypes = new Map([
    [`${v2PackageId}::market::MarketConfigV2`, ids.marketConfigV2Id],
    [`${v6PackageId}::market::MarketConfigV6`, ids.marketConfigV6Id],
    [`${v6PackageId}::market::MarketAdminCapV6`, ids.marketAdminCapV6Id],
  ])
  for (const [expectedType, expectedId] of topLevelTypes) {
    const matching = (result.objectChanges ?? []).filter(
      (change) => change.objectType === expectedType && change.type === 'created',
    )
    if (
      matching.length !== 1
      || requiredAddress(matching[0].objectId, `${expectedType} objectId`) !== expectedId
    ) {
      throw new Error(`Retirement did not create the expected ${expectedType} object`)
    }
  }
  return ids
}

function assertRetirementEvent(
  result: MigrationResult,
  eventTypeOriginPackageId: string,
  marketConfigV6PackageId: string,
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

  const v6EventType = `${normalizeSuiAddress(
    marketConfigV6PackageId,
  )}::market::MarketV6Initialized`
  const v6Matches = (result.events ?? []).filter((event) => event.type === v6EventType)
  if (v6Matches.length !== 1) {
    throw new Error(`Expected one MarketV6Initialized event; found ${v6Matches.length}`)
  }
  const v6Payload = v6Matches[0].parsedJson ?? {}
  const v6Checks: Array<[unknown, string, string]> = [
    [v6Payload.config_v2_id, ids.marketConfigV2Id, 'v6 event config_v2_id'],
    [v6Payload.admin_cap_v2_id, ids.marketAdminCapV2Id, 'v6 event admin_cap_v2_id'],
    [v6Payload.config_v6_id, ids.marketConfigV6Id, 'v6 event config_v6_id'],
    [v6Payload.admin_cap_v6_id, ids.marketAdminCapV6Id, 'v6 event admin_cap_v6_id'],
    [v6Payload.initialized_by, retiredBy, 'v6 event initialized_by'],
  ]
  for (const [actualValue, expected, label] of v6Checks) {
    const actual = objectIdFromMoveField(actualValue, label)
    if (actual !== expected) throw new Error(`${label} is ${actual}; expected ${expected}`)
  }
}

export async function verifyRetiredState(
  client: SuiJsonRpcClient,
  input: {
    originalPackageId: string
    marketConfigV2PackageId: string
    marketConfigV6PackageId: string
    legacyConfigId: string
    legacyAdminCapId: string
    ids: RetirementObjectIds
    adminOwner: string
  },
) {
  const [
    legacyConfig,
    legacyAdmin,
    successorConfigV2,
    successorConfigV6,
    successorAdminV6,
  ] =
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
        id: input.ids.marketConfigV6Id,
        options: { showContent: true, showOwner: true, showType: true },
      }),
      client.getObject({
        id: input.ids.marketAdminCapV6Id,
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
  const configFields = moveFields(successorConfigV2, configType, 'MarketConfigV2')
  assertObjectShared(successorConfigV2, 'MarketConfigV2')
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

  const configV6Type =
    `${input.marketConfigV6PackageId}::market::MarketConfigV6`
  const configV6Fields = moveFields(
    successorConfigV6,
    configV6Type,
    'MarketConfigV6',
  )
  assertObjectShared(successorConfigV6, 'MarketConfigV6')
  if (String(configV6Fields.version) !== '6') {
    throw new Error(`MarketConfigV6.version is ${String(configV6Fields.version)}; expected 6`)
  }
  if (objectIdFromMoveField(
    configV6Fields.config_v2_id,
    'MarketConfigV6.config_v2_id',
  ) !== input.ids.marketConfigV2Id) {
    throw new Error('MarketConfigV6 does not point to the created MarketConfigV2')
  }
  if (objectIdFromMoveField(
    configV6Fields.legacy_config_id,
    'MarketConfigV6.legacy_config_id',
  ) !== input.legacyConfigId) {
    throw new Error('MarketConfigV6 does not point to the canonical legacy config')
  }
  if (configV6Fields.secondary_enabled !== false) {
    throw new Error('MarketConfigV6 secondary gate must be disabled at retirement')
  }
  if (
    configV6Fields.fee_recipient !== configFields.fee_recipient
    || String(configV6Fields.platform_fee_bps) !== String(configFields.platform_fee_bps)
  ) {
    throw new Error('MarketConfigV2 and MarketConfigV6 fee policies diverged at retirement')
  }

  const adminV6Type =
    `${input.marketConfigV6PackageId}::market::MarketAdminCapV6`
  const adminV6Fields = moveFields(
    successorAdminV6,
    adminV6Type,
    'MarketAdminCapV6',
  )
  assertObjectAddressOwner(successorAdminV6, input.adminOwner, 'MarketAdminCapV6')
  if (objectIdFromMoveField(
    adminV6Fields.config_v2_id,
    'MarketAdminCapV6.config_v2_id',
  ) !== input.ids.marketConfigV2Id) {
    throw new Error('MarketAdminCapV6 does not control the created MarketConfigV2')
  }
  if (objectIdFromMoveField(
    adminV6Fields.config_v6_id,
    'MarketAdminCapV6.config_v6_id',
  ) !== input.ids.marketConfigV6Id) {
    throw new Error('MarketAdminCapV6 does not control the created MarketConfigV6')
  }
  const nestedV2 = adminV6Fields.v2_admin_cap
  if (!nestedV2 || typeof nestedV2 !== 'object') {
    throw new Error('MarketAdminCapV6 does not contain the wrapped MarketAdminCapV2')
  }
  const nestedV2Fields = (nestedV2 as { fields?: unknown }).fields
  if (!nestedV2Fields || typeof nestedV2Fields !== 'object') {
    throw new Error('MarketAdminCapV6.v2_admin_cap has no parsed fields')
  }
  const nestedFields = nestedV2Fields as Record<string, unknown>
  if (objectIdFromMoveField(
    nestedFields.id,
    'MarketAdminCapV6.v2_admin_cap.id',
  ) !== input.ids.marketAdminCapV2Id) {
    throw new Error('MarketAdminCapV6 contains a different MarketAdminCapV2')
  }
  if (objectIdFromMoveField(
    nestedFields.config_id,
    'MarketAdminCapV6.v2_admin_cap.config_id',
  ) !== input.ids.marketConfigV2Id) {
    throw new Error('Wrapped MarketAdminCapV2 controls a different MarketConfigV2')
  }
}

export function persistRetirementRecordsFromAttempt(
  attempt: MainnetMutationAttempt,
  ids: RetirementObjectIds,
): void {
  const context = retirementAttemptContext(attempt)
  if (attempt.operation !== 'retire-legacy-market') {
    throw new Error(`Cannot persist retirement records for ${attempt.operation}`)
  }
  const snapshot = readDeploymentSnapshot()
  const deployment = assertMainnetDeploymentRecord(snapshot.mainnet)
  const checks: Array<[string, string, string]> = [
    ['original package', deployment.originalPackageId, context.originalPackageId],
    ['callable package', deployment.callablePackageId, context.callablePackageId],
    ['UpgradeCap', deployment.upgradeCapId, context.upgradeCapId],
    ['legacy MarketConfig', deployment.legacyConfigId, context.legacyConfigId],
    ['legacy MarketAdminCap', deployment.legacyAdminCapId, context.legacyAdminCapId],
  ]
  for (const [label, actual, expected] of checks) {
    if (actual !== expected) {
      throw new Error(
        `Retirement journal ${label} ${expected} does not match local record ${actual}`,
      )
    }
  }

  const alreadyRecorded =
    snapshot.mainnet.marketConfigV2Id === ids.marketConfigV2Id
    && snapshot.mainnet.marketAdminCapV2Id === ids.marketAdminCapV2Id
    && snapshot.mainnet.marketConfigV6PackageId === context.marketConfigV6PackageId
    && snapshot.mainnet.marketConfigV6Id === ids.marketConfigV6Id
    && snapshot.mainnet.marketAdminCapV6Id === ids.marketAdminCapV6Id
    && snapshot.mainnet.legacyMarketRetirementTxDigest === attempt.digest
  if (!alreadyRecorded) {
    if (sha256(snapshot.serializedMainnet) !== context.priorManifestSha256) {
      throw new Error(
        'deployment-manifest.json changed since the retirement journal was prepared; '
          + 'refusing recovery write',
      )
    }
    atomicPatchMainnetDeployment(snapshot, {
      callablePackageId: context.callablePackageId,
      animacraftProvenancePackageId: context.animacraftProvenancePackageId,
      marketConfigV2PackageId: context.marketConfigV2PackageId,
      marketConfigV2Id: ids.marketConfigV2Id,
      // Kept for provenance/audit only. This V2 capability is wrapped inside
      // MarketAdminCapV6 and is not an address-owned transaction input.
      marketAdminCapV2Id: ids.marketAdminCapV2Id,
      marketConfigV6PackageId: context.marketConfigV6PackageId,
      marketConfigV6Id: ids.marketConfigV6Id,
      marketAdminCapV6Id: ids.marketAdminCapV6Id,
      legacyMarketRetirementTxDigest: attempt.digest,
    })
  }

  const readback = readDeploymentSnapshot().mainnet
  if (
    readback.callablePackageId !== context.callablePackageId
    || readback.marketConfigV2PackageId !== context.marketConfigV2PackageId
    || readback.marketConfigV2Id !== ids.marketConfigV2Id
    || readback.marketAdminCapV2Id !== ids.marketAdminCapV2Id
    || readback.marketConfigV6PackageId !== context.marketConfigV6PackageId
    || readback.marketConfigV6Id !== ids.marketConfigV6Id
    || readback.marketAdminCapV6Id !== ids.marketAdminCapV6Id
    || readback.legacyMarketRetirementTxDigest !== attempt.digest
  ) {
    throw new Error('Retirement deployment record failed final readback')
  }
}

/** Read-only recovery of a journaled pause or retirement transaction. */
export async function reconcileMarketMutationFromJournal(input: {
  client: MainnetClient
  attempt: MainnetMutationAttempt
  journalPath?: string
  persistRecords?: (
    attempt: MainnetMutationAttempt,
    ids: RetirementObjectIds,
  ) => void
}): Promise<{
  digest: string
  operation: 'pause-legacy-market' | 'retire-legacy-market'
  ids: RetirementObjectIds | null
}> {
  const { client, attempt, journalPath } = input
  const context = retirementAttemptContext(attempt)
  await assertMainnetRpc(client)
  const finalized = await client.getTransactionBlock({
    digest: attempt.digest,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
  })
  assertSuccessfulEffects(finalized, `Reconciled ${attempt.operation}`)
  const finalizedDigest = transactionDigest(finalized)
  if (finalizedDigest !== attempt.digest) {
    throw new Error(`Reconciled digest ${finalizedDigest} differs from journal ${attempt.digest}`)
  }

  const upgradeCapResponse = await client.getObject({
    id: context.upgradeCapId,
    options: { showContent: true, showOwner: true, showType: true },
  })
  assertUpgradeCap(upgradeCapResponse, context.callablePackageId, attempt.signerAddress)

  if (attempt.operation === 'pause-legacy-market') {
    const pausedConfig = await client.getObject({
      id: context.legacyConfigId,
      options: { showContent: true, showOwner: true, showType: true },
    })
    if (!assertLegacyMarketConfig(pausedConfig, context.originalPackageId).paused) {
      throw new Error('Reconciled legacy market pause did not produce paused=true')
    }
    const verifiedAttempt = updateMainnetMutationAttempt(
      attempt,
      'verified',
      journalPath,
    )
    clearMainnetMutationAttempt(verifiedAttempt, journalPath)
    return {
      digest: attempt.digest,
      operation: 'pause-legacy-market',
      ids: null,
    }
  }

  const ids = extractRetirementObjectIds(
    finalized as MigrationResult,
    context.marketConfigV2PackageId,
    context.marketConfigV6PackageId,
  )
  if (
    ids.marketConfigV2Id !== context.simulatedMarketConfigV2Id
    || ids.marketAdminCapV2Id !== context.simulatedMarketAdminCapV2Id
    || ids.marketConfigV6Id !== context.simulatedMarketConfigV6Id
    || ids.marketAdminCapV6Id !== context.simulatedMarketAdminCapV6Id
  ) {
    throw new Error('Finalized retirement object IDs differ from the journaled dry-run')
  }
  assertRetirementEvent(
    finalized as MigrationResult,
    context.marketConfigV2PackageId,
    context.marketConfigV6PackageId,
    context.legacyConfigId,
    ids,
    attempt.signerAddress,
  )
  await verifyRetiredState(client, {
    originalPackageId: context.originalPackageId,
    marketConfigV2PackageId: context.marketConfigV2PackageId,
    marketConfigV6PackageId: context.marketConfigV6PackageId,
    legacyConfigId: context.legacyConfigId,
    legacyAdminCapId: context.legacyAdminCapId,
    ids,
    adminOwner: attempt.signerAddress,
  })
  const verifiedAttempt = updateMainnetMutationAttempt(attempt, 'verified', journalPath)
  if (context.writeManifest) {
    const persistRecords = input.persistRecords ?? persistRetirementRecordsFromAttempt
    persistRecords(verifiedAttempt, ids)
  }
  clearMainnetMutationAttempt(verifiedAttempt, journalPath)
  return {
    digest: attempt.digest,
    operation: 'retire-legacy-market',
    ids,
  }
}

async function runMarketMutationReconcile(): Promise<void> {
  const attempt = readMainnetMutationAttempt()
  if (
    !attempt
    || (attempt.operation !== 'pause-legacy-market'
      && attempt.operation !== 'retire-legacy-market')
  ) {
    throw new Error('No market pause/retirement exists in the durable mutation journal')
  }
  const result = await reconcileMarketMutationFromJournal({
    client: createSuiGrpcCompatClient('mainnet'),
    attempt,
  })
  console.log(JSON.stringify({
    ok: true,
    mode: `${result.operation}-reconciled`,
    chainWrites: false,
    digest: result.digest,
    ...(result.ids ?? {}),
  }, null, 2))
}

async function main() {
  const args = parseRetirementArgs(process.argv.slice(2))
  if (args.initializeMutationJournal) {
    initializeMainnetMutationJournal(args.confirm)
    console.log('Initialized private Soulidity mainnet mutation journal.')
    return
  }
  if (args.reconcileFromJournal) {
    await runMarketMutationReconcile()
    return
  }
  if (args.execute) {
    // Never build or sign a second mutation while the prior exact-byte
    // attempt still requires read-only reconciliation.
    assertNoPendingMainnetMutationAttempt()
  }
  const snapshot = readDeploymentSnapshot()
  const deployment = assertMainnetDeploymentRecord(snapshot.mainnet)
  const callablePackageId = args.callablePackageId ?? deployment.callablePackageId
  const configuredV2TypeOrigin = snapshot.mainnet.marketConfigV2PackageId?.trim()
  const marketConfigV2PackageId = configuredV2TypeOrigin
    ? requiredAddress(configuredV2TypeOrigin, 'mainnet.marketConfigV2PackageId')
    : callablePackageId === deployment.originalPackageId
      ? deployment.originalPackageId
      : callablePackageId
  const configuredV6TypeOrigin = snapshot.mainnet.marketConfigV6PackageId?.trim()
  const marketConfigV6PackageId = configuredV6TypeOrigin
    ? requiredAddress(configuredV6TypeOrigin, 'mainnet.marketConfigV6PackageId')
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
  if (!args.pauseOnly && marketConfigV6PackageId !== callablePackageId) {
    throw new Error(
      `mainnet.marketConfigV6PackageId ${marketConfigV6PackageId} must equal the v6 `
        + `callable package ${callablePackageId}`,
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
    : extractRetirementObjectIds(
        simulation as MigrationResult,
        marketConfigV2PackageId,
        marketConfigV6PackageId,
      )
  if (simulatedIds) {
    assertRetirementEvent(
      simulation as MigrationResult,
      marketConfigV2PackageId,
      marketConfigV6PackageId,
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
  if (deployment.animacraftProvenancePackageId !== deployment.originalPackageId) {
    throw new Error(
      'P0: v6 retirement must preserve the v5 AnimacraftProvenance TypeOrigin; '
        + `found ${deployment.animacraftProvenancePackageId}`,
    )
  }
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  const { signature } = await signer.signTransaction(bytes)
  let attempt = beginMainnetMutationAttempt({
    operation: args.pauseOnly ? 'pause-legacy-market' : 'retire-legacy-market',
    signerAddress: capabilityOwner,
    digest,
    transactionBytesBase64: Buffer.from(bytes).toString('base64'),
    signature,
    context: {
      originalPackageId: deployment.originalPackageId,
      callablePackageId,
      upgradeCapId: deployment.upgradeCapId,
      legacyConfigId: deployment.legacyConfigId,
      legacyAdminCapId: deployment.legacyAdminCapId,
      marketConfigV2PackageId,
      marketConfigV6PackageId,
      animacraftProvenancePackageId: deployment.animacraftProvenancePackageId,
      simulatedMarketConfigV2Id: simulatedIds?.marketConfigV2Id ?? null,
      simulatedMarketAdminCapV2Id: simulatedIds?.marketAdminCapV2Id ?? null,
      simulatedMarketConfigV6Id: simulatedIds?.marketConfigV6Id ?? null,
      simulatedMarketAdminCapV6Id: simulatedIds?.marketAdminCapV6Id ?? null,
      writeManifest: args.writeManifest,
      priorManifestSha256: sha256(snapshot.serializedMainnet),
    },
  })

  let execution
  try {
    execution = await client.executeTransactionBlock({
      transactionBlock: bytes,
      signature,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    })
  } catch (error) {
    throw ambiguousMainnetMutationError(
      args.pauseOnly ? 'Legacy market pause' : 'Legacy market retirement',
      attempt,
      error,
    )
  }

  let reconciled: Awaited<ReturnType<typeof reconcileMarketMutationFromJournal>>
  try {
    const returnedDigest = transactionDigest(execution)
    if (returnedDigest !== digest) {
      throw new Error(`Submission returned digest ${returnedDigest}; expected ${digest}`)
    }
    attempt = updateMainnetMutationAttempt(attempt, 'submitted')
    await client.waitForTransaction({
      digest,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    })
    reconciled = await reconcileMarketMutationFromJournal({ client, attempt })
  } catch (error) {
    throw submittedMainnetMutationError(
      args.pauseOnly ? 'Legacy market pause' : 'Legacy market retirement',
      attempt,
      error,
    )
  }

  if (reconciled.operation === 'pause-legacy-market') {
    console.log(JSON.stringify({
      ok: true,
      mode: 'pause-executed',
      digest,
      legacyConfigId: deployment.legacyConfigId,
      legacyConfigPaused: true,
    }, null, 2))
    return
  }

  const ids = reconciled.ids!

  console.log(JSON.stringify({
    ok: true,
    mode: 'retirement-executed',
    digest,
    callablePackageId,
    animacraftProvenancePackageId: deployment.animacraftProvenancePackageId,
    marketConfigV2PackageId,
    marketConfigV6PackageId,
    legacyConfigId: deployment.legacyConfigId,
    legacyAdminCapDeleted: true,
    ...ids,
    primaryEnabled: false,
    v2SecondaryEnabled: false,
    v6SecondaryEnabled: false,
    manifestWritten: args.writeManifest,
    manifestPath: snapshot.path,
  }, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
