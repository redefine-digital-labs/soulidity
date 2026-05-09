import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('Soul detail content action source contract', () => {
  it('replaces the Phase 2 migration placeholder with real content action wiring', () => {
    const page = source('web/app/souls/[id]/page.tsx')
    const hook = source('web/lib/hooks/use-soul-content-actions.ts')

    expect(page).not.toContain('MigrationNote')
    expect(page).not.toContain('Decrypt unavailable')
    expect(page).toContain('useSoulContentActions')
    expect(page).toContain('SkillBundleFormatHint')
    expect(hook).toContain("pendingAction: 'append' | 'open' | 'delete' | 'purge' | 'set-active' | 'clear-active' | null")
    expect(hook).toContain('contentActionError')
  })

  it('uses the Phase 2 typed-content builders and unified sync route', () => {
    const hook = source('web/lib/hooks/use-soul-content-actions.ts')

    expect(hook).toContain('uploadSoulPayload')
    // Append now splices into the Walrus certify PTB so a single skill
    // upload costs 2 wallet signatures instead of 3 (register +
    // certify+append). The legacy standalone `buildAppendContentVersion*Tx`
    // helpers still exist in the SDK for non-upload callers (scripts), but
    // the hook uses the in-PTB `addAppendContentVersion*Calls` helpers.
    expect(hook).toContain('addAppendContentVersionAsOwnerCalls')
    expect(hook).toContain('addAppendContentVersionAsGrantedAgentCalls')
    expect(hook).toContain('attachAfterCertify')
    expect(hook).toContain('buildDeleteContentVersionAsOwnerTx')
    expect(hook).toContain('buildDeleteContentVersionAsGrantedAgentTx')
    expect(hook).toContain('buildPurgeContentVersionAsOwnerTx')
    expect(hook).toContain('buildSetActiveContentTx')
    expect(hook).toContain('buildClearActiveContentTx')
    expect(hook).toContain('buildContentSidecarsForVersionsWithSuiClient')
    expect(hook).toContain('/content/sync')
    expect(hook).not.toContain('memory.move')
    expect(hook).not.toContain('skills.move')
  })

  it('keeps grantee actions scoped and never exposes owner-only active or purge actions to grantees', () => {
    const page = source('web/app/souls/[id]/page.tsx')

    expect(page).toContain('SOUL_GRANT_SCOPE_ASSETS')
    expect(page).toContain('SOUL_GRANT_SCOPE_SKILLS')
    expect(page).toContain('SOUL_GRANT_SCOPE_MEMORY')
    expect(page).toContain('canAppendContent')
    expect(page).toContain('canPurgeContent')
    expect(page).toContain('canSetActiveContent')
    expect(page).toContain("role === 'owner'")
    expect(page).toContain("scopeMaskForKind(kind)")
  })

  it('prevents deleting the active sprite until the active binding is cleared or moved', () => {
    const page = source('web/app/souls/[id]/page.tsx')

    expect(page).toContain('isActiveSprite')
    expect(page).toContain('Clear or change the active sprite before deleting this version.')
    expect(page).toContain('disabled={pendingAction !== null || isActiveSprite || !canDelete}')
    expect(page).toContain('clearActiveContent')
  })
})
