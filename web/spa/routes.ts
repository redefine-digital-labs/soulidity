export type RouteParams = Readonly<Record<string, string>>
export interface RouteDefinition {
  pattern: string
  page: string
  layouts: string[]
  segments: string[]
}
export interface RouteMatch { route: RouteDefinition; params: RouteParams }

function segmentsFromModule(path: string, file: 'page' | 'layout'): string[] {
  const match = /^\.\.\/app\/(.*)$/.exec(path)
  if (!match || !match[1].endsWith(`${file}.tsx`)) throw new Error('Invalid SPA route module: ' + path)
  const segments = match[1].split('/').slice(0, -1)
  if (segments.some(segment => segment.startsWith('@') || segment.startsWith('_') || /\.{3}/.test(segment))) {
    throw new Error('SPA route needs an explicit non-standard segment adapter: ' + path)
  }
  return segments.filter(segment => !/^\(.+\)$/.test(segment))
}

/** Every current page is registered, including paths not minted at build time. */
export function createRouteDefinitions(pages: readonly string[], layouts: readonly string[]): RouteDefinition[] {
  const nested = layouts.filter(path => path !== '../app/layout.tsx')
    .map(path => ({ path, segments: segmentsFromModule(path, 'layout') }))
  const seen = new Set<string>()
  return pages.map(page => {
    const segments = segmentsFromModule(page, 'page')
    const pattern = '/' + segments.join('/')
    if (seen.has(pattern)) throw new Error('Duplicate SPA route: ' + pattern)
    seen.add(pattern)
    return { pattern, page, segments,
      layouts: nested.filter(layout => layout.segments.length <= segments.length
        && layout.segments.every((segment, index) => segment === segments[index]))
        .sort((left, right) => left.segments.length - right.segments.length).map(layout => layout.path) }
  }).sort((left, right) => {
    for (let index = 0; index < Math.max(left.segments.length, right.segments.length); index++) {
      const a = left.segments[index], b = right.segments[index]
      if (a === b) continue
      if (!a || !b) return left.segments.length - right.segments.length
      const dynamicA = a.startsWith('['), dynamicB = b.startsWith('[')
      if (dynamicA !== dynamicB) return dynamicA ? 1 : -1
      return a.localeCompare(b)
    }
    return 0
  })
}

export function matchRoute(routes: readonly RouteDefinition[], pathname: string): RouteMatch | null {
  let segments: string[]
  try { segments = pathname.replace(/\/+$/, '').split('/').slice(1).map(decodeURIComponent) } catch { return null }
  if (pathname === '/' || segments.length === 1 && segments[0] === '') segments = []
  for (const route of routes) {
    if (segments.length !== route.segments.length) continue
    const params: Record<string, string> = Object.create(null)
    if (route.segments.every((segment, index) => {
      const dynamic = /^\[([A-Za-z][A-Za-z0-9_]*)\]$/.exec(segment)
      if (dynamic) { if (!segments[index]) return false; params[dynamic[1]] = segments[index]; return true }
      return segment === segments[index]
    })) return { route, params: Object.freeze(params) }
  }
  return null
}

export function searchParamsRecord(search: string): Readonly<Record<string, string | string[]>> {
  const result: Record<string, string | string[]> = Object.create(null)
  for (const [key, value] of new URLSearchParams(search)) {
    const previous = result[key]
    result[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value]
  }
  return Object.freeze(result)
}
