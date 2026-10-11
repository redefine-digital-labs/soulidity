import type { WebPreferences } from 'electron'

export const SECURE_WINDOW_WEB_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
} as const satisfies Pick<WebPreferences, 'sandbox' | 'contextIsolation' | 'nodeIntegration'>

type NavigationEvent = {
  preventDefault(): void
}

type GuardedWebContents = {
  on(event: 'will-navigate', listener: (event: NavigationEvent, url: string) => void): unknown
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): unknown
}

function normalizeAllowedNavigationUrl(value: string): string | null {
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'file:') {
      return parsed.href
    }
    return parsed.origin
  } catch {
    return null
  }
}

function isAllowedNavigation(url: string, allowedNavigationUrls: string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  return allowedNavigationUrls.some((allowed) => {
    const normalized = normalizeAllowedNavigationUrl(allowed)
    if (!normalized) return false
    return parsed.protocol === 'file:'
      ? parsed.href.startsWith(normalized)
      : parsed.origin === normalized
  })
}

export function installWebContentsNavigationGuards(
  webContents: GuardedWebContents,
  options: { allowedNavigationUrls: string[] },
): void {
  webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, options.allowedNavigationUrls)) {
      event.preventDefault()
    }
  })

  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}
