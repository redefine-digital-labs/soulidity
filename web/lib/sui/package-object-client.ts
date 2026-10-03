import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeSuiAddress, toBase58 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { UnaryCall, type RpcOptions } from '@protobuf-ts/runtime-rpc'

type Ledger = SuiGrpcClient['ledgerService']
type Request = Parameters<Ledger['getObject']>[0]
type ObjectRow = NonNullable<Awaited<ReturnType<Ledger['getObject']>>['response']['object']>
type Mask = Request['readMask']

// Additional transport limits per adapter/read-session, not global application
// quotas or a guarantee that every maximum-size asset scan fits. Nothing is cached.
export const PACKAGE_IDENTITY_LIMITS = Object.freeze({ batch: 100, concurrent: 4,
  attempts: 20_000, totalBytes: 512 * 1024 * 1024, objectBytes: 4 * 1024 * 1024,
  modules: 512, origins: 4096, links: 1024, timeoutMs: 40_000 })
export class PackageObjectIdentityError extends Error {
  constructor(readonly code: string) { super(`PACKAGE_OBJECT_${code}`); this.name = 'PackageObjectIdentityError' }
}
function check(value: unknown, code: string): asserts value {
  if (!value) throw new PackageObjectIdentityError(code)
}
const id = (value: unknown): value is string => typeof value === 'string'
  && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
const uint = (value: unknown): value is bigint => typeof value === 'bigint' && value >= 0n && value <= 18446744073709551615n
const identifier = (value: string) => /^[A-Za-z_][A-Za-z0-9_]{0,254}$/.test(value)
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])
const wantsPackage = (mask: Mask) => mask?.paths.some(path => path === '*' || path === 'package' || path.startsWith('package.')) ?? false
function maskWithProof(mask: Mask): Mask {
  return { paths: [...new Set([...(mask?.paths ?? []), 'object_id', 'version', 'digest', 'owner', 'bcs', 'package'])] }
}
function requestMatches(row: ObjectRow, request: Request) {
  check(typeof request.objectId === 'string' && row.objectId === normalizeSuiAddress(request.objectId)
    && (request.version === undefined || row.version === request.version), 'REQUEST_MISMATCH')
}

function authenticate(row: ObjectRow) {
  check(id(row.objectId) && uint(row.version) && row.version > 0n, 'IDENTITY_INVALID')
  const bytes = row.bcs?.value
  check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= PACKAGE_IDENTITY_LIMITS.objectBytes, 'BCS_BUDGET')
  let object: ReturnType<typeof bcs.Object.parse>
  try { object = bcs.Object.parse(bytes) } catch { throw new PackageObjectIdentityError('BCS_INVALID') }
  const pkg = object.data.Package
  check(pkg && object.owner.$kind === 'Immutable' && row.owner?.kind === 4
    && row.owner.address === undefined && row.owner.version === undefined, 'IMMUTABLE_PACKAGE_REQUIRED')
  check(pkg.id === row.objectId && BigInt(pkg.version) === row.version, 'BCS_IDENTITY_MISMATCH')
  check(pkg.moduleMap.size > 0 && pkg.moduleMap.size <= PACKAGE_IDENTITY_LIMITS.modules && pkg.typeOriginTable.length <= PACKAGE_IDENTITY_LIMITS.origins
    && pkg.linkageTable.size <= PACKAGE_IDENTITY_LIMITS.links, 'PACKAGE_BUDGET')
  for (const [name, contents] of pkg.moduleMap) check(identifier(name) && contents.length > 0, 'RAW_MODULE_INVALID')
  for (const origin of pkg.typeOriginTable) check(identifier(origin.moduleName) && identifier(origin.datatypeName)
    && pkg.moduleMap.has(origin.moduleName) && id(origin.package), 'RAW_ORIGIN_INVALID')
  for (const [originalId, link] of pkg.linkageTable) check(id(originalId) && id(link.upgradedId)
    && uint(BigInt(link.upgradedVersion)), 'RAW_LINKAGE_INVALID')
  const prefix = new TextEncoder().encode('Object::'), preimage = new Uint8Array(prefix.length + bytes.length)
  preimage.set(prefix); preimage.set(bytes, prefix.length)
  check(sameBytes(bcs.Object.serialize(object).toBytes(), bytes)
    && toBase58(blake2b(preimage, { dkLen: 32 })) === row.digest, 'DIGEST_MISMATCH')
  const projected = row.package
  check(projected, 'PACKAGE_PROJECTION_REQUIRED')
  check((projected.storageId === undefined || projected.storageId === pkg.id)
    && (projected.version === undefined || projected.version === row.version)
    && (projected.originalId === undefined || id(projected.originalId)), 'PROJECTION_IDENTITY_MISMATCH')
  check(projected.modules.length <= PACKAGE_IDENTITY_LIMITS.modules && projected.typeOrigins.length <= PACKAGE_IDENTITY_LIMITS.origins
    && projected.linkage.length <= PACKAGE_IDENTITY_LIMITS.links, 'PROJECTION_BUDGET')
  // Repeated fields may be absent (decoded as []) or partially projected. Each
  // supplied record must be backed by raw BCS before canonical normalization.
  const names = new Set<string>()
  for (const entry of projected.modules) {
    check(typeof entry.name === 'string' && !names.has(entry.name) && pkg.moduleMap.has(entry.name), 'MODULE_MISMATCH')
    names.add(entry.name)
    check(entry.contents === undefined || entry.contents instanceof Uint8Array
      && sameBytes(entry.contents, pkg.moduleMap.get(entry.name)!), 'MODULE_MISMATCH')
  }
  const origins = new Map(pkg.typeOriginTable.map(origin => [`${origin.moduleName}::${origin.datatypeName}`, origin.package]))
  check(origins.size === pkg.typeOriginTable.length, 'ORIGIN_DUPLICATE')
  const seenOrigins = new Set<string>()
  for (const origin of projected.typeOrigins) {
    const key = `${origin.moduleName}::${origin.datatypeName}`
    check(!seenOrigins.has(key) && origins.has(key) && origin.packageId === origins.get(key), 'ORIGIN_MISMATCH')
    seenOrigins.add(key)
  }
  const links = new Set<string>()
  for (const link of projected.linkage) {
    check(typeof link.originalId === 'string' && !links.has(link.originalId), 'LINKAGE_MISMATCH')
    const raw = pkg.linkageTable.get(link.originalId)
    check(raw && link.upgradedId === raw.upgradedId && uint(link.upgradedVersion)
      && link.upgradedVersion === BigInt(raw.upgradedVersion), 'LINKAGE_MISMATCH')
    links.add(link.originalId)
  }
  return { size: bytes.length, projection: { ...projected,
    modules: [...pkg.moduleMap].map(([name, contents]) => ({ datatypes: [], functions: [],
      ...projected.modules.find(module => module.name === name), name, contents })),
    typeOrigins: pkg.typeOriginTable.map(origin => ({ moduleName: origin.moduleName,
      datatypeName: origin.datatypeName, packageId: origin.package })),
    linkage: [...pkg.linkageTable].map(([originalId, link]) => ({ originalId,
      upgradedId: link.upgradedId, upgradedVersion: BigInt(link.upgradedVersion) })) } }
}

function scope(parent: AbortSignal | undefined, options: RpcOptions | undefined) {
  const controller = new AbortController(), sources = [parent, options?.abort].filter((v): v is AbortSignal => !!v)
  const stop = () => controller.abort(new PackageObjectIdentityError('ABORTED'))
  for (const source of sources) { if (source.aborted) stop(); else source.addEventListener('abort', stop, { once: true }) }
  const supplied = options?.timeout instanceof Date ? options.timeout.getTime() - Date.now() : options?.timeout
  const milliseconds = Math.max(0, Math.min(PACKAGE_IDENTITY_LIMITS.timeoutMs, supplied ?? PACKAGE_IDENTITY_LIMITS.timeoutMs))
  const timer = setTimeout(() => controller.abort(new PackageObjectIdentityError('DEADLINE')), milliseconds)
  return { signal: controller.signal, options: { ...options, abort: controller.signal, timeout: milliseconds },
    close() { clearTimeout(timer); for (const source of sources) source.removeEventListener('abort', stop); controller.abort(new PackageObjectIdentityError('CLOSED')) } }
}
async function bounded<T>(signal: AbortSignal, work: () => PromiseLike<T>): Promise<T> {
  signal.throwIfAborted()
  let stop = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    stop = () => reject(signal.reason); signal.addEventListener('abort', stop, { once: true })
  })
  try {
    const result = await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work() }), cancelled])
    signal.throwIfAborted(); return result
  } finally { signal.removeEventListener('abort', stop) }
}

/** Native factory normalization, not a global SDK behavior change: recover
 * modules/origins/linkage from authenticated BCS and add only three identity
 * scalars from the SAME storage ID's package service. Callers still authenticate
 * their expected deployment pin/origin. Construct per read-session so explicit
 * lifetime budgets have a clear owner. */
export function withPackageObjectIdentity(client: SuiGrpcClient, signal?: AbortSignal): SuiGrpcClient {
  let attempts = 0, bytes = 0, active = 0
  const waiters = new Set<() => void>()
  function wakeNext() {
    if (active >= PACKAGE_IDENTITY_LIMITS.concurrent) return
    const next = waiters.values().next().value
    if (next) { waiters.delete(next); next() }
  }
  async function slot<T>(abort: AbortSignal, run: () => PromiseLike<T>) {
    while (active >= PACKAGE_IDENTITY_LIMITS.concurrent) {
      let wake = () => {}
      // Register in this same turn as the full-slot check. bounded() invokes
      // work in a microtask, after a transport may already release every slot.
      const available = new Promise<void>(resolve => { wake = resolve; waiters.add(wake) })
      try { await bounded(abort, () => available) }
      // An awakened caller may cancel before acquiring the slot. Hand its
      // unused availability onward instead of stranding the rest of the queue.
      finally { waiters.delete(wake); wakeNext() }
    }
    abort.throwIfAborted(); active++
    const release = () => { active--; wakeNext() }
    // Cancellation bounds the caller, not a non-cooperative transport. Keep
    // its slot occupied until the actual RPC settles, including late failure.
    const pending = Promise.resolve().then(() => { abort.throwIfAborted(); return run() })
      .then(value => { release(); return value }, error => { release(); throw error })
    void pending.catch(() => {})
    return bounded(abort, () => pending)
  }
  async function enrich(row: ObjectRow | undefined, request: Request, abort: AbortSignal, options: RpcOptions) {
    if (!row) return row
    requestMatches(row, request)
    if (!row.package) return row
    abort.throwIfAborted()
    const { size, projection } = authenticate(row)
    check(bytes + size <= PACKAGE_IDENTITY_LIMITS.totalBytes && attempts < PACKAGE_IDENTITY_LIMITS.attempts, 'SESSION_BUDGET')
    bytes += size; attempts++
    const identity = await slot(abort, async () => (await client.movePackageService.getPackage({ packageId: row.objectId }, options)).response.package)
    check(identity && identity.storageId === row.objectId && identity.version === row.version
      && id(identity.originalId), 'SUPPLEMENT_IDENTITY_MISMATCH')
    check(row.package.originalId === undefined || row.package.originalId === identity.originalId, 'ORIGINAL_ID_MISMATCH')
    return { ...row, package: { ...projection, storageId: identity.storageId, originalId: identity.originalId, version: identity.version } }
  }
  function wrap<I extends object, O extends object>(call: UnaryCall<I, O>, ctx: ReturnType<typeof scope>, transform: (response: O) => Promise<O>) {
    const response = bounded(ctx.signal, () => call.response).then(transform).finally(ctx.close)
    return new UnaryCall(call.method, call.requestHeaders, call.request, call.headers, response, call.status, call.trailers)
  }
  const ledger = new Proxy(client.ledgerService, { get(service, key) {
    if (key === 'getObject') return (request: Request, options?: RpcOptions) => {
      if (!wantsPackage(request.readMask)) return service.getObject(request, options)
      const ctx = scope(signal, options), captured = structuredClone(request)
      try {
        ctx.signal.throwIfAborted()
        return wrap(service.getObject({ ...captured, readMask: maskWithProof(captured.readMask) }, ctx.options), ctx,
          async response => ({ ...response, object: await enrich(response.object, captured, ctx.signal, ctx.options) }))
      } catch (error) { ctx.close(); throw error }
    }
    if (key === 'batchGetObjects') return (request: Parameters<Ledger['batchGetObjects']>[0], options?: RpcOptions) => {
      if (!wantsPackage(request.readMask) && !request.requests.some(row => wantsPackage(row.readMask))) return service.batchGetObjects(request, options)
      check(request.requests.length <= PACKAGE_IDENTITY_LIMITS.batch, 'BATCH_BUDGET')
      const ctx = scope(signal, options), captured = structuredClone(request), all = wantsPackage(captured.readMask)
      try {
        ctx.signal.throwIfAborted()
        const requests = captured.requests.map(row => all || wantsPackage(row.readMask) ? { ...row, readMask: maskWithProof(row.readMask ?? captured.readMask) } : row)
        // The live service applies the parent mask over per-item masks. Union
        // requested fields before adding proof, but only normalize selected rows.
        const parentMask = maskWithProof({ paths: [...(captured.readMask?.paths ?? []),
          ...captured.requests.flatMap(row => row.readMask?.paths ?? [])] })
        return wrap(service.batchGetObjects({ ...captured, requests, readMask: parentMask }, ctx.options), ctx,
          async response => {
            check(response.objects.length === captured.requests.length, 'BATCH_LENGTH_MISMATCH')
            return { ...response, objects: await Promise.all(response.objects.map(async (entry, i) => {
              if (entry.result.oneofKind !== 'object') return entry
              requestMatches(entry.result.object, captured.requests[i])
              if (!all && !wantsPackage(captured.requests[i].readMask)) return entry
              return { ...entry, result: { oneofKind: 'object' as const,
                object: (await enrich(entry.result.object, captured.requests[i], ctx.signal, ctx.options))! } }
            })) }
          })
      } catch (error) { ctx.close(); throw error }
    }
    const value = Reflect.get(service, key, service)
    return typeof value === 'function' ? value.bind(service) : value
  } })
  return new Proxy(client, { get(target, key) {
    if (key === 'ledgerService') return ledger
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}
