import { sha256 } from '@noble/hashes/sha2.js'
import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { profileReadStep } from '@soulidity/sdk'
export interface PinnedMovePackage { originalPackageId: string; callablePackageId: string; callableDigest: string }
type PackageObjectResponse = Awaited<ReturnType<SuiGrpcClient['ledgerService']['getObject']>>['response']['object']
export class PinnedMovePackageError extends Error {
  constructor(readonly code: 'CONFIG_INVALID' | 'EVIDENCE_MISMATCH' | 'BOUNDS_EXCEEDED' | 'BCS_INVALID' | 'UNAVAILABLE', detail: string) {
    super(`PINNED_PACKAGE_${code}: ${detail}`)
  }
}
function check(v: unknown, code: PinnedMovePackageError['code'], detail: string): asserts v {
  if (!v) throw new PinnedMovePackageError(code, detail)
}
const TIMEOUT_MS = 25_000, MAX_PACKAGE_BYTES = 4 * 1024 * 1024, U64_MAX = 18446744073709551615n
const id = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v)
const uint = (v: unknown): v is bigint => typeof v === 'bigint' && v >= 0n && v <= U64_MAX
const decimal = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= U64_MAX
const identifier = (v: string) => v.length <= 128 && /^(?:[A-Za-z][A-Za-z0-9_]*|_[A-Za-z0-9_]+)$/.exec(v)?.[0] === v
function validDigest(v: unknown) {
  if (typeof v !== 'string' || v.length > 44) return false
  try { const b = fromBase58(v); return b.length === 32 && toBase58(b) === v } catch { return false }
}
function bytes(v: unknown, max: number, label: string) {
  check(v instanceof Uint8Array && v.length > 0, 'UNAVAILABLE', `${label} bytes unavailable`)
  check(v.length <= max, 'BOUNDS_EXCEEDED', `${label} byte bound exceeded`); return v.slice()
}
function typedDigest(domain: string, value: Uint8Array) {
  const prefix = new TextEncoder().encode(`${domain}::`), input = new Uint8Array(prefix.length + value.length)
  input.set(prefix); input.set(value, prefix.length); return toBase58(blake2b(input, { dkLen: 32 }))
}
function canonical(codec: typeof bcs.Object, raw: Uint8Array, label: string) {
  try { const parsed = codec.parse(raw)
    check(toBase64(codec.serialize(parsed).toBytes()) === toBase64(raw), 'BCS_INVALID', `${label} noncanonical`); return parsed
  } catch (error) { if (error instanceof PinnedMovePackageError) throw error
    throw new PinnedMovePackageError('BCS_INVALID', `${label} invalid`) }
}
function packagePin(input: PinnedMovePackage) {
  const release = structuredClone(input)
  check(id(release.originalPackageId) && id(release.callablePackageId) && validDigest(release.callableDigest), 'CONFIG_INVALID', 'Invalid release package pin')
  return release
}
/** Immutable full Object BCS pinned by digest establishes each struct's origin.
 * This does not attest chain identity, executed VM linkage, schema layout or
 * successful business execution. Callers must prove those separately. No cache. */
export async function readPinnedMovePackage(client: SuiGrpcClient, input: PinnedMovePackage, signal: AbortSignal) {
  const release = packagePin(input)
  signal.throwIfAborted()
  const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId: release.callablePackageId,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'bcs', 'package.storage_id', 'package.original_id', 'package.version'] },
  }, { abort: signal, timeout: TIMEOUT_MS }))
  return authenticatePinnedMovePackageObject(response.object, release)
}

export function authenticatePinnedMovePackageObject(row: PackageObjectResponse, input: PinnedMovePackage) {
  const release = packagePin(input)
  check(row?.objectId === release.callablePackageId && row.digest === release.callableDigest && row.owner?.kind === 4
    && uint(row.version) && row.version > 0n, 'EVIDENCE_MISMATCH', 'Release package reference mismatch')
  const raw = bytes(row.bcs?.value, MAX_PACKAGE_BYTES, 'Release package')
  const parsed = canonical(bcs.Object, raw, 'release package object'), pkg = parsed.data.Package
  check(typedDigest('Object', raw) === release.callableDigest && parsed.owner.$kind === 'Immutable'
    && pkg?.id === release.callablePackageId && pkg.version === String(row.version),
  'EVIDENCE_MISMATCH', 'Release package BCS mismatch')
  // Ledger implementations may omit these redundant Package projections even
  // when requested. The configured Object digest, canonical full Object BCS,
  // Immutable owner and raw type origins remain the authority. A projection
  // that is supplied must agree; its absence does not weaken those checks.
  check((row.package?.storageId === undefined || row.package.storageId === pkg.id)
    && (row.package?.originalId === undefined || row.package.originalId === release.originalPackageId)
    && (row.package?.version === undefined || row.package.version === row.version),
  'EVIDENCE_MISMATCH', 'Release package projection mismatch')
  check(pkg.moduleMap.size > 0 && pkg.moduleMap.size <= 512 && pkg.typeOriginTable.length <= 4096 && pkg.linkageTable.size <= 1024,
    'BOUNDS_EXCEEDED', 'Release package table bound exceeded')
  // bcs.map canonical ordering is serialized-key byte order (including the
  // string length prefix), not JavaScript lexical ordering. Roundtrip above
  // already verifies ordering and duplicate keys with the installed SDK codec.
  for (const [name, module] of pkg.moduleMap) {
    check(identifier(name) && module.length > 0, 'BCS_INVALID', 'Invalid package module map')
  }
  for (const [name, link] of pkg.linkageTable) {
    // System packages legitimately commit zero linkage versions (Sui 722
    // move_package.rs::new_system). This reader checks structure, not linking.
    check(id(name) && id(link.upgradedId) && decimal(link.upgradedVersion),
      'BCS_INVALID', 'Invalid package linkage map')
  }
  const origins = new Map<string, string>()
  for (const origin of pkg.typeOriginTable) {
    const key = `${origin.moduleName}::${origin.datatypeName}`
    check(identifier(origin.moduleName) && identifier(origin.datatypeName) && id(origin.package)
      && pkg.moduleMap.has(origin.moduleName) && !origins.has(key), 'BCS_INVALID', 'Invalid or duplicate package type origin')
    origins.set(key, origin.package)
  }
  return { pin: release, version: row.version, origins, linkage: structuredClone(pkg.linkageTable),
    moduleBytes: new Map([...pkg.moduleMap].map(([name, code]) => [name, new Uint8Array(code)])),
    moduleHashes: new Map([...pkg.moduleMap].map(([name, code]) => [name, { sha256: toHex(sha256(code)), byteLength: code.length }])) }
}

/** Existing type-origin API retains the same proof and error behavior. */
export async function readPinnedMovePackageOrigins(client: SuiGrpcClient, input: PinnedMovePackage, signal: AbortSignal) {
  return (await readPinnedMovePackage(client, input, signal)).origins
}
