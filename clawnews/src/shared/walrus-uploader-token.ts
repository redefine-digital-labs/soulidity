import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export type WalrusUploaderNetwork = 'testnet' | 'mainnet'

export interface WalrusUploaderTokenPayload {
  v: 1
  scope: 'walrus-upload'
  jti: string
  walletAddress: string
  network: WalrusUploaderNetwork
  fileCount: number
  byteLimit: number
  iat: number
  exp: number
}

export interface CreateWalrusUploaderTokenParams {
  secret: string
  nowMs?: number
  ttlMs: number
  walletAddress: string
  network: WalrusUploaderNetwork
  fileCount: number
  byteLimit: number
  tokenId?: string
}

export interface VerifyWalrusUploaderTokenParams {
  secret: string
  nowMs?: number
  walletAddress?: string
  network?: WalrusUploaderNetwork
  fileCount?: number
  byteCount?: number
}

const TOKEN_PREFIX = 'wut1'

function assertUsableSecret(secret: string) {
  if (!secret || secret.length < 16) {
    throw new Error('WALRUS_UPLOADER_TOKEN_SECRET must be at least 16 characters')
  }
}

function assertPositiveInteger(name: string, value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
}

function base64UrlEncode(bytes: Buffer | Uint8Array | string): string {
  return Buffer.from(bytes).toString('base64url')
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

function safeEqualBase64Url(a: string, b: string): boolean {
  const left = base64UrlDecode(a)
  const right = base64UrlDecode(b)
  if (left.byteLength !== right.byteLength) return false
  return timingSafeEqual(left, right)
}

function parsePayload(value: unknown): WalrusUploaderTokenPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Walrus uploader token payload is invalid')
  }
  const payload = value as Partial<WalrusUploaderTokenPayload>
  if (
    payload.v !== 1
    || payload.scope !== 'walrus-upload'
    || typeof payload.jti !== 'string'
    || typeof payload.walletAddress !== 'string'
    || (payload.network !== 'testnet' && payload.network !== 'mainnet')
    || !Number.isInteger(payload.fileCount)
    || !Number.isInteger(payload.byteLimit)
    || !Number.isInteger(payload.iat)
    || !Number.isInteger(payload.exp)
  ) {
    throw new Error('Walrus uploader token payload is invalid')
  }
  return payload as WalrusUploaderTokenPayload
}

export function createWalrusUploaderToken(params: CreateWalrusUploaderTokenParams): string {
  assertUsableSecret(params.secret)
  assertPositiveInteger('fileCount', params.fileCount)
  assertPositiveInteger('byteLimit', params.byteLimit)
  assertPositiveInteger('ttlMs', params.ttlMs)

  const now = Math.trunc((params.nowMs ?? Date.now()) / 1000)
  const payload: WalrusUploaderTokenPayload = {
    v: 1,
    scope: 'walrus-upload',
    jti: params.tokenId ?? randomUUID(),
    walletAddress: params.walletAddress,
    network: params.network,
    fileCount: params.fileCount,
    byteLimit: params.byteLimit,
    iat: now,
    exp: now + Math.ceil(params.ttlMs / 1000),
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signedData = `${TOKEN_PREFIX}.${encodedPayload}`
  return `${signedData}.${sign(signedData, params.secret)}`
}

export function verifyWalrusUploaderToken(
  token: string,
  params: VerifyWalrusUploaderTokenParams,
): WalrusUploaderTokenPayload {
  assertUsableSecret(params.secret)
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    throw new Error('Walrus uploader token is malformed')
  }

  const signedData = `${parts[0]}.${parts[1]}`
  const expectedSignature = sign(signedData, params.secret)
  if (!safeEqualBase64Url(parts[2], expectedSignature)) {
    throw new Error('Walrus uploader token signature is invalid')
  }

  let payload: WalrusUploaderTokenPayload
  try {
    payload = parsePayload(JSON.parse(base64UrlDecode(parts[1]).toString('utf8')))
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error('Walrus uploader token payload is invalid')
  }

  const now = Math.trunc((params.nowMs ?? Date.now()) / 1000)
  if (payload.exp < now) {
    throw new Error('Walrus uploader token expired')
  }
  if (params.walletAddress && payload.walletAddress.toLowerCase() !== params.walletAddress.toLowerCase()) {
    throw new Error('Walrus uploader token wallet mismatch')
  }
  if (params.network && payload.network !== params.network) {
    throw new Error('Walrus uploader token network mismatch')
  }
  if (params.fileCount != null && params.fileCount > payload.fileCount) {
    throw new Error('Walrus uploader token file count exceeded')
  }
  if (params.byteCount != null && params.byteCount > payload.byteLimit) {
    throw new Error('Walrus uploader token byte limit exceeded')
  }

  return payload
}
