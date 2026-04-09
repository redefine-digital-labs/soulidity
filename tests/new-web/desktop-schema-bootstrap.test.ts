import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function readTextIfExists(...segments: string[]) {
  const filePath = join(process.cwd(), ...segments)
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
}

function loadMigrationSql() {
  const migrationsDir = join(process.cwd(), 'prisma', 'migrations')
  return readdirSync(migrationsDir)
    .filter((entry) => statSync(join(migrationsDir, entry)).isDirectory())
    .sort()
    .map((entry) => readTextIfExists('prisma', 'migrations', entry, 'migration.sql'))
    .join('\n\n')
}

describe('Desktop bootstrap schema', () => {
  it('declares starter/catalog/device/profile models in prisma schema', () => {
    const schema = readTextIfExists('prisma', 'schema.prisma')

    expect(schema).toContain('model StarterPersonaAsset')
    expect(schema).toContain('model DesktopCatalogEntry')
    expect(schema).toContain('model DesktopDeviceSession')
    expect(schema).toContain('model DesktopProfile')
    expect(schema).toContain('desktopProfile')
    expect(schema).toContain('desktopDeviceSessions')
  })

  it('ships a migration for desktop catalog/device/profile tables and keys', () => {
    const sql = loadMigrationSql()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "starter_persona_assets"')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "desktop_catalog_entries"')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "desktop_device_sessions"')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "desktop_profiles"')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "desktop_catalog_entries_source_type_source_ref_key"')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "desktop_device_sessions_device_code_key"')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "desktop_device_sessions_user_code_key"')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "desktop_profiles_account_id_key"')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "desktop_catalog_entries_is_published_is_hidden_sort_order_idx"')
  })

  it('provides a local seed path that upserts one starter asset and one curated soul catalog entry', () => {
    const packageJson = readTextIfExists('package.json')
    const seedScript = readTextIfExists('scripts', 'seed-desktop.ts')

    expect(packageJson).toContain('"seed:desktop"')
    expect(seedScript).toContain('prisma.starterPersonaAsset.upsert')
    expect(seedScript).toContain('prisma.soulAsset.upsert')
    expect(seedScript).toContain('prisma.desktopCatalogEntry.upsert')
    expect(seedScript).toContain("sourceType: 'starter'")
    expect(seedScript).toContain("sourceType: 'soul'")
  })
})
