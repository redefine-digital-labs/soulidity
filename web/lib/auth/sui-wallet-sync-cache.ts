export type SuiWalletSyncState = {
  inFlight: Promise<void> | null
  lastAttemptAt: number
}

export const SUI_WALLET_SYNC_TTL_MS = 5 * 60 * 1000
export const SUI_WALLET_SYNC_MAX_ENTRIES = 1024
export const SUI_WALLET_SYNC_IN_FLIGHT_TIMEOUT_MS = 30_000
const SUI_WALLET_SYNC_PRUNE_INTERVAL_MS = 10_000

const suiWalletSyncCache = new Map<string, SuiWalletSyncState>()
let lastSuiWalletSyncCachePruneAt = 0

function isStale(state: SuiWalletSyncState, now: number) {
  return state.inFlight === null && now - state.lastAttemptAt >= SUI_WALLET_SYNC_TTL_MS
}

function pruneSuiWalletSyncCache(now: number) {
  if (now - lastSuiWalletSyncCachePruneAt < SUI_WALLET_SYNC_PRUNE_INTERVAL_MS) {
    return
  }

  lastSuiWalletSyncCachePruneAt = now
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
  const state = suiWalletSyncCache.get(memberId)
  if (state && isStale(state, now)) {
    suiWalletSyncCache.delete(memberId)
    return undefined
  }
  return state
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
  lastSuiWalletSyncCachePruneAt = 0
}
