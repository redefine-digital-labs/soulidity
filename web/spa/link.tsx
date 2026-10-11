import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from 'react'
import { useRouter } from './navigation'

type LinkHref = string | { pathname?: string; query?: Record<string, string | number | boolean | readonly string[] | undefined>; hash?: string }
export function linkHref(value: LinkHref): string {
  if (typeof value === 'string') return value
  const search = new URLSearchParams()
  for (const [key, item] of Object.entries(value.query ?? {})) {
    if (item !== undefined) for (const part of Array.isArray(item) ? item : [item]) search.append(key, String(part))
  }
  const hash = value.hash ? (value.hash.startsWith('#') ? value.hash : '#' + value.hash) : ''
  return (value.pathname ?? '') + (search.size ? '?' + search : '') + hash
}
type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: LinkHref; replace?: boolean; scroll?: boolean; prefetch?: boolean | null
  onNavigate?: (event: { preventDefault(): void }) => void
}
export function isClientNavigation(event: MouseEvent<HTMLAnchorElement>) {
  const anchor = event.currentTarget
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey
    && !event.altKey && !event.shiftKey && !anchor.hasAttribute('download')
    && (!anchor.target || anchor.target === '_self')
    && new URL(anchor.href).origin === window.location.origin
    && ['https:', 'http:'].includes(new URL(anchor.href).protocol)
}
const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, replace = false, scroll,
  prefetch = false, onClick, onMouseEnter, onFocus, onNavigate, ...props }, ref) {
  const router = useRouter()
  const destination = linkHref(href)
  const warm = () => { if (prefetch) void router.prefetch(destination).catch(() => {}) }
  return <a {...props} href={destination} ref={ref}
    onMouseEnter={event => { onMouseEnter?.(event); warm() }}
    onFocus={event => { onFocus?.(event); warm() }}
    onClick={event => {
      onClick?.(event)
      if (!isClientNavigation(event)) return
      let cancelled = false
      onNavigate?.({ preventDefault: () => { cancelled = true } })
      if (cancelled) { event.preventDefault(); return }
      event.preventDefault()
      router[replace ? 'replace' : 'push'](destination, { scroll })
    }} />
})
export default Link
