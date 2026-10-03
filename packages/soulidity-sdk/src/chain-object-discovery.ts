import { fromBase58, isValidStructTag, normalizeStructTag, parseStructTag, toBase58, toHex } from '@mysten/sui/utils'

export type ChainObjectDiscoveryOwner =
  | Readonly<{ kind: 'ADDRESS' | 'OBJECT'; address: string }>
  | Readonly<{ kind: 'SHARED' | 'IMMUTABLE' }>
export interface ChainObjectDiscoveryScope {
  /** Original/type-origin package ID from the selected release, not an upgrade's callable ID. */
  packageId: string
  /** Exact, canonical fully-qualified type; package/module-wide queries are not accepted. */
  type: string
  owner?: ChainObjectDiscoveryOwner
}
export interface ChainObjectDiscoveryOptions {
  endpoint: string
  /** Existing release identity: eight lowercase hex characters, genesis digest's first four bytes. */
  expectedChainIdentifier: string
  scope: ChainObjectDiscoveryScope
  pageSize: number
  maxPages: number
  maxObjects: number
  timeoutMs: number
  fetch?: typeof globalThis.fetch
}
export interface ChainObjectDiscoveryPage {
  readonly ids: readonly string[]
  readonly source: Readonly<{
    endpoint: string
    chainIdentifier: string
    checkpoint: number
    scope: Readonly<ChainObjectDiscoveryScope>
    authority: 'CANDIDATE_IDS_ONLY'
  }>
  readonly page: Readonly<{
    status: 'PARTIAL' | 'COMPLETE' | 'LIMIT_REACHED'
    hasNextPage: boolean
    endCursor: string | null
    pagesRead: number
    objectsRead: number
  }>
}
export type ChainObjectDiscoveryErrorCode = 'CONFIG_INVALID' | 'BUSY' | 'COMPLETE' | 'LIMIT_REACHED'
  | 'ABORTED' | 'TIMEOUT' | 'TRANSPORT' | 'HTTP' | 'GRAPHQL' | 'RESPONSE_INVALID' | 'RESPONSE_TOO_LARGE'
  | 'WRONG_CHAIN' | 'CHECKPOINT_MISMATCH' | 'DUPLICATE_ID' | 'CURSOR_NOT_ADVANCING'
export class ChainObjectDiscoveryError extends Error {
  readonly name = 'ChainObjectDiscoveryError'
  constructor(readonly code: ChainObjectDiscoveryErrorCode, message: string, readonly httpStatus?: number) {
    super(message)
  }
}
function check(condition: unknown, code: ChainObjectDiscoveryErrorCode, message: string): asserts condition {
  if (!condition) throw new ChainObjectDiscoveryError(code, message)
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every(key => allowed.includes(key))
}
const id = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
const RESPONSE_BYTES = 128 * 1024
const QUERY = `query ChainObjectDiscovery($checkpoint:UInt53,$filter:ObjectFilter!,$first:Int!,$after:String) {
  chainIdentifier
  checkpoint(sequenceNumber:$checkpoint) {
    sequenceNumber
    query { objects(first:$first,after:$after,filter:$filter) {
      nodes { address }
      pageInfo { hasNextPage endCursor }
    } }
  }
}`

function configuration(options: ChainObjectDiscoveryOptions) {
  check(object(options) && typeof options.endpoint === 'string', 'CONFIG_INVALID', 'An explicit public GraphQL endpoint is required')
  let url: URL
  try { url = new URL(options.endpoint) } catch { throw new ChainObjectDiscoveryError('CONFIG_INVALID', 'Invalid GraphQL endpoint') }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && url.href === options.endpoint
    && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(url.hostname)
    && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname),
  'CONFIG_INVALID', 'GraphQL requires a canonical credential-free public HTTPS URL')
  check(typeof options.expectedChainIdentifier === 'string' && /^[0-9a-f]{8}$/.test(options.expectedChainIdentifier),
    'CONFIG_INVALID', 'Expected chain identifier must match the selected release eight-hex identity')
  let scope: ChainObjectDiscoveryScope
  try { scope = structuredClone(options.scope) }
  catch { throw new ChainObjectDiscoveryError('CONFIG_INVALID', 'Object scope must be serializable release data') }
  check(object(scope) && exactKeys(scope, ['packageId', 'type', 'owner']) && id(scope.packageId)
    && typeof scope.type === 'string' && scope.type.length <= 2048 && /^[a-zA-Z0-9_:<>,]+$/.test(scope.type),
  'CONFIG_INVALID', 'Invalid release-selected object scope')
  try {
    const tag = parseStructTag(scope.type)
    check(isValidStructTag(scope.type) && tag.address === scope.packageId && normalizeStructTag(scope.type) === scope.type
      && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tag.module) && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tag.name),
    'CONFIG_INVALID', 'An exact canonical type from the selected original package is required')
  } catch { throw new ChainObjectDiscoveryError('CONFIG_INVALID', 'An exact canonical type from the selected original package is required') }
  if (scope.owner !== undefined) {
    const owner = scope.owner
    check(object(owner) && ['ADDRESS', 'OBJECT', 'SHARED', 'IMMUTABLE'].includes(owner.kind)
      && (owner.kind === 'ADDRESS' || owner.kind === 'OBJECT'
        ? exactKeys(owner, ['kind', 'address']) && id(owner.address)
        : exactKeys(owner, ['kind'])), 'CONFIG_INVALID', 'Invalid object-owner discovery scope')
    Object.freeze(owner)
  }
  check(integer(options.pageSize, 1, 50) && integer(options.maxPages, 1, 200)
    && integer(options.maxObjects, 1, 10000) && integer(options.timeoutMs, 1, 40000),
  'CONFIG_INVALID', 'Explicit bounded page, object and timeout limits are required')
  const fetcher = options.fetch ?? globalThis.fetch
  check(typeof fetcher === 'function', 'CONFIG_INVALID', 'Fetch is unavailable')
  return { endpoint: url.href, expectedChainIdentifier: options.expectedChainIdentifier, scope: Object.freeze(scope),
    pageSize: options.pageSize, maxPages: options.maxPages, maxObjects: options.maxObjects, timeoutMs: options.timeoutMs, fetcher }
}

function discardResponse(response: Response) {
  // Best-effort resource cleanup only: never replace the actual request error,
  // and do not wait on a transport's potentially non-settling cancellation.
  try { void response.body?.cancel().catch(() => {}) } catch { /* Preserve the original error. */ }
}

async function jsonBody(response: Response, signal: AbortSignal) {
  const length = response.headers.get('content-length')
  if (length !== null) check(/^[0-9]+$/.test(length) && Number(length) <= RESPONSE_BYTES,
    'RESPONSE_TOO_LARGE', 'GraphQL response exceeds the discovery byte bound')
  check(response.body, 'RESPONSE_INVALID', 'GraphQL returned no response body')
  const reader = response.body.getReader(), parts: Uint8Array[] = []
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      check(size <= RESPONSE_BYTES, 'RESPONSE_TOO_LARGE', 'GraphQL response exceeds the discovery byte bound')
      parts.push(value)
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  catch { throw new ChainObjectDiscoveryError('RESPONSE_INVALID', 'GraphQL returned invalid JSON') }
}

/** Candidate ID discovery only. No object contents, creator, ownership, price,
 * listing validity, or cryptographic proof is returned/attested by this API.
 * The caller must verify every candidate through its actual gRPC/BCS reader.
 * A session holds pagination progress, never a cache of authoritative assets. */
export function createChainObjectDiscovery(options: ChainObjectDiscoveryOptions) {
  const config = configuration(options)
  const seen = new Set<string>()
  const seenCursors = new Set<string>()
  let checkpoint: number | null = null, cursor: string | null = null, pages = 0
  let terminal: 'COMPLETE' | 'LIMIT_REACHED' | null = null, busy = false
  return Object.freeze({
    async next({ signal }: { signal?: AbortSignal } = {}): Promise<ChainObjectDiscoveryPage> {
      check(!busy, 'BUSY', 'A discovery page is already in flight')
      check(!terminal, terminal ?? 'COMPLETE', terminal === 'COMPLETE' ? 'This snapshot scan is complete' : 'This scan reached its explicit limit')
      check(!signal?.aborted, 'ABORTED', 'Discovery was cancelled')
      busy = true
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined, timedOut = false
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      const first = Math.min(config.pageSize, config.maxObjects - seen.size)
      const filter = { type: config.scope.type,
        ...(config.scope.owner ? { ownerKind: config.scope.owner.kind,
          ...('address' in config.scope.owner ? { owner: config.scope.owner.address } : {}) } : {}) }
      const request = async () => {
        const response = await config.fetcher(config.endpoint, { method: 'POST', credentials: 'omit', mode: 'cors',
          redirect: 'error', cache: 'no-store', headers: { 'content-type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ query: QUERY, variables: { checkpoint, filter, first, after: cursor } }) })
        try {
          // A transport can ignore abort and deliver its Response after next()
          // has already rejected. Discard it without parsing or advancing state.
          check(!controller.signal.aborted, timedOut ? 'TIMEOUT' : 'ABORTED', 'Discovery request ended before its response arrived')
          if (!response.ok) throw new ChainObjectDiscoveryError('HTTP', 'GraphQL discovery request failed', response.status)
          return await jsonBody(response, controller.signal)
        } catch (error) {
          discardResponse(response)
          throw error
        }
      }
      try {
        const cancelled = new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new ChainObjectDiscoveryError(
            timedOut ? 'TIMEOUT' : 'ABORTED', timedOut ? 'GraphQL discovery timed out' : 'Discovery was cancelled')), { once: true })
          timer = setTimeout(() => { timedOut = true; controller.abort() }, config.timeoutMs)
        })
        const raw = await Promise.race([cancelled, request()])
        check(!controller.signal.aborted, timedOut ? 'TIMEOUT' : 'ABORTED', 'Discovery request ended before validation')
        check(object(raw), 'RESPONSE_INVALID', 'GraphQL returned an invalid response')
        if ('errors' in raw) {
          check(Array.isArray(raw.errors), 'RESPONSE_INVALID', 'GraphQL returned malformed errors')
          check(raw.errors.length === 0, 'GRAPHQL', 'GraphQL reported discovery errors; no page was accepted')
        }
        check(object(raw.data) && typeof raw.data.chainIdentifier === 'string', 'RESPONSE_INVALID', 'GraphQL returned no chain identity')
        let chainIdentifier: string
        try {
          const bytes = fromBase58(raw.data.chainIdentifier)
          check(bytes.length === 32 && toBase58(bytes) === raw.data.chainIdentifier, 'WRONG_CHAIN', 'Invalid GraphQL genesis identity')
          chainIdentifier = toHex(bytes.slice(0, 4))
        } catch { throw new ChainObjectDiscoveryError('WRONG_CHAIN', 'Invalid GraphQL genesis identity') }
        check(chainIdentifier === config.expectedChainIdentifier, 'WRONG_CHAIN', 'GraphQL does not match the selected release network')
        const cp = raw.data.checkpoint
        check(object(cp) && integer(cp.sequenceNumber, 0, Number.MAX_SAFE_INTEGER) && object(cp.query)
          && object(cp.query.objects), 'RESPONSE_INVALID', 'GraphQL returned no checkpoint-scoped object page')
        check(checkpoint === null || cp.sequenceNumber === checkpoint, 'CHECKPOINT_MISMATCH', 'GraphQL changed the scan checkpoint')
        const result = cp.query.objects, info = result.pageInfo
        check(Array.isArray(result.nodes) && result.nodes.length <= first && object(info) && typeof info.hasNextPage === 'boolean'
          && (info.endCursor === null || typeof info.endCursor === 'string' && info.endCursor.length > 0 && info.endCursor.length <= 4096),
        'RESPONSE_INVALID', 'GraphQL returned malformed object pagination')
        const ids: string[] = []
        const pageIds = new Set<string>()
        for (const node of result.nodes) {
          check(object(node) && id(node.address), 'RESPONSE_INVALID', 'GraphQL returned an invalid candidate object ID')
          check(!seen.has(node.address) && !pageIds.has(node.address), 'DUPLICATE_ID', 'GraphQL repeated an object in this snapshot scan')
          pageIds.add(node.address); ids.push(node.address)
        }
        check(ids.length ? info.endCursor !== null : info.endCursor === null && !info.hasNextPage,
          'CURSOR_NOT_ADVANCING', 'GraphQL returned an empty or cursorless nonterminal page')
        check(info.endCursor === null || !seenCursors.has(info.endCursor as string), 'CURSOR_NOT_ADVANCING', 'GraphQL repeated a pagination cursor')
        // Commit progress only after the entire response is validated. A failure
        // leaves exactly the same cursor/checkpoint for an explicit same-page retry.
        checkpoint = cp.sequenceNumber; cursor = info.endCursor as string | null; pages += 1
        if (cursor !== null) seenCursors.add(cursor)
        for (const candidate of ids) seen.add(candidate)
        terminal = !info.hasNextPage ? 'COMPLETE' : pages >= config.maxPages || seen.size >= config.maxObjects ? 'LIMIT_REACHED' : null
        return Object.freeze({ ids: Object.freeze(ids), source: Object.freeze({ endpoint: config.endpoint, chainIdentifier,
          checkpoint, scope: config.scope, authority: 'CANDIDATE_IDS_ONLY' as const }),
        page: Object.freeze({ status: terminal ?? 'PARTIAL', hasNextPage: info.hasNextPage, endCursor: cursor, pagesRead: pages, objectsRead: seen.size }) })
      } catch (error) {
        if (error instanceof ChainObjectDiscoveryError) throw error
        if (controller.signal.aborted) throw new ChainObjectDiscoveryError(timedOut ? 'TIMEOUT' : 'ABORTED', 'Discovery request ended without a page')
        throw new ChainObjectDiscoveryError('TRANSPORT', 'GraphQL discovery transport failed; no page was accepted')
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); busy = false
      }
    },
  })
}
