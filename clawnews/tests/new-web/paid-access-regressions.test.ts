import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('paid-access revoke recovery', () => {
  it('persists the committed revoke digest before mirror sync and replays it before signing again', () => {
    const source = readSource('web/lib/hooks/use-paid-access.ts')
    const signed = source.indexOf('const result = await signAndExecute(tx)')
    const asserted = source.indexOf("const executed = assertSoulidityTxSucceeded(result, 'Paid-access revoke transaction')")
    const persisted = source.indexOf('persistPaidAccessRevokePending({')
    const synced = source.indexOf('const synced = await postRevokeSync({ txDigest: executed.digest, buyerAddress, kind })')

    expect(signed).toBeGreaterThanOrEqual(0)
    expect(asserted).toBeGreaterThan(signed)
    expect(persisted).toBeGreaterThan(asserted)
    expect(synced).toBeGreaterThan(persisted)
    expect(source).toContain('assertSoulidityTxSucceeded,')
    expect(source).toContain('readPaidAccessRevokePendingForSoul({')
    expect(source).toContain('samePendingTarget(record, buyerAddress, kind)')
    expect(source).toContain('await replayPendingRecord(record)')
  })
})

describe('paid-access ownership epoch filtering', () => {
  it('exposes the live SoulState ownership epoch on the human detail payload', () => {
    const route = readSource('web/app/api/souls/[id]/route.ts')

    expect(route).toContain('getSoulStateObject(soul.stateOnChainId, packageId')
    expect(route).toContain('currentOwnershipEpoch = state.ownershipEpoch')
    expect(route).toContain('currentOwnershipEpoch,')
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
