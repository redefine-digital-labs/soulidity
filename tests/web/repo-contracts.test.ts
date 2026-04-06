import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..')
const newWebRoot = join(repoRoot, 'new-web')

const SOURCE_FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const IGNORED_PATH_SEGMENTS = new Set([
  '.git',
  '.next',
  'node_modules',
])

function walkFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (IGNORED_PATH_SEGMENTS.has(entry.name)) {
      continue
    }

    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath))
      continue
    }

    files.push(entryPath)
  }

  return files
}

function readSourceFilesUnder(directory: string) {
  return walkFiles(directory)
    .filter((filePath) => SOURCE_FILE_EXTENSIONS.has(filePath.slice(filePath.lastIndexOf('.'))))
    .map((filePath) => ({
      filePath,
      relativePath: relative(repoRoot, filePath),
      source: readFileSync(filePath, 'utf8'),
    }))
}

function collectMatches(pattern: RegExp) {
  const files = [
    ...readSourceFilesUnder(join(newWebRoot, 'app')),
    ...readSourceFilesUnder(join(newWebRoot, 'components')),
    ...readSourceFilesUnder(join(newWebRoot, 'lib')),
  ]

  return files
    .filter(({ source }) => pattern.test(source))
    .map(({ relativePath }) => relativePath)
}

describe('repository contract guards', () => {
  it('documents the Soulidity env contract and repo-level new-web verification', () => {
    const envExample = readFileSync(join(repoRoot, '.env.example'), 'utf8')
    const rootPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(envExample).toContain('AUTH_SECRET=')
    expect(envExample).toContain('DIRECT_URL=')
    expect(envExample).toContain('SHADOW_DATABASE_URL=')
    expect(envExample).toContain('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID=')
    expect(envExample).toContain('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID=')
    expect(envExample).toContain('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID=')
    expect(envExample).toContain('NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID=')
    expect(envExample).toContain('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE=')
    expect(envExample).not.toContain('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID=')
    expect(envExample).not.toContain('NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID=')
    expect(envExample).not.toContain('NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID=')
    expect(envExample).not.toContain('NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID=')

    expect(rootPackage.scripts?.['typecheck:new-web']).toBe('npm --prefix new-web run typecheck')
    expect(rootPackage.scripts?.typecheck).toContain('npm run typecheck:new-web')
  })

  it('keeps new-web soul business code isolated from the legacy web/lib/souls runtime', () => {
    const offenders = collectMatches(/@web\/lib\/souls\/|['"]\.\.\/web\/lib\/souls\//)
    expect(offenders).toEqual([])
  })

  it('removes allowlist, simulated tx, mock fallback, and dead create-collection entrypoints from active new-web code', () => {
    const pattern = /\ballowlist\b|0x_simulated_|mockSouls|mockCollections|\/create-collection\/|simulated upload|simulate the upload/i
    const offenders = collectMatches(pattern)
    expect(offenders).toEqual([])
  })

  it('keeps the hard-cut Soulidity route surface and removes the legacy allowlist route', () => {
    expect(existsSync(join(newWebRoot, 'app', 'api', 'souls', '[id]', 'allowlist', 'route.ts'))).toBe(false)
    expect(existsSync(join(newWebRoot, 'app', 'collections', '[id]', 'buy', 'page.tsx'))).toBe(false)

    expect(existsSync(join(newWebRoot, 'app', 'api', 'souls', '[id]', 'grant', 'route.ts'))).toBe(true)
    expect(existsSync(join(newWebRoot, 'app', 'api', 'collections', 'route.ts'))).toBe(true)
    expect(existsSync(join(newWebRoot, 'app', 'api', 'collections', '[id]', 'route.ts'))).toBe(true)
    expect(existsSync(join(newWebRoot, 'app', 'api', 'collections', '[id]', 'purchase', 'route.ts'))).toBe(true)
    expect(existsSync(join(newWebRoot, 'app', 'api', 'collections', '[id]', 'list', 'route.ts'))).toBe(true)
    expect(existsSync(join(newWebRoot, 'app', 'api', 'import', 'route.ts'))).toBe(true)
    expect(existsSync(join(newWebRoot, 'app', 'api', 'wrap-link', 'personal', 'route.ts'))).toBe(true)
  })

  it('keeps collection purchase entrypoints collapsed into the collection detail page', () => {
    const offenders = collectMatches(/\/collections\/[^'"]+\/buy|CollectionBuyPage|Confirm collection purchase/)
    expect(offenders).toEqual([])
  })

  it('defines the Soulidity tx-sync route key contract in the new mirror runtime', () => {
    const txSyncPath = join(newWebRoot, 'lib', 'soulidity', 'mirror', 'tx-sync.ts')
    expect(existsSync(txSyncPath)).toBe(true)

    const txSyncSource = readFileSync(txSyncPath, 'utf8')
    expect(txSyncSource).toContain(`'publish'`)
    expect(txSyncSource).toContain(`'buy'`)
    expect(txSyncSource).toContain(`'list'`)
    expect(txSyncSource).toContain(`'delist'`)
    expect(txSyncSource).toContain(`'grant:issue'`)
    expect(txSyncSource).toContain(`'grant:revoke'`)
    expect(txSyncSource).toContain(`'collection:list'`)
    expect(txSyncSource).toContain(`'collection:buy'`)
    expect(txSyncSource).toContain(`'collection:add-soul'`)
    expect(txSyncSource).toContain(`'import'`)
    expect(txSyncSource).toContain(`'personal-join'`)
  })
})
