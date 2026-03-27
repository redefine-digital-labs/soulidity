import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..')

describe('repository contract guards', () => {
  it('documents core auth and Prisma env requirements', () => {
    const envExample = readFileSync(join(repoRoot, '.env.example'), 'utf8')
    const prismaConfig = readFileSync(join(repoRoot, 'prisma.config.ts'), 'utf8')

    expect(envExample).toContain('AUTH_SECRET=')
    expect(envExample).toContain('DIRECT_URL=')
    expect(envExample).toContain('SHADOW_DATABASE_URL=')
    expect(envExample).toContain('TRUST_PROXY_HEADERS=')
    expect(prismaConfig).toContain('shadowDatabaseUrl')
  })

  it('keeps the new Soul runtime schema on single-object models only', () => {
    const schema = readFileSync(join(repoRoot, 'prisma', 'schema.prisma'), 'utf8')

    expect(schema).toContain('model SoulAsset {')
    expect(schema).toContain('model SoulPreparedPurchase {')
    expect(schema).toContain('contentBlobId')
    expect(schema).toContain('agentAccessCapOnChainId')
    expect(schema).not.toContain('model SoulSeries {')
    expect(schema).not.toContain('model SoulRelease {')
    expect(schema).not.toContain('model SoulPassSnapshot {')
  })

  it('keeps tx sync route keys aligned with the Soul-only runtime', () => {
    const txSyncSource = readFileSync(join(repoRoot, 'web', 'lib', 'souls', 'tx-sync.ts'), 'utf8')

    expect(txSyncSource).toContain(`'purchase' | 'publish' | 'grant:set' | 'grant:revoke'`)
    expect(txSyncSource).not.toContain(`'release'`)
    expect(txSyncSource).not.toContain(`'renew'`)
  })

  it('uses the new publish flow and removes release/subscription UI entrypoints', () => {
    const publishPage = readFileSync(join(repoRoot, 'web', 'app', 'souls', 'publish', 'page.tsx'), 'utf8')
    const purchaseButton = readFileSync(join(repoRoot, 'web', 'components', 'souls', 'purchase-button.tsx'), 'utf8')

    expect(publishPage).toContain('buildMintAndListSoulTx')
    expect(publishPage).not.toContain('buildPublishReleaseTx')
    expect(purchaseButton).not.toContain('planType')
    expect(existsSync(join(repoRoot, 'web', 'app', 'souls', '[id]', 'release', 'page.tsx'))).toBe(false)
    expect(existsSync(join(repoRoot, 'web', 'app', 'api', 'souls', '[id]', 'renew', 'route.ts'))).toBe(false)
    expect(existsSync(join(repoRoot, 'web', 'app', 'api', 'agent', 'souls', '[id]', 'renew', 'route.ts'))).toBe(false)
  })

  it('keeps the new soul_object Move package as the active implementation while preserving legacy soul_market', () => {
    const soulSource = readFileSync(join(repoRoot, 'move', 'soul_object', 'sources', 'soul.move'), 'utf8')
    const grantSource = readFileSync(join(repoRoot, 'move', 'soul_object', 'sources', 'grant.move'), 'utf8')
    const marketSource = readFileSync(join(repoRoot, 'move', 'soul_object', 'sources', 'market.move'), 'utf8')
    const sealPolicySource = readFileSync(join(repoRoot, 'move', 'soul_object', 'sources', 'seal_policy.move'), 'utf8')

    expect(soulSource).toContain('public struct Soul has key, store')
    expect(grantSource).toContain('public struct SoulAccessCap has key, store')
    expect(marketSource).toContain('const EInvalidPrice')
    expect(marketSource).toContain('assert!(price > 0, EInvalidPrice);')
    expect(sealPolicySource).toContain('seal_approve_owner')
    expect(sealPolicySource).toContain('seal_approve_agent')
    expect(existsSync(join(repoRoot, 'move', 'soul_market', 'Move.toml'))).toBe(true)
  })

  it('keeps agent deletion guarded by current Soul ownership and prepared purchase relations', () => {
    const agentsRoute = readFileSync(join(repoRoot, 'web', 'app', 'api', 'agents', 'route.ts'), 'utf8')

    expect(agentsRoute).toContain('tx.soulAsset.count({ where: { creatorMemberId: agentId } })')
    expect(agentsRoute).toContain('tx.soulAsset.count({ where: { currentOwnerMemberId: agentId } })')
    expect(agentsRoute).toContain('tx.soulPreparedPurchase.count({ where: { agentMemberId: agentId } })')
    expect(agentsRoute).not.toContain('settlementEvent')
  })

  it('prevents agent claim tokens in the URL from leaking via Referer headers', () => {
    const agentClaimLayout = readFileSync(join(repoRoot, 'web', 'app', 'agent-claim', 'layout.tsx'), 'utf8')
    const agentClaimPage = readFileSync(join(repoRoot, 'web', 'app', 'agent-claim', 'page.tsx'), 'utf8')

    expect(agentClaimLayout).toContain("referrer: 'no-referrer'")
    expect(agentClaimLayout).toContain('index: false')
    expect(agentClaimPage).toContain('new URLSearchParams({ id, token }).toString()')
  })
})
