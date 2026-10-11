import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// Patterns that must not appear in any source file. These were created or
// imported from Privy and should be fully removed by the wallet-auth migration.
const FORBIDDEN_PATTERNS = [
  '@privy-io',
  'usePrivy',
  'useLinkJwtAccount',
  'usePrivySui',
  'getPrivySuiWallet',
  'privy-token',
  'privyDid',
  'NEXT_PUBLIC_PRIVY',
  'PRIVY_APP_SECRET',
  'PRIVY_CUSTOM_AUTH',
] as const

// Search roots — repository directories that contain hand-written code.
const SEARCH_ROOTS = ['web', 'desktop/apps/desktop', 'tests', 'src', 'prisma', 'scripts']

const IGNORED_PATH_FRAGMENTS = [
  'node_modules/',
  '.next/',
  'dist/',
  // electron-vite output bundles previously compiled before this migration.
  // They are regenerated on every desktop build.
  'desktop/apps/desktop/out/',
  'pnpm-lock.yaml',
  'package-lock.json',
  // tsbuildinfo files cache string literals from previous builds — they get
  // rewritten on the next typecheck and are not authoritative source state.
  'tsconfig.tsbuildinfo',
  // The migration plan and historical docs may legitimately reference Privy.
  'docs/plans/',
  // This test file itself stores the forbidden patterns as string literals.
  'tests/web/no-privy-residue.test.ts',
]

function shouldIgnoreLine(line: string): boolean {
  if (!line) return true
  return IGNORED_PATH_FRAGMENTS.some((fragment) => line.includes(fragment))
}

describe('Privy migration leaves no runtime residue', () => {
  for (const pattern of FORBIDDEN_PATTERNS) {
    it(`no source file references "${pattern}"`, () => {
      let output: string
      try {
        output = execFileSync(
          'rg',
          ['-l', '--no-config', '-F', pattern, ...SEARCH_ROOTS],
          {
            cwd: process.cwd(),
            encoding: 'utf8',
          },
        )
      } catch (err) {
        // ripgrep exits with status 1 when there are no matches — that's the
        // success case we expect.
        if ((err as NodeJS.ErrnoException & { status?: number }).status === 1) {
          return
        }
        throw err
      }

      const offenders = output
        .split('\n')
        .filter((line) => !shouldIgnoreLine(line))

      if (offenders.length > 0) {
        throw new Error(
          `Found "${pattern}" in source files (Privy migration must remove these):\n  ${offenders.join('\n  ')}`,
        )
      }
    })
  }
})
