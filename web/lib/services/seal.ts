import 'server-only'

import {
  SealClient,
  SessionKey,
  type ExportedSessionKey,
  type KeyServerConfig,
  type SealCompatibleClient,
} from '@mysten/seal'
import type { Signer } from '@mysten/sui/cryptography'
import { suiClient } from '@/lib/sui'
import { getSoulidityDeployment } from '@/lib/soulidity/deployment'

const DEFAULT_TESTNET_SEAL_SERVER_CONFIGS: KeyServerConfig[] = [
  {
    objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
    weight: 1,
  },
]

const DEFAULT_SESSION_TTL_MIN = 10

export interface AccessPolicyDescriptor {
  packageId: string
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

type CredentialedSealRuntimeConfig = Omit<SealRuntimeConfig, 'serverConfigs'> & {
  serverConfigs: KeyServerConfig[]
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
): KeyServerConfig | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.objectId !== 'string' || candidate.objectId.trim().length === 0) {
    return null
  }

  const weight =
    typeof candidate.weight === 'number' && Number.isFinite(candidate.weight) && candidate.weight > 0
      ? candidate.weight
      : 1

  const config: KeyServerConfig = {
    objectId: candidate.objectId.trim(),
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

  return config
}

function parseConfiguredKeyServers(
  rawConfig: string | undefined,
  options: { allowCredentials: boolean; envName: string },
): KeyServerConfig[] | null {
  if (!rawConfig) return null
  try {
    const parsed = JSON.parse(rawConfig)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((value) => normalizeKeyServerConfig(value, options))
      .filter((config): config is KeyServerConfig => config != null)
  } catch {
    console.warn(`Failed to parse ${options.envName}`)
    return []
  }
}

function mergeKeyServerConfigs(baseConfigs: KeyServerConfig[], overrideConfigs: KeyServerConfig[]) {
  const merged = new Map(baseConfigs.map((config) => [config.objectId, { ...config }]))
  for (const config of overrideConfigs) {
    const existing = merged.get(config.objectId)
    merged.set(config.objectId, {
      ...(existing ?? {}),
      ...config,
    })
  }
  return Array.from(merged.values())
}

function getConfiguredKeyServers(network: 'testnet' | 'mainnet') {
  const publicConfigs = parseConfiguredKeyServers(
    process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS,
    { allowCredentials: false, envName: 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS' },
  )

  const baseConfigs = publicConfigs ?? (
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

  return serverConfigs.length === 0 ? baseConfigs : mergeKeyServerConfigs(baseConfigs, serverConfigs)
}

function getThreshold(serverConfigs: KeyServerConfig[], network: 'testnet' | 'mainnet') {
  if (serverConfigs.length === 0) return 0
  const configured = parsePositiveInteger(process.env.NEXT_PUBLIC_SEAL_THRESHOLD)
  const threshold = configured == null
    ? Math.min(2, serverConfigs.length)
    : Math.min(configured, serverConfigs.length)

  if (network === 'mainnet' && serverConfigs.length === 1 && threshold === 1) {
    console.warn('Seal threshold is 1-of-1 on mainnet')
  }

  return threshold
}

function getVerifyKeyServers() {
  return process.env.NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS !== 'false'
}

function getSoulObjectPackageId() {
  return getSoulidityDeployment().packageId
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
  return Boolean(getSoulObjectPackageId()) && getCredentialedSealRuntimeConfig().serverConfigs.length > 0
}

function getAccessPolicyDescriptor(
  soulObjectId: string,
  functionName: AccessPolicyDescriptor['functionName'],
  params?: {
    packageId?: string | null
    currentKioskId?: string | null
    currentKioskCapOnChainId?: string | null
    allowlistRegistryObjectId?: string | null
  },
): AccessPolicyDescriptor {
  return {
    packageId: params?.packageId?.trim() || getSoulObjectPackageId(),
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
  packageId?: string | null
  soulObjectId: string
  currentKioskId: string
  currentKioskCapOnChainId: string
}): SealSessionParams {
  return getAccessPolicyDescriptor(
    params.soulObjectId,
    'seal_approve_owner_in_personal_kiosk',
    {
      packageId: params.packageId,
      currentKioskId: params.currentKioskId,
      currentKioskCapOnChainId: params.currentKioskCapOnChainId,
    },
  )
}

export function getAllowlistedSealSession(params: {
  packageId?: string | null
  soulObjectId: string
  allowlistRegistryObjectId: string
}): SealSessionParams {
  return getAccessPolicyDescriptor(
    params.soulObjectId,
    'seal_approve_allowlisted',
    {
      packageId: params.packageId,
      allowlistRegistryObjectId: params.allowlistRegistryObjectId,
    },
  )
}

export function getSealSessionTtlMinutes(): number {
  return parsePositiveInteger(process.env.NEXT_PUBLIC_SEAL_SESSION_TTL_MIN) ?? DEFAULT_SESSION_TTL_MIN
}

export function createSealClient(client?: SealCompatibleClient): SealClient {
  const runtimeConfig = getCredentialedSealRuntimeConfig()
  if (runtimeConfig.serverConfigs.length === 0) {
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
): Promise<SessionKey> {
  return SessionKey.create({
    address: signer.toSuiAddress(),
    packageId: getSoulObjectPackageId(),
    signer,
    ttlMin: getSealSessionTtlMinutes(),
    suiClient: getSealCompatibleClient(client),
  })
}

export async function exportSealSessionKey(
  signer: Signer,
  client?: SealCompatibleClient,
): Promise<ExportedSessionKey> {
  const sessionKey = await createSealSessionKey(signer, client)
  return sessionKey.export()
}

export function importSealSessionKey(exported: ExportedSessionKey): SessionKey {
  return SessionKey.import(exported, getSealCompatibleClient())
}
