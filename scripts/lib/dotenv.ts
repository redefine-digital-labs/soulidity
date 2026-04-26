import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from 'dotenv'

// Load .env then .env.local (overrides). Mirrors the Next.js / Vite
// convention: shared dev config in .env (committed-as-example), local-only
// secrets like MAINNET_DEPLOYER_PRIV_KEY in .env.local (gitignored).
//
// Import this module for its side effect at the top of any script that
// reads env vars: `import './lib/dotenv'`.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

config({ path: resolve(repoRoot, '.env') })
config({ path: resolve(repoRoot, '.env.local'), override: true })
