import { NextResponse } from 'next/server'

import { requireSoulCreateWalletIdentity } from '@/lib/soulidity/server'
import { completeWalrusBatchUpload, WalrusBatchCompleteError } from '@/lib/upload/walrus-server-writer'
import {
  serializeWalrusCertificate,
  type SerializedWalrusEncodedBlob,
  type WalrusTransportValue,
} from '@/lib/upload/walrus-batch-transport'
import {
  normalizeWalrusBlobId,
  parseRequiredObjectId,
  parseRequiredTxDigest,
  parseRequiredAddress,
  resolveSuiNetwork,
  sameSuiValue,
} from '@soulidity/sdk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const DEFAULT_MAX_FILES = 64
const DEFAULT_MAX_BODY_BYTES = 128 * 1024 * 1024

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function getMaxFiles() {
  return readPositiveIntegerEnv('WALRUS_BATCH_COMPLETE_MAX_FILES', DEFAULT_MAX_FILES)
}

function getMaxBodyBytes() {
  return readPositiveIntegerEnv('WALRUS_BATCH_COMPLETE_MAX_BODY_BYTES', DEFAULT_MAX_BODY_BYTES)
}

function isTransportValue(value: unknown): value is WalrusTransportValue {
  if (value == null) return true
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every(isTransportValue)
  if (typeof value !== 'object') return false
  return Object.values(value as Record<string, unknown>).every(isTransportValue)
}

function parseBody(body: Record<string, unknown> | null, maxFiles: number):
  | { ok: true; value: {
    network: 'testnet' | 'mainnet'
    registerTxDigest: string
    walletAddress: string
    blobs: SerializedWalrusEncodedBlob[]
  } }
  | { ok: false; error: string } {
  if (!body) return { ok: false, error: 'Request body must be a JSON object' }

  const network = body.network === 'mainnet' ? 'mainnet' : body.network === 'testnet' ? 'testnet' : null
  if (!network) return { ok: false, error: 'network must be testnet or mainnet' }

  const configuredNetwork = resolveSuiNetwork(process.env.NEXT_PUBLIC_SUI_NETWORK)
  if (network !== configuredNetwork) {
    return { ok: false, error: `network must match the configured ${configuredNetwork} network` }
  }

  const registerTxDigest = parseRequiredTxDigest(body.registerTxDigest)
  if (!registerTxDigest) {
    return { ok: false, error: 'registerTxDigest must be a valid Sui transaction digest' }
  }

  const walletAddress = parseRequiredAddress(body.walletAddress)
  if (!walletAddress) {
    return { ok: false, error: 'walletAddress must be a valid Sui address' }
  }

  if (!Array.isArray(body.blobs) || body.blobs.length === 0) {
    return { ok: false, error: 'blobs must be a non-empty array' }
  }
  if (body.blobs.length > maxFiles) {
    return { ok: false, error: `blobs exceeds the ${maxFiles} file limit` }
  }

  const blobs: SerializedWalrusEncodedBlob[] = []
  for (let i = 0; i < body.blobs.length; i++) {
    const item = body.blobs[i] as Record<string, unknown> | null
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `blobs[${i}] must be an object` }
    }
    const blobId = normalizeWalrusBlobId(item.blobId)
    if (!blobId) {
      return { ok: false, error: `blobs[${i}].blobId is invalid` }
    }
    const blobObjectId = parseRequiredObjectId(item.blobObjectId)
    if (!blobObjectId) {
      return { ok: false, error: `blobs[${i}].blobObjectId is invalid` }
    }
    if (!isTransportValue(item.metadata)) {
      return { ok: false, error: `blobs[${i}].metadata is invalid` }
    }
    if (!isTransportValue(item.sliversByNode)) {
      return { ok: false, error: `blobs[${i}].sliversByNode is invalid` }
    }
    blobs.push({
      blobId,
      blobObjectId,
      metadata: item.metadata,
      sliversByNode: item.sliversByNode,
    })
  }

  return {
    ok: true,
    value: {
      network,
      registerTxDigest,
      walletAddress,
      blobs,
    },
  }
}

export async function POST(request: Request) {
  const auth = await requireSoulCreateWalletIdentity(request, { mutation: true })
  if ('error' in auth) {
    return auth.error
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  const maxBodyBytes = getMaxBodyBytes()
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    return NextResponse.json(
      { error: `Walrus batch completion body exceeds the ${maxBodyBytes} byte limit` },
      { status: 413 },
    )
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const parsed = parseBody(body, getMaxFiles())
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  if (!auth.walletAddresses.some((walletAddress) => sameSuiValue(walletAddress, parsed.value.walletAddress))) {
    return NextResponse.json(
      { error: 'walletAddress does not match the signed-in wallet' },
      { status: 403 },
    )
  }

  try {
    const result = await completeWalrusBatchUpload(parsed.value)
    return NextResponse.json({
      files: result.files.map((file) => ({
        blobId: file.blobId,
        blobObjectId: file.blobObjectId,
        certificate: serializeWalrusCertificate(file.certificate),
      })),
    })
  } catch (error) {
    if (error instanceof WalrusBatchCompleteError) {
      return NextResponse.json(
        {
          error: error.message,
          recoverable: true,
        },
        { status: error.status },
      )
    }
    console.error('[walrus] batch completion failed', { error })
    return NextResponse.json(
      {
        error: 'Walrus storage-node write failed after register. Retry to resume without registering again.',
        recoverable: true,
      },
      { status: 502 },
    )
  }
}
