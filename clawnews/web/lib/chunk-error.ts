const CHUNK_RELOAD_KEY = 'sld:chunk-error-reload-ts'
const CHUNK_RELOAD_COOLDOWN_MS = 30_000

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { message?: unknown; name?: unknown }
  const message = typeof e.message === 'string' ? e.message : ''
  const name = typeof e.name === 'string' ? e.name : ''
  return (
    name === 'ChunkLoadError'
    || /Loading chunk \S+ failed/.test(message)
    || /Loading CSS chunk \S+ failed/.test(message)
    || /Failed to fetch dynamically imported module/.test(message)
  )
}

export function autoReloadOnChunkError(error: unknown): boolean {
  if (typeof window === 'undefined') return false
  if (!isChunkLoadError(error)) return false

  let last = 0
  try {
    last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || '0')
  } catch {
    // sessionStorage may be unavailable (privacy mode, sandboxed iframe, quota)
  }
  if (Date.now() - last < CHUNK_RELOAD_COOLDOWN_MS) return false

  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch {
    // ignore
  }

  window.location.reload()
  return true
}
