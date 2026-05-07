import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, safeStorage } from 'electron'

import { loadDesktopToken } from './desktop-auth-store'

const ENCRYPTED_KEY_FILE = 'agent_api_key.enc'
const KEY_METADATA_FILE = 'agent_api_key.json'
// Rotation staging files. Only `performRotation()` writes these and they are
// promoted into the active slot atomically once the server-side
// `/api/desktop/me/agent-key/rotate/commit` returns 200. `loadAgentApiKey()` /
// `getAgentApiKeyStatus()` deliberately do not read pending files — until
// commit succeeds the server's `apiKeyHash` is still the previously committed
// key, so exposing the pending key as if it were active would hand callers
// credentials that agent API auth will reject.
const PENDING_KEY_FILE = 'agent_api_key.pending.enc'
const PENDING_METADATA_FILE = 'agent_api_key.pending.json'

interface KeyMetadata {
  agentMemberId: string | null
  storedAt: number
  rotationId?: string | null
}

function getStatePath(): string {
  return path.join(app.getPath('userData'), 'state')
}

function getEncryptedKeyPath(): string {
  return path.join(getStatePath(), ENCRYPTED_KEY_FILE)
}

function getMetadataPath(): string {
  return path.join(getStatePath(), KEY_METADATA_FILE)
}

function getPendingKeyPath(): string {
  return path.join(getStatePath(), PENDING_KEY_FILE)
}

function getPendingMetadataPath(): string {
  return path.join(getStatePath(), PENDING_METADATA_FILE)
}

// ── safeStorage 加密层 ──────────────────────────

export function storeAgentApiKey(
  apiKey: string,
  agentMemberId: string | null = null,
  rotationId: string | null = null,
): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this system')
  }

  const encrypted = safeStorage.encryptString(apiKey)
  const dir = getStatePath()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getEncryptedKeyPath(), encrypted)

  const metadata: KeyMetadata = {
    agentMemberId,
    storedAt: Date.now(),
    rotationId,
  }
  fs.writeFileSync(getMetadataPath(), JSON.stringify(metadata, null, 2))
}

export function loadAgentApiKey(): string | null {
  try {
    const encrypted = fs.readFileSync(getEncryptedKeyPath())
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

export function clearAgentApiKey(): void {
  try { fs.unlinkSync(getEncryptedKeyPath()) } catch { /* already gone */ }
  try { fs.unlinkSync(getMetadataPath()) } catch { /* already gone */ }
  // A rotation that crashed between staging and commit can leave pending
  // files on disk. Always sweep them when callers ask to clear the active
  // key, otherwise the next rotation could re-promote stale staged state.
  clearPendingAgentApiKey()
}

/**
 * Stage a freshly-rotated agent API key in the pending slot. The active
 * slot is left untouched until {@link promotePendingAgentApiKey} runs. This
 * keeps the previously-committed key — which is still the server's
 * `apiKeyHash` — usable for agent API auth right up until commit succeeds.
 */
function storePendingAgentApiKey(apiKey: string, rotationId: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this system')
  }
  const encrypted = safeStorage.encryptString(apiKey)
  const dir = getStatePath()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getPendingKeyPath(), encrypted)
  const metadata: KeyMetadata = {
    agentMemberId: null,
    storedAt: Date.now(),
    rotationId,
  }
  fs.writeFileSync(getPendingMetadataPath(), JSON.stringify(metadata, null, 2))
}

/**
 * Promote a successfully-committed pending key into the active slot.
 * Best-effort atomic: each `renameSync` is atomic on POSIX/NTFS for the
 * common case (same-filesystem move). If the metadata rename fails after
 * the enc rename succeeds, the active key file still matches the committed
 * server hash; the metadata is non-authoritative and is rewritten on the
 * next rotation.
 */
function promotePendingAgentApiKey(): void {
  fs.renameSync(getPendingKeyPath(), getEncryptedKeyPath())
  fs.renameSync(getPendingMetadataPath(), getMetadataPath())
}

/**
 * Discard any staged pending key. Called on every commit failure path so
 * the desktop never reports a stored key the server didn't promote.
 */
function clearPendingAgentApiKey(): void {
  try { fs.unlinkSync(getPendingKeyPath()) } catch { /* already gone */ }
  try { fs.unlinkSync(getPendingMetadataPath()) } catch { /* already gone */ }
}

function loadMetadata(): KeyMetadata | null {
  try {
    const raw = fs.readFileSync(getMetadataPath(), 'utf-8')
    return JSON.parse(raw) as KeyMetadata
  } catch {
    return null
  }
}

export function getAgentApiKeyStatus(): {
  hasKey: boolean
  storedAt: number | null
  agentMemberId: string | null
} {
  const key = loadAgentApiKey()
  if (!key) {
    return { hasKey: false, storedAt: null, agentMemberId: null }
  }

  const metadata = loadMetadata()
  return {
    hasKey: true,
    storedAt: metadata?.storedAt ?? null,
    agentMemberId: metadata?.agentMemberId ?? null,
  }
}

// ── Rotation single-flight + write-then-commit ─────────────────

export interface RotationFetcherResponse {
  status: number
  body: unknown
}

export type RotationFetcher = (
  pathname: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<RotationFetcherResponse>

let rotationFetcher: RotationFetcher | null = null

/**
 * Configure how rotate calls reach the web backend. The desktop main process
 * wires this up at startup with a `WEB_BASE_URL`-bound fetcher; tests inject
 * a mock so they don't need network access.
 */
export function configureAgentApiKeyStoreFetcher(fetcher: RotationFetcher | null): void {
  rotationFetcher = fetcher
}

let inflightRotation: Promise<{ ok: true } | { ok: false; error: string }> | null = null

export type RotationResult = { ok: true } | { ok: false; error: string }

interface RotateResponseOk { apiKey: string }
interface RotateResponseInProgress { error: 'rotation_in_progress'; rotationId: string; expiresAt?: string }
interface CommitResponseStale { error: 'stale-rotation' }

function readJsonField<T>(body: unknown, field: string): T | undefined {
  if (body && typeof body === 'object' && field in body) {
    return (body as Record<string, unknown>)[field] as T
  }
  return undefined
}

async function callRotate(
  rotationId: string,
  dtk: string,
): Promise<RotationFetcherResponse> {
  const fetcher = rotationFetcher
  if (!fetcher) {
    throw new Error('Agent api-key rotation fetcher is not configured')
  }
  return fetcher('/api/desktop/me/agent-key/rotate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${dtk}`,
    },
    body: JSON.stringify({ rotationId }),
  })
}

async function callCommit(
  rotationId: string,
  dtk: string,
): Promise<RotationFetcherResponse> {
  const fetcher = rotationFetcher
  if (!fetcher) {
    throw new Error('Agent api-key rotation fetcher is not configured')
  }
  return fetcher('/api/desktop/me/agent-key/rotate/commit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${dtk}`,
    },
    body: JSON.stringify({ rotationId }),
  })
}

async function performRotation(): Promise<RotationResult> {
  const dtk = loadDesktopToken()
  if (!dtk) {
    return { ok: false, error: 'no-desktop-token' }
  }

  // A previous rotation that crashed between staging and commit can leave
  // orphaned pending files. Sweep them up front so we never inherit stale
  // staged state into a fresh rotation.
  try { clearPendingAgentApiKey() } catch { /* best-effort */ }

  let rotationId: string = crypto.randomUUID()

  // Step 1: rotate.
  let rotateRes: RotationFetcherResponse
  try {
    rotateRes = await callRotate(rotationId, dtk)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'rotate-failed' }
  }

  if (rotateRes.status === 401) {
    return { ok: false, error: 'unauthorized' }
  }

  if (rotateRes.status === 409) {
    const errCode = readJsonField<string>(rotateRes.body, 'error')
    const inflightId = readJsonField<string>(rotateRes.body, 'rotationId')
    if (errCode === 'rotation_in_progress' && typeof inflightId === 'string' && inflightId.length > 0) {
      // Retry once with the in-flight rotationId — the server will return the
      // pending apiKey deterministically.
      rotationId = inflightId
      try {
        rotateRes = await callRotate(rotationId, dtk)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'rotate-failed' }
      }
      if (rotateRes.status === 409) {
        return { ok: false, error: 'rotation_conflict' }
      }
    } else {
      return { ok: false, error: 'rotation_conflict' }
    }
  }

  if (rotateRes.status !== 200) {
    const message = readJsonField<string>(rotateRes.body, 'error') ?? `rotate-status-${rotateRes.status}`
    return { ok: false, error: message }
  }

  const rotateBody = rotateRes.body as Partial<RotateResponseOk> | null
  const apiKey = rotateBody && typeof rotateBody === 'object' ? rotateBody.apiKey : undefined
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return { ok: false, error: 'rotate-missing-api-key' }
  }

  // Step 2: stage the new key in the PENDING slot only. The active slot
  // (read by `loadAgentApiKey()`) is intentionally left untouched until
  // commit succeeds, because the server's `apiKeyHash` is still the
  // previously committed key until then. Promoting the pending key
  // pre-commit would mean any commit failure (network drop, 5xx, anything
  // other than `stale-rotation`) leaves the desktop reporting a key that
  // agent API auth will reject — exactly the failure mode this guards
  // against.
  try {
    storePendingAgentApiKey(apiKey, rotationId)
  } catch (err) {
    try { clearPendingAgentApiKey() } catch { /* best-effort */ }
    return { ok: false, error: err instanceof Error ? err.message : 'store-failed' }
  }

  // Step 3: commit.
  let commitRes: RotationFetcherResponse
  try {
    commitRes = await callCommit(rotationId, dtk)
  } catch (err) {
    // Network-class failure between rotate and commit: the active key is
    // still the previously committed (server-valid) key, so just discard
    // the staged pending key. The desktop's stored credentials remain
    // usable until the next successful rotation.
    try { clearPendingAgentApiKey() } catch { /* best-effort */ }
    return { ok: false, error: err instanceof Error ? err.message : 'commit-failed' }
  }

  if (commitRes.status === 200) {
    // Server promoted `pendingApiKeyHash → apiKeyHash`; promote the staged
    // local key into the active slot to match. Only after this point does
    // `loadAgentApiKey()` return the new key.
    try {
      promotePendingAgentApiKey()
    } catch (err) {
      // Promotion failed locally after the server already committed. The
      // server is now ahead of the desktop — the pending file may still
      // exist on disk but `loadAgentApiKey()` keeps returning the old key
      // (which the server no longer accepts). Surface so the caller can
      // re-rotate; the next rotation's deterministic-hash retry path will
      // converge.
      try { clearPendingAgentApiKey() } catch { /* best-effort */ }
      return { ok: false, error: err instanceof Error ? err.message : 'promote-failed' }
    }
    return { ok: true }
  }

  if (commitRes.status === 409) {
    const errCode = readJsonField<string>(commitRes.body, 'error')
    if (errCode === 'stale-rotation') {
      // Server's pending rotation expired between rotate and commit. The
      // server kept the previously committed key, so the active local key
      // is still server-valid; only the staged pending key needs to be
      // discarded. (Pre-fix this also wiped the active key, which left a
      // user with a still-valid server-side key but no local copy.)
      try { clearPendingAgentApiKey() } catch { /* best-effort */ }
      return { ok: false, error: 'stale-rotation' }
    }
    try { clearPendingAgentApiKey() } catch { /* best-effort */ }
    return { ok: false, error: errCode ?? 'commit-conflict' }
  }

  if (commitRes.status === 401) {
    try { clearPendingAgentApiKey() } catch { /* best-effort */ }
    return { ok: false, error: 'unauthorized' }
  }

  // Any other non-success commit response (e.g. 5xx) — discard the staged
  // pending key so `loadAgentApiKey()` keeps returning the previously
  // committed key the server still recognises.
  try { clearPendingAgentApiKey() } catch { /* best-effort */ }
  const commitErr = readJsonField<string>(commitRes.body, 'error')
  return { ok: false, error: commitErr ?? `commit-status-${commitRes.status}` }
}

/**
 * Rotate the desktop pet's agent API key.
 *
 * Single-flight: parallel callers receive the SAME promise. The server's
 * deterministic-HMAC contract makes this safe — concurrent rotates with the
 * same rotationId produce the same `sk-*` — but we still dedupe to keep the
 * write-then-commit ordering simple.
 */
export async function rotateAgentApiKey(): Promise<RotationResult> {
  if (inflightRotation) {
    return inflightRotation
  }

  const promise = performRotation().finally(() => {
    inflightRotation = null
  })
  inflightRotation = promise
  return promise
}
