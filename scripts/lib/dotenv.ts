import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from 'dotenv'

// Load .env then .env.local (overrides) by default. Set
// CLAWNEWS_LOAD_ENV_LOCAL=false for production validation that must use .env
// exactly as the deploy target.
//
// Import this module for its side effect at the top of any script that
// reads env vars: `import './lib/dotenv'`.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

config({ path: resolve(repoRoot, '.env') })

if (process.env.CLAWNEWS_LOAD_ENV_LOCAL !== 'false') {
  config({ path: resolve(repoRoot, '.env.local'), override: true })
}
