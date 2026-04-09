import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('sell flow regression guards', () => {
  it('redirects to sell success from a stable route id after listing completes', () => {
    const source = readSource('web/app/souls/[id]/sell/authorize/page.tsx')

    expect(source).toContain("if (status !== 'done') return")
    expect(source).toContain("router.replace(`/souls/${encodeURIComponent(id)}/sell/success?price=${encodeURIComponent(rawPrice)}`)")
    expect(source).not.toContain("if (status === 'done' && soul)")
  })
})
