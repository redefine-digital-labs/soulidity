import './lib/dotenv'

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  Transaction,
  TransactionDataBuilder,
} from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { createSuiGrpcCompatClient } from '../packages/soulidity-sdk/src/sui-grpc-compat'

import { loadKeypairFromEnv } from './lib/keypair'
import {
  assertReviewedAnimacraftDependencies,
  assertReviewedAnimacraftMainnetAbi,
} from './lib/reviewed-move-dependencies'
import {
  assertCanonicalSigner,
  assertExecutionConfirmation,
  assertLegacyAdminCap,
  assertLegacyMarketConfig,
  assertMainnetDeploymentRecord,
  assertMainnetRpc,
  assertNoPendingMainnetMutationAttempt,
  assertSuccessfulEffects,
  assertUpgradeCap,
  ambiguousMainnetMutationError,
  atomicPatchMainnetDeployment,
  atomicWriteText,
  beginMainnetMutationAttempt,
  clearMainnetMutationAttempt,
  initializeMainnetMutationJournal,
  type MainnetMutationAttempt,
  objectAddressOwner,
  readMainnetMutationAttempt,
  readDeploymentSnapshot,
  SOULIDITY_MAINNET_CONFIRM_UPGRADE,
  SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL,
  submittedMainnetMutationError,
  transactionDigest,
  updateMainnetMutationAttempt,
} from './lib/soulidity-mainnet-migration'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const moveRoot = join(repoRoot, 'move')
const sourcePackageDir = join(moveRoot, 'soulidity')
const publishedTomlPath = join(sourcePackageDir, 'Published.toml')
const DEFAULT_GAS_BUDGET = 1_500_000_000n

export interface UpgradeArgs {
  execute: boolean
  reconcileFromJournal: boolean
  initializeMutationJournal: boolean
  confirm: string | null
  writeManifest: boolean
  privKeyEnv: string
  gasBudget: bigint
}

export interface BuiltMovePackage {
  modules: string[]
  dependencies: string[]
  digest: number[]
}

type UpgradeResult = {
  digest?: string | null
  effects?: {
    transactionDigest?: string | null
    status?: { status?: string; error?: string | null } | null
  } | null
  objectChanges?: Array<{
    type?: string
    packageId?: string
  }> | null
}

type MainnetClient = ReturnType<typeof createSuiGrpcCompatClient>

interface UpgradeAttemptContext {
  originalPackageId: string
  currentPackageId: string
  expectedCallablePackageId: string
  upgradeCapId: string
  legacyConfigId: string
  legacyAdminCapId: string
  previousUpgradeVersion: string
  nextUpgradeVersion: string
  writeManifest: boolean
  toolchainVersion: string
  priorManifestSha256: string
  priorPublishedTomlSha256: string
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
    throw new Error(`Upgrade journal context.${key} is missing`)
  }
  return value.trim()
}

function upgradeAttemptContext(attempt: MainnetMutationAttempt): UpgradeAttemptContext {
  if (attempt.operation !== 'upgrade') {
    throw new Error(`Expected an upgrade journal; found ${attempt.operation}`)
  }
  return {
    originalPackageId: normalizeSuiAddress(contextString(attempt.context, 'originalPackageId')),
    currentPackageId: normalizeSuiAddress(contextString(attempt.context, 'currentPackageId')),
    expectedCallablePackageId: normalizeSuiAddress(
      contextString(attempt.context, 'expectedCallablePackageId'),
    ),
    upgradeCapId: normalizeSuiAddress(contextString(attempt.context, 'upgradeCapId')),
    legacyConfigId: normalizeSuiAddress(contextString(attempt.context, 'legacyConfigId')),
    legacyAdminCapId: normalizeSuiAddress(contextString(attempt.context, 'legacyAdminCapId')),
    previousUpgradeVersion: contextString(attempt.context, 'previousUpgradeVersion'),
    nextUpgradeVersion: contextString(attempt.context, 'nextUpgradeVersion'),
    writeManifest: attempt.context.writeManifest === true,
    toolchainVersion: contextString(attempt.context, 'toolchainVersion'),
    priorManifestSha256: contextString(attempt.context, 'priorManifestSha256'),
    priorPublishedTomlSha256: contextString(
      attempt.context,
      'priorPublishedTomlSha256',
    ),
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

export function parseUpgradeArgs(argv: string[]): UpgradeArgs {
  let dryRunRequested = false
  const parsed: UpgradeArgs = {
    execute: false,
    reconcileFromJournal: false,
    initializeMutationJournal: false,
    confirm: null,
    writeManifest: false,
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
        'Usage: npm run upgrade:soulidity-mainnet -- [--dry-run] '
          + '[--execute --confirm=UPGRADE_SOULIDITY_MAINNET] '
          + '[--write-manifest] | [--reconcile-from-journal] | '
          + '[--initialize-mutation-journal '
          + '--confirm=INITIALIZE_SOULIDITY_MAINNET_MUTATION_JOURNAL]',
      )
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  if (parsed.writeManifest && !parsed.execute) {
    throw new Error('--write-manifest is only allowed together with --execute')
  }
  if (dryRunRequested && parsed.execute) {
    throw new Error('--dry-run and --execute are mutually exclusive')
  }
  if (parsed.reconcileFromJournal && (
    parsed.execute
    || dryRunRequested
    || parsed.confirm !== null
    || parsed.writeManifest
    || parsed.privKeyEnv !== 'MAINNET_DEPLOYER_PRIV_KEY'
    || parsed.gasBudget !== DEFAULT_GAS_BUDGET
  )) {
    throw new Error(
      '--reconcile-from-journal is an isolated read-only-chain mode; remove all signing, '
        + 'dry-run, key, gas, confirmation and manifest flags',
    )
  }
  if (parsed.initializeMutationJournal && (
    parsed.execute
    || parsed.reconcileFromJournal
    || dryRunRequested
    || parsed.writeManifest
    || parsed.privKeyEnv !== 'MAINNET_DEPLOYER_PRIV_KEY'
    || parsed.gasBudget !== DEFAULT_GAS_BUDGET
  )) {
    throw new Error(
      '--initialize-mutation-journal is an isolated local-state operation; remove all '
        + 'execute, reconcile, dry-run, key, gas and manifest flags',
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
    SOULIDITY_MAINNET_CONFIRM_UPGRADE,
  )
  return parsed
}

function resolveSuiBin(): string {
  const candidates = [
    process.env.SUI_BIN,
    join(homedir(), '.local', 'bin', 'sui'),
    join(homedir(), '.cargo', 'bin', 'sui'),
    'sui',
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find((candidate) => candidate === 'sui' || existsSync(candidate)) ?? 'sui'
}

function toolchainVersion(suiBin: string): string {
  const output = execFileSync(suiBin, ['--version'], { encoding: 'utf8' }).trim()
  return output.match(/sui\s+([\d.]+)/i)?.[1] ?? 'unknown'
}

export function validateBuiltMovePackage(value: unknown): BuiltMovePackage {
  if (!value || typeof value !== 'object') {
    throw new Error('Sui Move build output is not a JSON object')
  }
  const record = value as Partial<BuiltMovePackage>
  if (!Array.isArray(record.modules) || record.modules.length === 0) {
    throw new Error('Sui Move build produced no modules')
  }
  if (!record.modules.every((module) => typeof module === 'string' && module.length > 0)) {
    throw new Error('Sui Move build contains an invalid module')
  }
  if (!Array.isArray(record.dependencies)) {
    throw new Error('Sui Move build output is missing dependencies')
  }
  const dependencies = record.dependencies.map((dependency) =>
    normalizeSuiAddress(String(dependency)),
  )
  if (!Array.isArray(record.digest)
    || record.digest.length !== 32
    || !record.digest.every(
      (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
    )) {
    throw new Error('Sui Move build output has an invalid 32-byte upgrade digest')
  }
  return {
    modules: [...record.modules],
    dependencies,
    digest: [...record.digest],
  }
}

function buildMovePackage(suiBin: string): {
  built: BuiltMovePackage
  temporaryPackageDir: string
} {
  const temporaryPackageDir = mkdtempSync(join(moveRoot, '.soulidity-upgrade-'))
  cpSync(sourcePackageDir, temporaryPackageDir, { recursive: true })
  try {
    const output = execFileSync(
      suiBin,
      [
        'move',
        '--client.env',
        'mainnet',
        'build',
        '--dump-bytecode-as-base64',
        '--path',
        temporaryPackageDir,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    )
    return {
      built: validateBuiltMovePackage(JSON.parse(output)),
      temporaryPackageDir,
    }
  } catch (error) {
    rmSync(temporaryPackageDir, { recursive: true, force: true })
    throw error
  }
}

export function buildUpgradeTransaction(input: {
  currentPackageId: string
  upgradeCapId: string
  policy: number
  built: BuiltMovePackage
  sender?: string
  gasBudget?: bigint
}): Transaction {
  const tx = new Transaction()
  const upgradeCap = tx.object(input.upgradeCapId)
  const ticket = tx.moveCall({
    target: '0x2::package::authorize_upgrade',
    arguments: [
      upgradeCap,
      tx.pure.u8(input.policy),
      tx.pure.vector('u8', input.built.digest),
    ],
  })
  const receipt = tx.upgrade({
    modules: input.built.modules,
    dependencies: input.built.dependencies,
    package: input.currentPackageId,
    ticket,
  })
  tx.moveCall({
    target: '0x2::package::commit_upgrade',
    arguments: [upgradeCap, receipt],
  })
  if (input.sender) tx.setSender(input.sender)
  if (input.gasBudget) tx.setGasBudget(input.gasBudget)
  return tx
}

export function extractUpgradedCallablePackageId(
  result: UpgradeResult,
  currentPackageId: string,
): string {
  const published = (result.objectChanges ?? []).filter(
    (change) => change.type === 'published' && change.packageId,
  )
  if (published.length !== 1) {
    throw new Error(
      `Upgrade result must contain exactly one published package; found ${published.length}`,
    )
  }
  const callablePackageId = normalizeSuiAddress(published[0].packageId!)
  if (callablePackageId === normalizeSuiAddress(currentPackageId)) {
    throw new Error('Upgrade result returned the current package instead of a new callable package')
  }
  return callablePackageId
}

export function renderUpdatedPublishedToml(input: {
  content: string
  currentPackageId: string
  callablePackageId: string
  originalPackageId: string
  upgradeCapId: string
  version: bigint
  toolchainVersion: string
}): string {
  const { content } = input
  // Do not use the multiline flag here: `$` would then match every line end
  // and truncate the capture to the section header.
  const sectionPattern =
    /\[published\.mainnet\]\r?\n[\s\S]*?(?=\r?\n\[published\.[a-z0-9]+\]\s*(?:\r?\n|$)|\s*$)/
  const existingSection = content.match(sectionPattern)?.[0]
  if (!existingSection) throw new Error('Published.toml has no [published.mainnet] section')
  if (!existingSection.includes(`published-at = "${input.currentPackageId}"`)) {
    throw new Error(
      `Published.toml mainnet published-at does not match ${input.currentPackageId}`,
    )
  }
  const nextSection = [
    '[published.mainnet]',
    'chain-id = "35834a8a"',
    `published-at = "${input.callablePackageId}"`,
    `original-id = "${input.originalPackageId}"`,
    `version = ${input.version}`,
    `toolchain-version = "${input.toolchainVersion}"`,
    'build-config = { flavor = "sui", edition = "2024" }',
    `upgrade-capability = "${input.upgradeCapId}"`,
  ].join('\n')
  return content.replace(sectionPattern, nextSection).replace(/\s+$/, '\n')
}

function assertUpgradeRecordIdentity(
  attempt: MainnetMutationAttempt,
  deployment: ReturnType<typeof assertMainnetDeploymentRecord>,
): UpgradeAttemptContext {
  const context = upgradeAttemptContext(attempt)
  const checks: Array<[string, string, string]> = [
    ['original package', deployment.originalPackageId, context.originalPackageId],
    ['UpgradeCap', deployment.upgradeCapId, context.upgradeCapId],
    ['legacy MarketConfig', deployment.legacyConfigId, context.legacyConfigId],
    ['legacy MarketAdminCap', deployment.legacyAdminCapId, context.legacyAdminCapId],
  ]
  for (const [label, actual, expected] of checks) {
    if (actual !== expected) {
      throw new Error(`Upgrade journal ${label} ${expected} does not match local record ${actual}`)
    }
  }
  return context
}

export function persistUpgradeRecordsFromAttempt(
  attempt: MainnetMutationAttempt,
  digest = attempt.digest,
): void {
  const snapshot = readDeploymentSnapshot()
  const deployment = assertMainnetDeploymentRecord(snapshot.mainnet)
  const context = assertUpgradeRecordIdentity(attempt, deployment)

  if (deployment.callablePackageId === context.currentPackageId) {
    if (sha256(snapshot.serializedMainnet) !== context.priorManifestSha256) {
      throw new Error(
        'deployment-manifest.json changed since the journal was prepared; refusing recovery write',
      )
    }
    atomicPatchMainnetDeployment(snapshot, {
      callablePackageId: context.expectedCallablePackageId,
      // MarketConfigV6/MarketAdminCapV6 are introduced by this upgrade, so
      // their immutable TypeOrigin is the finalized upgrade package.
      marketConfigV6PackageId: context.expectedCallablePackageId,
      upgradeTxDigest: digest,
    })
  } else if (deployment.callablePackageId === context.expectedCallablePackageId) {
    if (deployment.marketConfigV6PackageId
      && deployment.marketConfigV6PackageId !== context.expectedCallablePackageId) {
      throw new Error(
        `Local v6 market TypeOrigin ${deployment.marketConfigV6PackageId} conflicts with `
          + `journal package ${context.expectedCallablePackageId}`,
      )
    }
    if (snapshot.mainnet.upgradeTxDigest
      && snapshot.mainnet.upgradeTxDigest !== digest) {
      throw new Error(
        `Local upgrade digest ${snapshot.mainnet.upgradeTxDigest} conflicts with journal ${digest}`,
      )
    }
    if (
      snapshot.mainnet.upgradeTxDigest !== digest
      || snapshot.mainnet.marketConfigV6PackageId !== context.expectedCallablePackageId
    ) {
      const current = readDeploymentSnapshot()
      atomicPatchMainnetDeployment(current, {
        marketConfigV6PackageId: context.expectedCallablePackageId,
        upgradeTxDigest: digest,
      })
    }
  } else {
    throw new Error(
      `Local callable package ${deployment.callablePackageId} is neither journal prestate `
        + `${context.currentPackageId} nor finalized package ${context.expectedCallablePackageId}`,
    )
  }

  const publishedContent = readFileSync(publishedTomlPath, 'utf8')
  if (publishedContent.includes(`published-at = "${context.currentPackageId}"`)) {
    if (sha256(publishedContent) !== context.priorPublishedTomlSha256) {
      throw new Error('Published.toml changed since the journal was prepared; refusing recovery write')
    }
    const nextPublishedToml = renderUpdatedPublishedToml({
      content: publishedContent,
      currentPackageId: context.currentPackageId,
      callablePackageId: context.expectedCallablePackageId,
      originalPackageId: context.originalPackageId,
      upgradeCapId: context.upgradeCapId,
      version: BigInt(context.nextUpgradeVersion),
      toolchainVersion: context.toolchainVersion,
    })
    if (readFileSync(publishedTomlPath, 'utf8') !== publishedContent) {
      throw new Error('Published.toml changed during recovery; refusing to overwrite it')
    }
    atomicWriteText(publishedTomlPath, nextPublishedToml)
  } else {
    const expectedLines = [
      `published-at = "${context.expectedCallablePackageId}"`,
      `original-id = "${context.originalPackageId}"`,
      `version = ${context.nextUpgradeVersion}`,
      `upgrade-capability = "${context.upgradeCapId}"`,
    ]
    if (!expectedLines.every((line) => publishedContent.includes(line))) {
      throw new Error('Published.toml is neither the journal prestate nor the verified upgrade state')
    }
  }

  const recordReadback = readDeploymentSnapshot().mainnet
  if (
    recordReadback.callablePackageId !== context.expectedCallablePackageId
    || recordReadback.marketConfigV6PackageId !== context.expectedCallablePackageId
    || recordReadback.upgradeTxDigest !== digest
  ) {
    throw new Error('Upgrade deployment record failed final readback')
  }
  const publishedReadback = readFileSync(publishedTomlPath, 'utf8')
  if (!publishedReadback.includes(`published-at = "${context.expectedCallablePackageId}"`)) {
    throw new Error('Published.toml failed final upgrade readback')
  }
}

/**
 * Read-only chain recovery for a previously signed upgrade. It never builds,
 * signs or submits a transaction. The journal is cleared only after finalized
 * effects, the UpgradeCap poststate and optional local records all read back.
 */
export async function reconcileUpgradeFromJournal(input: {
  client: MainnetClient
  attempt: MainnetMutationAttempt
  journalPath?: string
  persistRecords?: (attempt: MainnetMutationAttempt) => void
}): Promise<{ digest: string; callablePackageId: string; version: string }> {
  const { client, attempt, journalPath } = input
  const context = upgradeAttemptContext(attempt)
  await assertMainnetRpc(client)
  const finalized = await client.getTransactionBlock({
    digest: attempt.digest,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
  })
  assertSuccessfulEffects(finalized, 'Reconciled Soulidity mainnet upgrade')
  const finalizedDigest = transactionDigest(finalized)
  if (finalizedDigest !== attempt.digest) {
    throw new Error(`Reconciled digest ${finalizedDigest} differs from journal ${attempt.digest}`)
  }
  const callablePackageId = extractUpgradedCallablePackageId(
    finalized as UpgradeResult,
    context.currentPackageId,
  )
  if (callablePackageId !== context.expectedCallablePackageId) {
    throw new Error(
      `Finalized callable package ${callablePackageId} differs from journal expectation `
        + context.expectedCallablePackageId,
    )
  }
  const upgradedCapResponse = await client.getObject({
    id: context.upgradeCapId,
    options: { showContent: true, showOwner: true, showType: true },
  })
  const upgradedCap = assertUpgradeCap(
    upgradedCapResponse,
    callablePackageId,
    attempt.signerAddress,
  )
  if (upgradedCap.version.toString() !== context.nextUpgradeVersion) {
    throw new Error(
      `UpgradeCap version ${upgradedCap.version} differs from journal expectation `
        + context.nextUpgradeVersion,
    )
  }

  const verifiedAttempt = updateMainnetMutationAttempt(attempt, 'verified', journalPath)
  if (context.writeManifest) {
    const persistRecords = input.persistRecords ?? persistUpgradeRecordsFromAttempt
    persistRecords(verifiedAttempt)
  }
  clearMainnetMutationAttempt(verifiedAttempt, journalPath)
  return {
    digest: attempt.digest,
    callablePackageId,
    version: upgradedCap.version.toString(),
  }
}

async function runUpgradeReconcile(): Promise<void> {
  const attempt = readMainnetMutationAttempt()
  if (!attempt || attempt.operation !== 'upgrade') {
    throw new Error('No upgrade attempt exists in the durable mainnet mutation journal')
  }
  const result = await reconcileUpgradeFromJournal({
    client: createSuiGrpcCompatClient('mainnet'),
    attempt,
  })
  console.log(JSON.stringify({
    ok: true,
    mode: 'upgrade-reconciled',
    chainWrites: false,
    ...result,
  }, null, 2))
}

async function main() {
  const args = parseUpgradeArgs(process.argv.slice(2))
  if (args.initializeMutationJournal) {
    initializeMainnetMutationJournal(args.confirm)
    console.log('Initialized private Soulidity mainnet mutation journal.')
    return
  }
  if (args.reconcileFromJournal) {
    await runUpgradeReconcile()
    return
  }
  if (args.execute) {
    // Fail before package compilation or key loading when an earlier signed
    // mainnet mutation still needs read-only reconciliation.
    assertNoPendingMainnetMutationAttempt()
  }
  const snapshot = readDeploymentSnapshot()
  const publishedTomlSnapshot = readFileSync(publishedTomlPath, 'utf8')
  const deployment = assertMainnetDeploymentRecord(snapshot.mainnet)
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
  const upgradeCap = assertUpgradeCap(
    upgradeCapResponse,
    deployment.callablePackageId,
    capabilityOwner,
  )
  assertLegacyAdminCap(
    legacyAdminResponse,
    deployment.originalPackageId,
    capabilityOwner,
  )
  const legacyMarket = assertLegacyMarketConfig(
    legacyConfigResponse,
    deployment.originalPackageId,
  )
  if (!legacyMarket.paused) {
    throw new Error(
      'P0: legacy MarketConfig is not paused. Run the pause-only migration step '
        + 'and read paused=true back before building or executing the upgrade.',
    )
  }

  const suiBin = resolveSuiBin()
  const { built, temporaryPackageDir } = buildMovePackage(suiBin)
  try {
    const reviewedDependencies = assertReviewedAnimacraftDependencies(
      'mainnet',
      built.dependencies,
    )
    await assertReviewedAnimacraftMainnetAbi({
      client,
      dependencies: reviewedDependencies,
    })
    const tx = buildUpgradeTransaction({
      currentPackageId: upgradeCap.packageId,
      upgradeCapId: deployment.upgradeCapId,
      policy: upgradeCap.policy,
      built,
      sender: capabilityOwner,
      gasBudget: args.gasBudget,
    })

    // Every invocation simulates the exact upgrade first. Default mode stops
    // here and never loads a private key.
    const transactionBytes = await tx.build({ client })
    const simulation = await client.dryRunTransactionBlock({
      transactionBlock: transactionBytes,
    })
    assertSuccessfulEffects(simulation, 'Soulidity mainnet upgrade dry-run')
    const simulatedCallablePackageId = extractUpgradedCallablePackageId(
      simulation as UpgradeResult,
      upgradeCap.packageId,
    )

    if (!args.execute) {
      console.log(JSON.stringify({
        ok: true,
        mode: 'dry-run',
        signerLoaded: false,
        currentPackageId: upgradeCap.packageId,
        simulatedCallablePackageId,
        upgradeCapId: deployment.upgradeCapId,
        upgradeCapVersion: upgradeCap.version.toString(),
        upgradePolicy: upgradeCap.policy,
        legacyConfigPaused: true,
        modules: built.modules.length,
        dependencies: built.dependencies.length,
        gasUsed: simulation.effects?.gasUsed,
        next: `Re-run with --execute --confirm=${SOULIDITY_MAINNET_CONFIRM_UPGRADE}`,
      }, null, 2))
      return
    }

    const signer = loadKeypairFromEnv(args.privKeyEnv)
    assertCanonicalSigner(signer.toSuiAddress(), capabilityOwner)
    const digest = TransactionDataBuilder.getDigestFromBytes(transactionBytes)
    const { signature } = await signer.signTransaction(transactionBytes)
    let attempt = beginMainnetMutationAttempt({
      operation: 'upgrade',
      signerAddress: capabilityOwner,
      digest,
      transactionBytesBase64: Buffer.from(transactionBytes).toString('base64'),
      signature,
      context: {
        originalPackageId: deployment.originalPackageId,
        currentPackageId: upgradeCap.packageId,
        expectedCallablePackageId: simulatedCallablePackageId,
        upgradeCapId: deployment.upgradeCapId,
        legacyConfigId: deployment.legacyConfigId,
        legacyAdminCapId: deployment.legacyAdminCapId,
        previousUpgradeVersion: upgradeCap.version.toString(),
        nextUpgradeVersion: (upgradeCap.version + 1n).toString(),
        writeManifest: args.writeManifest,
        toolchainVersion: toolchainVersion(suiBin),
        priorManifestSha256: sha256(snapshot.serializedMainnet),
        priorPublishedTomlSha256: sha256(publishedTomlSnapshot),
      },
    })

    let execution
    try {
      execution = await client.executeTransactionBlock({
        transactionBlock: transactionBytes,
        signature,
        options: {
          showEffects: true,
          showEvents: true,
          showObjectChanges: true,
        },
      })
    } catch (error) {
      throw ambiguousMainnetMutationError('Soulidity mainnet upgrade', attempt, error)
    }

    let reconciled: Awaited<ReturnType<typeof reconcileUpgradeFromJournal>>
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
      reconciled = await reconcileUpgradeFromJournal({ client, attempt })
    } catch (error) {
      throw submittedMainnetMutationError('Soulidity mainnet upgrade', attempt, error)
    }

    console.log(JSON.stringify({
      ok: true,
      mode: 'executed',
      digest,
      currentPackageId: upgradeCap.packageId,
      callablePackageId: reconciled.callablePackageId,
      upgradeCapId: deployment.upgradeCapId,
      upgradeCapVersion: reconciled.version,
      legacyConfigPaused: true,
      recordsWritten: args.writeManifest,
      manifestPath: snapshot.path,
      publishedTomlPath,
    }, null, 2))
  } finally {
    rmSync(temporaryPackageDir, { recursive: true, force: true })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
