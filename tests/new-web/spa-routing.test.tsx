// @vitest-environment jsdom
import React, { act, use, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouteDefinitions, matchRoute, searchParamsRecord } from '../../web/spa/routes'
import { createHistoryRouter, type HistoryRouter } from '../../web/spa/history'
import { createSpaRouteRegistry, SpaRouter, type RouteProps } from '../../web/spa/router'
import { useParams, usePathname, useSearchParams, notFound } from '../../web/spa/navigation'
import Link, { isClientNavigation, linkHref } from '../../web/spa/link'
import Image from '../../web/spa/image'
import { assertBrowserModule, browserMetadataLayout, SERVER_METADATA_LAYOUTS } from '../../web/spa/build-boundary'

const app = resolve('web/app')
const files = readdirSync(app, { recursive: true }).filter((file): file is string => typeof file === 'string')
const pages = files.filter(file => /(^|\/)page\.tsx$/.test(file)).map(file => '../app/' + file)
const layouts = files.filter(file => /(^|\/)layout\.tsx$/.test(file)).map(file => '../app/' + file)

describe('complete original route inventory', () => {
  it('registers all original pages and accepts future IDs without build-time enumeration', () => {
    const definitions = createRouteDefinitions(pages, layouts)
    expect(definitions).toHaveLength(pages.length)
    expect(pages.length).toBeGreaterThanOrEqual(70)
    for (const route of definitions) {
      const url = route.pattern.replace(/\[[^\]]+\]/g, 'future%252Fid')
      const match = matchRoute(definitions, url + (url === '/' ? '' : '/'))
      expect(match?.route.page).toBe(route.page)
      for (const id of Object.values(match!.params)) expect(id).toBe('future%2Fid')
      expect(route.layouts).not.toContain('../app/layout.tsx')
    }
    expect(matchRoute(definitions, '/souls/0xfuture/sell/authorize')?.params.id).toBe('0xfuture')
    expect(matchRoute(definitions, '/missing-route')).toBeNull()
    expect(matchRoute(definitions, '/souls/%E0%A4%A')).toBeNull()
  })
  it('orders static routes first and preserves nested wizard providers', () => {
    const definitions = createRouteDefinitions(pages, layouts)
    expect(matchRoute(definitions, '/collections/create/preview')?.route.layouts).toContain('../app/collections/create/layout.tsx')
    expect(matchRoute(definitions, '/create/preview')?.route.layouts).toContain('../app/create/layout.tsx')
    const collision = createRouteDefinitions(['../app/[id]/page.tsx', '../app/new/page.tsx'], [])
    expect(matchRoute(collision, '/new')?.route.page).toBe('../app/new/page.tsx')
    expect(() => createRouteDefinitions(['../app/[...id]/page.tsx'], [])).toThrow('non-standard')
  })
  it('preserves duplicate query fields and safely handles prototype-looking keys', () => {
    expect(searchParamsRecord('?link=a&link=b&__proto__=safe')).toEqual({ link: ['a', 'b'], __proto__: undefined, ...JSON.parse('{"__proto__":"safe"}') })
    expect(linkHref({ pathname: '/x', query: { a: ['1', '2'], bool: false }, hash: 'target' })).toBe('/x?a=1&a=2&bool=false#target')
  })
})

let host: HTMLDivElement, root: Root, history: HistoryRouter
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.history.replaceState(null, '', '/')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 0 })
  history = createHistoryRouter(window)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); history.dispose(); host.remove(); vi.restoreAllMocks() })

describe('browser history semantics', () => {
  it('publishes push, replace, native query cleanup and popstate without mutable snapshots', () => {
    const first = history.getSnapshot(), changed = vi.fn()
    const unsubscribe = history.subscribe(changed)
    history.push('/souls/new?link=a#content', { scroll: false })
    expect(history.getSnapshot()).toMatchObject({ pathname: '/souls/new', search: '?link=a', hash: '#content' })
    expect(first.pathname).toBe('/')
    history.replace('/souls/new?link=b')
    window.history.replaceState(null, '', '/souls/new')
    expect(history.getSnapshot().search).toBe('')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(changed).toHaveBeenCalledTimes(4)
    unsubscribe(); expect(() => history.push('javascript:alert(1)')).toThrow('protocol')
  })
  it('delays scrolling until the committed page exists and honors scroll false', () => {
    history.push('/souls/new#late')
    expect(window.scrollTo).not.toHaveBeenCalled()
    const target = document.createElement('div'); target.id = 'late'; target.scrollIntoView = vi.fn(); host.appendChild(target)
    history.commitScroll(history.getSnapshot().revision)
    expect(target.scrollIntoView).toHaveBeenCalledOnce()
    history.push('/souls/next', { scroll: false }); history.commitScroll(history.getSnapshot().revision)
    expect(window.scrollTo).not.toHaveBeenCalled()
    history.push('/souls/another'); history.commitScroll(history.getSnapshot().revision)
    expect(window.scrollTo).toHaveBeenCalledOnce()
  })
  it('delegates back and forward to real browser history', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => {})
    history.back(); history.forward(); expect(back).toHaveBeenCalledOnce(); expect(forward).toHaveBeenCalledOnce()
  })
  it.each(['ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'download', 'target', 'external', 'defaultPrevented'])('preserves native link action: %s', reason => {
    const anchor = document.createElement('a'); anchor.href = '/next'
    if (reason === 'download') anchor.download = 'file'
    if (reason === 'target') anchor.target = '_blank'
    if (reason === 'external') anchor.href = 'https://external.example/path'
    const event = { currentTarget: anchor, button: 0, [reason]: true }
    expect(isClientNavigation(event as any)).toBe(false)
  })
})

describe('original component composition', () => {
  const Probe = ({ params }: RouteProps) => {
    const promised = use(params), direct = useParams(), search = useSearchParams(), path = usePathname()
    return <><output>{path}|{promised.id}|{direct.id}|{search.getAll('q').join(',')}</output>
      <Link href="/wizard/second?q=two#anchor" scroll={false}>next</Link><Image src="/original.png" width={30} height={40} alt="original" /></>
  }
  const Layout = ({ children }: RouteProps) => {
    const [count, setCount] = useState(0)
    return <section><button onClick={() => setCount(count + 1)}>{count}</button>{children}</section>
  }
  it('keeps layout state across sibling IDs and updates Promise params, hooks, hash and native cleanup', async () => {
    const registry = createSpaRouteRegistry({ '../app/wizard/[id]/page.tsx': async () => ({ default: Probe }) },
      { '../app/wizard/layout.tsx': async () => ({ default: Layout }) })
    history.replace('/wizard/first?q=one&q=also', { scroll: false })
    await act(async () => root.render(<SpaRouter history={history} registry={registry} loading="loading" notFound="404"
      renderError={error => error.message}>{content => <main>{content}</main>}</SpaRouter>))
    expect(host.querySelector('output')?.textContent).toBe('/wizard/first|first|first|one,also')
    await act(async () => host.querySelector('button')!.click())
    await act(async () => host.querySelector('a')!.click())
    expect(host.querySelector('button')?.textContent).toBe('1')
    expect(host.querySelector('output')?.textContent).toBe('/wizard/second|second|second|two')
    expect(history.getSnapshot().hash).toBe('#anchor')
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/original.png')
    expect(host.querySelector('img')?.getAttribute('width')).toBe('30')
    await act(async () => window.history.replaceState(null, '', '/wizard/second'))
    expect(host.querySelector('output')?.textContent).toBe('/wizard/second|second|second|')
    await act(async () => history.push('/missing'))
    expect(host.textContent).toBe('404')
  })
  it('shows original not-found UI for explicit notFound, and exposes import errors rather than placeholders', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const registry = createSpaRouteRegistry({ '../app/page.tsx': async () => ({ default: () => notFound() }),
      '../app/broken/page.tsx': async () => { throw new Error('chunk unavailable') } }, {})
    await act(async () => root.render(<SpaRouter history={history} registry={registry} loading="loading" notFound="original 404"
      renderError={(error, reset) => <button onClick={reset}>{error.message}</button>}>{content => content}</SpaRouter>))
    expect(host.textContent).toBe('original 404')
    await act(async () => history.push('/broken'))
    expect(host.textContent).toBe('chunk unavailable')
  })
})

describe('honest browser build boundary', () => {
  it('strips only reviewed metadata and preserves every actual layout renderer', () => {
    for (const path of SERVER_METADATA_LAYOUTS) {
      const source = readFileSync(resolve('web', path), 'utf8')
      const result = browserMetadataLayout(source, path)
      expect(result).toContain('return children')
      expect(result).not.toContain('prisma')
      expect(() => assertBrowserModule(result, path)).not.toThrow()
      expect(() => browserMetadataLayout(source.replace('return children', 'return <Provider>{children}</Provider>'), path)).toThrow('never discard')
    }
  })
  it.each(['export default async function Page() {}', 'import "server-only"', 'import { prisma } from "@db/prisma"', 'const secret = process.env.DATABASE_URL'])('fails rather than stubbing server behavior: %s', source => {
    expect(() => assertBrowserModule(source, 'app/test/page.tsx')).toThrow()
  })
  it('allows only public environment values and erased server metadata types', () => {
    expect(() => assertBrowserModule('import type { Metadata } from "next"; const x = process.env.NEXT_PUBLIC_CHAIN', 'client.ts')).not.toThrow()
    const config = readFileSync(resolve('web/vite.config.ts'), 'utf8')
    expect(config).toContain("'process.env': JSON.stringify(publicEnv)")
    expect(config).not.toContain('JSON.stringify(process.env)')
  })
})
