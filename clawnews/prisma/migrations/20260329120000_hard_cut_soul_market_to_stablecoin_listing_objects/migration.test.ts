import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20260329120000_hard_cut_soul_market_to_stablecoin_listing_objects/migration.sql',
)
const manualIndexesPath = resolve(process.cwd(), 'prisma/MANUAL_INDEXES.md')

describe('hard-cut stablecoin listing migration', () => {
  it('only resets legacy soul asset rows without listing object ids', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/UPDATE "soul_assets"[\s\S]*WHERE "listing_object_on_chain_id" IS NULL;/)
  })

  it('tracks the hand-managed partial unique index in the manual index registry', () => {
    const doc = readFileSync(manualIndexesPath, 'utf8')
    expect(doc).toContain('soul_assets_listing_object_on_chain_id_key')
    expect(doc).toContain('20260329120000_hard_cut_soul_market_to_stablecoin_listing_objects')
  })
})
