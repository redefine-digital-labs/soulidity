export type SuiWalletSyncState = {
  inFlight: Promise<void> | null
  lastAttemptAt: number
}

export const SUI_WALLET_SYNC_TTL_MS = 5 * 60 * 1000
export const SUI_WALLET_SYNC_MAX_ENTRIES = 1024

const suiWalletSyncCache = new Map<string, SuiWalletSyncState>()

function isStale(state: SuiWalletSyncState, now: number) {
  return state.inFlight === null && now - state.lastAttemptAt >= SUI_WALLET_SYNC_TTL_MS
}

function pruneSuiWalletSyncCache(now: number) {
  for (const [memberId, state] of suiWalletSyncCache.entries()) {
    if (isStale(state, now)) {
      suiWalletSyncCache.delete(memberId)
    }
  }
}

function enforceSuiWalletSyncCacheCap() {
  if (suiWalletSyncCache.size <= SUI_WALLET_SYNC_MAX_ENTRIES) {
    return
  }

  const candidates = Array.from(suiWalletSyncCache.entries())
    .filter(([, state]) => state.inFlight === null)
    .sort(([, left], [, right]) => left.lastAttemptAt - right.lastAttemptAt)

  for (const [memberId] of candidates) {
    if (suiWalletSyncCache.size <= SUI_WALLET_SYNC_MAX_ENTRIES) {
      break
    }
    suiWalletSyncCache.delete(memberId)
  }
}

export function getSuiWalletSyncCacheEntry(memberId: string, now = Date.now()) {
  pruneSuiWalletSyncCache(now)
  return suiWalletSyncCache.get(memberId)
}

export function setSuiWalletSyncCacheEntry(
  memberId: string,
  state: SuiWalletSyncState,
  now = Date.now(),
) {
  pruneSuiWalletSyncCache(now)
  suiWalletSyncCache.set(memberId, state)
  enforceSuiWalletSyncCacheCap()
}

export function getSuiWalletSyncCacheSize(now = Date.now()) {
  pruneSuiWalletSyncCache(now)
  return suiWalletSyncCache.size
}

export function resetSuiWalletSyncCacheForTests() {
  suiWalletSyncCache.clear()
}
