/**
 * Pure helpers for the `device:poll` IPC. Extracted so the double-write retry
 * logic can be unit-tested without spinning up Electron.
 *
 * The contract:
 *  - `desktop:poll` returns *sanitized* payloads to the renderer; the renderer
 *    must never see `desktopAccessToken` or `agentApiKey` in plaintext.
 *  - On a confirmed poll containing `desktopAccessToken`, main attempts to
 *    persist BOTH the desktop access token and (if present) the agent API key
 *    via safeStorage. If either persist throws, the renderer is told the poll
 *    is still pending so it keeps retrying — every confirmed poll for the same
 *    `deviceCode` returns the same deterministic credentials, so a retry is
 *    safe and idempotent.
 *  - After 3 consecutive double-write failures for the same `deviceCode`, the
 *    renderer gets `{ status: 'error', error: 'storage-failed' }` so the UI
 *    can prompt unlink + relink.
 */

export type RawPollResponse = {
  status: string
  accountId?: string
  desktopAccessToken?: string
  agentApiKey?: string
  expiresAt?: string | null
  pollInterval?: number
  error?: string
}

export type RendererPollResponse = {
  status: 'pending' | 'confirmed' | 'expired' | 'invalid_code' | 'error'
  accountId?: string
  error?: string
  expiresAt?: string | null
  pollInterval?: number
}

export interface DevicePollDeps {
  storeDesktopToken: (token: string, accountId: string) => void
  storeAgentApiKey: (apiKey: string, agentMemberId?: string | null, rotationId?: string | null) => void
}

export const DEVICE_POLL_MAX_STORAGE_FAILURES = 3

/**
 * Given a poll response from the web `/api/desktop/device/poll` endpoint, the
 * current attempt counter for this `deviceCode`, and the storage primitives,
 * return:
 *   - the renderer-facing sanitized response
 *   - the next attempt counter (or `null` to drop the entry)
 *
 * Pure: no fs / no Electron / no globals. The caller owns the per-deviceCode
 * counter map.
 */
export function handleDevicePollResponse(
  raw: RawPollResponse,
  attempts: number,
  deps: DevicePollDeps,
): { renderer: RendererPollResponse; nextAttempts: number | null } {
  const status = raw.status

  if (status === 'pending') {
    return {
      renderer: {
        status: 'pending',
        ...(raw.expiresAt !== undefined ? { expiresAt: raw.expiresAt } : {}),
        ...(raw.pollInterval !== undefined ? { pollInterval: raw.pollInterval } : {}),
      },
      // Pending polls don't touch the storage retry counter.
      nextAttempts: attempts > 0 ? attempts : 0,
    }
  }

  if (status === 'expired' || status === 'invalid_code') {
    return {
      renderer: {
        status: status as 'expired' | 'invalid_code',
        ...(raw.expiresAt !== undefined ? { expiresAt: raw.expiresAt } : {}),
        ...(raw.error ? { error: raw.error } : {}),
      },
      nextAttempts: null,
    }
  }

  if (status === 'confirmed') {
    // Confirmed-without-token: cookie-only re-confirm path. Pass through the
    // sanitized fields. Don't reset the counter aggressively — but since this
    // means we never had storage work to do, drop it.
    if (typeof raw.desktopAccessToken !== 'string' || raw.desktopAccessToken.length === 0) {
      return {
        renderer: {
          status: 'confirmed',
          ...(typeof raw.accountId === 'string' ? { accountId: raw.accountId } : {}),
          ...(raw.expiresAt !== undefined ? { expiresAt: raw.expiresAt } : {}),
        },
        nextAttempts: null,
      }
    }

    if (typeof raw.accountId !== 'string' || raw.accountId.length === 0) {
      // Server contract violation — confirmed branch must include accountId
      // alongside desktopAccessToken. Treat as a transient and let renderer
      // retry; this should never happen in production but we fail closed.
      const nextCount = attempts + 1
      if (nextCount >= DEVICE_POLL_MAX_STORAGE_FAILURES) {
        return {
          renderer: { status: 'error', error: 'storage-failed' },
          nextAttempts: null,
        }
      }
      return {
        renderer: { status: 'pending' },
        nextAttempts: nextCount,
      }
    }

    // Step 1: persist the desktop access token. If this fails, do NOT proceed
    // to the agent API key — repeat the entire double-write on the next poll.
    try {
      deps.storeDesktopToken(raw.desktopAccessToken, raw.accountId)
    } catch (err) {
      console.error('[device:poll] storeDesktopToken failed; renderer will keep polling', err)
      const nextCount = attempts + 1
      if (nextCount >= DEVICE_POLL_MAX_STORAGE_FAILURES) {
        return {
          renderer: { status: 'error', error: 'storage-failed' },
          nextAttempts: null,
        }
      }
      return { renderer: { status: 'pending' }, nextAttempts: nextCount }
    }

    // Step 2: persist the agent API key, if present. T3 made this conditional —
    // when absent, the desktop token alone is enough.
    if (typeof raw.agentApiKey === 'string' && raw.agentApiKey.length > 0) {
      try {
        deps.storeAgentApiKey(raw.agentApiKey, null, null)
      } catch (err) {
        console.error('[device:poll] storeAgentApiKey failed; renderer will keep polling', err)
        const nextCount = attempts + 1
        if (nextCount >= DEVICE_POLL_MAX_STORAGE_FAILURES) {
          return {
            renderer: { status: 'error', error: 'storage-failed' },
            nextAttempts: null,
          }
        }
        return { renderer: { status: 'pending' }, nextAttempts: nextCount }
      }
    }

    // Both writes (or single write, if no agentApiKey) succeeded: drop counter
    // and tell renderer confirmed — but strip plaintext credentials.
    return {
      renderer: {
        status: 'confirmed',
        accountId: raw.accountId,
        ...(raw.expiresAt !== undefined ? { expiresAt: raw.expiresAt } : {}),
      },
      nextAttempts: null,
    }
  }

  // Unknown status — pass through as pending so renderer doesn't crash, but
  // strip any potentially sensitive fields.
  return {
    renderer: { status: 'pending' },
    nextAttempts: attempts > 0 ? attempts : 0,
  }
}
