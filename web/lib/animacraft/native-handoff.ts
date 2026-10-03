export const NATIVE_RECEIVER_SCHEMA = 'animacraft.native-receiver.v1' as const
const PROD_ORIGIN = 'https://animacraft.soulidity.ai'
const ID = /^0x[0-9a-f]{64}$/
const NONCE = /^[0-9a-f]{32}$/
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const id = (v: unknown): v is string => typeof v === 'string' && ID.test(v) && !/^0x0+$/.test(v)
export interface NativeHandoff { source: string; root: string; owner: string; returnOrigin: string; returnNonce: string }
export function trustedNativeOrigin(environment = process.env.NODE_ENV, override = process.env.NEXT_PUBLIC_ANIMACRAFT_ORIGIN): string {
  if (environment !== 'development' || !override) return PROD_ORIGIN
  try {
    const url = new URL(override)
    if (url.origin !== override || url.username || url.password) return ''
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return url.origin
  } catch { /* Invalid explicit configuration must fail closed. */ }
  return ''
}
export function validNativeHandoff(handoff: NativeHandoff, origin = trustedNativeOrigin()): boolean {
  return !!origin && handoff.source === 'animacraft-v8' && id(handoff.root) && id(handoff.owner)
    && handoff.returnOrigin === origin && NONCE.test(handoff.returnNonce)
}
export interface NativeRequest {
  schemaVersion: typeof NATIVE_RECEIVER_SCHEMA; type: 'PREFLIGHT' | 'SYNC'; requestId: string; nonce: string; rootId: string; signer: string
  payload?: { txDigest: string; soulOnChainId: string; contentSidecars: unknown[] }
}
function validSidecar(value: unknown): boolean {
  if (!record(value) || !exact(value, ['kind', 'name', 'versionIndex', 'sidecar']) || !Number.isInteger(value.kind)
    || ![0, 1, 2].includes(value.kind as number) || typeof value.name !== 'string' || !value.name || value.versionIndex !== 0) return false
  const s = value.sidecar
  return record(s) && exact(s, ['version', 'mode', 'sealPackageId', 'documentId', 'encryptedDek', 'iv', 'cipher', 'mimeType', 'fileName', 'contentHash'])
    && s.version === 1 && s.mode === 'seal-envelope' && s.cipher === 'AES-GCM-256' && id(s.sealPackageId)
    && ['documentId', 'encryptedDek', 'iv', 'mimeType', 'fileName'].every(k => typeof s[k] === 'string' && !!s[k])
    && typeof s.contentHash === 'string' && /^[0-9a-f]{64}$/.test(s.contentHash)
}
export function parseNativeRequest(value: unknown, handoff: NativeHandoff): NativeRequest | null {
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 512 * 1024 || !record(value)) return null
    const keys = ['schemaVersion', 'type', 'requestId', 'nonce', 'rootId', 'signer']
    if (value.type === 'SYNC') keys.push('payload')
    if (!exact(value, keys) || value.schemaVersion !== NATIVE_RECEIVER_SCHEMA || !['PREFLIGHT', 'SYNC'].includes(value.type as string)
      || typeof value.requestId !== 'string' || !NONCE.test(value.requestId) || value.nonce !== handoff.returnNonce
      || value.rootId !== handoff.root || value.signer !== handoff.owner) return null
    if (value.type === 'SYNC') {
      const p = value.payload
      if (!record(p) || !exact(p, ['txDigest', 'soulOnChainId', 'contentSidecars']) || typeof p.txDigest !== 'string'
        || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(p.txDigest) || !id(p.soulOnChainId)
        || !Array.isArray(p.contentSidecars) || p.contentSidecars.length !== 3 || !p.contentSidecars.every(validSidecar)
        || new Set(p.contentSidecars.map(s => `${s.kind}:${s.name}`)).size !== 3) return null
    }
    return structuredClone(value) as unknown as NativeRequest
  } catch { return null }
}
export function nativeMessageRequest(event: Pick<MessageEvent, 'source' | 'origin' | 'data'>, opener: unknown, handoff: NativeHandoff, origin = trustedNativeOrigin()): NativeRequest | null {
  if (!opener || event.source !== opener || event.origin !== origin || !validNativeHandoff(handoff, origin)) return null
  return parseNativeRequest(event.data, handoff)
}
export async function receiveNativeRequest(input: NativeRequest, verify: (request: NativeRequest) => Promise<unknown>) {
  const request = structuredClone(input)
  const responseScope = { schemaVersion: NATIVE_RECEIVER_SCHEMA, type: 'RESPONSE' as const, requestId: request.requestId, nonce: request.nonce, rootId: request.rootId, signer: request.signer }
  try {
    const result = await verify(structuredClone(request))
    if (!record(result) || (request.type === 'PREFLIGHT' ? result.ready !== true || result.rootId !== request.rootId || result.signer !== request.signer
      : result.status !== 'COMPLETE' || result.soulId !== request.payload?.soulOnChainId || result.transactionDigest !== request.payload?.txDigest)) {
      return { ...responseScope, error: { code: 'RECEIVE_NOT_READY', message: 'Chain verification is not complete. Retry this request.' } }
    }
    return { ...responseScope, result: request.type === 'PREFLIGHT' ? { ready: true, rootId: request.rootId, signer: request.signer } : { status: 'COMPLETE', soulId: result.soulId as string, transactionDigest: result.transactionDigest as string } }
  } catch (error) {
    const code = record(error) && error.code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED'
      : record(error) && error.code === 'NATIVE_RECEIVE_ENVELOPE_PENDING' ? 'NATIVE_RECEIVE_ENVELOPE_PENDING' : 'RECEIVE_RETRY_REQUIRED'
    return { ...responseScope, error: { code, message: code === 'AUTH_REQUIRED' ? 'Connect the same wallet and retry verification.'
      : code === 'NATIVE_RECEIVE_ENVELOPE_PENDING' ? 'Soul mint is complete. Resume encrypted-content finalization in Animacraft; do not mint again.'
        : 'Verification is unavailable. Retry this request.' } }
  }
}

/** Duplicate bridge retries share one chain read; changed requests cannot reuse an ID. */
export function createNativeRequestCache() {
  type Response = Awaited<ReturnType<typeof receiveNativeRequest>>
  const entries = new Map<string, { fingerprint: string; type: NativeRequest['type']; promise: Promise<Response>; settled: boolean }>()
  return { async run(request: NativeRequest, operation: () => Promise<Response>, retry = false): Promise<Response | null> {
    const fingerprint = JSON.stringify(request)
    const previous = entries.get(request.requestId)
    if (previous && previous.fingerprint !== fingerprint) return null
    if (previous && (!retry || !previous.settled)) return previous.promise
    if (!previous && entries.size >= 64) {
      const disposable = [...entries].find(([, entry]) => entry.settled && entry.type === 'PREFLIGHT')
      if (disposable) entries.delete(disposable[0])
      else return { schemaVersion: NATIVE_RECEIVER_SCHEMA, type: 'RESPONSE', requestId: request.requestId,
        nonce: request.nonce, rootId: request.rootId, signer: request.signer,
        error: { code: 'RECEIVER_BUSY', message: 'Receiver recovery capacity is busy. Retry this request later.' } }
    }
    const entry = { fingerprint, type: request.type, promise: Promise.resolve().then(operation), settled: false }
    entries.set(request.requestId, entry)
    try { return await entry.promise } finally { entry.settled = true }
  } }
}

export function nativeReceiverScope(handoff: NativeHandoff, account: { id: string; primarySuiAddress: string | null } | null, loading: boolean): string {
  return JSON.stringify([handoff.source, handoff.root, handoff.owner, handoff.returnOrigin, handoff.returnNonce,
    account?.id ?? null, account?.primarySuiAddress ?? null, loading])
}
type NativeResponse = Awaited<ReturnType<typeof receiveNativeRequest>>
export type NativeReceiverView = {
  status: 'waiting' | 'checking' | 'retryRequired' | 'ready' | 'complete'
  soulId: string | null; last: NativeRequest | null; pending: boolean; errorMessage: string | null
}
/** The page and tests share this generation-bound async lifecycle, including retries. */
export function createNativeReceiverSession() {
  let scope: string | null = null
  let generation = 0
  let cache = createNativeRequestCache()
  let pending = 0
  let view: NativeReceiverView = { status: 'waiting', soulId: null, last: null, pending: false, errorMessage: null }
  return {
    setScope(next: string) {
      if (scope === next) return
      scope = next; generation++; cache = createNativeRequestCache(); pending = 0
      view = { status: 'waiting', soulId: null, last: null, pending: false, errorMessage: null }
    },
    dispose() { scope = null; generation++; pending = 0 },
    matchesScope(expected: string) { return scope === expected },
    snapshot(): NativeReceiverView { return structuredClone(view) },
    async run(request: NativeRequest, operation: () => Promise<NativeResponse>,
      publish: (response: NativeResponse) => void, changed: () => void, retry = false) {
      if (scope === null) return
      const started = generation
      const submitted = structuredClone(request)
      pending++; view = { ...view, pending: true, status: view.status === 'complete'
        || (submitted.type === 'PREFLIGHT' && view.last?.type === 'SYNC') ? view.status : 'checking' }; changed()
      try {
        const response = await cache.run(submitted, operation, retry)
        if (generation !== started || !response) return
        // Each request receives its own result even when a later SYNC already completed.
        publish(response)
        if (view.status === 'complete' && submitted.type === 'PREFLIGHT') return
        if (view.last?.type === 'SYNC' && submitted.type === 'PREFLIGHT') return
        view = { ...view, last: submitted }
        if ('error' in response) view = { ...view, status: 'retryRequired', errorMessage: response.error.message }
        else if (submitted.type === 'SYNC' && typeof response.result.soulId === 'string') {
          view = { ...view, soulId: response.result.soulId, status: 'complete', errorMessage: null }
        } else view = { ...view, status: 'ready', errorMessage: null }
      } finally {
        if (generation === started) { pending--; view = { ...view, pending: pending > 0 }; changed() }
      }
    },
  }
}
