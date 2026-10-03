import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const removed = [
  'scripts/publish-soulidity-and-sync.ts', 'scripts/upgrade-soulidity-mainnet.ts',
  'scripts/retire-soulidity-legacy-market.ts', 'scripts/preflight-animacraft-market-retirement.ts',
  'scripts/lib/reviewed-move-dependencies.ts', 'scripts/lib/soulidity-mainnet-migration.ts',
]
const commands = ['publish:soulidity', 'upgrade:soulidity-mainnet',
  'pause:soulidity-legacy-market', 'retire:soulidity-legacy-market',
  'preflight:animacraft-market-retirement', 'postflight:animacraft-market-retirement']

describe('one fresh release entry', () => {
  it.each(removed)('does not retain a second publisher or migration module: %s', path => {
    expect(existsSync(path)).toBe(false)
  })
  it('removes obsolete command aliases without adding a forwarding publisher', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    for (const name of commands) expect(pkg.scripts[name]).toBeUndefined()
    for (const value of Object.values(pkg.scripts)) {
      for (const path of removed) expect(value).not.toContain(path)
    }
    expect(pkg.scripts['build:web:production-env']).toBe('CLAWNEWS_LOAD_ENV_LOCAL=false npm --prefix web run build')
  })
  it('has no active imports or CI references to the removed group', () => {
    const files = execFileSync('rg', ['--files', 'scripts', 'packages', 'web', '.github',
      '-g', '*.ts', '-g', '*.tsx', '-g', '*.mjs', '-g', '*.js', '-g', '*.yml', '-g', '*.json',
      '-g', '!**/node_modules/**', '-g', '!**/dist/**'], { encoding: 'utf8' }).trim().split('\n')
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const path of removed) {
        const name = path.split('/').at(-1)!.replace(/\.ts$/, '')
        if (source.includes(name)) offenders.push(`${file}: ${name}`)
      }
    }
    expect(offenders).toEqual([])
  })
  it('marks superseded runbooks historical and points to the current release owner', () => {
    const spec = readFileSync('docs/plans/2026-10-01-single-release-entry.md', 'utf8')
    expect(spec).toContain('scripts/mainnet-v8-release.mjs')
    expect(spec).toContain('https://github.com/redefine-digital-labs/animacraft/blob/main/scripts/mainnet-v8-release.mjs')
    expect(spec).toContain('2026-10-01-paired-move-ci.md')
    expect(spec).not.toMatch(/\/tmp\/|\/Users\/|\/var\/folders\//)
    for (const path of ['2026-07-26-animacraft-legacy-market-retirement.md',
      '2026-05-04-soulidity-phase2-runbook.md', '2026-05-04-soulidity-typed-content-nebula.md']) {
      const source = readFileSync(`docs/plans/${path}`, 'utf8')
      expect(source.slice(0, 700)).toMatch(/historical/i)
      expect(source.slice(0, 700)).toContain('2026-10-01-single-release-entry.md')
    }
  })
})
