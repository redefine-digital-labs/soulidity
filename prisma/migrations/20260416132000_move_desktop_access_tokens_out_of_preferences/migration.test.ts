import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20260416132000_move_desktop_access_tokens_out_of_preferences/migration.sql',
)

describe('move desktop access tokens out of preferences migration', () => {
  it('backfills hash metadata columns from legacy preferences JSON', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('ADD COLUMN "desktop_access_token_hash" TEXT')
    expect(sql).toContain('ADD COLUMN "desktop_access_token_issued_at" TIMESTAMPTZ')
    expect(sql).toContain(`"preferences"->>'desktopAccessTokenHash'`)
    expect(sql).toContain(`"preferences"->>'desktopAccessTokenIssuedAt'`)
  })

  it('removes legacy token material from preferences and adds a unique hash index', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toContain(`- 'desktopAccessTokenPending'`)
    expect(sql).toContain(`- 'desktopAccessTokenHash'`)
    expect(sql).toContain(`- 'desktopAccessTokenIssuedAt'`)
    expect(sql).toContain(`- 'desktopAccessTokenSessionId'`)
    expect(sql).toContain('CREATE UNIQUE INDEX "desktop_profiles_desktop_access_token_hash_key"')
  })
})
