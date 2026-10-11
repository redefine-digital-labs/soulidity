/**
 * W1.1 — E2E role keypair bootstrap.
 *
 * Idempotently appends the 5 E2E role private keys (Seller / Buyer /
 * Agent Alpha / Agent Beta / Dev) and `NEXT_PUBLIC_E2E_TEST_MODE=1` to
 * `.env.e2e` if they aren't already there. Existing values are preserved
 * verbatim — this script never overwrites a key that already exists.
 *
 * Reads:
 *   .env.e2e (repo root)
 *
 * Writes:
 *   .env.e2e (append-only). New keys are bech32-encoded
 *   `suiprivkey1...` strings produced by `Ed25519Keypair.generate()`.
 *
 * Usage:
 *   npx tsx scripts/e2e-bootstrap-keys.ts
 *
 * Safety:
 *   - Never touches: MAINNET_DEPLOYER_PRIV_KEY, AUTH_SECRET,
 *     DATABASE_URL, DIRECT_URL, anything already present.
 *   - Re-running produces no diff once all 6 entries exist.
 *   - On any error (parse / write / keypair gen), exits non-zero.
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'dotenv'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const ENV_PATH = resolve(REPO_ROOT, '.env.e2e')

const ROLE_KEYS = [
  'E2E_SELLER_PRIVATE_KEY',
  'E2E_BUYER_PRIVATE_KEY',
  'E2E_AGENT_ALPHA_PRIVATE_KEY',
  'E2E_AGENT_BETA_PRIVATE_KEY',
  'E2E_DEV_PRIVATE_KEY',
] as const

type RoleKeyName = (typeof ROLE_KEYS)[number]

interface EntryPlan {
  name: string
  value: string
  generated: boolean
  derivedAddress?: string
}

function ensureRoleKey(existing: Record<string, string>, name: RoleKeyName): EntryPlan {
  const current = existing[name]?.trim()
  if (current) {
    // Validate that the existing value actually decodes; if not, surface the
    // problem rather than silently re-using a corrupt entry. This script
    // does not auto-replace a malformed key — that's a deliberate policy
    // call the operator should make.
    try {
      const kp = Ed25519Keypair.fromSecretKey(current)
      return {
        name,
        value: current,
        generated: false,
        derivedAddress: kp.toSuiAddress(),
      }
    } catch (err) {
      throw new Error(
        `${name} is present in .env.e2e but is not a valid Sui private key (${
          (err as Error).message
        }). Fix or remove it before re-running this script.`,
      )
    }
  }

  const kp = Ed25519Keypair.generate()
  const secret = kp.getSecretKey()
  if (!secret.startsWith('suiprivkey')) {
    throw new Error(`Generated keypair did not return bech32 form for ${name}`)
  }
  return {
    name,
    value: secret,
    generated: true,
    derivedAddress: kp.toSuiAddress(),
  }
}

function ensureFlag(existing: Record<string, string>, name: string, value: string): EntryPlan | null {
  const current = existing[name]?.trim()
  if (current) {
    if (current !== value) {
      console.warn(
        `note: ${name}=${current} (already set; not changing). Plan expects ${value}.`,
      )
    }
    return null
  }
  return { name, value, generated: true }
}

function appendBlock(entries: EntryPlan[]) {
  const lines: string[] = []
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : ''

  // Make sure we start on a fresh line.
  if (existing.length > 0 && !existing.endsWith('\n')) {
    lines.push('')
  }

  lines.push('')
  lines.push('# ── E2E test bootstrap (managed by scripts/e2e-bootstrap-keys.ts) ──')
  for (const entry of entries) {
    lines.push(`${entry.name}=${entry.value}`)
  }
  lines.push('')

  appendFileSync(ENV_PATH, lines.join('\n'))
}

function main() {
  if (!existsSync(ENV_PATH)) {
    throw new Error(
      `.env.e2e not found at ${ENV_PATH}. Create it (with at minimum MAINNET_DEPLOYER_PRIV_KEY / DATABASE_URL / AUTH_SECRET) before running this script.`,
    )
  }

  const existing = parse(readFileSync(ENV_PATH, 'utf8'))

  const plans: EntryPlan[] = []
  for (const name of ROLE_KEYS) {
    plans.push(ensureRoleKey(existing, name))
  }
  const testModeEntry = ensureFlag(existing, 'NEXT_PUBLIC_E2E_TEST_MODE', '1')

  const newlyGenerated = plans.filter((p) => p.generated)
  const toAppend: EntryPlan[] = [...newlyGenerated]
  if (testModeEntry) toAppend.push(testModeEntry)

  if (toAppend.length === 0) {
    console.log('All E2E role keys + NEXT_PUBLIC_E2E_TEST_MODE already present in .env.e2e — no changes.')
  } else {
    appendBlock(toAppend)
    console.log(`Appended ${toAppend.length} entry(ies) to ${ENV_PATH}:`)
    for (const entry of toAppend) {
      if (entry.derivedAddress) {
        console.log(`  ${entry.name}=… (address: ${entry.derivedAddress})`)
      } else {
        console.log(`  ${entry.name}=${entry.value}`)
      }
    }
  }

  console.log('\nRole address summary:')
  for (const plan of plans) {
    const tag = plan.generated ? 'NEW' : 'existing'
    console.log(`  ${plan.name.padEnd(32)} ${plan.derivedAddress}  [${tag}]`)
  }

  // Sanity check: addresses must be unique. If two roles collide we have a
  // generator bug; abort hard so the operator sees it.
  const addresses = plans.map((p) => p.derivedAddress).filter((v): v is string => Boolean(v))
  const uniqueAddresses = new Set(addresses)
  if (uniqueAddresses.size !== addresses.length) {
    throw new Error('Role addresses collide — refusing to continue. Check .env.e2e for duplicate private keys.')
  }
}

try {
  main()
} catch (err) {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
}
