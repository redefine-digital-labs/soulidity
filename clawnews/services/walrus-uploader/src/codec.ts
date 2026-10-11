export interface WalrusCertificateLike {
  signers: number[]
  serializedMessage: Uint8Array
  signature: Uint8Array
}

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
  | TransportBytes
  | TransportBigInt
  | WalrusTransportValue[]
  | { [key: string]: WalrusTransportValue }

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

export function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
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
    const out: Record<string, WalrusTransportValue> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
      out[key] = serializeWalrusTransportValue(item)
    }
    return out
  }
  throw new Error(`Cannot serialize Walrus value of type ${typeof value}`)
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

export function serializeWalrusCertificate(certificate: WalrusCertificateLike) {
  return {
    signers: [...certificate.signers],
    serializedMessage: bytesToBase64(certificate.serializedMessage),
    signature: bytesToBase64(certificate.signature),
  }
}
