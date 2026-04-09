import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('desktop device confirmation page regression guards', () => {
  it('keeps the browser confirmation flow bound to userCode context and the complete API', () => {
    const source = readSource('web/app/desktop/device/page.tsx')

    expect(source).toContain("const userCode = searchParams.get('userCode')?.trim().toUpperCase() ?? ''")
    expect(source).toContain("fetch('/api/desktop/device/complete'")
    expect(source).toContain('void login()')
    expect(source).toContain('href={completeResult.deepLink}')
    expect(source).toContain('Open Soulidity Desktop')
  })
})
