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
// reads env vars: `import './lib/dotenv'`.
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
