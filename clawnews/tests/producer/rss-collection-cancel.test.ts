import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('content production RSS collection cutoff', () => {
  it('does not schedule RSS collection in the content generation runtime', () => {
    const scheduler = readSource('src/scheduler.ts')

    expect(scheduler).not.toContain('rss_collection')
    expect(scheduler).not.toContain('Running RSS collection')
    expect(scheduler).not.toContain('collectRss')
  })

  it('keeps the default collector CLI from collecting RSS sources', () => {
    const collectorRun = readSource('src/collector/run.ts')

    expect(collectorRun).not.toMatch(/runCollectors\(prisma,\s*\[[^\]]*collectRss/)
  })
})
