import './lib/dotenv'

import { execFileSync } from 'node:child_process'
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
  getJsonRpcFullnodeUrl,
  SuiJsonRpcClient,
} from '@mysten/sui/jsonRpc'
import {
  Transaction,
  UpgradePolicy,
} from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'

import { loadKeypairFromEnv } from './lib/keypair'
import {
  assertCanonicalSigner,
  assertDeploymentSnapshotUnchanged,
  assertExecutionConfirmation,
  assertLegacyAdminCap,
  assertLegacyMarketConfig,
  assertMainnetDeploymentRecord,
  assertMainnetRpc,
  assertSuccessfulEffects,
  assertUpgradeCap,
  atomicPatchMainnetDeployment,
  atomicWriteText,
  objectAddressOwner,
  readDeploymentSnapshot,
  SOULIDITY_MAINNET_CONFIRM_UPGRADE,
  transactionDigest,
} from './lib/soulidity-mainnet-migration'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const moveRoot = join(repoRoot, 'move')
const sourcePackageDir = join(moveRoot, 'soulidity')
const publishedTomlPath = join(sourcePackageDir, 'Published.toml')
const DEFAULT_GAS_BUDGET = 1_500_000_000n

export interface UpgradeArgs {
  execute: boolean
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
          + '[--write-manifest]',
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

async function main() {
  const args = parseUpgradeArgs(process.argv.slice(2))
  const snapshot = readDeploymentSnapshot()
  const publishedTomlSnapshot = readFileSync(publishedTomlPath, 'utf8')
  const deployment = assertMainnetDeploymentRecord(snapshot.mainnet)
  const client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl('mainnet'),
    network: 'mainnet',
  })
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
    const execution = await client.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    })
    assertSuccessfulEffects(execution, 'Soulidity mainnet upgrade')
    const digest = transactionDigest(execution)
    const finalized = await client.waitForTransaction({
      digest,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    })
    assertSuccessfulEffects(finalized, 'Finalized Soulidity mainnet upgrade')
    const callablePackageId = extractUpgradedCallablePackageId(
      finalized as UpgradeResult,
      upgradeCap.packageId,
    )
    if (callablePackageId !== simulatedCallablePackageId) {
      throw new Error(
        `Executed callable package ${callablePackageId} differs from simulation ${simulatedCallablePackageId}`,
      )
    }

    const upgradedCapResponse = await client.getObject({
      id: deployment.upgradeCapId,
      options: { showContent: true, showOwner: true, showType: true },
    })
    const upgradedCap = assertUpgradeCap(
      upgradedCapResponse,
      callablePackageId,
      capabilityOwner,
    )
    if (upgradedCap.version !== upgradeCap.version + 1n) {
      throw new Error(
        `UpgradeCap version is ${upgradedCap.version}; expected ${upgradeCap.version + 1n}`,
      )
    }

    let recordsWritten = false
    if (args.writeManifest) {
      const patch = {
        callablePackageId,
        upgradeTxDigest: digest,
      }

      // Validate both source records before writing either one. If the process
      // stops between the two atomic renames, the runtime manifest is written
      // first so production routes point at the finalized on-chain package;
      // Published.toml is build metadata and can then be recovered safely.
      if (readFileSync(publishedTomlPath, 'utf8') !== publishedTomlSnapshot) {
        throw new Error(
          'Published.toml changed during the chain operation; refusing to overwrite it.',
        )
      }
      const nextPublishedToml = renderUpdatedPublishedToml({
        content: publishedTomlSnapshot,
        currentPackageId: upgradeCap.packageId,
        callablePackageId,
        originalPackageId: deployment.originalPackageId,
        upgradeCapId: deployment.upgradeCapId,
        version: upgradedCap.version,
        toolchainVersion: toolchainVersion(suiBin),
      })
      assertDeploymentSnapshotUnchanged(snapshot)
      atomicPatchMainnetDeployment(snapshot, patch)
      atomicWriteText(publishedTomlPath, nextPublishedToml)
      recordsWritten = true
    }

    console.log(JSON.stringify({
      ok: true,
      mode: 'executed',
      digest,
      currentPackageId: upgradeCap.packageId,
      callablePackageId,
      upgradeCapId: deployment.upgradeCapId,
      upgradeCapVersion: upgradedCap.version.toString(),
      legacyConfigPaused: true,
      recordsWritten,
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
