import { readFileSync } from 'node:fs'
import { dirname, join, normalize, posix, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Cloud Build uploads the source context determined by `.gcloudignore`. The
// uploader's `STAGING_BACKEND=gcs` mode dynamically imports
// `./token-usage-gcs.js` and `./staging-gcs.js` at runtime; if any transitive
// source file is missing from the upload allowlist, the resulting Docker
// build still succeeds (those files are just absent), but the deployed
// service crashes when the dynamic import fails. This regression freezes the
// allowlist against the actual import graph rooted at `server.ts`.

const REPO_ROOT = resolve(__dirname, '..', '..')
const UPLOADER_SRC_DIR = join(REPO_ROOT, 'services', 'walrus-uploader', 'src')
const ENTRY_POINTS = [
  join(UPLOADER_SRC_DIR, 'server.ts'),
] as const

type ResolvedFiles = ReadonlySet<string>

function readGcloudIgnoreAllowlist(): ResolvedFiles {
  const text = readFileSync(join(REPO_ROOT, '.gcloudignore'), 'utf8')
  const allowed = new Set<string>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (!line.startsWith('!')) continue
    const path = line.slice(1).replace(/\/+$/, '')
    if (!path) continue
    allowed.add(normalize(join(REPO_ROOT, path)))
  }
  return allowed
}

function collectImportTargets(filePath: string): string[] {
  const text = readFileSync(filePath, 'utf8')
  const targets: string[] = []
  // static imports / re-exports
  for (const match of text.matchAll(/\b(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) {
    targets.push(match[1])
  }
  // dynamic imports
  for (const match of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    targets.push(match[1])
  }
  return targets
}

function resolveLocalImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const baseDir = dirname(fromFile)
  // strip the `.js` suffix used by ESM imports back to the `.ts` source.
  const noExt = specifier.replace(/\.js$/, '')
  const candidates = [
    join(baseDir, `${noExt}.ts`),
    join(baseDir, `${noExt}.tsx`),
    join(baseDir, noExt, 'index.ts'),
  ]
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, 'utf8')
      return normalize(candidate)
    } catch {
      // try next candidate
    }
  }
  return null
}

function collectImportGraph(entryPoints: readonly string[]): Set<string> {
  const visited = new Set<string>()
  const queue: string[] = []
  for (const entry of entryPoints) {
    const normalized = normalize(entry)
    visited.add(normalized)
    queue.push(normalized)
  }
  while (queue.length > 0) {
    const file = queue.shift()!
    for (const specifier of collectImportTargets(file)) {
      const resolved = resolveLocalImport(file, specifier)
      if (!resolved) continue
      if (visited.has(resolved)) continue
      visited.add(resolved)
      queue.push(resolved)
    }
  }
  return visited
}

describe('Walrus uploader Cloud Build context', () => {
  it('allowlists every TS source file transitively imported by server.ts', () => {
    const allowed = readGcloudIgnoreAllowlist()
    const reachable = collectImportGraph(ENTRY_POINTS)

    const uploaderSources = [...reachable].filter((file) => file.startsWith(`${UPLOADER_SRC_DIR}${posix.sep}`)
      || file.startsWith(`${UPLOADER_SRC_DIR}/`))
    expect(uploaderSources.length).toBeGreaterThan(0)

    const missing = uploaderSources.filter((file) => !allowed.has(file))
    if (missing.length > 0) {
      const relativeMissing = missing.map((file) => relative(REPO_ROOT, file))
      throw new Error(
        'Cloud Build context is missing uploader source files imported by server.ts. '
        + 'Add `!` allowlist entries to .gcloudignore:\n  '
        + relativeMissing.map((path) => `!${path}`).join('\n  '),
      )
    }
  })

  it('allowlists token-usage-gcs.ts so STAGING_BACKEND=gcs deployments boot', () => {
    // Sentinel for R-002: production cloud-run.env.example sets
    // STAGING_BACKEND=gcs, server.ts dynamic-imports './token-usage-gcs.js'
    // for that backend, and the per-file `.gcloudignore` allowlist must
    // include the source.
    const allowed = readGcloudIgnoreAllowlist()
    expect(allowed.has(normalize(join(UPLOADER_SRC_DIR, 'token-usage-gcs.ts')))).toBe(true)
  })
})
