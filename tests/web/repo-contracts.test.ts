import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..')

describe('repository contract guards', () => {
  it('documents AUTH_SECRET in the sample environment when agent join requires it', () => {
    const envExample = readFileSync(join(repoRoot, '.env.example'), 'utf8')

    expect(envExample).toContain('AUTH_SECRET=')
  })

  it('documents Prisma direct and shadow database URLs when migrations define the database shape', () => {
    const envExample = readFileSync(join(repoRoot, '.env.example'), 'utf8')
    const prismaConfig = readFileSync(join(repoRoot, 'prisma.config.ts'), 'utf8')

    expect(envExample).toContain('DIRECT_URL=')
    expect(envExample).toContain('SHADOW_DATABASE_URL=')
    expect(prismaConfig).toContain('shadowDatabaseUrl')
  })

  it('documents trusted proxy configuration when auth challenge routes fail closed without a client IP', () => {
    const envExample = readFileSync(join(repoRoot, '.env.example'), 'utf8')

    expect(envExample).toContain('TRUST_PROXY_HEADERS=')
  })

  it('keeps settlement_events migration history aligned when SettlementEvent is removed from the schema', () => {
    const schema = readFileSync(join(repoRoot, 'prisma', 'schema.prisma'), 'utf8')

    if (schema.includes('model SettlementEvent')) {
      return
    }

    const migrationRoot = join(repoRoot, 'prisma', 'migrations')
    const migrationSql = readdirSync(migrationRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(migrationRoot, entry.name, 'migration.sql'))
      .filter((path) => {
        try {
          readFileSync(path, 'utf8')
          return true
        } catch {
          return false
        }
      })
      .map((path) => readFileSync(path, 'utf8'))

    const hasSettlementDrop = migrationSql.some((sql) =>
      /DROP TABLE(?: IF EXISTS)? "settlement_events";/i.test(sql),
    )

    expect(hasSettlementDrop).toBe(true)
  })

  it('keeps the soul pivot plan aligned with the current Prisma read models', () => {
    const schema = readFileSync(join(repoRoot, 'prisma', 'schema.prisma'), 'utf8')
    const pivotPlan = readFileSync(join(repoRoot, 'docs', 'plans', 'pivot.md'), 'utf8')

    expect(pivotPlan.includes('SoulGrantSnapshot')).toBe(schema.includes('model SoulGrantSnapshot'))
    expect(pivotPlan.includes('SettlementEvent')).toBe(schema.includes('model SettlementEvent'))
  })

  it('keeps unsafe release publishing UI turned off while the Seal flow is fail-closed', () => {
    const publishPage = readFileSync(join(repoRoot, 'web', 'app', 'souls', 'publish', 'page.tsx'), 'utf8')
    const releasePage = readFileSync(join(repoRoot, 'web', 'app', 'souls', '[id]', 'release', 'page.tsx'), 'utf8')

    expect(publishPage).not.toContain('buildPublishReleaseTx')
    expect(publishPage).not.toContain('SealClient')
    expect(releasePage).toContain('SOUL_RELEASE_FLOW_DISABLED_MESSAGE')
    expect(releasePage).not.toContain('useSignAndExecuteTransaction')
    expect(releasePage).not.toContain('UploadWalrus')
  })

  it('does not swallow client-side Soul mirror sync failures', () => {
    const purchaseButton = readFileSync(join(repoRoot, 'web', 'components', 'souls', 'purchase-button.tsx'), 'utf8')
    const passStatus = readFileSync(join(repoRoot, 'web', 'components', 'souls', 'pass-status.tsx'), 'utf8')

    expect(purchaseButton).not.toContain("}).catch(() => { /* on-chain TX succeeded, DB write can be retried */ })")
    expect(passStatus).not.toContain("}).catch(() => { /* on-chain TX succeeded */ })")
  })

  it('keeps Soul passes key-only so ownership changes must flow through package helpers', () => {
    const passSource = readFileSync(join(repoRoot, 'move', 'soul_market', 'sources', 'pass.move'), 'utf8')
    const grantSource = readFileSync(join(repoRoot, 'move', 'soul_market', 'sources', 'grant.move'), 'utf8')
    const purchaseSource = readFileSync(join(repoRoot, 'move', 'soul_market', 'sources', 'purchase.move'), 'utf8')

    expect(passSource).toContain('public struct PerpetualPass has key {')
    expect(passSource).toContain('public struct SubscriptionPass has key {')
    expect(passSource).toContain('public(package) fun transfer_perpetual(mut pass: PerpetualPass, recipient: address) {')
    expect(passSource).toContain('pass.owner = recipient;')
    expect(passSource).toContain('public(package) fun transfer_subscription(mut pass: SubscriptionPass, recipient: address) {')
    expect(passSource).not.toContain('set_perpetual_owner')
    expect(passSource).not.toContain('set_subscription_owner')
    expect(grantSource).not.toContain('transfer::public_transfer(pass, to);')
    expect(purchaseSource).not.toContain('transfer::public_transfer(pass, buyer);')
  })

  it('rejects empty series names and categories at the Move validation layer', () => {
    const seriesSource = readFileSync(join(repoRoot, 'move', 'soul_market', 'sources', 'series.move'), 'utf8')

    expect(seriesSource).toContain('const E_NAME_EMPTY: u64 = 37;')
    expect(seriesSource).toContain('const E_CATEGORY_EMPTY: u64 = 38;')
    expect(seriesSource).toContain('assert!(name.length() > 0, E_NAME_EMPTY);')
    expect(seriesSource).toContain('assert!(category.length() > 0, E_CATEGORY_EMPTY);')
  })

  it('removes the obsolete relayer module now that Souls only support Sui purchase paths', () => {
    const relayerPath = join(repoRoot, 'move', 'soul_market', 'sources', 'relayer.move')
    const eventsSource = readFileSync(join(repoRoot, 'move', 'soul_market', 'sources', 'events.move'), 'utf8')
    const passSource = readFileSync(join(repoRoot, 'move', 'soul_market', 'sources', 'pass.move'), 'utf8')
    const purchaseSource = readFileSync(join(repoRoot, 'move', 'soul_market', 'sources', 'purchase.move'), 'utf8')

    expect(existsSync(relayerPath)).toBe(false)
    expect(eventsSource).not.toContain('relayer.move')
    expect(passSource).not.toContain('purchase/relayer')
    expect(purchaseSource).not.toContain('relayer layers')
  })

  it('uses a domain-specific error before revoking a missing agent grant', () => {
    const grantSource = readFileSync(join(repoRoot, 'move', 'soul_market', 'sources', 'grant.move'), 'utf8')

    expect(grantSource).toContain('const E_NO_AGENT_GRANT')
    expect(grantSource).toContain('assert!(grant_mut.is_some(), E_NO_AGENT_GRANT);')
    expect(grantSource).toContain('event::emit(AgentGrantRevoked {')
  })

  it('guards deactivate_pricing_plan against mismatched series objects before mutating active_plans', () => {
    const purchaseSource = readFileSync(join(repoRoot, 'move', 'soul_market', 'sources', 'purchase.move'), 'utf8')
    const seriesSource = readFileSync(join(repoRoot, 'move', 'soul_market', 'sources', 'series.move'), 'utf8')
    const moveToml = readFileSync(join(repoRoot, 'move', 'soul_market', 'Move.toml'), 'utf8')
    const publishPage = readFileSync(join(repoRoot, 'web', 'app', 'souls', 'publish', 'page.tsx'), 'utf8')
    const soulsPage = readFileSync(join(repoRoot, 'web', 'app', 'souls', 'page.tsx'), 'utf8')
    const purchaseButton = readFileSync(join(repoRoot, 'web', 'components', 'souls', 'purchase-button.tsx'), 'utf8')
    const passStatus = readFileSync(join(repoRoot, 'web', 'components', 'souls', 'pass-status.tsx'), 'utf8')
    const webPackage = readFileSync(join(repoRoot, 'web', 'package.json'), 'utf8')

    expect(purchaseSource).toContain('assert!(series.series_id() == plan.series_id, E_PLAN_SERIES_MISMATCH);')
    expect(seriesSource).toContain('assert!(series.active_plans.contains(&plan_type), E_PLAN_TYPE_NOT_ACTIVE);')
    expect(seriesSource).toContain('assert!(series.author != recipient, E_SELF_TRANSFER);')
    expect(moveToml).toContain('Sui = { git = "https://github.com/MystenLabs/sui.git"')
    expect(purchaseButton).toContain('if (!planId) {')
    expect(passStatus).toContain("const isGrantPending = grantState === 'pending'")
    expect(passStatus).toContain('disabled={isGrantPending}')
    expect(publishPage).toContain('htmlFor="soul-name"')
    expect(publishPage).toContain('aria-pressed={pricingType === type}')
    expect(soulsPage).toContain('htmlFor="souls-search"')
    expect(soulsPage).toContain('id="souls-search"')
    expect(soulsPage).toContain('aria-pressed={active}')
    expect(webPackage).not.toContain('aftermath-ts-sdk')
  })
})
