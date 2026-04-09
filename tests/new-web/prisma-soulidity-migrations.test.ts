import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function loadMigrationSql() {
  const migrationsDir = join(process.cwd(), 'prisma', 'migrations')
  return readdirSync(migrationsDir)
    .filter((entry) => statSync(join(migrationsDir, entry)).isDirectory())
    .sort()
    .map((entry) => readFileSync(join(migrationsDir, entry, 'migration.sql'), 'utf8'))
    .join('\n\n')
}

describe('Soulidity projection migrations', () => {
  it('contains a migration that adds community post channel/article linkage columns', () => {
    const sql = loadMigrationSql()

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT \'general\'')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "article_id" UUID')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "posts_article_id_key"')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "posts_channel_idx"')
    expect(sql).toContain('ADD CONSTRAINT "posts_article_id_fkey"')
  })

  it('contains a migration that upgrades community post tags to text arrays with a gin index', () => {
    const sql = loadMigrationSql()

    expect(sql).toContain('ALTER TABLE "posts"')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "tags_v2" TEXT[]')
    expect(sql).toContain('RENAME COLUMN "tags_v2" TO "tags"')
    expect(sql).toContain('USING GIN ("tags")')
  })

  it('contains a migration that upgrades soul_memory_entries to timestamp_key addressing', () => {
    const sql = loadMigrationSql()

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "timestamp_key"')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "seal_sidecar"')
    expect(sql).toContain('DROP COLUMN IF EXISTS "entry_index"')
    expect(sql).toContain('DROP COLUMN IF EXISTS "on_chain_id"')
    expect(sql).toContain('"memory_on_chain_id", "timestamp_key"')
  })

  it('contains a migration that upgrades soul_skill_version_records to skill_name/version_index keys', () => {
    const sql = loadMigrationSql()

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "skill_name"')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "version_index"')
    expect(sql).toContain('DROP COLUMN IF EXISTS "version_on_chain_id"')
    expect(sql).toContain('DROP COLUMN IF EXISTS "version_number"')
    expect(sql).toContain('"skills_on_chain_id", "skill_name", "version_index"')
  })
})
