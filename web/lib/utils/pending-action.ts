/**
 * sessionStorage-backed pending-action store.
 *
 * When a guest clicks a gated action (e.g. Buy a Soul), the intended
 * navigation is saved here before wallet login is triggered. After the
 * user authenticates, AppShell consumes the entry and resumes the
 * original intent. TTL caps stale entries to 10 minutes.
 */

export interface PendingAction {
  path: string
  label: string
  savedAt: number
}

const KEY = 'soulidity.pending'
const TTL_MS = 10 * 60 * 1000

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

export function savePendingAction(action: Omit<PendingAction, 'savedAt'>): void {
  const s = storage()
  if (!s) return
  try {
    const payload: PendingAction = { ...action, savedAt: Date.now() }
    s.setItem(KEY, JSON.stringify(payload))
  } catch {
    /* swallow */
  }
}

export function readPendingAction(): PendingAction | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingAction>
    if (
      !parsed
      || typeof parsed !== 'object'
      || typeof parsed.path !== 'string'
      || typeof parsed.label !== 'string'
      || typeof parsed.savedAt !== 'number'
    ) {
      s.removeItem(KEY)
      return null
    }
    if (Date.now() - parsed.savedAt > TTL_MS) {
      s.removeItem(KEY)
      return null
    }
    return parsed as PendingAction
  } catch {
    try { s.removeItem(KEY) } catch {}
    return null
  }
}

export function clearPendingAction(): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(KEY)
  } catch {
    /* swallow */
  }
}
