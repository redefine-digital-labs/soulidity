import 'server-only'

import {
  SealClient,
  SessionKey,
  type ExportedSessionKey,
  type KeyServerConfig,
  type SealCompatibleClient,
} from '@mysten/seal'
import type { Signer } from '@mysten/sui/cryptography'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import {
  getRequiredSoulidityEnv,
  suiClient,
} from '@soulidity/sdk'

const DEFAULT_TESTNET_SEAL_SERVER_CONFIGS: KeyServerConfig[] = [
  {
    objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
    weight: 1,
  },
]

const DEFAULT_SESSION_TTL_MIN = 10
const MAX_SEAL_SHARES = 255

export interface AccessPolicyDescriptor {
  /** @deprecated Immutable Seal namespace alias for older callers. */
  packageId: string
  /** First/original package used for encryption and SessionKey identity. */
  sealPackageId: string
  /** Latest package used only for the `seal_approve*` Move call. */
  callablePackageId: string
  soulObjectId: string
  moduleName: 'seal_policy'
  functionName: 'seal_approve_owner_in_personal_kiosk' | 'seal_approve_allowlisted'
  currentKioskId: string | null
  currentKioskCapOnChainId: string | null
  allowlistRegistryObjectId: string | null
  soulAllowlistCapObjectId: string | null
}

export type SealSessionParams = AccessPolicyDescriptor
export type PublicKeyServerConfig = Pick<KeyServerConfig, 'objectId' | 'weight' | 'aggregatorUrl'>

export interface SealRuntimeConfig {
  network: 'testnet' | 'mainnet'
  threshold: number
  verifyKeyServers: boolean
  serverConfigs: PublicKeyServerConfig[]
}

export interface SouliditySealPackageRoute {
  /** Immutable package namespace embedded in Seal ciphertext. */
  sealPackageId: string
  /** Latest callable package in the same package family. */
  callablePackageId: string
}

type CredentialedSealRuntimeConfig = Omit<SealRuntimeConfig, 'serverConfigs'> & {
  serverConfigs: KeyServerConfig[]
}

type ParsedKeyServerConfig = KeyServerConfig & {
  weightWasProvided: boolean
}

function getSealNetwork(): 'testnet' | 'mainnet' {
  return process.env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeKeyServerConfig(
  value: unknown,
  options: { allowCredentials: boolean },
): ParsedKeyServerConfig | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.objectId !== 'string' || candidate.objectId.trim().length === 0) {
    return null
  }
  let objectId: string
  try {
    objectId = normalizeSuiAddress(candidate.objectId.trim())
  } catch {
    return null
  }
  if (objectId === `0x${'0'.repeat(64)}`) return null

  const weight = candidate.weight == null ? 1 : candidate.weight
  if (
    typeof weight !== 'number'
    || !Number.isInteger(weight)
    || weight <= 0
  ) {
    return null
  }

  const config: KeyServerConfig = {
    objectId,
    weight,
  }

  if (typeof candidate.aggregatorUrl === 'string' && candidate.aggregatorUrl.trim().length > 0) {
    config.aggregatorUrl = candidate.aggregatorUrl.trim()
  }
  if (
    options.allowCredentials
    && typeof candidate.apiKeyName === 'string'
    && candidate.apiKeyName.trim().length > 0
  ) {
    config.apiKeyName = candidate.apiKeyName.trim()
  }
  if (
    options.allowCredentials
    && typeof candidate.apiKey === 'string'
    && candidate.apiKey.trim().length > 0
  ) {
    config.apiKey = candidate.apiKey.trim()
  }

  return {
    ...config,
    weightWasProvided: candidate.weight != null,
  }
}

function parseConfiguredKeyServers(
  rawConfig: string | undefined,
  options: { allowCredentials: boolean; envName: string },
): ParsedKeyServerConfig[] | null {
  if (!rawConfig) return null
  try {
    const parsed = JSON.parse(rawConfig)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((value) => normalizeKeyServerConfig(value, options))
      .filter((config): config is ParsedKeyServerConfig => config != null)
  } catch {
    console.warn(`Failed to parse ${options.envName}`)
    return []
  }
}

function mergeKeyServerConfigs(
  baseConfigs: KeyServerConfig[],
  overrideConfigs: ParsedKeyServerConfig[],
) {
  const merged = new Map(baseConfigs.map((config) => [config.objectId, { ...config }]))
  for (const config of overrideConfigs) {
    const existing = merged.get(config.objectId)
    if (!existing) {
      console.warn(
        `SEAL_SERVER_CONFIGS may only override a public key server; unknown object ${config.objectId}`,
      )
      return []
    }
    if (config.weightWasProvided && config.weight !== existing.weight) {
      console.warn(
        `SEAL_SERVER_CONFIGS must preserve public weight ${existing.weight} for ${config.objectId}`,
      )
      return []
    }
    const { weightWasProvided: _, ...override } = config
    merged.set(config.objectId, {
      ...existing,
      ...override,
      weight: existing.weight,
    })
  }
  return Array.from(merged.values())
}

function getTotalKeyServerWeight(serverConfigs: KeyServerConfig[]) {
  return serverConfigs.reduce((total, config) => total + config.weight, 0)
}

function enforceSealShareBudget(serverConfigs: KeyServerConfig[], network: 'testnet' | 'mainnet') {
  const totalWeight = getTotalKeyServerWeight(serverConfigs)
  if (totalWeight >= MAX_SEAL_SHARES) {
    console.warn(
      `Seal key server weight must total less than ${MAX_SEAL_SHARES}; received ${totalWeight} on ${network}`,
    )
    return []
  }
  return serverConfigs
}

function getConfiguredKeyServers(network: 'testnet' | 'mainnet') {
  const publicConfigs = parseConfiguredKeyServers(
    process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS,
    { allowCredentials: false, envName: 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS' },
  )

  const baseConfigs = publicConfigs?.map(({ weightWasProvided: _, ...config }) => config) ?? (
    network === 'testnet'
      ? DEFAULT_TESTNET_SEAL_SERVER_CONFIGS.map((config) => ({ ...config }))
      : []
  )

  const serverConfigs = parseConfiguredKeyServers(
    process.env.SEAL_SERVER_CONFIGS,
    { allowCredentials: true, envName: 'SEAL_SERVER_CONFIGS' },
  ) ?? []

  if (network === 'mainnet' && baseConfigs.length === 0 && serverConfigs.length === 0) {
    console.warn('Seal key server config is empty on mainnet')
  }

  return enforceSealShareBudget(
    serverConfigs.length === 0 ? baseConfigs : mergeKeyServerConfigs(baseConfigs, serverConfigs),
    network,
  )
}

function getThreshold(serverConfigs: KeyServerConfig[], network: 'testnet' | 'mainnet') {
  if (serverConfigs.length === 0) return 0
  const totalWeight = getTotalKeyServerWeight(serverConfigs)
  const configured = parsePositiveInteger(process.env.NEXT_PUBLIC_SEAL_THRESHOLD)
  const threshold = configured == null ? Math.min(2, totalWeight) : configured

  if (threshold >= MAX_SEAL_SHARES || threshold > totalWeight) {
    console.warn(`Seal threshold ${threshold} exceeds the configured weight ${totalWeight}`)
    return 0
  }

  if (network === 'mainnet' && serverConfigs.length === 1) {
    console.warn(`Seal uses one physical key server on mainnet (threshold ${threshold})`)
  }

  return threshold
}

function getVerifyKeyServers() {
  return process.env.NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS !== 'false'
}

export function getSouliditySealPackageId() {
  return getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
}

export function getSouliditySealCallablePackageId() {
  return getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
}

function comparablePackageId(value: string) {
  try {
    return normalizeSuiAddress(value.trim())
  } catch {
    throw new Error(`Seal package id is invalid: ${value || '(empty)'}`)
  }
}

function parseHistoricalSealPackageRoutes(): SouliditySealPackageRoute[] {
  const raw = process.env.NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES?.trim()
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES is not valid JSON')
  }
  if (!Array.isArray(parsed)) {
    throw new Error('NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES must be a JSON array')
  }
  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object') {
      throw new Error(`Seal package route ${index} must be an object`)
    }
    const candidate = value as Record<string, unknown>
    if (typeof candidate.sealPackageId !== 'string'
      || typeof candidate.callablePackageId !== 'string') {
      throw new Error(`Seal package route ${index} is missing package ids`)
    }
    return {
      sealPackageId: comparablePackageId(candidate.sealPackageId),
      callablePackageId: comparablePackageId(candidate.callablePackageId),
    }
  })
}

export function getSouliditySealPackageRoutes(): SouliditySealPackageRoute[] {
  const active: SouliditySealPackageRoute = {
    sealPackageId: comparablePackageId(getSouliditySealPackageId()),
    callablePackageId: comparablePackageId(getSouliditySealCallablePackageId()),
  }
  const routes = new Map<string, string>([
    [active.sealPackageId, active.callablePackageId],
  ])
  for (const route of parseHistoricalSealPackageRoutes()) {
    const existing = routes.get(route.sealPackageId)
    if (existing && existing !== route.callablePackageId) {
      throw new Error(
        `Seal package namespace ${route.sealPackageId} has conflicting callable routes`,
      )
    }
    routes.set(route.sealPackageId, route.callablePackageId)
  }
  return Array.from(routes, ([sealPackageId, callablePackageId]) => ({
    sealPackageId,
    callablePackageId,
  }))
}

export function resolveSouliditySealPackageRoute(
  value: string,
): SouliditySealPackageRoute {
  const requested = comparablePackageId(value)
  const route = getSouliditySealPackageRoutes().find(
    (candidate) => candidate.sealPackageId === requested,
  )
  if (!route) {
    throw new Error(`Seal namespace is not a trusted Soulidity package family: ${requested}`)
  }
  return route
}

export function assertSouliditySealPackageId(value: string): string {
  return resolveSouliditySealPackageRoute(value).sealPackageId
}

function sanitizeKeyServerConfig(config: KeyServerConfig): PublicKeyServerConfig {
  return {
    objectId: config.objectId,
    weight: config.weight,
    ...(config.aggregatorUrl ? { aggregatorUrl: config.aggregatorUrl } : {}),
  }
}

function getCredentialedSealRuntimeConfig(): CredentialedSealRuntimeConfig {
  const network = getSealNetwork()
  const serverConfigs = getConfiguredKeyServers(network)
  return {
    network,
    threshold: getThreshold(serverConfigs, network),
    verifyKeyServers: getVerifyKeyServers(),
    serverConfigs,
  }
}

function getSealCompatibleClient(client?: SealCompatibleClient): SealCompatibleClient {
  return client ?? suiClient
}

export function getSealRuntimeConfig(): SealRuntimeConfig {
  const runtimeConfig = getCredentialedSealRuntimeConfig()
  return {
    network: runtimeConfig.network,
    threshold: runtimeConfig.threshold,
    verifyKeyServers: runtimeConfig.verifyKeyServers,
    serverConfigs: runtimeConfig.serverConfigs.map(sanitizeKeyServerConfig),
  }
}

export function hasCredentialedSealServerConfigs(): boolean {
  return getCredentialedSealRuntimeConfig().serverConfigs.some((config) =>
    Boolean(config.apiKeyName) || Boolean(config.apiKey),
  )
}

export function hasSealSessionConfig(): boolean {
  const runtimeConfig = getCredentialedSealRuntimeConfig()
  return Boolean(getSouliditySealPackageId())
    && runtimeConfig.serverConfigs.length > 0
    && runtimeConfig.threshold > 0
}

function getAccessPolicyDescriptor(
  soulObjectId: string,
  functionName: AccessPolicyDescriptor['functionName'],
  params?: {
    /** @deprecated Use sealPackageId. */
    packageId?: string | null
    sealPackageId?: string | null
    currentKioskId?: string | null
    currentKioskCapOnChainId?: string | null
    allowlistRegistryObjectId?: string | null
  },
): AccessPolicyDescriptor {
  const route = resolveSouliditySealPackageRoute(
    params?.sealPackageId?.trim()
      || params?.packageId?.trim()
      || getSouliditySealPackageId(),
  )
  const sealPackageId = route.sealPackageId
  return {
    packageId: sealPackageId,
    sealPackageId,
    callablePackageId: route.callablePackageId,
    soulObjectId,
    moduleName: 'seal_policy',
    functionName,
    currentKioskId: params?.currentKioskId ?? null,
    currentKioskCapOnChainId: params?.currentKioskCapOnChainId ?? null,
    allowlistRegistryObjectId: params?.allowlistRegistryObjectId ?? null,
    soulAllowlistCapObjectId: null,
  }
}

export function getOwnerSealSession(params: {
  /** @deprecated Use sealPackageId. */
  packageId?: string | null
  sealPackageId?: string | null
  soulObjectId: string
  currentKioskId: string
  currentKioskCapOnChainId: string
}): SealSessionParams {
  return getAccessPolicyDescriptor(
    params.soulObjectId,
    'seal_approve_owner_in_personal_kiosk',
    {
      packageId: params.packageId,
      sealPackageId: params.sealPackageId,
      currentKioskId: params.currentKioskId,
      currentKioskCapOnChainId: params.currentKioskCapOnChainId,
    },
  )
}

export function getAllowlistedSealSession(params: {
  /** @deprecated Use sealPackageId. */
  packageId?: string | null
  sealPackageId?: string | null
  soulObjectId: string
  allowlistRegistryObjectId: string
}): SealSessionParams {
  return getAccessPolicyDescriptor(
    params.soulObjectId,
    'seal_approve_allowlisted',
    {
      packageId: params.packageId,
      sealPackageId: params.sealPackageId,
      allowlistRegistryObjectId: params.allowlistRegistryObjectId,
    },
  )
}

export function getSealSessionTtlMinutes(): number {
  return parsePositiveInteger(process.env.NEXT_PUBLIC_SEAL_SESSION_TTL_MIN) ?? DEFAULT_SESSION_TTL_MIN
}

export function createSealClient(client?: SealCompatibleClient): SealClient {
  const runtimeConfig = getCredentialedSealRuntimeConfig()
  if (runtimeConfig.serverConfigs.length === 0 || runtimeConfig.threshold <= 0) {
    throw new Error('Seal key server config is not available')
  }

  return new SealClient({
    suiClient: getSealCompatibleClient(client),
    serverConfigs: runtimeConfig.serverConfigs,
    verifyKeyServers: runtimeConfig.verifyKeyServers,
  })
}

export async function createSealSessionKey(
  signer: Signer,
  client?: SealCompatibleClient,
  sealPackageId = getSouliditySealPackageId(),
): Promise<SessionKey> {
  const trustedSealPackageId = assertSouliditySealPackageId(sealPackageId)
  return SessionKey.create({
    address: signer.toSuiAddress(),
    packageId: trustedSealPackageId,
    signer,
    ttlMin: getSealSessionTtlMinutes(),
    suiClient: getSealCompatibleClient(client),
  })
}

export async function exportSealSessionKey(
  signer: Signer,
  client?: SealCompatibleClient,
  sealPackageId = getSouliditySealPackageId(),
): Promise<ExportedSessionKey> {
  const sessionKey = await createSealSessionKey(signer, client, sealPackageId)
  return sessionKey.export()
}

export function importSealSessionKey(exported: ExportedSessionKey): SessionKey {
  return SessionKey.import(exported, getSealCompatibleClient())
}
