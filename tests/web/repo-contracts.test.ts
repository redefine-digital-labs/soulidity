import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..')

describe('repository contract guards', () => {
  it('documents AUTH_SECRET in the sample environment when agent join requires it', () => {
    const envExample = readFileSync(join(repoRoot, '.env.example'), 'utf8')

    expect(envExample).toContain('AUTH_SECRET=')
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
})
