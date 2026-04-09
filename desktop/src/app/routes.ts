export type DesktopRouteId =
  | 'home'
  | 'explore'
  | 'search'
  | 'persona'
  | 'library'
  | 'settings'
  | 'auth'

export interface DesktopRouteDefinition {
  id: DesktopRouteId
  path: string
  nav: boolean
  title: string
}

export const desktopRouteDefinitions = [
  { id: 'home', path: '/', nav: true, title: 'Home' },
  { id: 'explore', path: '/explore', nav: true, title: 'Explore' },
  { id: 'search', path: '/search', nav: true, title: 'Search' },
  { id: 'persona', path: '/persona/:id', nav: false, title: 'Persona Detail' },
  { id: 'library', path: '/library', nav: true, title: 'Library' },
  { id: 'settings', path: '/settings', nav: true, title: 'Settings' },
  { id: 'auth', path: '/auth', nav: true, title: 'Auth' },
] as const satisfies readonly DesktopRouteDefinition[]

export const desktopPrimaryNavItems = [
  { id: 'home', to: '/' },
  { id: 'explore', to: '/explore' },
  { id: 'search', to: '/search' },
  { id: 'library', to: '/library' },
  { id: 'settings', to: '/settings' },
  { id: 'auth', to: '/auth' },
] as const

export interface ResolvedDesktopRoute {
  definition: DesktopRouteDefinition
  params: Record<string, string>
  pathname: string
}

export function normalizeDesktopPathname(pathname: string) {
  if (!pathname || pathname === '#') {
    return '/'
  }

  const cleaned = pathname
    .replace(/^#/, '')
    .replace(/[?#].*$/, '')
    .trim()

  if (!cleaned) {
    return '/'
  }

  const withLeadingSlash = cleaned.startsWith('/') ? cleaned : `/${cleaned}`
  const normalized = withLeadingSlash.replace(/\/{2,}/g, '/')

  if (normalized !== '/' && normalized.endsWith('/')) {
    return normalized.slice(0, -1)
  }

  return normalized
}

export function resolveDesktopRoute(pathname: string): ResolvedDesktopRoute {
  const normalized = normalizeDesktopPathname(pathname)
  const personaMatch = normalized.match(/^\/persona\/([^/]+)$/)

  if (personaMatch) {
    return {
      definition: desktopRouteDefinitions[3],
      params: { id: decodeURIComponent(personaMatch[1]) },
      pathname: normalized,
    }
  }

  const directMatch = desktopRouteDefinitions.find((definition) => definition.path === normalized)

  if (directMatch) {
    return {
      definition: directMatch,
      params: {},
      pathname: normalized,
    }
  }

  return {
    definition: desktopRouteDefinitions[0],
    params: {},
    pathname: '/',
  }
}

export function readDesktopHashPath(hash: string) {
  return normalizeDesktopPathname(hash)
}

export function toDesktopHref(pathname: string) {
  const normalized = normalizeDesktopPathname(pathname)
  return normalized === '/' ? '#/' : `#${normalized}`
}
