import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import {
  normalizeStructTag,
  normalizeSuiAddress,
} from '@mysten/sui/utils'

export const SOULIDITY_MAINNET_CHAIN_IDENTIFIER = '35834a8a'
export const SOULIDITY_MAINNET_GENESIS_DIGEST =
  '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S'
export const SOULIDITY_MAINNET_ADMIN =
  '0x840221acb5a4bd05dfd1cfd696c070773270125012f9c7e67e5c334e406712da'
export const SOULIDITY_MAINNET_ORIGINAL_PACKAGE =
  '0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0'
export const SOULIDITY_MAINNET_LEGACY_CONFIG =
  '0xe6214eaba8afa4c9191a602b78bfc0658ce1e188625f986dc6768d40f4d7dbb5'
export const SOULIDITY_MAINNET_LEGACY_ADMIN_CAP =
  '0x1a68b6e897b9c76377e895545c2d54f777820bf8b844748718ec9e242aae2446'
export const SOULIDITY_MAINNET_UPGRADE_CAP =
  '0xca2ff2940a628e5d15e7d452604aa0a2777ed147febe012280b54feced1dc701'

export const SOULIDITY_MAINNET_CONFIRM_PAUSE =
  'PAUSE_SOULIDITY_LEGACY_MARKET_MAINNET'
export const SOULIDITY_MAINNET_CONFIRM_UPGRADE =
  'UPGRADE_SOULIDITY_MAINNET'
export const SOULIDITY_MAINNET_CONFIRM_RETIRE =
  'RETIRE_SOULIDITY_LEGACY_MARKET_MAINNET'
export const SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL =
  'INITIALIZE_SOULIDITY_MAINNET_MUTATION_JOURNAL'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export const SOULIDITY_MAINNET_MUTATION_ATTEMPT_PATH = resolve(
  repoRoot,
  '.soulidity-state/mainnet-mutation-attempt.json',
)

export type MainnetMutationOperation =
  | 'upgrade'
  | 'pause-legacy-market'
  | 'retire-legacy-market'

export interface MainnetMutationAttempt {
  schemaVersion: 1
  operation: MainnetMutationOperation
  status: 'prepared' | 'submitted' | 'verified'
  preparedAt: string
  chainIdentifier: typeof SOULIDITY_MAINNET_CHAIN_IDENTIFIER
  signerAddress: string
  digest: string
  /** Exact BCS transaction bytes whose digest was recorded before submission. */
  transactionBytesBase64: string
  /** Public transaction signature over the exact bytes above. */
  signature: string
  context: Record<string, string | boolean | null>
}

export interface SoulidityDeploymentRecord {
  callablePackageId?: string
  originalPackageId?: string
  animacraftProvenancePackageId?: string
  /** Compatibility alias. This must remain the original package family ID. */
  packageId?: string
  marketConfigId?: string
  marketAdminCapId?: string
  marketConfigV2Id?: string
  marketAdminCapV2Id?: string
  /** Defining package (TypeOrigin) for MarketConfigV2 and MarketAdminCapV2. */
  marketConfigV2PackageId?: string
  /** Defining package (TypeOrigin) for the v6-only secondary-market objects. */
  marketConfigV6PackageId?: string
  marketConfigV6Id?: string
  marketAdminCapV6Id?: string
  kioskRegistryId?: string
  upgradeCapId?: string
  upgradeTxDigest?: string
  legacyMarketRetirementTxDigest?: string
  [key: string]: unknown
}

export interface SoulidityDeploymentManifest {
  mainnet?: SoulidityDeploymentRecord
  [network: string]: SoulidityDeploymentRecord | undefined
}

export interface DeploymentSnapshot {
  path: string
  manifest: SoulidityDeploymentManifest
  mainnet: SoulidityDeploymentRecord
  serializedMainnet: string
}

type ObjectResponse = Awaited<ReturnType<SuiJsonRpcClient['getObject']>>

export interface UpgradeCapState {
  packageId: string
  policy: number
  version: bigint
}

export interface LegacyMarketState {
  paused: boolean
  feeRecipient: string
  platformFeeBps: number
}

export function deploymentManifestPath(cwd = process.cwd()): string {
  return resolve(cwd, 'packages/soulidity-sdk/src/deployment-manifest.json')
}

export function requiredAddress(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing`)
  }
  try {
    return normalizeSuiAddress(value.trim())
  } catch (error) {
    throw new Error(`${label} is not a valid Sui address: ${(error as Error).message}`)
  }
}

export function readDeploymentSnapshot(
  path = deploymentManifestPath(),
): DeploymentSnapshot {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as SoulidityDeploymentManifest
  if (!manifest.mainnet || typeof manifest.mainnet !== 'object') {
    throw new Error(`${path} has no mainnet deployment entry`)
  }
  return {
    path,
    manifest,
    mainnet: manifest.mainnet,
    serializedMainnet: JSON.stringify(manifest.mainnet),
  }
}

export function assertCanonicalMainnetDeployment(
  deployment: SoulidityDeploymentRecord,
): {
  originalPackageId: string
  callablePackageId: string
  legacyConfigId: string
  legacyAdminCapId: string
  upgradeCapId: string
} {
  const originalPackageId = requiredAddress(
    deployment.originalPackageId ?? deployment.packageId,
    'mainnet.originalPackageId',
  )
  const callablePackageId = requiredAddress(
    deployment.callablePackageId ?? deployment.packageId,
    'mainnet.callablePackageId',
  )
  const legacyConfigId = requiredAddress(
    deployment.marketConfigId,
    'mainnet.marketConfigId',
  )
  const legacyAdminCapId = requiredAddress(
    deployment.marketAdminCapId,
    'mainnet.marketAdminCapId',
  )
  const upgradeCapId = requiredAddress(
    deployment.upgradeCapId,
    'mainnet.upgradeCapId',
  )

  const canonicalChecks: Array<[string, string, string]> = [
    ['original package', originalPackageId, SOULIDITY_MAINNET_ORIGINAL_PACKAGE],
    ['legacy MarketConfig', legacyConfigId, SOULIDITY_MAINNET_LEGACY_CONFIG],
    ['legacy MarketAdminCap', legacyAdminCapId, SOULIDITY_MAINNET_LEGACY_ADMIN_CAP],
    ['UpgradeCap', upgradeCapId, SOULIDITY_MAINNET_UPGRADE_CAP],
  ]
  for (const [label, actual, expected] of canonicalChecks) {
    if (actual !== expected) {
      throw new Error(`Refusing non-canonical mainnet ${label}: ${actual}; expected ${expected}`)
    }
  }

  return {
    originalPackageId,
    callablePackageId,
    legacyConfigId,
    legacyAdminCapId,
    upgradeCapId,
  }
}

/**
 * Parse a deployment record without pinning it to the retired 2026 package
 * family. Fresh-family releases are safe only when the scripts subsequently
 * prove every object type, package linkage and capability owner on chain.
 *
 * `packageId` is a compatibility alias for the immutable original package and
 * may never be redirected to a later callable upgrade.
 */
export function assertMainnetDeploymentRecord(
  deployment: SoulidityDeploymentRecord,
): {
  originalPackageId: string
  callablePackageId: string
  legacyConfigId: string
  legacyAdminCapId: string
  upgradeCapId: string
  marketConfigV2PackageId: string
  marketConfigV6PackageId: string | null
  animacraftProvenancePackageId: string
} {
  const originalPackageId = requiredAddress(
    deployment.originalPackageId ?? deployment.packageId,
    'mainnet.originalPackageId',
  )
  const callablePackageId = requiredAddress(
    deployment.callablePackageId ?? deployment.packageId,
    'mainnet.callablePackageId',
  )
  if (deployment.packageId
    && requiredAddress(deployment.packageId, 'mainnet.packageId') !== originalPackageId) {
    throw new Error('mainnet.packageId must remain the immutable original package id')
  }

  return {
    originalPackageId,
    callablePackageId,
    legacyConfigId: requiredAddress(
      deployment.marketConfigId,
      'mainnet.marketConfigId',
    ),
    legacyAdminCapId: requiredAddress(
      deployment.marketAdminCapId,
      'mainnet.marketAdminCapId',
    ),
    upgradeCapId: requiredAddress(
      deployment.upgradeCapId,
      'mainnet.upgradeCapId',
    ),
    marketConfigV2PackageId: requiredAddress(
      deployment.marketConfigV2PackageId?.trim() || originalPackageId,
      'mainnet.marketConfigV2PackageId',
    ),
    marketConfigV6PackageId: deployment.marketConfigV6PackageId?.trim()
      ? requiredAddress(
          deployment.marketConfigV6PackageId,
          'mainnet.marketConfigV6PackageId',
        )
      : null,
    animacraftProvenancePackageId: requiredAddress(
      deployment.animacraftProvenancePackageId?.trim() || originalPackageId,
      'mainnet.animacraftProvenancePackageId',
    ),
  }
}

export async function assertMainnetRpc(client: SuiJsonRpcClient): Promise<void> {
  const chainIdentifier = (await client.getChainIdentifier()).trim()
  if (
    chainIdentifier.toLowerCase() !== SOULIDITY_MAINNET_CHAIN_IDENTIFIER
    && chainIdentifier !== SOULIDITY_MAINNET_GENESIS_DIGEST
  ) {
    throw new Error(
      `Refusing RPC chain ${chainIdentifier}; expected Sui mainnet ${SOULIDITY_MAINNET_GENESIS_DIGEST}`,
    )
  }
}

function objectData(response: ObjectResponse, label: string) {
  if (response.error || !response.data) {
    throw new Error(`${label} is unavailable: ${JSON.stringify(response.error)}`)
  }
  return response.data
}

function assertObjectType(
  response: ObjectResponse,
  expectedType: string,
  label: string,
) {
  const data = objectData(response, label)
  const actualType = data.type
  if (!actualType) {
    throw new Error(`${label} ${data.objectId} has no object type`)
  }
  if (normalizeStructTag(actualType) !== normalizeStructTag(expectedType)) {
    throw new Error(`${label} ${data.objectId} has type ${actualType}; expected ${expectedType}`)
  }
  return data
}

export function objectAddressOwner(response: ObjectResponse, label: string): string {
  const data = objectData(response, label)
  const owner = data.owner as unknown
  if (!owner || typeof owner !== 'object' || !('AddressOwner' in owner)) {
    throw new Error(`${label} ${data.objectId} is not address-owned`)
  }
  return requiredAddress(
    (owner as { AddressOwner?: unknown }).AddressOwner,
    `${label}.owner`,
  )
}

export function objectObjectOwner(response: ObjectResponse, label: string): string {
  const data = objectData(response, label)
  const owner = data.owner as unknown
  if (!owner || typeof owner !== 'object' || !('ObjectOwner' in owner)) {
    throw new Error(`${label} ${data.objectId} is not child-object-owned`)
  }
  return requiredAddress(
    (owner as { ObjectOwner?: unknown }).ObjectOwner,
    `${label}.owner`,
  )
}

function assertSharedOwner(response: ObjectResponse, label: string) {
  const data = objectData(response, label)
  const owner = data.owner as unknown
  if (!owner || typeof owner !== 'object' || !('Shared' in owner)) {
    throw new Error(`${label} ${data.objectId} is not a shared object`)
  }
}

export function assertObjectAddressOwner(
  response: ObjectResponse,
  expectedOwner: string,
  label: string,
): void {
  const owner = objectAddressOwner(response, label)
  const expected = requiredAddress(expectedOwner, `${label}.expectedOwner`)
  if (owner !== expected) {
    throw new Error(`${label} owner is ${owner}; expected ${expected}`)
  }
}

export function assertObjectObjectOwner(
  response: ObjectResponse,
  expectedOwner: string,
  label: string,
): void {
  const owner = objectObjectOwner(response, label)
  const expected = requiredAddress(expectedOwner, `${label}.expectedOwner`)
  if (owner !== expected) {
    throw new Error(`${label} owner is ${owner}; expected parent object ${expected}`)
  }
}

export function assertObjectShared(response: ObjectResponse, label: string): void {
  assertSharedOwner(response, label)
}

export function moveFields(
  response: ObjectResponse,
  expectedType: string,
  label: string,
): Record<string, unknown> {
  const data = assertObjectType(response, expectedType, label)
  const content = data.content
  if (!content || content.dataType !== 'moveObject') {
    throw new Error(`${label} ${data.objectId} has no parsed Move content`)
  }
  if (normalizeStructTag(content.type) !== normalizeStructTag(expectedType)) {
    throw new Error(`${label} ${data.objectId} content type does not match ${expectedType}`)
  }
  return content.fields as Record<string, unknown>
}

export function objectIdFromMoveField(value: unknown, label: string): string {
  if (typeof value === 'string') return requiredAddress(value, label)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.id === 'string') return requiredAddress(record.id, label)
    if (typeof record.bytes === 'string') return requiredAddress(record.bytes, label)
  }
  throw new Error(`${label} is not a Sui object ID`)
}

function finiteInteger(value: unknown, label: string): number {
  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN
  if (!Number.isSafeInteger(numberValue)) {
    throw new Error(`${label} is not a safe integer`)
  }
  return numberValue
}

export function assertUpgradeCap(
  response: ObjectResponse,
  expectedPackageId: string,
  expectedOwner = SOULIDITY_MAINNET_ADMIN,
): UpgradeCapState {
  const fields = moveFields(
    response,
    '0x2::package::UpgradeCap',
    'Soulidity UpgradeCap',
  )
  assertObjectAddressOwner(response, expectedOwner, 'Soulidity UpgradeCap')
  const packageId = objectIdFromMoveField(fields.package, 'UpgradeCap.package')
  if (packageId !== requiredAddress(expectedPackageId, 'expected current package')) {
    throw new Error(
      `UpgradeCap controls ${packageId}; deployment callable package is ${expectedPackageId}`,
    )
  }
  const policy = finiteInteger(fields.policy, 'UpgradeCap.policy')
  if (![0, 128, 192].includes(policy)) {
    throw new Error(`UpgradeCap.policy ${policy} is not a supported Sui upgrade policy`)
  }
  let version: bigint
  try {
    version = BigInt(String(fields.version))
  } catch {
    throw new Error('UpgradeCap.version is not an integer')
  }
  if (version < 1n) throw new Error('UpgradeCap.version must be positive')
  return { packageId, policy, version }
}

export function assertLegacyAdminCap(
  response: ObjectResponse,
  originalPackageId = SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
  expectedOwner = SOULIDITY_MAINNET_ADMIN,
): void {
  assertObjectType(
    response,
    `${originalPackageId}::market::MarketAdminCap`,
    'legacy MarketAdminCap',
  )
  assertObjectAddressOwner(response, expectedOwner, 'legacy MarketAdminCap')
}

export function assertLegacyMarketConfig(
  response: ObjectResponse,
  originalPackageId = SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
): LegacyMarketState {
  const fields = moveFields(
    response,
    `${originalPackageId}::market::MarketConfig`,
    'legacy MarketConfig',
  )
  assertSharedOwner(response, 'legacy MarketConfig')
  if (typeof fields.paused !== 'boolean') {
    throw new Error('legacy MarketConfig.paused is not a boolean')
  }
  return {
    paused: fields.paused,
    feeRecipient: requiredAddress(fields.fee_recipient, 'legacy MarketConfig.fee_recipient'),
    platformFeeBps: finiteInteger(
      fields.platform_fee_bps,
      'legacy MarketConfig.platform_fee_bps',
    ),
  }
}

export function assertDeletedObject(response: ObjectResponse, label: string): void {
  if (response.data) {
    throw new Error(`${label} still exists at ${response.data.objectId}`)
  }
  if (!response.error) {
    throw new Error(`${label} returned neither object data nor a deletion/not-found error`)
  }
}

export function assertExecutionConfirmation(
  execute: boolean,
  suppliedConfirmation: string | null,
  requiredConfirmation: string,
): void {
  if (!execute) return
  if (suppliedConfirmation !== requiredConfirmation) {
    throw new Error(
      `Execution requires --confirm=${requiredConfirmation}; no transaction was signed`,
    )
  }
}

export function assertCanonicalSigner(
  address: string,
  expectedOwner = SOULIDITY_MAINNET_ADMIN,
): string {
  const normalized = requiredAddress(address, 'signer address')
  const expected = requiredAddress(expectedOwner, 'expected signer address')
  if (normalized !== expected) {
    throw new Error(
      `Refusing signer ${normalized}; expected capability owner ${expected}`,
    )
  }
  return normalized
}

export function atomicWriteText(path: string, text: string): void {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`
  let fd: number | null = null
  try {
    fd = openSync(temporaryPath, 'wx', 0o600)
    writeFileSync(fd, text, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    renameSync(temporaryPath, path)

    // Best effort directory fsync makes the rename durable on filesystems that
    // support syncing directories. Failure here does not undo an atomic rename.
    try {
      const directoryFd = openSync(dirname(path), 'r')
      try {
        fsyncSync(directoryFd)
      } finally {
        closeSync(directoryFd)
      }
    } catch {
      // macOS and some CI filesystems reject directory fsync.
    }
  } finally {
    if (fd !== null) closeSync(fd)
    rmSync(temporaryPath, { force: true })
  }
}

export function atomicWriteJson(path: string, value: unknown): void {
  atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function initializeMainnetMutationJournal(
  confirmation: string | null,
  path = SOULIDITY_MAINNET_MUTATION_ATTEMPT_PATH,
): void {
  if (confirmation !== SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL) {
    throw new Error(
      `Journal initialization requires --confirm=${SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL}`,
    )
  }
  if (existsSync(path)) {
    throw new Error(`Mainnet mutation journal already exists at ${path}; refusing to replace it`)
  }
  const directory = dirname(path)
  const createdDirectory = !existsSync(directory)
  if (createdDirectory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
  } else if (path === SOULIDITY_MAINNET_MUTATION_ATTEMPT_PATH) {
    // The default operator-state directory is owned by this tool. Custom test
    // or operator paths may live under an existing parent we must not chmod.
    chmodSync(directory, 0o700)
  }
  let fd: number | null = null
  try {
    fd = openSync(path, 'wx', 0o600)
    writeFileSync(fd, 'null\n', 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    const directoryFd = openSync(directory, 'r')
    try {
      fsyncSync(directoryFd)
    } finally {
      closeSync(directoryFd)
    }
  } catch (error) {
    if (fd !== null) closeSync(fd)
    rmSync(path, { force: true })
    throw error
  }
}

function atomicWritePrivateMutationJournal(path: string, value: unknown): void {
  atomicWriteJson(path, value)
  chmodSync(path, 0o600)
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing`)
  }
  return value.trim()
}

function requireCanonicalBase64(value: unknown, label: string): string {
  const encoded = requireNonEmptyString(value, label)
  const decoded = Buffer.from(encoded, 'base64')
  if (decoded.length === 0 || decoded.toString('base64') !== encoded) {
    throw new Error(`${label} is not canonical base64`)
  }
  return encoded
}

function validateMutationContext(value: unknown): Record<string, string | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Mainnet mutation journal context must be an object')
  }
  const context = value as Record<string, unknown>
  for (const [key, entry] of Object.entries(context)) {
    if (!key || (typeof entry !== 'string' && typeof entry !== 'boolean' && entry !== null)) {
      throw new Error(`Mainnet mutation journal context field ${key || '<empty>'} is invalid`)
    }
  }
  return context as Record<string, string | boolean | null>
}

export function readMainnetMutationAttempt(
  path = SOULIDITY_MAINNET_MUTATION_ATTEMPT_PATH,
): MainnetMutationAttempt | null {
  if (!existsSync(path)) {
    throw new Error(
      `Mainnet mutation journal is missing at ${path}; refusing any signed mutation. `
        + `Initialize it once with --initialize-mutation-journal `
        + `--confirm=${SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL}.`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(
      `Mainnet mutation journal ${path} is unreadable: ${(error as Error).message}`,
    )
  }
  if (parsed === null) return null
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Mainnet mutation journal ${path} must contain null or an object`)
  }
  const attempt = parsed as Partial<MainnetMutationAttempt>
  const operations: MainnetMutationOperation[] = [
    'upgrade',
    'pause-legacy-market',
    'retire-legacy-market',
  ]
  if (
    attempt.schemaVersion !== 1
    || !operations.includes(attempt.operation as MainnetMutationOperation)
    || !['prepared', 'submitted', 'verified'].includes(attempt.status ?? '')
    || attempt.chainIdentifier !== SOULIDITY_MAINNET_CHAIN_IDENTIFIER
  ) {
    throw new Error(`Mainnet mutation journal ${path} is malformed; refusing to sign`)
  }
  const transactionBytesBase64 = requireCanonicalBase64(
    attempt.transactionBytesBase64,
    'journal transactionBytesBase64',
  )
  const digest = requireNonEmptyString(attempt.digest, 'journal digest')
  const derivedDigest = TransactionDataBuilder.getDigestFromBytes(
    Buffer.from(transactionBytesBase64, 'base64'),
  )
  if (derivedDigest !== digest) {
    throw new Error(
      `Mainnet mutation journal digest ${digest} does not match exact transaction bytes `
        + derivedDigest,
    )
  }
  const validated: MainnetMutationAttempt = {
    schemaVersion: 1,
    operation: attempt.operation as MainnetMutationOperation,
    status: attempt.status as MainnetMutationAttempt['status'],
    preparedAt: requireNonEmptyString(attempt.preparedAt, 'journal preparedAt'),
    chainIdentifier: SOULIDITY_MAINNET_CHAIN_IDENTIFIER,
    signerAddress: requiredAddress(attempt.signerAddress, 'journal signerAddress'),
    digest,
    transactionBytesBase64,
    signature: requireCanonicalBase64(attempt.signature, 'journal signature'),
    context: validateMutationContext(attempt.context),
  }
  return validated
}

export function assertNoPendingMainnetMutationAttempt(
  path = SOULIDITY_MAINNET_MUTATION_ATTEMPT_PATH,
): void {
  const attempt = readMainnetMutationAttempt(path)
  if (!attempt) return
  throw new Error(
    `A ${attempt.operation} attempt is still ${attempt.status} at digest ${attempt.digest}. `
      + 'DO NOT RETRY or clear the journal. Run the script\'s isolated '
      + '--reconcile-from-journal mode and verify finalized chain state first.',
  )
}

export function beginMainnetMutationAttempt(
  input: Omit<
    MainnetMutationAttempt,
    'schemaVersion' | 'status' | 'preparedAt' | 'chainIdentifier'
  >,
  path = SOULIDITY_MAINNET_MUTATION_ATTEMPT_PATH,
): MainnetMutationAttempt {
  assertNoPendingMainnetMutationAttempt(path)
  const attempt: MainnetMutationAttempt = {
    schemaVersion: 1,
    operation: input.operation,
    status: 'prepared',
    preparedAt: new Date().toISOString(),
    chainIdentifier: SOULIDITY_MAINNET_CHAIN_IDENTIFIER,
    signerAddress: requiredAddress(input.signerAddress, 'mutation signerAddress'),
    digest: requireNonEmptyString(input.digest, 'mutation digest'),
    transactionBytesBase64: requireCanonicalBase64(
      input.transactionBytesBase64,
      'mutation transactionBytesBase64',
    ),
    signature: requireCanonicalBase64(input.signature, 'mutation signature'),
    context: validateMutationContext(input.context),
  }
  atomicWritePrivateMutationJournal(path, attempt)
  const readback = readMainnetMutationAttempt(path)
  if (!readback || readback.preparedAt !== attempt.preparedAt || readback.digest !== attempt.digest) {
    throw new Error('Mainnet mutation journal failed durable readback; transaction was not submitted')
  }
  return readback
}

export function updateMainnetMutationAttempt(
  attempt: MainnetMutationAttempt,
  status: 'submitted' | 'verified',
  path = SOULIDITY_MAINNET_MUTATION_ATTEMPT_PATH,
): MainnetMutationAttempt {
  const current = readMainnetMutationAttempt(path)
  if (
    !current
    || current.preparedAt !== attempt.preparedAt
    || current.digest !== attempt.digest
    || current.operation !== attempt.operation
  ) {
    throw new Error(
      'Mainnet mutation journal changed during the chain operation; refusing to overwrite it.',
    )
  }
  const allowed = current.status === 'prepared'
    ? status === 'submitted' || status === 'verified'
    : current.status === 'submitted'
      ? status === 'submitted' || status === 'verified'
      : status === 'verified'
  if (!allowed) {
    throw new Error(`Invalid mutation journal transition ${current.status} -> ${status}`)
  }
  const updated = { ...current, status }
  atomicWritePrivateMutationJournal(path, updated)
  return readMainnetMutationAttempt(path)!
}

export function clearMainnetMutationAttempt(
  attempt: MainnetMutationAttempt,
  path = SOULIDITY_MAINNET_MUTATION_ATTEMPT_PATH,
): void {
  const current = readMainnetMutationAttempt(path)
  if (
    !current
    || current.status !== 'verified'
    || current.preparedAt !== attempt.preparedAt
    || current.digest !== attempt.digest
  ) {
    throw new Error('Only the verified matching mainnet mutation journal may be cleared')
  }
  atomicWritePrivateMutationJournal(path, null)
  if (readMainnetMutationAttempt(path) !== null) {
    throw new Error('Mainnet mutation journal failed final null readback')
  }
}

export function ambiguousMainnetMutationError(
  label: string,
  attempt: MainnetMutationAttempt,
  cause: unknown,
): Error {
  return new Error(
    `${label} digest ${attempt.digest} was signed and durably journaled before submission, `
      + `but submission returned an ambiguous result: ${(cause as Error)?.message ?? String(cause)}. `
      + 'DO NOT RETRY, rebuild, re-sign, or clear the journal. Run '
      + '--reconcile-from-journal; it performs chain reads only.',
  )
}

export function submittedMainnetMutationError(
  label: string,
  attempt: MainnetMutationAttempt,
  cause: unknown,
): Error {
  return new Error(
    `${label} digest ${attempt.digest} was submitted, but finality/readback verification failed: `
      + `${(cause as Error)?.message ?? String(cause)}. DO NOT RETRY, rebuild, re-sign, or clear `
      + 'the journal. Run --reconcile-from-journal; it performs chain reads only.',
  )
}

export function assertDeploymentSnapshotUnchanged(
  snapshot: DeploymentSnapshot,
): void {
  const current = readDeploymentSnapshot(snapshot.path)
  if (current.serializedMainnet !== snapshot.serializedMainnet) {
    throw new Error(
      'deployment-manifest.json changed during the chain operation; refusing to overwrite it. '
        + 'Re-read the on-chain result and record it with a fresh invocation.',
    )
  }
}

export function atomicPatchMainnetDeployment(
  snapshot: DeploymentSnapshot,
  patch: Partial<SoulidityDeploymentRecord>,
): SoulidityDeploymentRecord {
  assertDeploymentSnapshotUnchanged(snapshot)
  const current = readDeploymentSnapshot(snapshot.path)
  const nextMainnet = {
    ...current.mainnet,
    ...patch,
  }
  const nextManifest = {
    ...current.manifest,
    mainnet: nextMainnet,
  }
  atomicWriteJson(snapshot.path, nextManifest)
  return nextMainnet
}

export function transactionDigest(result: {
  digest?: string | null
  effects?: { transactionDigest?: string | null } | null
}): string {
  const digest = result.digest?.trim() || result.effects?.transactionDigest?.trim()
  if (!digest) throw new Error('Transaction response is missing its digest')
  return digest
}

export function assertSuccessfulEffects(result: {
  effects?: { status?: { status?: string; error?: string | null } | null } | null
}, label: string): void {
  const status = result.effects?.status
  if (status?.status !== 'success') {
    throw new Error(`${label} failed: ${status?.error ?? JSON.stringify(status)}`)
  }
}
