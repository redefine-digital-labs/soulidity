import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { composeMySoulsPortfolio } from '../../web/lib/soulidity/soul-portfolio-model'
import { mySoulsFixture, id } from './fixtures/my-souls'

describe('Soul grant serialization', () => {
  it('preserves the assets scope in the still-used private repository grant records', async () => {
    const { toSoulGrantRecord } = await import('../../web/lib/soulidity/repository')
    expect(toSoulGrantRecord({ id: 'grant-db-1', onChainId: id(4), soulOnChainId: id(3),
      issuedByAddress: id(1), issuedByMemberId: 'issuer-1', granteeAddress: id(2), granteeMemberId: 'grantee-1',
      scopes: ['assets'], status: 'active', expiresAt: null, endedAt: null, replacedByGrantOnChainId: null,
      createdAt: new Date('2026-04-11T00:00:00.000Z'), updatedAt: new Date('2026-04-11T00:00:00.000Z'),
    } as any).scopes).toEqual(['assets'])
  })

  it('preserves assets scope and exact issue time through the replacement chain portfolio projection', () => {
    const f = mySoulsFixture(), activity = f.activity()
    activity.activity.grants[0].scopes = ['assets']; activity.activity.grants[0].scopeMask = 8
    const portfolio = composeMySoulsPortfolio({ owner: f.owner, originalPackageId: id(1), owned: null, collections: null, activity })
    expect(portfolio.grants).toEqual([expect.objectContaining({ onChainId: id(900), scopes: ['assets'],
      createdAtMs: '123', createdAt: '1970-01-01T00:00:00.123Z', status: null })])
  })

  it('preserves every verified purchase with exact totals and dates without current ownership or a SQL sync row', () => {
    const f = mySoulsFixture(), activity = f.activity('COMPLETE', 61)
    Object.assign(activity.activity.purchases[60], { soulOnChainId: id(1666), paidAtomic: '100000', totalAtomic: '107500',
      platformFeeAtomic: '2500', creatorRoyaltyAtomic: '5000', createdAtMs: '1775952000000', createdAt: '2026-04-12T00:00:00.000Z' })
    const portfolio = composeMySoulsPortfolio({ owner: f.owner, originalPackageId: id(1), owned: f.owned(), collections: null, activity })
    expect(portfolio.owned).toHaveLength(0); expect(portfolio.purchases).toHaveLength(61)
    expect(portfolio.purchases[60]).toMatchObject({ soulOnChainId: id(1666), soulName: null,
      paidAtomic: '100000', totalAtomic: '107500', createdAtMs: '1775952000000', createdAt: '2026-04-12T00:00:00.000Z' })
    expect(portfolio.purchases[0].paidAtomic).toBe('9007199254740993')
  })

  it('keeps agent access route selector and Seal byte-compare script wired', () => {
    const routeSource = readFileSync('web/app/api/agent/souls/[id]/access/route.ts', 'utf8')
    const scriptSource = readFileSync('web/scripts/e2e-agent-decrypt.ts', 'utf8')
    const paidAccessScriptSource = readFileSync('web/scripts/e2e-paid-access-lifecycle.ts', 'utf8')
    expect(routeSource).toContain("searchParams.get('kind')")
    expect(routeSource).toContain('version.kind === selector.kind')
    expect(scriptSource).toContain('CONTENT_KIND'); expect(scriptSource).toContain('OK byte compare')
    expect(paidAccessScriptSource).toContain('createSuiGrpcCompatClient')
    expect(paidAccessScriptSource).not.toContain('new SuiJsonRpcClient')
  })
})
