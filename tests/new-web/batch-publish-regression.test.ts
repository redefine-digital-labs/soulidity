import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('batch-publish price guards', () => {
  it('rejects zero-price CSV rows before any transaction is built', () => {
    const source = readSource('scripts/batch-publish.ts')

    expect(source).toContain("const priceUsdc = parseRequiredPositiveNumber(fields[4]!, 'priceUsdc', i + 2)")
    expect(source).toContain('function parseRequiredPositiveNumber(raw: string, fieldName: string, csvRow: number): number')
    expect(source).toContain('must be greater than 0')
  })

  it('guards list transaction construction and removes free-listing copy', () => {
    const source = readSource('scripts/batch-publish.ts')

    expect(source).toContain("throw new Error('priceAtomic must be positive')")
    expect(source).not.toContain('(free listing)')
  })
})
