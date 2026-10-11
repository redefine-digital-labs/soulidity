import { Component, Fragment, Suspense, lazy, useEffect, useMemo, useSyncExternalStore,
  type ComponentType, type ReactNode } from 'react'
import { createRouteDefinitions, matchRoute, searchParamsRecord } from './routes'
import { NavigationProvider, RouteNotFound, RouteRedirect, useRouter } from './navigation'
import type { HistoryRouter } from './history'

export interface RouteProps {
  params: Promise<Readonly<Record<string, string>>>
  searchParams: Promise<Readonly<Record<string, string | string[]>>>
  children?: ReactNode
}
export type RouteModule = { default: ComponentType<RouteProps>; metadata?: { title?: string | { default?: string } } }
export type RouteLoaders = Record<string, () => Promise<RouteModule>>

function Redirect({ error }: { error: RouteRedirect }) {
  const router = useRouter()
  useEffect(() => { router[error.replace ? 'replace' : 'push'](error.href) }, [error, router])
  return null
}
class RouteBoundary extends Component<{
  children: ReactNode; routeKey: string; notFound: ReactNode
  reset: () => void
  renderError: (error: Error, reset: () => void) => ReactNode
}, { error: Error | null; routeKey: string }> {
  state = { error: null as Error | null, routeKey: this.props.routeKey }
  static getDerivedStateFromError(error: Error) { return { error } }
  static getDerivedStateFromProps(props: { routeKey: string }, state: { routeKey: string }) {
    return props.routeKey === state.routeKey ? null : { error: null, routeKey: props.routeKey }
  }
  render() {
    const error = this.state.error
    if (error instanceof RouteRedirect) return <Redirect error={error} />
    if (error instanceof RouteNotFound) return this.props.notFound
    if (error) return this.props.renderError(error, this.props.reset)
    return this.props.children
  }
}

/** Load the original components once; stable layout types preserve wizard state. */
export function createSpaRouteRegistry(pages: RouteLoaders, layouts: RouteLoaders) {
  const definitions = createRouteDefinitions(Object.keys(pages), Object.keys(layouts))
  const all = { ...pages, ...layouts }
  const pending = new Map<string, Promise<RouteModule>>()
  const load = (path: string) => {
    let promise = pending.get(path)
    if (!promise) {
      promise = all[path]().then(module => {
        if (typeof module.default !== 'function' || module.default.constructor.name === 'AsyncFunction') {
          throw new Error(`SPA route still requires an explicit client conversion: ${path}`)
        }
        return module
      })
      pending.set(path, promise)
    }
    return promise
  }
  const components = new Map(Object.keys(all).filter(path => path !== '../app/layout.tsx')
    .map(path => [path, lazy(() => load(path))]))
  return { definitions, components, load,
    async prefetch(href: string) {
      const url = new URL(href, window.location.href)
      if (url.origin !== window.location.origin) return
      const match = matchRoute(definitions, url.pathname)
      if (match) await Promise.all([match.route.page, ...match.route.layouts].map(load))
    } }
}
export type SpaRouteRegistry = ReturnType<typeof createSpaRouteRegistry>

function CommitScroll({ history, revision }: { history: HistoryRouter; revision: number }) {
  useEffect(() => { history.commitScroll(revision) }, [history, revision])
  return null
}

export function SpaRouter({ history, registry, children, loading, notFound, renderError }: {
  history: HistoryRouter; registry: SpaRouteRegistry
  children: (content: ReactNode) => ReactNode
  loading: ReactNode; notFound: ReactNode
  renderError: (error: Error, reset: () => void) => ReactNode
}) {
  const location = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot)
  const match = useMemo(() => matchRoute(registry.definitions, location.pathname), [registry, location.pathname])
  const params = useMemo(() => Promise.resolve(match?.params ?? Object.freeze({})), [match])
  const searchParams = useMemo(() => Promise.resolve(searchParamsRecord(location.search)), [location.search])
  const context = useMemo(() => ({ history, params: match?.params ?? Object.freeze({}), prefetch: registry.prefetch }),
    [history, match, registry])
  useEffect(() => {
    let current = true
    if (match) void Promise.all([...match.route.layouts, match.route.page].map(registry.load)).then(modules => {
      if (!current) return
      const titles = modules.map(module => module.metadata?.title).filter(Boolean)
      const title = titles.at(-1)
      document.title = typeof title === 'string' ? `${title} · Soulidity`
        : title?.default ?? 'Soulidity — On-chain Soul Ownership'
    }).catch(() => { /* The route boundary displays the actual load failure. */ })
    return () => { current = false }
  }, [registry, match])

  let content: ReactNode = notFound
  if (match) {
    const Page = registry.components.get(match.route.page)!
    // Registry creation owns lazy(); Map.get only retrieves that stable component type.
    // eslint-disable-next-line react-hooks/static-components
    content = <Page key={location.pathname} params={params} searchParams={searchParams} />
    for (const path of [...match.route.layouts].reverse()) {
      const Layout = registry.components.get(path)!
      const depth = path.split('/').length - 3
      const key = path + ':' + location.pathname.split('/').slice(0, depth + 1).join('/')
      // Registry-owned layout identity survives navigation and preserves its state.
      // eslint-disable-next-line react-hooks/static-components
      content = <Layout key={key} params={params} searchParams={searchParams}>{content}</Layout>
    }
  }
  return <NavigationProvider value={context}>{children(
    <RouteBoundary routeKey={location.pathname + location.search} notFound={notFound} renderError={renderError}
      reset={history.refresh}>
      <Suspense fallback={loading}><Fragment>{content}<CommitScroll history={history} revision={location.revision} /></Fragment></Suspense>
    </RouteBoundary>,
  )}</NavigationProvider>
}
