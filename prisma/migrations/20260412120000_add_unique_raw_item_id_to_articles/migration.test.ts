import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20260412120000_add_unique_raw_item_id_to_articles/migration.sql',
)

describe('add unique raw_item_id to articles migration', () => {
  it('uses downstream refs and completion state to keep the canonical article', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/FROM "publications"/)
    expect(sql).toMatch(/FROM "posts"/)
    expect(sql).toMatch(/a\.status = 'published'/)
    expect(sql).toMatch(/a\.pipeline_status = 'completed'/)
  })
})
