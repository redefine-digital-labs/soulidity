/**
 * Pure helper for the `desktop-auth:unlink` IPC.
 *
 * Unlink semantics ("disconnect this device from my account, but keep the
 * pet identity so I can re-link the same agent address later"):
 *  - If a `dtk_*` is present, FIRST call `/api/desktop/me/revoke` so the
 *    server-side `DesktopPet` row + bound agent `Member` are torn down. We
 *    treat the response as "server-side state matches what we want" — and
 *    therefore clear local desktop credentials — for any of:
 *      * 200 — explicit revoke. The revoke endpoint accepts bearer tokens
 *        past the 90-day rotation window, so this also covers the
 *        "stale token but pet still exists" case.
 *      * 401 — no pet row matches this token hash. Uniquely means the pet
 *        is already gone server-side (e.g. user deleted it via
 *        `/account/pets`, or a previous revoke already succeeded).
 *      * 404 — pet row was deleted concurrently between auth and revoke.
 *    Network failures and 5xx remain fail-closed: the user must retry
 *    online so we don't drop a locally-still-valid identity that the
 *    server still owns.
 *  - If no `dtk_*` is present, this is a local-only unlink. Clear the
 *    desktop token + agent API key files defensively.
 *  - On success, clear in this order:
 *      1. desktop access token (best-effort — file is inert post-revoke)
 *      2. agent API key (best-effort — same self-healing rationale)
 *  - Crucially, the agent KEYPAIR is *not* cleared on this path. The
 *    `WalletBinding` is preserved server-side by `revokeDesktopPet()`, so
 *    keeping the local keypair lets the next device-link reuse the same
 *    agent address (same `pet`). Callers that want to mint a fresh agent
 *    identity must use `performAgentResetIdentity()` instead.
 *
 * Pure: takes injected deps so tests can drive it without Electron / fetch.
 *
 * Mirrors `agent-reset-identity.ts` deliberately (same revoke status
 * semantics, same fail-closed behavior on 5xx / network drop) so the two
 * paths converge on the same server-side teardown contract.
 */

export interface UnlinkFetcherResponse {
  status: number
  body: unknown
}

export type UnlinkFetcher = (
  pathname: string,
  init: { method: 'POST'; headers: Record<string, string> },
) => Promise<UnlinkFetcherResponse>

export interface UnlinkDeps {
  loadDesktopToken: () => string | null
  fetcher: UnlinkFetcher
  clearDesktopToken: () => void
  clearAgentApiKey: () => void
}

export type UnlinkResult =
  | { ok: true; remoteRevoked: boolean }
  | { ok: false; error: string; status?: number }

export async function performAgentUnlink(deps: UnlinkDeps): Promise<UnlinkResult> {
  const dtk = deps.loadDesktopToken()

  if (dtk) {
    let response: UnlinkFetcherResponse
    try {
      response = await deps.fetcher('/api/desktop/me/revoke', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${dtk}`,
        },
      })
    } catch (err) {
      // Network / DNS / fetch threw — treat as remote-revoke-failed. Do NOT
      // clear local credentials; user must retry online so we don't strand
      // a locally-still-valid identity that the server might still own.
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'remote-revoke-failed',
      }
    }

    if (!isAlreadyRevokedStatus(response.status)) {
      return {
        ok: false,
        error: 'remote-revoke-failed',
        status: response.status,
      }
    }

    // Remote revoke succeeded (200) or the pet was already gone server-side
    // (401 / 404). Clear local desktop credentials best-effort. The keypair
    // is intentionally preserved — see file-level docs.
    clearDesktopCredentials(deps)
    return { ok: true, remoteRevoked: true }
  }

  // No `dtk_*` on disk — local-only unlink. Still clear the desktop token
  // + agent API key files defensively (in case a partial state was left
  // behind by a crashed link). The keypair stays.
  clearDesktopCredentials(deps)
  return { ok: true, remoteRevoked: false }
}

function clearDesktopCredentials(deps: UnlinkDeps): void {
  // Token + API-key files self-heal: the next successful link overwrites
  // them, and any stale bearer 401s server-side. Failures here are logged
  // but non-fatal — both `clearDesktopToken` and `clearAgentApiKey` already
  // swallow ENOENT internally; this catch covers EPERM/EBUSY/etc. on the
  // unlink path so a transient FS error doesn't flip ok=false after the
  // server-side revoke already succeeded.
  safeClear(deps.clearDesktopToken, 'clearDesktopToken')
  safeClear(deps.clearAgentApiKey, 'clearAgentApiKey')
}

function safeClear(fn: () => void, label: string): void {
  try {
    fn()
  } catch (err) {
    console.warn(`[desktop-auth:unlink] ${label} failed (ignoring):`, err)
  }
}

function isAlreadyRevokedStatus(status: number): boolean {
  // 200 = explicit revoke; 401 = dtk no longer authenticates (pet row gone);
  // 404 = pet row deleted between auth and revoke. All three mean the
  // server-side state already matches the post-unlink target.
  return status === 200 || status === 401 || status === 404
}
