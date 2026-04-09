import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('new-web responsive regression guards', () => {
  it('keeps the mobile navigation drawer viewport-bounded', () => {
    const source = readSource('new-web/components/nav/navbar.tsx')

    expect(source).toContain('max-h-[calc(100dvh-56px)]')
    expect(source).toContain('overflow-y-auto')
  })

  it('keeps the landing hero ctas and stats mobile-friendly', () => {
    const source = readSource('new-web/app/page.tsx')

    expect(source).toContain('w-full max-w-[30rem] flex-col')
    expect(source).toContain('grid w-full max-w-[880px] grid-cols-2')
    expect(source).toContain('lg:grid-cols-4')
  })

  it('stacks market controls before widening into rows', () => {
    const source = readSource('new-web/app/market/page.tsx')

    expect(source).toContain('flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row')
  })

  it('stacks step actions on narrow screens in the create and import flows', () => {
    const createContentSource = readSource('new-web/app/create/content/page.tsx')
    const importUploadSource = readSource('new-web/app/import/upload/page.tsx')

    expect(createContentSource).toContain('flex-col-reverse gap-2.5 sm:flex-row')
    expect(importUploadSource).toContain('flex-col-reverse gap-2.5 sm:flex-row')
  })
})
