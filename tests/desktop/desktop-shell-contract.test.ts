import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8')) as T
}

describe('desktop tauri shell contract', () => {
  it('defines the desktop package scripts and tauri dev/build wiring', () => {
    const pkg = readJson<{
      scripts?: Record<string, string>
    }>('desktop/package.json')

    expect(pkg.scripts).toMatchObject({
      dev: 'vite',
      build: 'npm run typecheck && vite build',
      preview: 'vite preview',
      typecheck: 'tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json',
      tauri: 'tauri',
    })

    const tauriConfig = readJson<{
      build?: Record<string, string>
    }>('desktop/src-tauri/tauri.conf.json')

    expect(tauriConfig.build).toMatchObject({
      beforeDevCommand: 'npm run dev',
      devUrl: 'http://localhost:1420',
      beforeBuildCommand: 'npm run build',
      frontendDist: '../dist',
    })

    const capability = readJson<{
      permissions?: string[]
    }>('desktop/src-tauri/capabilities/default.json')

    expect(capability.permissions).toContain('core:default')
  })

  it('publishes the phase-one desktop route definitions and primary navigation items', async () => {
    const routeModule = await import('../../desktop/src/app/routes.ts')

    expect(routeModule.desktopRouteDefinitions).toEqual([
      { id: 'home', path: '/', nav: true, title: 'Home' },
      { id: 'explore', path: '/explore', nav: true, title: 'Explore' },
      { id: 'search', path: '/search', nav: true, title: 'Search' },
      { id: 'persona', path: '/persona/:id', nav: false, title: 'Persona Detail' },
      { id: 'library', path: '/library', nav: true, title: 'Library' },
      { id: 'settings', path: '/settings', nav: true, title: 'Settings' },
      { id: 'auth', path: '/auth', nav: true, title: 'Auth' },
    ])

    expect(routeModule.desktopPrimaryNavItems).toEqual([
      { id: 'home', to: '/' },
      { id: 'explore', to: '/explore' },
      { id: 'search', to: '/search' },
      { id: 'library', to: '/library' },
      { id: 'settings', to: '/settings' },
      { id: 'auth', to: '/auth' },
    ])

    expect(routeModule.resolveDesktopRoute('/persona/aurora')).toEqual({
      definition: { id: 'persona', path: '/persona/:id', nav: false, title: 'Persona Detail' },
      params: { id: 'aurora' },
      pathname: '/persona/aurora',
    })
  })
})
