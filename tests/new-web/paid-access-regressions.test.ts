import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('paid-access revoke recovery', () => {
  it('routes revoke through exact-byte recovery and retires digest-only mirror replay', () => {
    const source = readSource('web/lib/hooks/use-paid-access.ts')
    expect(source).toContain('useSoulAccessMutations(soul, onSynced)')
    expect(source).toContain("access.mutate({ action: 'paid-revoke', granteeAddress: buyerAddress, kind })")
    expect(source).not.toContain('signAndExecute')
    expect(source).not.toContain('postRevokeSync')
    expect(readSource('web/lib/upload/walrus-recovery.ts')).not.toContain('persistPaidAccessRevokePending')
    for (const route of ['paid-access', 'grant', 'grant-capacity'])
      expect(existsSync(resolve(process.cwd(), `web/app/api/souls/[id]/${route}/route.ts`))).toBe(false)
  })
})

describe('paid-access ownership epoch filtering', () => {
  it('exposes the verified raw SoulState ownership epoch on browser detail without a Number conversion', () => {
    const model = readSource('web/lib/soulidity/soul-detail-model.ts')
    expect(model).toContain('s.ownershipEpoch === a.ownershipEpoch')
    expect(model).toContain('currentOwnershipEpoch: s.ownershipEpoch')
    expect(model).toContain('ownershipEpochSnapshot: e.ownership_epoch_snapshot')
  })

  it('counts and labels only same-epoch paid-access rows as active', () => {
    const page = readSource('web/app/souls/[id]/page.tsx')

    expect(page).toContain('const activeConfigs = soul.paidAccessKindConfigs.filter((c) => paidAccessConfigActive(c, soul))')
    expect(page).toContain('const activeVisibleCount = visibleEntries.filter((e) => paidEntryActive(e, soul)).length')
    expect(page).toContain('entry.ownershipEpochSnapshot === soul.currentOwnershipEpoch')
    expect(page).toContain('config.ownershipEpochSnapshot === soul.currentOwnershipEpoch')
    expect(page).toContain("const statusLabel = active ? 'active' : stale ? 'stale' : expired ? 'expired' : 'on file'")
  })
})
