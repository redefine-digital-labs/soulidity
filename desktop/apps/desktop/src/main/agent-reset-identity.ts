/**
 * Pure helper for the `agent:reset-identity` IPC.
 *
 * Reset semantics (the "换 pet 身份" path):
 *  - If a `dtk_*` is present, FIRST call `/api/desktop/me/revoke` so the
 *    server-side `DesktopPet` + agent member are torn down. We treat the
 *    response as "server-side state matches what we want" — and therefore
 *    clear local credentials — for any of:
 *      * 200 — the server explicitly revoked. The revoke endpoint accepts
 *        bearer tokens past the 90-day rotation window, so this also
 *        covers the "stale token but pet still exists" case (server
 *        finishes the tear-down on this call).
 *      * 401 — no pet row matches this token hash. This uniquely means
 *        the pet is already gone server-side (e.g. the user deleted it
 *        via `/account/pets`, or a previous revoke succeeded and we are
 *        retrying). The revoke endpoint's `allowExpiredDesktopToken: true`
 *        is what makes this invariant hold: an expired token whose pet
 *        still exists yields 200 (the revoke succeeds) instead of 401, so
 *        a 401 here cannot misclassify "stale token + active pet" as
 *        "pet already gone". Without clearing local state on this branch,
 *        the desktop's keypair / api key / token would be permanently
 *        orphaned and the next link would resurrect the same agent
 *        address instead of minting fresh identity, breaking the "换 pet
 *        身份" promise.
 *      * 404 — pet row was deleted concurrently between auth and revoke.
 *    Network failures and 5xx remain fail-closed: the user must retry
 *    online so we don't wipe a locally-still-valid identity that the server
 *    might still own.
 *  - If no `dtk_*` is present, this is a local-only reset. Still wipe every
 *    local file defensively (a rogue keypair / api key without a token
 *    shouldn't exist, but we don't want to leave it).
 *  - On success, clear in this order:
 *      1. desktop access token (best-effort — file is inert post-revoke; the
 *         server-side pet row is gone so a leftover bearer 401s on next call,
 *         and the next link overwrites it)
 *      2. agent API key (best-effort — same self-healing rationale)
 *      3. agent keypair (metadata + encrypted secret + legacy plaintext) —
 *         STRICT. The metadata file is the only reset-critical credential:
 *         `device:start-link` calls `loadAgentKeypair()` first and reuses the
 *         existing identity if metadata is readable, so a swallowed unlink
 *         failure here would silently resurrect the same on-chain agent
 *         address on the next link instead of minting a fresh pet identity.
 *         If `clearAgentKeypair` throws (non-ENOENT unlink failure) we
 *         propagate it as `local-cleanup-failed` even when the remote revoke
 *         succeeded — the user must retry to actually reset.
 *
 * Pure: takes injected deps so tests can drive it without Electron / fetch.
 */

export interface ResetIdentityFetcherResponse {
  status: number
  body: unknown
}

export type ResetIdentityFetcher = (
  pathname: string,
  init: { method: 'POST'; headers: Record<string, string> },
) => Promise<ResetIdentityFetcherResponse>

export interface ResetIdentityDeps {
  loadDesktopToken: () => string | null
  fetcher: ResetIdentityFetcher
  clearDesktopToken: () => void
  clearAgentApiKey: () => void
  clearAgentKeypair: () => void
}

export type ResetIdentityResult =
  | { ok: true; remoteRevoked: boolean }
  | { ok: false; error: string; status?: number }

export async function performAgentResetIdentity(
  deps: ResetIdentityDeps,
): Promise<ResetIdentityResult> {
  const dtk = deps.loadDesktopToken()

  if (dtk) {
    let response: ResetIdentityFetcherResponse
    try {
      response = await deps.fetcher('/api/desktop/me/revoke', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${dtk}`,
        },
      })
    } catch (err) {
      // Network / dev-tools-disabled / DNS — treat as remote-revoke-failed.
      // Do NOT clear local credentials; user must retry online.
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
    // (401 = dtk no longer authenticates → pet deleted from /account/pets;
    // 404 = pet deleted concurrently). Token / API-key clears are best-effort
    // (their files are inert once the server has disowned the pet); the
    // keypair clear is strict because leftover metadata would resurrect the
    // same agent identity on the next link.
    const cleanup = clearLocalCredentials(deps)
    if (!cleanup.ok) {
      return { ok: false, error: cleanup.error }
    }

    return { ok: true, remoteRevoked: true }
  }

  // No `dtk_*` on disk — local-only reset. Still clear everything so we
  // don't leave a stray keypair or apiKey lingering after a partial unlink.
  const cleanup = clearLocalCredentials(deps)
  if (!cleanup.ok) {
    return { ok: false, error: cleanup.error }
  }

  return { ok: true, remoteRevoked: false }
}

function clearLocalCredentials(
  deps: ResetIdentityDeps,
): { ok: true } | { ok: false; error: string } {
  // Token + API-key files self-heal: the next successful link overwrites
  // them, and any stale bearer 401s server-side. Failures here are logged
  // but non-fatal.
  safeClear(deps.clearDesktopToken, 'clearDesktopToken')
  safeClear(deps.clearAgentApiKey, 'clearAgentApiKey')

  // Keypair clear is strict. `clearAgentKeypair` only swallows ENOENT and
  // re-throws any other unlink failure (EPERM/EBUSY/...). Surface that as
  // a typed local-cleanup failure so the caller does NOT broadcast "no
  // keypair" while the metadata file is still readable on disk.
  try {
    deps.clearAgentKeypair()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.warn('[agent:reset-identity] clearAgentKeypair failed:', err)
    return { ok: false, error: `local-cleanup-failed: ${detail}` }
  }

  return { ok: true }
}

function safeClear(fn: () => void, label: string): void {
  try {
    fn()
  } catch (err) {
    console.warn(`[agent:reset-identity] ${label} failed (ignoring):`, err)
  }
}

function isAlreadyRevokedStatus(status: number): boolean {
  // 200 = explicit revoke; 401 = dtk no longer authenticates (pet row gone);
  // 404 = pet row deleted between auth and revoke. All three mean the
  // server-side state already matches the post-revoke target.
  return status === 200 || status === 401 || status === 404
}
