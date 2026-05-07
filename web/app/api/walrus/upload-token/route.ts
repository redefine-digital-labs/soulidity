import { NextResponse } from 'next/server'

import { takeRateLimitToken } from '@/lib/rate-limit'
import { requireSoulCreateWalletIdentity } from '@/lib/soulidity/server'
import {
  createWalrusUploaderToken,
  type WalrusUploaderNetwork,
} from '@shared/walrus-uploader-token'
import {
  parseRequiredAddress,
  resolveSuiNetwork,
  sameSuiValue,
} from '@soulidity/sdk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000
const DEFAULT_MAX_FILES = 64
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024

// Per-member rate limit on upload-token issuance. Each token authorises up to
// `WALRUS_UPLOADER_TOKEN_MAX_FILES` × `WALRUS_UPLOADER_TOKEN_MAX_BYTES` of
// staged uploader work before any Walrus storage TX is signed.
// Without a gate here, a signed-in wallet could loop token issuance and
// `/v1/uploads` to force the managed uploader to encode and stage payloads
// indefinitely (the managed transport's per-token byte guard does not bound
// the rate of fresh token mints). This bucket caps that loop at the first
// authentication boundary — well above the legitimate retry rate for a
// publish flow but tight enough to stop a runaway client.
const UPLOAD_TOKEN_RATE_LIMIT = {
  max: 20,
  windowMs: 5 * 60 * 1000,
} as const

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null
  return value
}

function parseBody(body: Record<string, unknown> | null):
  | { ok: true; value: { walletAddress: string; network: WalrusUploaderNetwork | null; fileCount: number; byteLimit: number } }
  | { ok: false; error: string } {
  if (!body) return { ok: false, error: 'Request body must be a JSON object' }

  const walletAddress = parseRequiredAddress(body.walletAddress)
  if (!walletAddress) return { ok: false, error: 'walletAddress must be a valid Sui address' }

  const fileCount = parsePositiveInteger(body.fileCount)
  if (!fileCount) return { ok: false, error: 'fileCount must be a positive integer' }

  const byteLimit = parsePositiveInteger(body.byteLimit ?? body.totalBytes)
  if (!byteLimit) return { ok: false, error: 'byteLimit must be a positive integer' }

  const network = body.network == null
    ? null
    : body.network === 'testnet' || body.network === 'mainnet'
      ? body.network
      : undefined
  if (network === undefined) return { ok: false, error: 'network must be testnet or mainnet' }

  return { ok: true, value: { walletAddress, network, fileCount, byteLimit } }
}

export async function POST(request: Request) {
  const auth = await requireSoulCreateWalletIdentity(request, { mutation: true })
  if ('error' in auth) return auth.error

  // Gate token issuance behind a per-member sliding-window limit before any
  // body parsing or token signing. Each successful token mint authorises
  // staged uploader work, so the limiter must apply to ALL authenticated
  // callers — including malformed or address-mismatched bodies — to bound the
  // rate of `/v1/uploads` work that follows.
  const tokenRateLimit = await takeRateLimitToken(
    `walrus-upload-token:${auth.identity.memberId}`,
    UPLOAD_TOKEN_RATE_LIMIT,
  )
  if (tokenRateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Walrus upload-token requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(tokenRateLimit.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const parsed = parseBody(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  if (!auth.walletAddresses.some((walletAddress) => sameSuiValue(walletAddress, parsed.value.walletAddress))) {
    return NextResponse.json(
      { error: 'walletAddress does not match the signed-in wallet' },
      { status: 403 },
    )
  }

  const maxFiles = readPositiveIntegerEnv('WALRUS_UPLOADER_TOKEN_MAX_FILES', DEFAULT_MAX_FILES)
  if (parsed.value.fileCount > maxFiles) {
    return NextResponse.json(
      { error: `fileCount exceeds the ${maxFiles} file limit` },
      { status: 413 },
    )
  }

  const maxBytes = readPositiveIntegerEnv('WALRUS_UPLOADER_TOKEN_MAX_BYTES', DEFAULT_MAX_BYTES)
  if (parsed.value.byteLimit > maxBytes) {
    return NextResponse.json(
      { error: `byteLimit exceeds the ${maxBytes} byte limit` },
      { status: 413 },
    )
  }

  const secret = process.env.WALRUS_UPLOADER_TOKEN_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'WALRUS_UPLOADER_TOKEN_SECRET is not configured' },
      { status: 500 },
    )
  }

  const ttlMs = readPositiveIntegerEnv('WALRUS_UPLOADER_TOKEN_TTL_MS', DEFAULT_TOKEN_TTL_MS)
  const network = resolveSuiNetwork(process.env.NEXT_PUBLIC_SUI_NETWORK) as WalrusUploaderNetwork
  if (parsed.value.network && parsed.value.network !== network) {
    return NextResponse.json(
      { error: `network must match the configured ${network} network` },
      { status: 400 },
    )
  }
  const nowMs = Date.now()
  const token = createWalrusUploaderToken({
    secret,
    nowMs,
    ttlMs,
    walletAddress: parsed.value.walletAddress,
    network,
    fileCount: parsed.value.fileCount,
    byteLimit: parsed.value.byteLimit,
  })

  return NextResponse.json({
    token,
    tokenType: 'Bearer',
    expiresAt: nowMs + ttlMs,
    walletAddress: parsed.value.walletAddress,
    network,
    fileCount: parsed.value.fileCount,
    byteLimit: parsed.value.byteLimit,
  })
}
