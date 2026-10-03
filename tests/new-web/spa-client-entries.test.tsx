// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHistoryRouter, type HistoryRouter } from '../../web/spa/history'
import { createSpaRouteRegistry, SpaRouter } from '../../web/spa/router'
import { useSearchParams } from '../../web/spa/navigation'
import DownloadPage from '../../web/app/download/page'
import DesktopLinkPage from '../../web/app/desktop/link/page'
import IntegrationPage from '../../web/app/integrations/animacraft/page'
import { handoffFromSearch } from '../../web/app/integrations/animacraft/client-entry'
import { configuredDesktopRelease, loadDesktopRelease } from '../../web/app/download/desktop-release'
import { assertBrowserModule } from '../../web/spa/build-boundary'

vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_DESKTOP_MANIFEST_URL', 'https://releases.example/manifest.json')
  vi.stubEnv('NEXT_PUBLIC_DESKTOP_MAC_ARM64_URL', 'https://releases.example/fallback.dmg')
  vi.stubEnv('NEXT_PUBLIC_DESKTOP_VERSION', '0.0.4')
})
vi.mock('../../web/node_modules/next/navigation.js', () => import('../../web/spa/navigation'))
vi.mock('../../web/node_modules/next/link.js', () => import('../../web/spa/link'))
vi.mock('../../web/app/integrations/animacraft/integration-client', () => ({
  AnimacraftIntegrationClient: ({ handoff }: { handoff: unknown }) => <output>{JSON.stringify(handoff)}</output>,
}))

let root: Root, host: HTMLDivElement, history: HistoryRouter
const config = { manifestUrl: 'https://releases.example/manifest.json', downloadUrl: 'https://releases.example/fallback.dmg', version: '0.0.4' }
const manifest = () => new Response(JSON.stringify({ version: '1.2.3', mac: { arm64: { url: 'https://releases.example/new.dmg' } } }))
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.history.replaceState(null, '', '/')
  history = createHistoryRouter(window)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); history.dispose(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
afterAll(() => vi.unstubAllEnvs())

async function render(path: string) {
  const registry = createSpaRouteRegistry({ '../app/download/page.tsx': async () => ({ default: DownloadPage }),
    '../app/desktop/link/page.tsx': async () => ({ default: DesktopLinkPage }),
    '../app/integrations/animacraft/page.tsx': async () => ({ default: IntegrationPage }),
    '../app/account/pets/page.tsx': async () => ({ default: () => <output>pair:{useSearchParams().get('link')}</output> }),
  }, {})
  history.replace(path, { scroll: false })
  await act(async () => root.render(<SpaRouter history={history} registry={registry} loading="loading" notFound="404"
    renderError={error => error.message}>{content => content}</SpaRouter>))
}

it.each([['?link=a%2Bb%26c&link=ignored', '/account/pets?link=a%2Bb%26c', 'pair:a+b&c'],
  ['?link=&link=ignored', '/account/pets', 'pair:'], ['', '/account/pets', 'pair:']])('preserves desktop first-link and replacement semantics: %s', async (query, target, text) => {
  const initialLength = window.history.length
  await render('/desktop/link' + query)
  expect(window.location.pathname + window.location.search).toBe(target)
  expect(window.history.length).toBe(initialLength)
  expect(host.textContent).toBe(text)
})

it('passes the original handoff fields to the existing client and responds to native query changes', async () => {
  await render('/integrations/animacraft?source=animacraft&root=0x1&owner=0x2&returnOrigin=https%3A%2F%2Fmaker.example&returnNonce=nonce')
  expect(JSON.parse(host.querySelector('output')!.textContent!)).toEqual({ source: 'animacraft', root: '0x1', owner: '0x2', returnOrigin: 'https://maker.example', returnNonce: 'nonce' })
  await act(async () => window.history.replaceState(null, '', '/integrations/animacraft?root=first&root=second&owner=new'))
  expect(JSON.parse(host.querySelector('output')!.textContent!)).toMatchObject({ root: '', owner: 'new', source: '' })
})
it.each(['source', 'root', 'owner', 'returnOrigin', 'returnNonce'])('still rejects duplicated security-relevant handoff field %s', field => {
  expect(handoffFromSearch(new URLSearchParams(`${field}=one&${field}=two`))[field as keyof ReturnType<typeof handoffFromSearch>]).toBe('')
})

it('retains original download UI, reports fallback honestly, and retries into the fetched release', async () => {
  let reject!: (error: Error) => void
  const request = vi.fn().mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure })).mockResolvedValueOnce(manifest())
  vi.stubGlobal('fetch', request)
  await render('/download')
  expect(host.textContent).toContain('Bring your Souls')
  expect(host.textContent).toContain('Checking the public release manifest')
  expect(host.querySelector('a[download]')?.getAttribute('href')).toBe(config.downloadUrl)
  await act(async () => reject(new Error('CORS unavailable')))
  expect(host.textContent).toContain('its version is not verified')
  expect(host.textContent).toContain('CORS unavailable')
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Retry release check')!.click())
  expect(host.querySelector('a[download]')?.getAttribute('href')).toBe('https://releases.example/new.dmg')
  expect(host.textContent).toContain('v1.2.3')
  expect(host.textContent).not.toContain('CORS unavailable')
  expect(host.textContent).toContain('System requirements')
  expect(host.textContent).toContain('Link device')
  expect(request.mock.calls[0][1]).toMatchObject({ credentials: 'omit' })
})

it('cancels in-flight download discovery when leaving its original page', async () => {
  let signal!: AbortSignal
  vi.stubGlobal('fetch', vi.fn((_url, options) => { signal = options.signal
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
  }))
  await render('/download')
  expect(signal.aborted).toBe(false)
  await act(async () => history.replace('/account/pets', { scroll: false }))
  expect(signal.aborted).toBe(true)
})

it('uses only explicit public fallback when no manifest exists', async () => {
  const request = vi.fn()
  const result = await loadDesktopRelease({ downloadUrl: config.downloadUrl }, request, new AbortController().signal)
  expect(request).not.toHaveBeenCalled()
  expect(result).toMatchObject({ status: 'ready', release: { source: 'env', version: '0.0.4' } })
  expect(configuredDesktopRelease({ downloadUrl: 'javascript:alert(1)' })).toMatchObject({ source: 'none', macArm64Url: '' })
})
it.each([new Response('{}'), new Response('invalid JSON'), new Response('', { status: 503 }),
  new Response(JSON.stringify({ version: '1', mac: { arm64: { url: 'https://user:secret@download.example/file' } } }))])('exposes invalid/failed release discovery with only the configured fallback', async response => {
  const result = await loadDesktopRelease(config, vi.fn().mockResolvedValue(response), new AbortController().signal)
  expect(result.status).toBe('error')
  expect(result.release).toEqual(configuredDesktopRelease(config))
})
it('aborts a slow request and distinguishes timeout from a discovered release', async () => {
  const request = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))))
  const result = await loadDesktopRelease(config, request as typeof fetch, new AbortController().signal, 1)
  expect(result.status).toBe('error')
  expect(result.error).toContain('timed out')
  expect(result.release.source).toBe('env')
})
it('keeps every changed entry inside the existing browser guard without a private environment mapping', () => {
  for (const path of ['download/page.tsx', 'download/download-client.tsx', 'download/desktop-release.ts', 'desktop/link/page.tsx',
    'integrations/animacraft/page.tsx', 'integrations/animacraft/client-entry.tsx']) {
    expect(() => assertBrowserModule(readFileSync('web/app/' + path, 'utf8'), path)).not.toThrow()
  }
})
