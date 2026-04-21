import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('web collection create regression guards', () => {
  it('keeps the collection create hook pointed at the dedicated sync route', () => {
    const source = readSource('web/lib/hooks/use-collections.ts')

    expect(source).toContain("fetch('/api/collections/create'")
    expect(source).not.toContain("fetch('/api/collections', {")
  })

  it('keeps the desktop create menu pointed at /collections/create', () => {
    const source = readSource('web/components/nav/nav-create-menu.tsx')

    expect(source).toContain("label: 'Create Collection'")
    expect(source).toContain("href: '/collections/create'")
  })

  it('keeps the mobile nav exposing the collection create entry', () => {
    const source = readSource('web/components/nav/navbar.tsx')

    expect(source).toContain("href: '/collections/create'")
    expect(source).toContain("label: 'Create Collection'")
  })

  it('keeps the collection create route behind an AuthGate layout', () => {
    const source = readSource('web/app/collections/create/_shell.tsx')

    expect(source).toContain('<AuthGate')
    expect(source).toContain('label="Sign in to create a Collection"')
  })
})
