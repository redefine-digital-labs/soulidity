import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

describe('desktop mac release config', () => {
  it('does not disable signing or notarization in the production mac build config', () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, 'desktop/apps/desktop/package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>
      build: { mac: Record<string, unknown> }
    }

    expect(pkg.build.mac).not.toHaveProperty('identity')
    expect(pkg.build.mac).not.toHaveProperty('notarize')
    expect(pkg.scripts['package:mac']).toContain('assert-mac-release-env')
    expect(pkg.scripts['package:mac:unsigned']).toContain('SOULIDITY_ALLOW_UNSIGNED_MAC_BUILD=1')
  })
})
