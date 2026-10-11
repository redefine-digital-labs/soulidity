import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config, parse } from 'dotenv'

// Layered env loading with strict precedence:
//   1. process env set on the command line (highest — preserved unconditionally)
//   2. .env.local (per-machine overrides over .env)
//   3. .env (committed defaults — lowest)
//
// Why this matters: ad-hoc invocations like
//   `NEXT_PUBLIC_SUI_NETWORK=mainnet npm run publish:soulidity ...`
// must win, but if .env.local declares NEXT_PUBLIC_SUI_NETWORK=testnet a
// naive `config({ override: true })` would silently rewrite the CLI value
// back to testnet — which has caused mainnet publish flows to query the
// wrong RPC. We snapshot CLI keys before loading anything, then refuse to
// overwrite them.
//
// CLAWNEWS_LOAD_ENV_LOCAL=false skips .env.local for production validation
// that must use .env exactly as the deploy target.
//
// Import this module for its side effect at the top of any script that
// reads env vars: `import './lib/dotenv'`. For specialty env files (e.g.
// `.env.soulidity-smoke` consumed only by the smoke harness), call
// `loadEnvFile(relativePath)` after the side-effect import.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const cliKeys = new Set(Object.keys(process.env))

config({ path: resolve(repoRoot, '.env') })

if (process.env.CLAWNEWS_LOAD_ENV_LOCAL !== 'false') {
  const localPath = resolve(repoRoot, '.env.local')
  if (existsSync(localPath)) {
    const localParsed = parse(readFileSync(localPath))
    for (const [key, value] of Object.entries(localParsed)) {
      if (cliKeys.has(key)) continue
      process.env[key] = value
    }
  }
}

export interface LoadEnvFileResult {
  loaded: boolean
  path: string
  applied: string[]
}

/**
 * Apply a dotenv file from `relativePath` (relative to repo root) without
 * overriding values that were already set on the command line. Values from
 * `.env` / `.env.local` ARE overridden — specialty files are intended to be
 * authoritative for their own concern (e.g. smoke wallets) while still
 * yielding to CLI / CI exports.
 *
 * Returns `{ loaded: false }` when the file does not exist; callers can
 * decide whether to warn or fall back.
 */
export function loadEnvFile(relativePath: string): LoadEnvFileResult {
  const absolutePath = resolve(repoRoot, relativePath)
  if (!existsSync(absolutePath)) {
    return { loaded: false, path: absolutePath, applied: [] }
  }
  const parsed = parse(readFileSync(absolutePath))
  const applied: string[] = []
  for (const [key, value] of Object.entries(parsed)) {
    if (cliKeys.has(key)) continue
    process.env[key] = value
    applied.push(key)
  }
  return { loaded: true, path: absolutePath, applied }
}
