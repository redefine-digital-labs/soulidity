import { fromBase58, normalizeStructTag, parseStructTag, toBase58, toHex } from '@mysten/sui/utils'

export interface ChainEventDiscoveryScope {
  /** Original/type-origin package ID from the selected release, not an upgrade's callable ID. */
  packageId: string
  /** Exact canonical, non-generic event type. Package/module-wide and generic queries are not accepted. */
  type: string
  /** Exclusive lower checkpoint bound; omit to scan the full event family. */
  afterCheckpoint?: number
}
export interface ChainEventDiscoveryOptions {
  endpoint: string
  /** Existing release identity: eight lowercase hex characters, genesis digest's first four bytes. */
  expectedChainIdentifier: string
  scope: ChainEventDiscoveryScope
  /** Share one snapshot across event-family scans; otherwise freeze the first accepted page. */
  checkpoint?: number
  pageSize: number
  maxPages: number
  maxEvents: number
  timeoutMs: number
  fetch?: typeof globalThis.fetch
}
export interface ChainEventDiscoveryCandidate {
  readonly transactionDigest: string
  /** Position in this transaction, not a globally unique event number. */
  readonly eventSequence: number
  readonly type: string
}
export interface ChainEventDiscoveryPage {
  readonly events: readonly ChainEventDiscoveryCandidate[]
  readonly source: Readonly<{
    endpoint: string
    chainIdentifier: string
    checkpoint: number
    scope: Readonly<ChainEventDiscoveryScope>
    authority: 'CANDIDATE_EVENTS_ONLY'
  }>
  readonly page: Readonly<{
    status: 'PARTIAL' | 'COMPLETE' | 'LIMIT_REACHED'
    hasNextPage: boolean
    endCursor: string | null
    pagesRead: number
    eventsRead: number
  }>
}
export type ChainEventDiscoveryErrorCode = 'CONFIG_INVALID' | 'BUSY' | 'COMPLETE' | 'LIMIT_REACHED'
  | 'ABORTED' | 'TIMEOUT' | 'TRANSPORT' | 'HTTP' | 'GRAPHQL' | 'RESPONSE_INVALID' | 'RESPONSE_TOO_LARGE'
  | 'WRONG_CHAIN' | 'CHECKPOINT_MISMATCH' | 'DUPLICATE_EVENT' | 'CURSOR_NOT_ADVANCING'
export class ChainEventDiscoveryError extends Error {
  readonly name = 'ChainEventDiscoveryError'
  constructor(readonly code: ChainEventDiscoveryErrorCode, message: string, readonly httpStatus?: number) {
    super(message)
  }
}
function check(condition: unknown, code: ChainEventDiscoveryErrorCode, message: string): asserts condition {
  if (!condition) throw new ChainEventDiscoveryError(code, message)
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every(key => allowed.includes(key))
}
// The approved grant, ownership and purchase event families are non-generic.
// Do not use SDK struct-tag parsing as Move Identifier validation: it accepts
// invalid identifiers (including a lone underscore) and malformed suffixes.
const EVENT_TYPE = /^0x[0-9a-f]{1,64}::(?:[a-zA-Z][a-zA-Z0-9_]*|_[a-zA-Z0-9_]+)::(?:[a-zA-Z][a-zA-Z0-9_]*|_[a-zA-Z0-9_]+)$/
function eventType(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2048 && EVENT_TYPE.exec(value)?.[0] === value
}
function sameType(value: unknown, expected: string) {
  // GraphQL's repr shortens addresses; selected-release types stay canonical.
  if (!eventType(value)) return false
  try { return normalizeStructTag(value) === expected } catch { return false }
}
const id = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
const RESPONSE_BYTES = 128 * 1024
const QUERY = `query ChainEventDiscovery($checkpoint:UInt53,$filter:EventFilter!,$first:Int!,$after:String) {
  chainIdentifier
  checkpoint(sequenceNumber:$checkpoint) {
    sequenceNumber
    query { events(first:$first,after:$after,filter:$filter) {
      nodes { sequenceNumber transaction { digest } contents { type { repr } } }
      pageInfo { hasNextPage endCursor }
    } }
  }
}`

function configuration(options: ChainEventDiscoveryOptions) {
  check(object(options) && typeof options.endpoint === 'string', 'CONFIG_INVALID', 'An explicit public GraphQL endpoint is required')
  let url: URL
  try { url = new URL(options.endpoint) } catch { throw new ChainEventDiscoveryError('CONFIG_INVALID', 'Invalid GraphQL endpoint') }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && url.href === options.endpoint
    && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(url.hostname)
    && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname),
  'CONFIG_INVALID', 'GraphQL requires a canonical credential-free public HTTPS URL')
  check(typeof options.expectedChainIdentifier === 'string' && /^[0-9a-f]{8}$/.test(options.expectedChainIdentifier),
    'CONFIG_INVALID', 'Expected chain identifier must match the selected release eight-hex identity')
  let scope: ChainEventDiscoveryScope
  try { scope = structuredClone(options.scope) }
  catch { throw new ChainEventDiscoveryError('CONFIG_INVALID', 'Event scope must be serializable release data') }
  check(object(scope) && exactKeys(scope, ['packageId', 'type', 'afterCheckpoint']) && id(scope.packageId)
    && eventType(scope.type),
  'CONFIG_INVALID', 'Invalid release-selected event scope')
  try {
    const tag = parseStructTag(scope.type)
    check(tag.address === scope.packageId && normalizeStructTag(scope.type) === scope.type,
    'CONFIG_INVALID', 'An exact canonical non-generic event type from the selected original package is required')
  } catch { throw new ChainEventDiscoveryError('CONFIG_INVALID', 'An exact canonical non-generic event type from the selected original package is required') }
  check(scope.afterCheckpoint === undefined || integer(scope.afterCheckpoint, 0, Number.MAX_SAFE_INTEGER),
    'CONFIG_INVALID', 'Invalid exclusive start checkpoint')
  check(options.checkpoint === undefined || integer(options.checkpoint, 0, Number.MAX_SAFE_INTEGER),
    'CONFIG_INVALID', 'Invalid pinned checkpoint')
  check(options.checkpoint === undefined || scope.afterCheckpoint === undefined || scope.afterCheckpoint < options.checkpoint,
    'CONFIG_INVALID', 'The exclusive start checkpoint must precede the snapshot')
  check(integer(options.pageSize, 1, 50) && integer(options.maxPages, 1, 200)
    && integer(options.maxEvents, 1, 10000) && integer(options.timeoutMs, 1, 40000),
  'CONFIG_INVALID', 'Explicit bounded page, event and timeout limits are required')
  const fetcher = options.fetch ?? globalThis.fetch
  check(typeof fetcher === 'function', 'CONFIG_INVALID', 'Fetch is unavailable')
  return { endpoint: url.href, expectedChainIdentifier: options.expectedChainIdentifier, scope: Object.freeze(scope),
    checkpoint: options.checkpoint ?? null, pageSize: options.pageSize, maxPages: options.maxPages, maxEvents: options.maxEvents, timeoutMs: options.timeoutMs, fetcher }
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
  catch { throw new ChainEventDiscoveryError('RESPONSE_INVALID', 'GraphQL returned invalid JSON') }
}

/** Candidate event discovery only: no payload, status, timestamp or cryptographic
 * proof is attested here. Verify the transaction/effects/events/checkpoint using
 * gRPC and raw BCS before using any candidate as activity.
 * Scans the entire exact event-type family, without a sender/owner/wallet filter.
 * In particular, received grants cannot be discovered by filtering tx sender.
 * COMPLETE means the index exhausted this scope, not certified ledger completeness. */
export function createChainEventDiscovery(options: ChainEventDiscoveryOptions) {
  const config = configuration(options)
  const seen = new Set<string>()
  const seenCursors = new Set<string>()
  let checkpoint: number | null = config.checkpoint, cursor: string | null = null, pages = 0
  let terminal: 'COMPLETE' | 'LIMIT_REACHED' | null = null, busy = false
  return Object.freeze({
    async next({ signal }: { signal?: AbortSignal } = {}): Promise<ChainEventDiscoveryPage> {
      check(!busy, 'BUSY', 'A discovery page is already in flight')
      check(!terminal, terminal ?? 'COMPLETE', terminal === 'COMPLETE' ? 'This snapshot scan is complete' : 'This scan reached its explicit limit')
      check(!signal?.aborted, 'ABORTED', 'Discovery was cancelled')
      busy = true
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined, timedOut = false
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      const first = Math.min(config.pageSize, config.maxEvents - seen.size)
      const filter = { type: config.scope.type,
        ...(config.scope.afterCheckpoint !== undefined ? { afterCheckpoint: config.scope.afterCheckpoint } : {}) }
      const request = async () => {
        // Native browser fetch cannot use this configuration object as its receiver.
        const { fetcher } = config
        const response = await fetcher(config.endpoint, { method: 'POST', credentials: 'omit', mode: 'cors',
          redirect: 'error', cache: 'no-store', headers: { 'content-type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ query: QUERY, variables: { checkpoint, filter, first, after: cursor } }) })
        try {
          // A transport can ignore abort and deliver its Response after next()
          // has already rejected. Discard it without parsing or advancing state.
          check(!controller.signal.aborted, timedOut ? 'TIMEOUT' : 'ABORTED', 'Discovery request ended before its response arrived')
          if (!response.ok) throw new ChainEventDiscoveryError('HTTP', 'GraphQL discovery request failed', response.status)
          return await jsonBody(response, controller.signal)
        } catch (error) {
          discardResponse(response)
          throw error
        }
      }
      try {
        const cancelled = new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new ChainEventDiscoveryError(
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
          check(raw.data.chainIdentifier.length <= 44, 'WRONG_CHAIN', 'Invalid GraphQL genesis identity')
          const bytes = fromBase58(raw.data.chainIdentifier)
          check(bytes.length === 32 && toBase58(bytes) === raw.data.chainIdentifier, 'WRONG_CHAIN', 'Invalid GraphQL genesis identity')
          chainIdentifier = toHex(bytes.slice(0, 4))
        } catch { throw new ChainEventDiscoveryError('WRONG_CHAIN', 'Invalid GraphQL genesis identity') }
        check(chainIdentifier === config.expectedChainIdentifier, 'WRONG_CHAIN', 'GraphQL does not match the selected release network')
        const cp = raw.data.checkpoint
        check(object(cp) && integer(cp.sequenceNumber, 0, Number.MAX_SAFE_INTEGER) && object(cp.query)
          && object(cp.query.events), 'RESPONSE_INVALID', 'GraphQL returned no checkpoint-scoped event page')
        check(checkpoint === null || cp.sequenceNumber === checkpoint, 'CHECKPOINT_MISMATCH', 'GraphQL changed the scan checkpoint')
        check(config.scope.afterCheckpoint === undefined || cp.sequenceNumber > config.scope.afterCheckpoint,
          'CHECKPOINT_MISMATCH', 'GraphQL snapshot does not follow the exclusive start checkpoint')
        const result = cp.query.events, info = result.pageInfo
        check(Array.isArray(result.nodes) && result.nodes.length <= first && object(info) && typeof info.hasNextPage === 'boolean'
          && (info.endCursor === null || typeof info.endCursor === 'string' && info.endCursor.length > 0 && info.endCursor.length <= 4096),
        'RESPONSE_INVALID', 'GraphQL returned malformed event pagination')
        const events: ChainEventDiscoveryCandidate[] = []
        const pageIds = new Set<string>()
        for (const node of result.nodes) {
          check(object(node) && object(node.transaction) && typeof node.transaction.digest === 'string'
            && node.transaction.digest.length <= 44 && integer(node.sequenceNumber, 0, Number.MAX_SAFE_INTEGER)
            && object(node.contents) && object(node.contents.type) && sameType(node.contents.type.repr, config.scope.type),
          'RESPONSE_INVALID', 'GraphQL returned an invalid or out-of-scope candidate event')
          let digest: Uint8Array
          try { digest = fromBase58(node.transaction.digest) }
          catch { throw new ChainEventDiscoveryError('RESPONSE_INVALID', 'GraphQL returned an invalid transaction digest') }
          check(digest.length === 32 && toBase58(digest) === node.transaction.digest,
            'RESPONSE_INVALID', 'GraphQL returned an invalid transaction digest')
          const key = `${node.transaction.digest}:${node.sequenceNumber}`
          check(!seen.has(key) && !pageIds.has(key), 'DUPLICATE_EVENT', 'GraphQL repeated an event in this snapshot scan')
          pageIds.add(key)
          events.push(Object.freeze({ transactionDigest: node.transaction.digest, eventSequence: node.sequenceNumber, type: config.scope.type }))
        }
        check(events.length ? info.endCursor !== null : info.endCursor === null && !info.hasNextPage,
          'CURSOR_NOT_ADVANCING', 'GraphQL returned an empty or cursorless nonterminal page')
        check(info.endCursor === null || !seenCursors.has(info.endCursor as string), 'CURSOR_NOT_ADVANCING', 'GraphQL repeated a pagination cursor')
        // Commit progress only after the entire response is validated. A failure
        // leaves exactly the same cursor/checkpoint for an explicit same-page retry.
        checkpoint = cp.sequenceNumber; cursor = info.endCursor as string | null; pages += 1
        if (cursor !== null) seenCursors.add(cursor)
        for (const key of pageIds) seen.add(key)
        terminal = !info.hasNextPage ? 'COMPLETE' : pages >= config.maxPages || seen.size >= config.maxEvents ? 'LIMIT_REACHED' : null
        return Object.freeze({ events: Object.freeze(events), source: Object.freeze({ endpoint: config.endpoint, chainIdentifier,
          checkpoint, scope: config.scope, authority: 'CANDIDATE_EVENTS_ONLY' as const }),
        page: Object.freeze({ status: terminal ?? 'PARTIAL', hasNextPage: info.hasNextPage, endCursor: cursor, pagesRead: pages, eventsRead: seen.size }) })
      } catch (error) {
        if (error instanceof ChainEventDiscoveryError) throw error
        if (controller.signal.aborted) throw new ChainEventDiscoveryError(timedOut ? 'TIMEOUT' : 'ABORTED', 'Discovery request ended without a page')
        throw new ChainEventDiscoveryError('TRANSPORT', 'GraphQL discovery transport failed; no page was accepted')
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); busy = false
      }
    },
  })
}
