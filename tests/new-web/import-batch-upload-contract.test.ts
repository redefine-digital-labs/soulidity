import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const readSource = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

// Structural removal guards; actual field/order/recovery behavior is exercised
// by ordinary-create-controller and import-create-page, not inferred here.
describe('import durable authoring entry contract', () => {
  it('submits original Files to the shared identity-first flow, with no pre-upload or fake resume inputs', () => {
    const page = readSource('web/app/import/gas/page.tsx'), hook = readSource('web/lib/hooks/use-import.ts')
    expect(page).toContain('originRef: ctx.originRef')
    expect(page).toContain('cover: withMime(ctx.coverImageFile)')
    expect(page).toContain('character: withMime(ctx.charFile)')
    expect(page).toContain('memory: withMime(ctx.memoryFile)')
    expect(hook).toContain("useSingleSoulAuthoring(approve, 'IMPORTED')")
    for (const old of ['prepareSoulBlobsForBatchPublish', 'attachWalrusCertifyCalls', 'sealMaterial', '__e2eLastSealMaterial', 'Resume Sync', 'Start Over'])
      expect(page).not.toContain(old)
    expect(hook).not.toContain('/api/'); expect(hook).not.toContain('sessionStorage')
    expect(readSource('web/components/providers/import-soul-provider.tsx')).not.toContain('PendingSealMaterial')
  })
  it('preserves selected royalty accessibility and original import contract label', () => {
    const map = readSource('web/app/import/map/page.tsx')
    expect(map).toContain('aria-pressed={ctx.royalty === opt.value}')
    expect(map).toContain("desc: '5%', recommended: true")
    expect(readSource('web/app/import/gas/page.tsx')).toContain('market::mint_imported_in_personal_kiosk_v2')
  })
})
