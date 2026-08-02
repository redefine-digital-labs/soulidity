import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SIGNED_JOURNAL_JSON = /(?:^|\/)[^/]*mutation-attempt[^/]*\.json$/i

describe('signed mainnet mutation journal hygiene', () => {
  it('keeps signed exact-byte journals out of tracked and deployable source paths', () => {
    const visibleFiles = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean)

    expect(visibleFiles.filter((path) => SIGNED_JOURNAL_JSON.test(path))).toEqual([])
  })

  it('excludes the private operator-state directory from git and Vercel', () => {
    const gitignore = readFileSync('.gitignore', 'utf8')
    const vercelignore = readFileSync('.vercelignore', 'utf8')

    expect(gitignore).toMatch(/^\.soulidity-state\/$/m)
    expect(vercelignore).toMatch(/^\/\.soulidity-state\/$/m)
  })
})
