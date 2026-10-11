import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..')
const legacyAllowlistRoutePath = join(repoRoot, 'web', 'app', 'api', 'souls', '[id]', 'allowlist', 'route.ts')

describe('soul allowlist route', () => {
  it('is removed from the active web runtime', () => {
    expect(existsSync(legacyAllowlistRoutePath)).toBe(false)
  })
})
