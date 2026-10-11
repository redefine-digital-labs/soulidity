export interface BrowserLocation {
  readonly pathname: string
  readonly search: string
  readonly hash: string
  readonly revision: number
}
export interface NavigateOptions { scroll?: boolean }

/** History is location only, never identity, ownership or transaction authority. */
export function createHistoryRouter(win: Window) {
  let revision = 0
  const read = (): BrowserLocation => Object.freeze({ pathname: win.location.pathname,
    search: win.location.search, hash: win.location.hash, revision })
  let snapshot = read()
  let pendingScroll: { revision: number; hash: string } | null = null
  const listeners = new Set<() => void>()
  const publish = () => { revision++; snapshot = read(); listeners.forEach(listener => listener()) }
  const pushState = win.history.pushState.bind(win.history)
  const replaceState = win.history.replaceState.bind(win.history)
  // Existing integration code removes consumed handoff query fields with native
  // replaceState. Observe that too, rather than leaving hook values stale.
  win.history.pushState = (...args) => { pushState(...args); publish() }
  win.history.replaceState = (...args) => { replaceState(...args); publish() }
  win.addEventListener('popstate', publish)
  win.addEventListener('hashchange', publish)

  const navigate = (href: string, replace: boolean, options: NavigateOptions = {}) => {
    const url = new URL(href, win.location.href)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported navigation protocol')
    if (url.origin !== win.location.origin) {
      if (replace) win.location.replace(url.href); else win.location.assign(url.href)
      return
    }
    pendingScroll = options.scroll === false ? null : { revision: revision + 1, hash: url.hash }
    win.history[replace ? 'replaceState' : 'pushState'](null, '', url.pathname + url.search + url.hash)
  }
  const commitScroll = (renderedRevision: number) => {
    if (!pendingScroll || pendingScroll.revision !== renderedRevision) return
    const { hash } = pendingScroll
    pendingScroll = null
    win.requestAnimationFrame(() => {
      if (snapshot.revision !== renderedRevision) return
      let target: HTMLElement | null = null
      if (hash) {
        try { target = win.document.getElementById(decodeURIComponent(hash.slice(1))) } catch { /* malformed anchor */ }
      }
      if (target) target.scrollIntoView(); else win.scrollTo(0, 0)
    })
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    // Called after the lazy page commits, so a deep-page anchor actually exists.
    commitScroll,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    push: (href: string, options?: NavigateOptions) => navigate(href, false, options),
    replace: (href: string, options?: NavigateOptions) => navigate(href, true, options),
    back: () => win.history.back(), forward: () => win.history.forward(),
    // No server component cache exists in this SPA. Refresh is a real reload,
    // preserving URL and durable browser recovery rather than fake RSC work.
    refresh: () => win.location.reload(),
    dispose() {
      win.removeEventListener('popstate', publish); win.removeEventListener('hashchange', publish)
      win.history.pushState = pushState; win.history.replaceState = replaceState; listeners.clear()
    },
  })
}
export type HistoryRouter = ReturnType<typeof createHistoryRouter>
