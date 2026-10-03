import { existsSync, readFileSync } from 'node:fs'
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
    expect(hook).toContain("pendingAction: 'append' | 'open' | 'delete' | 'purge' | 'set-active' | 'clear-active' | 'recovery' | null")
    expect(hook).toContain('contentActionError')
  })

  it('routes encrypted append through the atomic envelope attachment while retaining other typed mutations', () => {
    const hook = source('web/lib/hooks/use-soul-content-actions.ts')
    const operation = source('web/lib/soulidity/content-append-operation.ts')
    expect(hook).toContain('useSoulContentAppend')
    expect(operation).toContain('uploadPreparedSoulPayload')
    expect(operation).toContain('addAppendContentVersionAsOwnerCalls')
    expect(operation).toContain('addAppendContentVersionAsGrantedAgentCalls')
    expect(operation).toContain('expectedVersionIndex: s.versionIndex')
    expect(operation).toContain('encryptedEnvelope: contentAppendPreparedEnvelope(record, blobObjectId)')
    const mutation = source('web/lib/soulidity/content-mutation-transaction.ts')
    expect(mutation).toContain('buildDeleteContentVersionAsOwnerTx')
    expect(mutation).toContain('buildDeleteContentVersionAsGrantedAgentTx')
    expect(mutation).toContain('buildPurgeContentVersionAsOwnerTx')
    expect(mutation).toContain('buildSetActiveContentTx')
    expect(mutation).toContain('buildClearActiveContentTx')
    expect(hook).toContain('useSoulContentMutations')
    expect(hook).not.toContain('buildContentSidecarsForVersionsWithSuiClient')
    expect(hook).not.toContain('/content/sync')
    expect(hook).not.toContain('signAndExecute')
    expect(hook).not.toContain('setStateConfig')
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

  it('persists the signed encrypted stage before payment and acknowledges only after exact raw final readback', () => {
    const hook = source('web/lib/hooks/use-soul-content-append.ts')
    const operation = source('web/lib/soulidity/content-append-operation.ts')
    expect(hook.indexOf('await store.create(key, record)')).toBeGreaterThan(hook.indexOf('record = await prepareContentAppend'))
    expect(hook.indexOf('await store.create(key, record)')).toBeLessThan(hook.lastIndexOf('return run(record, controller, guard)'))
    expect(operation.indexOf('const version = assertContentAppendFinal')).toBeLessThan(operation.indexOf('deps.acknowledge ??'))
    expect(source('web/lib/upload/walrus-recovery.ts')).not.toContain('persistContentSyncPending')
  })

  it('mounts explicit encrypted recovery for all detail tabs without an automatic SQL replay', () => {
    const page = source('web/app/souls/[id]/page.tsx')
    const hook = source('web/lib/hooks/use-soul-content-actions.ts')
    const workspace = page.slice(page.indexOf('function Workspace'), page.indexOf('function PanelHead'))
    expect(page).not.toContain('useSoulContentSyncReplay')
    expect(hook).not.toContain('useSoulContentSyncReplay')
    expect(workspace.indexOf('<ContentAppendRecoveryPanel')).toBeGreaterThan(-1)
    expect(workspace.indexOf('<ContentAppendRecoveryPanel')).toBeLessThan(workspace.indexOf("{tab === 'info'"))
    expect(workspace.indexOf('<ContentMutationRecoveryPanel')).toBeGreaterThan(-1)
    expect(workspace.indexOf('<ContentMutationRecoveryPanel')).toBeLessThan(workspace.indexOf("{tab === 'info'"))
    expect(page).toContain('Check imported transaction')
    expect(page).toContain('Resume recorded upload')
  })
  it('removes the replaced mutation transport and its dedicated mirror writers', () => {
    expect(existsSync(resolve(process.cwd(), 'web/app/api/souls/[id]/content/sync/route.ts'))).toBe(false)
    for (const name of ['markContentVersionDeleted', 'markContentVersionPurged']) {
      expect(source('web/lib/soulidity/mirror/sync-helpers.ts')).not.toContain(name)
      expect(source('web/lib/soulidity/mirror/upsert-content-version.ts')).not.toContain(name)
    }
    expect(source('web/app/resources/api-sdk/page.tsx')).not.toContain('/content/sync')
    expect(source('web/lib/soulidity/mirror/tx-sync.ts')).not.toContain("'content:delete'")
    expect(source('web/lib/soulidity/mirror/tx-sync.ts')).not.toContain("'state-config:upsert'")
  })
})
