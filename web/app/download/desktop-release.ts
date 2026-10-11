export interface DesktopReleaseConfig { manifestUrl?: string; downloadUrl?: string; version?: string }
export interface DesktopRelease { version: string; macArm64Url: string; source: 'manifest' | 'env' | 'none' }
export interface DesktopReleaseState { release: DesktopRelease; status: 'loading' | 'ready' | 'error'; error: string | null }

function publicUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const url = new URL(value.trim())
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}
export function configuredDesktopRelease(config: DesktopReleaseConfig): DesktopRelease {
  const url = publicUrl(config.downloadUrl)
  return { version: config.version?.trim() || (url ? '0.0.4' : '0.0.0'), macArm64Url: url, source: url ? 'env' : 'none' }
}

/** Public artifact discovery only; never asks an owned API for a secret or token. */
export async function loadDesktopRelease(config: DesktopReleaseConfig, request: typeof fetch, signal: AbortSignal,
  timeoutMs = 10_000): Promise<DesktopReleaseState> {
  const fallback = configuredDesktopRelease(config)
  if (!config.manifestUrl?.trim()) return { release: fallback, status: 'ready', error: null }
  const manifestUrl = publicUrl(config.manifestUrl)
  if (!manifestUrl) return { release: fallback, status: 'error', error: 'The public release manifest URL is invalid.' }
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  try {
    const response = await request(manifestUrl, { signal: controller.signal, credentials: 'omit' })
    if (!response.ok) throw new Error(`Release manifest returned HTTP ${response.status}.`)
    const data = await response.json() as { version?: unknown; mac?: { arm64?: { url?: unknown } } }
    const url = publicUrl(data?.mac?.arm64?.url)
    const version = typeof data?.version === 'string' ? data.version.trim() : ''
    if (!url || !version) throw new Error('Release manifest is missing a valid version or download URL.')
    return { release: { version, macArm64Url: url, source: 'manifest' }, status: 'ready', error: null }
  } catch (error) {
    return { release: fallback, status: 'error', error: timedOut ? 'The public release manifest request timed out.'
      : signal.aborted ? 'Release check cancelled.' : error instanceof Error ? error.message : 'The public release manifest could not be loaded.' }
  } finally {
    clearTimeout(timeout); signal.removeEventListener('abort', abort)
  }
}
