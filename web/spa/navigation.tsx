import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { HistoryRouter } from './history'
import type { RouteParams } from './routes'

interface NavigationContextValue {
  history: HistoryRouter
  params: RouteParams
  prefetch: (href: string) => Promise<void>
}
const NavigationContext = createContext<NavigationContextValue | null>(null)
export function NavigationProvider({ value, children }: { value: NavigationContextValue; children: ReactNode }) {
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}
function useNavigation() {
  const value = useContext(NavigationContext)
  if (!value) throw new Error('SPA navigation provider is required')
  return value
}
export function useBrowserLocation() {
  const { history } = useNavigation()
  return useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot)
}
export function useRouter() {
  const { history, prefetch } = useNavigation()
  return useMemo(() => ({ push: history.push, replace: history.replace, back: history.back,
    forward: history.forward, refresh: history.refresh, prefetch }), [history, prefetch])
}
export function usePathname() { return useBrowserLocation().pathname }
export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useNavigation().params as T
}
class ReadonlySearchParams extends URLSearchParams {
  append(): never { throw new Error('Search parameters are readonly; navigate to update the URL') }
  delete(): never { throw new Error('Search parameters are readonly; navigate to update the URL') }
  set(): never { throw new Error('Search parameters are readonly; navigate to update the URL') }
  sort(): never { throw new Error('Search parameters are readonly; navigate to update the URL') }
}
export function useSearchParams(): URLSearchParams {
  const { search } = useBrowserLocation()
  return useMemo(() => new ReadonlySearchParams(search), [search])
}
export class RouteNotFound extends Error {}
export class RouteRedirect extends Error {
  constructor(readonly href: string, readonly replace = true) { super('SPA redirect') }
}
export function notFound(): never { throw new RouteNotFound('Route not found') }
export function redirect(href: string, type: 'replace' | 'push' = 'replace'): never {
  throw new RouteRedirect(href, type === 'replace')
}
