export type WalrusUploadTransport = 'managed' | 'server' | 'browser'

type TransportBytes = {
  __walrusTransport: 'bytes'
  base64: string
}

type TransportBigInt = {
  __walrusTransport: 'bigint'
  value: string
}

export type WalrusTransportValue =
  | null
  | boolean
  | number
  | string
  | WalrusTransportValue[]
  | TransportBytes
  | TransportBigInt
  | { [key: string]: WalrusTransportValue }

export interface SerializedWalrusEncodedBlob {
  blobId: string
  blobObjectId: string
  metadata: WalrusTransportValue
  sliversByNode: WalrusTransportValue
}

export interface SerializedWalrusCertificate {
  signers: number[]
  serializedMessage: string
  signature: string
}

export interface WalrusCertificateLike {
  signers: number[]
  serializedMessage: Uint8Array
  signature: Uint8Array
}

function bytesToBase64(bytes: Uint8Array): string {
  const bufferCtor = (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer
  if (bufferCtor) return bufferCtor.from(bytes).toString('base64')

  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const bufferCtor = (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer
  if (bufferCtor) return new Uint8Array(bufferCtor.from(value, 'base64'))

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function isTransportBytes(value: unknown): value is TransportBytes {
  return !!value
    && typeof value === 'object'
    && (value as Partial<TransportBytes>).__walrusTransport === 'bytes'
    && typeof (value as Partial<TransportBytes>).base64 === 'string'
}

function isTransportBigInt(value: unknown): value is TransportBigInt {
  return !!value
    && typeof value === 'object'
    && (value as Partial<TransportBigInt>).__walrusTransport === 'bigint'
    && typeof (value as Partial<TransportBigInt>).value === 'string'
}

export function serializeWalrusTransportValue(value: unknown): WalrusTransportValue {
  if (value == null) return null
  if (value instanceof Uint8Array) {
    return { __walrusTransport: 'bytes', base64: bytesToBase64(value) }
  }
  if (typeof value === 'bigint') {
    return { __walrusTransport: 'bigint', value: value.toString() }
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeWalrusTransportValue(item))
  }
  if (typeof value === 'object') {
    const out: { [key: string]: WalrusTransportValue } = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
      out[key] = serializeWalrusTransportValue(item)
    }
    return out
  }
  throw new Error(`Cannot serialize Walrus transport value of type ${typeof value}`)
}

export function deserializeWalrusTransportValue(value: WalrusTransportValue): unknown {
  if (value == null) return null
  if (isTransportBytes(value)) return base64ToBytes(value.base64)
  if (isTransportBigInt(value)) return BigInt(value.value)
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => deserializeWalrusTransportValue(item))
  }
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    out[key] = deserializeWalrusTransportValue(item)
  }
  return out
}

export function serializeWalrusEncodedBlob(params: {
  blobId: string
  blobObjectId: string
  metadata: unknown
  sliversByNode: unknown
}): SerializedWalrusEncodedBlob {
  return {
    blobId: params.blobId,
    blobObjectId: params.blobObjectId,
    metadata: serializeWalrusTransportValue(params.metadata),
    sliversByNode: serializeWalrusTransportValue(params.sliversByNode),
  }
}

export function deserializeWalrusEncodedBlob(blob: SerializedWalrusEncodedBlob): {
  blobId: string
  blobObjectId: string
  metadata: unknown
  sliversByNode: unknown
} {
  return {
    blobId: blob.blobId,
    blobObjectId: blob.blobObjectId,
    metadata: deserializeWalrusTransportValue(blob.metadata),
    sliversByNode: deserializeWalrusTransportValue(blob.sliversByNode),
  }
}

export function serializeWalrusCertificate(certificate: WalrusCertificateLike): SerializedWalrusCertificate {
  return {
    signers: [...certificate.signers],
    serializedMessage: bytesToBase64(certificate.serializedMessage),
    signature: bytesToBase64(certificate.signature),
  }
}

export function deserializeWalrusCertificate(certificate: SerializedWalrusCertificate): WalrusCertificateLike {
  return {
    signers: [...certificate.signers],
    serializedMessage: base64ToBytes(certificate.serializedMessage),
    signature: base64ToBytes(certificate.signature),
  }
}

export function getConfiguredWalrusUploadTransport(): WalrusUploadTransport {
  const configured = process.env.NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT?.trim()
  if (!configured) return 'managed'
  if (configured === 'managed' || configured === 'browser' || configured === 'server') return configured
  throw new Error(
    `Invalid NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT="${configured}". Expected managed, browser, or server.`,
  )
}
