import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

describe('repository health cleanup', () => {
  it('removes the disabled legacy batch publisher from active code and tests', () => {
    expect(existsSync(join(repoRoot, 'scripts/batch-publish.ts'))).toBe(false)
    expect(existsSync(join(repoRoot, 'tests/new-web/batch-publish-regression.test.ts'))).toBe(false)
    expect(read('tsconfig.json')).not.toContain('scripts/batch-publish.ts')
  })

  it('keeps executable batch-publish instructions out of active docs', () => {
    const activeDocPaths = [
      'docs/plans/2026-04-23-rebind-primary-kiosk.md',
      'docs/superpowers/plans/2026-04-15-soul-templates-20.md',
    ]

    for (const docPath of activeDocPaths) {
      const content = existsSync(join(repoRoot, docPath)) ? read(docPath) : ''
      expect(content).not.toContain('scripts/batch-publish.ts')
    }
  })
})
