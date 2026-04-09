import 'dotenv/config'

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface SoulidityDeployment {
  packageId: string
  marketConfigId: string
  soulTransferPolicyId: string
  collectionTransferPolicyId: string
  paymentCoinType: string
  publishTxDigest?: string
  upgradeCapId?: string
}

type SoulidityDeploymentManifest = Record<string, SoulidityDeployment>

interface PublishObjectChange {
  type?: string
  packageId?: string
  objectType?: string
  objectId?: string
}

interface PublishEvent {
  type?: string
  parsedJson?: Record<string, unknown>
}

interface PublishResult {
  digest?: string
  effects?: {
    transactionDigest?: string
  }
  objectChanges?: PublishObjectChange[]
  events?: PublishEvent[]
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const moveRoot = join(repoRoot, 'move')
const sourcePackageDir = join(repoRoot, 'move', 'soulidity')
const sourcePublishedTomlPath = join(sourcePackageDir, 'Published.toml')
const manifestPath = join(repoRoot, 'web', 'lib', 'soulidity', 'deployment-manifest.json')

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function writeJsonFile(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }

  throw new Error(`Missing ${fieldName} in publish result`)
}

function resolveSuiBin() {
  const candidates = [
    process.env.SUI_BIN,
    join(homedir(), '.local', 'bin', 'sui'),
    'sui',
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (candidate === 'sui' || existsSync(candidate)) {
      return candidate
    }
  }

  return 'sui'
}

function parseArgs(argv: string[]) {
  let dryRun = false
  let gasBudget: string | null = null
  let paymentCoinType: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--gas-budget') {
      gasBudget = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg.startsWith('--gas-budget=')) {
      gasBudget = arg.slice('--gas-budget='.length)
      continue
    }
    if (arg === '--payment-coin-type') {
      paymentCoinType = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg.startsWith('--payment-coin-type=')) {
      paymentCoinType = arg.slice('--payment-coin-type='.length)
    }
  }

  return { dryRun, gasBudget, paymentCoinType }
}

function runSuiJson(suiBin: string, args: string[]) {
  return execFileSync(suiBin, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  })
}

function getActiveSuiEnv(suiBin: string) {
  return execFileSync(suiBin, ['client', 'active-env'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  }).trim().toLowerCase()
}

function resolveTargetNetwork(suiBin: string) {
  const activeEnv = getActiveSuiEnv(suiBin)
  const configuredNetwork = process.env.NEXT_PUBLIC_SUI_NETWORK?.trim().toLowerCase() || activeEnv

  if (configuredNetwork !== activeEnv) {
    throw new Error(`NEXT_PUBLIC_SUI_NETWORK=${configuredNetwork} does not match active sui env ${activeEnv}`)
  }

  return configuredNetwork
}

export function extractDeploymentFromPublishResult(
  result: PublishResult,
  previousDeployment?: Partial<SoulidityDeployment>,
  paymentCoinTypeOverride?: string | null,
): SoulidityDeployment {
  const publishedPackage = result.objectChanges?.find((change) => change.type === 'published')
  const packageId = requireString(publishedPackage?.packageId, 'published packageId')

  const marketInitialized = result.events?.find((event) => event.type?.endsWith('::market::MarketInitialized'))
  const marketPayload = marketInitialized?.parsedJson ?? {}
  const marketConfigId = requireString(marketPayload.config_id, 'market config id')
  const soulTransferPolicyId = requireString(marketPayload.soul_policy_id, 'soul transfer policy id')
  const collectionTransferPolicyId = requireString(marketPayload.collection_policy_id, 'collection transfer policy id')

  const upgradeCap = result.objectChanges?.find((change) => change.objectType === '0x2::package::UpgradeCap')
  const upgradeCapId = requireString(upgradeCap?.objectId, 'upgrade capability id')

  const paymentCoinType = previousDeployment?.paymentCoinType?.trim()
    || paymentCoinTypeOverride?.trim()
  if (!paymentCoinType) {
    throw new Error('Missing paymentCoinType; seed deployment-manifest.json first or pass --payment-coin-type once')
  }
  const publishTxDigest = result.digest?.trim() || result.effects?.transactionDigest?.trim()

  return {
    packageId,
    marketConfigId,
    soulTransferPolicyId,
    collectionTransferPolicyId,
    paymentCoinType,
    publishTxDigest: requireString(publishTxDigest, 'publish transaction digest'),
    upgradeCapId,
  }
}

function main() {
  const suiBin = resolveSuiBin()
  const network = resolveTargetNetwork(suiBin)
  const { dryRun, gasBudget, paymentCoinType } = parseArgs(process.argv.slice(2))
  const manifest = readJsonFile<SoulidityDeploymentManifest>(manifestPath)
  const previousDeployment = manifest[network]

  const tempPackageDir = mkdtempSync(join(moveRoot, '.soulidity-publish-'))
  try {
    cpSync(sourcePackageDir, tempPackageDir, { recursive: true })
    rmSync(join(tempPackageDir, 'Published.toml'), { force: true })

    const publishArgs = ['client', 'publish', tempPackageDir]
    if (gasBudget) {
      publishArgs.push('--gas-budget', gasBudget)
    }
    publishArgs.push('--json')
    if (dryRun) {
      publishArgs.push('--dry-run')
    }

    const raw = runSuiJson(suiBin, publishArgs)
    const result = JSON.parse(raw) as PublishResult
    const deployment = extractDeploymentFromPublishResult(result, previousDeployment, paymentCoinType)

    if (dryRun) {
      console.log(JSON.stringify({ network, dryRun: true, deployment }, null, 2))
      return
    }

    manifest[network] = deployment
    writeJsonFile(manifestPath, manifest)

    const tempPublishedTomlPath = join(tempPackageDir, 'Published.toml')
    if (!existsSync(tempPublishedTomlPath)) {
      throw new Error(`Publish succeeded but ${tempPublishedTomlPath} was not generated`)
    }
    cpSync(tempPublishedTomlPath, sourcePublishedTomlPath)

    console.log(JSON.stringify({
      network,
      suiBin,
      packageId: deployment.packageId,
      marketConfigId: deployment.marketConfigId,
      soulTransferPolicyId: deployment.soulTransferPolicyId,
      collectionTransferPolicyId: deployment.collectionTransferPolicyId,
      publishTxDigest: deployment.publishTxDigest,
      upgradeCapId: deployment.upgradeCapId,
      manifestPath,
      publishedTomlPath: sourcePublishedTomlPath,
    }, null, 2))
  } finally {
    rmSync(tempPackageDir, { recursive: true, force: true })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
