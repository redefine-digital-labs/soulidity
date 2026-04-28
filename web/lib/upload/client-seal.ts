'use client'

import { SealClient, type KeyServerConfig, type SealCompatibleClient } from '@mysten/seal'
import {
  createAssetVersionSealEnvelopeSidecar,
  createMemoryEntrySealEnvelopeSidecar,
  createSealEnvelopeSidecar,
  createSkillVersionSealEnvelopeSidecar,
  type SealEnvelopeSidecar,
} from '@/lib/services/seal-crypto'

const DEFAULT_TESTNET_SEAL_SERVER_CONFIGS: KeyServerConfig[] = [
  {
    objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
    weight: 1,
  },
]

const DEK_BYTES = 32
const IV_BYTES = 12

export interface PendingSealMaterial {
  version: 1
  dek: string
  iv: string
  contentHash: string
  mimeType: string
  fileName: string
}

function getCrypto(): Crypto {
  const cryptoInstance = globalThis.crypto
  if (!cryptoInstance?.subtle) {
    throw new Error('Web Crypto is not available in this runtime')
  }
  return cryptoInstance
}

function toCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) as Uint8Array<ArrayBuffer>
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function padBase64(value: string): string {
  const remainder = value.length % 4
  return remainder === 0 ? value : `${value}${'='.repeat(4 - remainder)}`
}

export function base64ToBytes(value: string): Uint8Array {
  const normalized = padBase64(value)
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(normalized, 'base64'))
  }
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await getCrypto().subtle.digest('SHA-256', toCryptoBytes(data))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function importAesKey(rawKey: Uint8Array) {
  return getCrypto().subtle.importKey(
    'raw',
    toCryptoBytes(rawKey),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
}

export async function encryptClientSide(params: {
  plaintext: Uint8Array
  mimeType: string
  fileName: string
}): Promise<{ ciphertext: Uint8Array; material: PendingSealMaterial }> {
  const dek = getCrypto().getRandomValues(new Uint8Array(DEK_BYTES))
  const iv = getCrypto().getRandomValues(new Uint8Array(IV_BYTES))
  try {
    const key = await importAesKey(dek)
    const ciphertext = new Uint8Array(
      await getCrypto().subtle.encrypt(
        { name: 'AES-GCM', iv: toCryptoBytes(iv) },
        key,
        toCryptoBytes(params.plaintext),
      ),
    )
    return {
      ciphertext,
      material: {
        version: 1,
        dek: bytesToBase64(dek),
        iv: bytesToBase64(iv),
        contentHash: await sha256Hex(params.plaintext),
        mimeType: params.mimeType || 'application/octet-stream',
        fileName: params.fileName || 'bundle',
      },
    }
  } finally {
    dek.fill(0)
  }
}

function parseConfiguredKeyServers(rawConfig: string | undefined): KeyServerConfig[] | null {
  if (!rawConfig) return null
  try {
    const parsed = JSON.parse(rawConfig)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((value): KeyServerConfig[] => {
      if (!value || typeof value !== 'object') return []
      const candidate = value as Record<string, unknown>
      if (typeof candidate.objectId !== 'string' || candidate.objectId.trim().length === 0) return []
      return [{
        objectId: candidate.objectId.trim(),
        weight: typeof candidate.weight === 'number' && candidate.weight > 0 ? candidate.weight : 1,
        ...(typeof candidate.aggregatorUrl === 'string' && candidate.aggregatorUrl.trim()
          ? { aggregatorUrl: candidate.aggregatorUrl.trim() }
          : {}),
      }]
    })
  } catch {
    console.warn('Failed to parse NEXT_PUBLIC_SEAL_SERVER_CONFIGS')
    return []
  }
}

function getBrowserSealRuntimeConfig() {
  const network = process.env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
  const useE2ETestnetDefaults = network === 'testnet' && process.env.NEXT_PUBLIC_E2E_TEST_MODE === '1'
  const serverConfigs = useE2ETestnetDefaults
    ? DEFAULT_TESTNET_SEAL_SERVER_CONFIGS
    : parseConfiguredKeyServers(process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS)
      ?? (network === 'testnet' ? DEFAULT_TESTNET_SEAL_SERVER_CONFIGS : [])
  const threshold = Math.min(
    Math.max(Number.parseInt(process.env.NEXT_PUBLIC_SEAL_THRESHOLD ?? '2', 10) || 1, 1),
    serverConfigs.length,
  )
  return {
    threshold,
    serverConfigs,
    verifyKeyServers: process.env.NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS !== 'false',
  }
}

function createBrowserSealClient(suiClient: SealCompatibleClient) {
  const config = getBrowserSealRuntimeConfig()
  if (config.threshold <= 0 || config.serverConfigs.length === 0) {
    throw new Error('Seal key server config is not available for client-side upload')
  }
  return {
    sealClient: new SealClient({
      suiClient,
      serverConfigs: config.serverConfigs,
      verifyKeyServers: config.verifyKeyServers,
    }),
    threshold: config.threshold,
  }
}

function materialToBytes(material: PendingSealMaterial) {
  const dek = base64ToBytes(material.dek)
  const iv = base64ToBytes(material.iv)
  if (dek.length !== DEK_BYTES) throw new Error('Pending Seal material contains an invalid DEK')
  if (iv.length !== IV_BYTES) throw new Error('Pending Seal material contains an invalid IV')
  return { dek, iv }
}

export async function createSoulSealSidecarFromMaterial(params: {
  suiClient: SealCompatibleClient
  packageId: string
  soulObjectId: string
  material: PendingSealMaterial
}): Promise<SealEnvelopeSidecar> {
  const { sealClient, threshold } = createBrowserSealClient(params.suiClient)
  const { dek, iv } = materialToBytes(params.material)
  try {
    return await createSealEnvelopeSidecar({
      sealClient,
      packageId: params.packageId,
      soulObjectId: params.soulObjectId,
      threshold,
      dek,
      iv,
      contentHash: params.material.contentHash,
      mimeType: params.material.mimeType,
      fileName: params.material.fileName,
    })
  } finally {
    dek.fill(0)
  }
}

export async function createMemorySealSidecarFromMaterial(params: {
  suiClient: SealCompatibleClient
  packageId: string
  memoryObjectId: string
  timestampKey: number
  material: PendingSealMaterial
}): Promise<SealEnvelopeSidecar> {
  const { sealClient, threshold } = createBrowserSealClient(params.suiClient)
  const { dek, iv } = materialToBytes(params.material)
  try {
    return await createMemoryEntrySealEnvelopeSidecar({
      sealClient,
      packageId: params.packageId,
      memoryObjectId: params.memoryObjectId,
      timestampKey: params.timestampKey,
      threshold,
      dek,
      iv,
      contentHash: params.material.contentHash,
      mimeType: params.material.mimeType,
      fileName: params.material.fileName,
    })
  } finally {
    dek.fill(0)
  }
}

export async function createSkillSealSidecarFromMaterial(params: {
  suiClient: SealCompatibleClient
  packageId: string
  skillsObjectId: string
  skillName: string
  versionIndex: number
  material: PendingSealMaterial
}): Promise<SealEnvelopeSidecar> {
  const { sealClient, threshold } = createBrowserSealClient(params.suiClient)
  const { dek, iv } = materialToBytes(params.material)
  try {
    return await createSkillVersionSealEnvelopeSidecar({
      sealClient,
      packageId: params.packageId,
      skillsObjectId: params.skillsObjectId,
      skillName: params.skillName,
      versionIndex: params.versionIndex,
      threshold,
      dek,
      iv,
      contentHash: params.material.contentHash,
      mimeType: params.material.mimeType,
      fileName: params.material.fileName,
    })
  } finally {
    dek.fill(0)
  }
}

export async function createAssetSealSidecarFromMaterial(params: {
  suiClient: SealCompatibleClient
  packageId: string
  assetsObjectId: string
  assetName: string
  versionIndex: number
  material: PendingSealMaterial
}): Promise<SealEnvelopeSidecar> {
  const { sealClient, threshold } = createBrowserSealClient(params.suiClient)
  const { dek, iv } = materialToBytes(params.material)
  try {
    return await createAssetVersionSealEnvelopeSidecar({
      sealClient,
      packageId: params.packageId,
      assetsObjectId: params.assetsObjectId,
      assetName: params.assetName,
      versionIndex: params.versionIndex,
      threshold,
      dek,
      iv,
      contentHash: params.material.contentHash,
      mimeType: params.material.mimeType,
      fileName: params.material.fileName,
    })
  } finally {
    dek.fill(0)
  }
}
