import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('soul success navigation regression guards', () => {
  it('redirects create publish success to the Soul Born page', () => {
    const source = readSource('web/app/create/gas/page.tsx')

    expect(source).toContain("router.replace('/create/success')")
  })

  it('redirects import publish success to the Soul Born page', () => {
    const source = readSource('web/app/import/gas/page.tsx')

    expect(source).toContain("router.replace('/import/success')")
  })
})
