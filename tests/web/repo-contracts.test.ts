import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..')

describe('repository contract guards', () => {
  it('documents the current Soul and Prisma env requirements', () => {
    const envExample = readFileSync(join(repoRoot, '.env.example'), 'utf8')
    const prismaConfig = readFileSync(join(repoRoot, 'prisma.config.ts'), 'utf8')

    expect(envExample).toContain('AUTH_SECRET=')
    expect(envExample).toContain('DIRECT_URL=')
    expect(envExample).toContain('SHADOW_DATABASE_URL=')
    expect(envExample).toContain('TRUST_PROXY_HEADERS=')
    expect(envExample).toContain('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID=')
    expect(envExample).toContain('NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID=')
    expect(envExample).toContain('NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID=')
    expect(envExample).toContain('NEXT_PUBLIC_SOUL_COLLECTION_ID=')
    expect(envExample).toContain('NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID=')
    expect(envExample).toContain('NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID=')
    expect(envExample).toContain('NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE=')
    expect(envExample).toContain('NEXT_PUBLIC_KIOSK_PACKAGE_ID=')
    expect(envExample).toContain('required in deployments without the vendored Move.toml')
    expect(envExample).toContain('MEM9_API_KEY=local-dev-tenant-id-replace-in-production')
    expect(prismaConfig).toContain('shadowDatabaseUrl')
  })

  it('keeps the human Soul access and allowlist routes explicitly dynamic', () => {
    const accessRoute = readFileSync(join(repoRoot, 'web', 'app', 'api', 'souls', '[id]', 'access', 'route.ts'), 'utf8')
    const allowlistRoute = readFileSync(join(repoRoot, 'web', 'app', 'api', 'souls', '[id]', 'allowlist', 'route.ts'), 'utf8')

    expect(accessRoute).toContain("export const dynamic = 'force-dynamic'")
    expect(allowlistRoute).toContain("export const dynamic = 'force-dynamic'")
  })

  it('keeps the new Soul runtime schema on single-object models only', () => {
    const schema = readFileSync(join(repoRoot, 'prisma', 'schema.prisma'), 'utf8')

    expect(schema).toContain('model SoulAsset {')
    expect(schema).toContain('model SoulPreparedPurchase {')
    expect(schema).toContain('contentBlobId')
    expect(schema).toContain('allowlistCapOnChainId')
    expect(schema).not.toContain('model SoulSeries {')
    expect(schema).not.toContain('model SoulRelease {')
    expect(schema).not.toContain('model SoulPassSnapshot {')
  })

  it('keeps tx sync route keys aligned with the Soul-only runtime', () => {
    const txSyncSource = readFileSync(join(repoRoot, 'web', 'lib', 'souls', 'tx-sync.ts'), 'utf8')

    expect(txSyncSource).toContain(`'purchase' | 'publish' | 'allowlist:set' | 'allowlist:clear'`)
    expect(txSyncSource).not.toContain(`'release'`)
    expect(txSyncSource).not.toContain(`'renew'`)
  })

  it('uses the local vendored Kiosk package as the PersonalKioskCap address source', () => {
    const soulObjectMoveToml = readFileSync(join(repoRoot, 'move', 'soul_object', 'Move.toml'), 'utf8')
    const adapterMoveToml = readFileSync(join(repoRoot, 'move', 'soul_market_adapter', 'Move.toml'), 'utf8')
    const kioskMoveToml = readFileSync(join(repoRoot, 'move', 'vendor', 'kiosk', 'Move.toml'), 'utf8')
    const kioskHelper = readFileSync(join(repoRoot, 'web', 'lib', 'souls', 'kiosk-package.ts'), 'utf8')
    const onChainVerification = readFileSync(join(repoRoot, 'web', 'lib', 'souls', 'on-chain-verification.ts'), 'utf8')

    expect(soulObjectMoveToml).toContain('Kiosk = { local = "../vendor/kiosk", override = true }')
    expect(adapterMoveToml).toContain('Kiosk = { local = "../vendor/kiosk", override = true }')
    expect(kioskMoveToml).toContain('[addresses]')
    expect(kioskMoveToml).toContain('kiosk = "')
    expect(kioskHelper).toContain('NEXT_PUBLIC_KIOSK_PACKAGE_ID')
    expect(kioskHelper).toContain("path.join('move', 'vendor', 'kiosk', 'Move.toml')")
    expect(onChainVerification).toContain('getVendoredKioskPackageAddress()')
    expect(onChainVerification).not.toContain("normalizeSuiAddress('0x2')}::personal_kiosk::PersonalKioskCap")
  })

  it('keeps the pinned @mysten/sui ESM entrypoints present for Vitest alias resolution', () => {
    expect(existsSync(join(repoRoot, 'web', 'node_modules', '@mysten', 'sui', 'dist', 'transactions', 'index.mjs'))).toBe(true)
    expect(existsSync(join(repoRoot, 'web', 'node_modules', '@mysten', 'sui', 'dist', 'bcs', 'index.mjs'))).toBe(true)
  })

  it('uses the new publish flow and removes release/subscription UI entrypoints', () => {
    const publishPage = readFileSync(join(repoRoot, 'web', 'app', 'souls', 'publish', 'page.tsx'), 'utf8')
    const purchaseButton = readFileSync(join(repoRoot, 'web', 'components', 'souls', 'purchase-button.tsx'), 'utf8')
    const soulCard = readFileSync(join(repoRoot, 'web', 'components', 'souls', 'soul-card.tsx'), 'utf8')

    expect(publishPage).toContain('buildMintAndListSoulTx')
    expect(publishPage).not.toContain('buildPublishReleaseTx')
    expect(purchaseButton).not.toContain('planType')
    expect(soulCard).toContain('toSafeBackgroundImage')
    expect(soulCard).not.toContain('style={{ backgroundImage: `url("${previewImage}")` }}')
  })

  it('keeps the new Soul Move packages as the only active implementation', () => {
    const soulSource = readFileSync(join(repoRoot, 'move', 'soul_object', 'sources', 'soul.move'), 'utf8')
    const allowlistSource = readFileSync(join(repoRoot, 'move', 'soul_object', 'sources', 'allowlist.move'), 'utf8')
    const marketSource = readFileSync(join(repoRoot, 'move', 'soul_object', 'sources', 'market.move'), 'utf8')
    const sealPolicySource = readFileSync(join(repoRoot, 'move', 'soul_object', 'sources', 'seal_policy.move'), 'utf8')
    const adapterSource = readFileSync(join(repoRoot, 'move', 'soul_market_adapter', 'sources', 'market.move'), 'utf8')
    const testUsdcSource = readFileSync(join(repoRoot, 'move', 'test_usdc', 'sources', 'usdc.move'), 'utf8')

    expect(soulSource).toContain('public struct Soul has key, store')
    expect(soulSource).toContain('creator_royalty_bps')
    expect(allowlistSource).toContain('public struct SoulAllowlistCap has key, store')
    expect(marketSource).toContain('const EInvalidPrice')
    expect(marketSource).toContain('witness_rule')
    expect(marketSource).not.toContain('update_royalty_bps')
    expect(soulSource).toContain('public(package) fun publisher(self: &SoulPackageAuthority): &Publisher')
    expect(soulSource).not.toContain('public fun publisher(self: &SoulPackageAuthority): &Publisher')
    expect(soulSource).toContain('public(package) fun clear_allowlist_address_if_present(self: &mut Soul): bool')
    expect(soulSource).not.toContain('public fun clear_allowlist_address_if_present(self: &mut Soul): bool')
    expect(allowlistSource).toContain('public(package) fun clear_allowlist_address_if_present(registry: &mut AllowlistRegistry, soul: &mut Soul): bool')
    expect(allowlistSource).not.toContain('public fun clear_allowlist_address_if_present(registry: &mut AllowlistRegistry, soul: &mut Soul): bool')
    expect(sealPolicySource).toContain('seal_approve_owner_in_personal_kiosk')
    expect(sealPolicySource).toContain('seal_approve_allowlisted')
    expect(marketSource).toContain('public struct FixedPriceListing has key, store')
    expect(adapterSource).toContain('public fun mint_and_list_fixed_price(')
    expect(adapterSource).toContain('public fun list_fixed_price(')
    expect(adapterSource).toContain('public fun buy_fixed_price(')
    expect(marketSource).toContain('kiosk::list_with_purchase_cap')
    expect(adapterSource).toContain('authority: SoulPackageAuthority,')
    expect(adapterSource).toContain('soul::burn_authority(authority);')
    expect(testUsdcSource).toContain('public struct USDC has drop {}')
    expect(existsSync(join(repoRoot, 'move', 'soul_market'))).toBe(false)
  })

  it('adds the stablecoin hard-cut migration for listing objects and atomic price fields', () => {
    const migration = readFileSync(
      join(repoRoot, 'prisma', 'migrations', '20260329120000_hard_cut_soul_market_to_stablecoin_listing_objects', 'migration.sql'),
      'utf8',
    )

    expect(migration).toContain('RENAME COLUMN "listed_price_sui" TO "listed_price_atomic"')
    expect(migration).toContain('ADD COLUMN "listing_object_on_chain_id" TEXT')
    expect(migration).toContain(`"listing_status" = 'held'`)
    expect(migration).toContain('RENAME COLUMN "price_sui" TO "price_atomic"')
    expect(migration).toContain('ADD COLUMN "listing_object_id" TEXT')
    expect(migration).toContain('ADD COLUMN "platform_fee_atomic" DECIMAL(20, 0) NOT NULL DEFAULT 0')
    expect(migration).toContain('ADD COLUMN "creator_royalty_atomic" DECIMAL(20, 0) NOT NULL DEFAULT 0')
    expect(migration).toContain('ADD COLUMN "total_atomic" DECIMAL(20, 0) NOT NULL DEFAULT 0')
    expect(migration).toContain('DELETE FROM "soul_prepared_purchases"')
  })

  it('adds a standalone listing-status index for marketplace listing queries', () => {
    const schema = readFileSync(join(repoRoot, 'prisma', 'schema.prisma'), 'utf8')
    const migration = readFileSync(
      join(repoRoot, 'prisma', 'migrations', '20260329150000_add_soul_listing_status_indexes', 'migration.sql'),
      'utf8',
    )

    expect(schema).toContain('@@index([listingStatus, createdAt(sort: Desc)])')
    expect(migration).toContain(
      'CREATE INDEX "soul_assets_listing_status_created_at_idx" ON "soul_assets"("listing_status", "created_at" DESC);',
    )
  })

  it('hard-cuts Soul tx sync migrations to the current four-key contract', () => {
    const migration = readFileSync(
      join(repoRoot, 'prisma', 'migrations', '20260328110000_rename_soul_allowlist_fields', 'migration.sql'),
      'utf8',
    )

    expect(migration).not.toContain('"current_kiosk_cap_on_chain_id" = COALESCE("current_kiosk_cap_on_chain_id", "current_kiosk_id")')
    expect(migration).toContain('DELETE FROM "soul_prepared_purchases"')
    expect(migration).toContain('DELETE FROM "soul_assets"')
    expect(migration).toContain('ALTER COLUMN "current_kiosk_id" SET NOT NULL')
    expect(migration).toContain('DROP INDEX IF EXISTS "soul_assets_current_kiosk_cap_on_chain_id_key"')
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "soul_assets_current_kiosk_id_current_kiosk_cap_on_chain_id_idx"')
    expect(migration).toContain('DELETE FROM "soul_tx_syncs"')
    expect(migration).toContain(`WHERE "route_key" NOT IN ('purchase', 'publish', 'allowlist:set', 'allowlist:clear')`)
    expect(migration).toContain(`CHECK ("route_key" IN ('purchase', 'publish', 'allowlist:set', 'allowlist:clear'))`)
  })

  it('preserves historical tx sync migrations before the hard-cut cleanup migration', () => {
    const enumCheckMigration = readFileSync(
      join(repoRoot, 'prisma', 'migrations', '20260322233000_add_soul_enum_checks', 'migration.sql'),
      'utf8',
    )
    const releaseRouteMigration = readFileSync(
      join(repoRoot, 'prisma', 'migrations', '20260324130000_add_release_route_key', 'migration.sql'),
      'utf8',
    )
    const renewMigration = readFileSync(
      join(repoRoot, 'prisma', 'migrations', '20260325100000_add_renew_support', 'migration.sql'),
      'utf8',
    )

    expect(enumCheckMigration).toContain(`CHECK ("route_key" IN ('purchase', 'publish', 'grant:set', 'grant:revoke'))`)
    expect(releaseRouteMigration).toContain(`CHECK ("route_key" IN ('purchase', 'publish', 'release', 'grant:set', 'grant:revoke'))`)
    expect(renewMigration).toContain(`CHECK ("route_key" IN ('purchase', 'publish', 'release', 'grant:set', 'grant:revoke', 'renew'))`)
  })

  it('keeps agent deletion guarded by current Soul ownership and prepared purchase relations', () => {
    const agentsRoute = readFileSync(join(repoRoot, 'web', 'app', 'api', 'agents', 'route.ts'), 'utf8')

    expect(agentsRoute).toContain('tx.soulAsset.count({ where: { creatorMemberId: agentId } })')
    expect(agentsRoute).toContain('tx.soulAsset.count({ where: { currentOwnerMemberId: agentId } })')
    expect(agentsRoute).toContain('tx.soulPreparedPurchase.count({ where: { agentMemberId: agentId, resultStatusCode: null } })')
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
