import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const canonicalManifestPath = 'packages/soulidity-sdk/src/deployment-manifest.json'
const canonicalManifestJoin = "'packages', 'soulidity-sdk', 'src', 'deployment-manifest.json'"
const staleManifestPath = 'web/lib/soulidity/deployment-manifest.json'

function source(relativePath: string) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8')
}

describe('Soulidity manifest script wiring', () => {
  it('keeps operational scripts on the SDK deployment manifest', () => {
    expect(existsSync(resolve(repoRoot, canonicalManifestPath))).toBe(true)
    expect(existsSync(resolve(repoRoot, staleManifestPath))).toBe(false)

    for (const file of [
      'scripts/phase2-smoke.ts',
      'scripts/phase2-mainnet-execute-rest.ts',
      'scripts/phase2-retry-failed.ts',
      'scripts/phase2-finish-skipped.ts',
      'scripts/publish-soulidity-and-sync.ts',
      'web/scripts/e2e-paid-access-lifecycle.ts',
    ]) {
      const contents = source(file)
      expect(
        contents.includes(canonicalManifestPath) || contents.includes(canonicalManifestJoin),
        file,
      ).toBe(true)
      expect(contents, file).not.toContain(staleManifestPath)
    }
  })
})
