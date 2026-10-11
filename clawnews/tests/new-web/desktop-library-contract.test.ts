import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

function functionBody(sourceText: string, functionName: string) {
  const start = sourceText.indexOf(`function ${functionName}`)
  expect(start).toBeGreaterThanOrEqual(0)
  const nextFunction = sourceText.indexOf('\nfunction ', start + 1)
  return sourceText.slice(start, nextFunction === -1 ? sourceText.length : nextFunction)
}

describe('desktop library source contract', () => {
  it('catalog list items include active sprite binding metadata consumed by the renderer', () => {
    const repository = source('web/lib/desktop/repository.ts')
    const mapper = functionBody(repository, 'toSoulCatalogItem')

    expect(mapper).toContain('activeSpriteName: soul.activeSpriteName')
    expect(mapper).toContain('activeSpriteVersionIndex')
    expect(mapper).toContain('Number(soul.activeSpriteVersionIndex)')
    expect(mapper).toContain('activeSpriteDownloadPolicy: normalizeActiveDownloadPolicy(soul.activeSpriteDownloadPolicy)')
  })

  it('authenticated dynamic Soul manifest fallback keeps held Souls private to their owner', () => {
    const route = source('web/app/api/desktop/catalog/[id]/route.ts')

    expect(route).toContain('resolveAuthenticatedHeldSoulManifest')
    expect(route).toContain('findDesktopPersonaManifestById(id)')
    expect(route).toContain('currentOwnerMemberId: true')
    expect(route).toContain('soul.currentOwnerMemberId !== member.id')
    expect(route).toContain('Authenticated desktop access to this held Soul requires ownership')
    expect(route).toContain('const manifest = publicManifest ?? heldSoulResult.manifest')
  })
})
