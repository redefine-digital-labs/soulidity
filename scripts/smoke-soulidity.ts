#!/usr/bin/env tsx
/**
 * scripts/smoke-soulidity.ts
 *
 * Soulidity 2-signature fast-path smoke harness. Parameterised on
 * NEXT_PUBLIC_SUI_NETWORK so the same code drives stage 7a (testnet) and
 * stage 7b (mainnet) in the runbook.
 *
 * The harness:
 *   1. Reads smoke wallet private keys from .env.soulidity-smoke:
 *        SMOKE_PUBLISHER_KEY  — creator / mint / collection-launch wallet
 *        SMOKE_BUYER_KEY      — secondary purchaser
 *        SMOKE_AGENT_KEY      — grant recipient
 *   2. Reads the acceptance matrix from SOULIDITY_SMOKE_SCENARIO_JSON or
 *      SOULIDITY_SMOKE_SCENARIO_FILE, signs each provided PTB with the
 *      publisher / buyer / agent key, and asserts:
 *        - Exact wallet signature count (the spec).
 *        - dryRun reports success before signing.
 *        - All mirror sync calls return 200.
 *        - Mirror state reflects the on-chain projection.
 *   3. Writes a per-row summary (PTB byte size, dry-run gas) to
 *      docs/benchmarks/smoke-soulidity-<network>-<timestamp>.md so the
 *      bench numbers are a free side-effect of running the matrix.
 *   4. Exits non-zero on any signature-count mismatch, dry-run failure,
 *      or mirror divergence.
 *
 * Usage:
 *   NEXT_PUBLIC_SUI_NETWORK=testnet tsx scripts/smoke-soulidity.ts
 *   NEXT_PUBLIC_SUI_NETWORK=mainnet tsx scripts/smoke-soulidity.ts
 *
 * The harness assumes:
 *   - Each smoke wallet has at least: 5 SUI, 100 USDC (mainnet) or 5
 *     testnet WAL after `walrus get-wal --context testnet`.
 *   - The matching deployment-manifest entry points at the new
 *     soulidity package (post publish-only step).
 *   - A web/back-end with /api/* routes is reachable at SOULIDITY_WEB_URL
 *     (the harness goes through the public mirror routes the user-facing
 *     hooks call).
 */

import './lib/dotenv'
import { loadEnvFile } from './lib/dotenv'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { extractAllContentVersionAppendedEvents, getRequiredSoulidityEnv } from '@soulidity/sdk'

// Load smoke wallets / scenario from `.env.soulidity-smoke` (or an explicit
// override via SOULIDITY_SMOKE_ENV_FILE). Documented in `.env.soulidity-smoke
// .example` as the place to drop SMOKE_PUBLISHER_KEY / SMOKE_BUYER_KEY /
// SMOKE_AGENT_KEY. Without this load, `loadSmokeWallets()` only sees CI-style
// `process.env` exports and the documented local command —
//   `tsx scripts/smoke-soulidity.ts`
// — fails immediately even when the file is present and populated.
{
  const explicitPath = process.env.SOULIDITY_SMOKE_ENV_FILE?.trim() || null
  const result = loadEnvFile(explicitPath ?? '.env.soulidity-smoke')
  if (!result.loaded) {
    if (explicitPath) {
      console.error(
        `[smoke] SOULIDITY_SMOKE_ENV_FILE points at ${result.path} but no such file exists.`,
      )
      process.exit(2)
    }
    // Implicit default missing — only warn. CI may export the same keys
    // directly without a file, in which case the missing-key error in
    // `loadSmokeWallets()` is the right place to surface a problem.
    if (!process.env.SMOKE_PUBLISHER_KEY) {
      console.warn(
        `[smoke] No .env.soulidity-smoke found at ${result.path}. Falling back to existing process.env.`,
      )
    }
  }
}

interface SmokeRowResult {
  name: string
  expectedSignatures: number
  actualSignatures: number
  ptbBytes: number[]
  dryRunGas: number[]
  passed: boolean
  failure: string | null
}

interface SmokeWallets {
  publisher: Ed25519Keypair
  buyer: Ed25519Keypair
  agent: Ed25519Keypair
}

function loadSmokeWallets(): SmokeWallets {
  const need = (key: string) => {
    const raw = process.env[key]
    if (!raw) {
      console.error(`Missing ${key} in .env.soulidity-smoke (required for smoke harness)`)
      process.exit(2)
    }
    const decoded = decodeSuiPrivateKey(raw)
    return Ed25519Keypair.fromSecretKey(decoded.secretKey)
  }
  return {
    publisher: need('SMOKE_PUBLISHER_KEY'),
    buyer: need('SMOKE_BUYER_KEY'),
    agent: need('SMOKE_AGENT_KEY'),
  }
}

interface RunContext {
  network: 'testnet' | 'mainnet'
  suiClient: SuiJsonRpcClient
  wallets: SmokeWallets
  webBaseUrl: string
}

async function ctx(): Promise<RunContext> {
  const network = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
  const suiClient = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(network),
    network,
  })
  const wallets = loadSmokeWallets()
  const webBaseUrl = process.env.SOULIDITY_WEB_URL ?? 'http://localhost:3000'
  return { network, suiClient, wallets, webBaseUrl }
}

interface SignTrace {
  signatures: number
  bytes: number[]
  dryRunGas: number[]
}

type SmokeSigner = keyof SmokeWallets

interface SmokeMirrorRequest {
  path: string
  method?: 'POST' | 'PUT' | 'PATCH'
  headers?: Record<string, string>
  body?: unknown
  expectedStatus?: number
  assertBody?: SmokeJsonAssertion[]
}

interface SmokeJsonAssertion {
  path: string
  equals?: unknown
  present?: boolean
}

interface SmokeContentVersionEventAssertion {
  kind?: number
  name?: string
  versionIndex?: number
  count: number
}

interface SmokeEventAssertions {
  contentVersions?: SmokeContentVersionEventAssertion[]
}

interface SmokeStep {
  label: string
  signer: SmokeSigner
  transactionBase64: string
  mirror?: SmokeMirrorRequest | SmokeMirrorRequest[]
  assertEvents?: SmokeEventAssertions
}

interface SmokeRow {
  name: string
  expectedSignatures: number
  steps: SmokeStep[]
}

interface SmokeScenario {
  rows: SmokeRow[]
}

function validateSmokeEventAssertions(rowName: string, step: SmokeStep) {
  const assertions = step.assertEvents
  if (!assertions) return
  if (
    assertions.contentVersions !== undefined
    && !Array.isArray(assertions.contentVersions)
  ) {
    throw new Error(`${rowName}/${step.label}: assertEvents.contentVersions must be an array`)
  }
  for (const [index, assertion] of (assertions.contentVersions ?? []).entries()) {
    if (!Number.isInteger(assertion.count) || assertion.count < 0) {
      throw new Error(`${rowName}/${step.label}: assertEvents.contentVersions[${index}].count must be a non-negative integer`)
    }
    if (assertion.kind !== undefined && !Number.isInteger(assertion.kind)) {
      throw new Error(`${rowName}/${step.label}: assertEvents.contentVersions[${index}].kind must be an integer`)
    }
    if (assertion.name !== undefined && typeof assertion.name !== 'string') {
      throw new Error(`${rowName}/${step.label}: assertEvents.contentVersions[${index}].name must be a string`)
    }
    if (assertion.versionIndex !== undefined && !Number.isInteger(assertion.versionIndex)) {
      throw new Error(`${rowName}/${step.label}: assertEvents.contentVersions[${index}].versionIndex must be an integer`)
    }
    if (assertion.kind === undefined && assertion.name === undefined && assertion.versionIndex === undefined) {
      throw new Error(`${rowName}/${step.label}: assertEvents.contentVersions[${index}] must filter by kind, name, or versionIndex`)
    }
  }
}

function readSmokeScenario(): SmokeScenario {
  const rawJson = process.env.SOULIDITY_SMOKE_SCENARIO_JSON
  const rawFile = process.env.SOULIDITY_SMOKE_SCENARIO_FILE
  const raw = rawJson
    ?? (rawFile ? readFileSync(resolve(process.cwd(), rawFile), 'utf8') : null)
  if (!raw) {
    throw new Error(
      'Missing smoke scenario. Set SOULIDITY_SMOKE_SCENARIO_JSON or SOULIDITY_SMOKE_SCENARIO_FILE with rows[].steps[].transactionBase64.',
    )
  }
  const parsed = JSON.parse(raw) as SmokeScenario
  if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) {
    throw new Error('Smoke scenario must contain a non-empty rows array')
  }
  for (const row of parsed.rows) {
    if (!row.name || !Number.isInteger(row.expectedSignatures) || !Array.isArray(row.steps)) {
      throw new Error('Each smoke row must include name, expectedSignatures, and steps')
    }
    if (row.steps.length !== row.expectedSignatures) {
      throw new Error(`${row.name}: steps length must match expectedSignatures`)
    }
    for (const step of row.steps) {
      if (!step.label || !step.signer || !step.transactionBase64) {
        throw new Error(`${row.name}: every step must include label, signer, and transactionBase64`)
      }
      if (!['publisher', 'buyer', 'agent'].includes(step.signer)) {
        throw new Error(`${row.name}/${step.label}: unsupported signer ${step.signer}`)
      }
      validateSmokeEventAssertions(row.name, step)
    }
  }
  return parsed
}

function substituteDigest(value: unknown, txDigest: string): unknown {
  if (typeof value === 'string') {
    return value.replaceAll('{{txDigest}}', txDigest)
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteDigest(item, txDigest))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteDigest(item, txDigest)]),
    )
  }
  return value
}

// Per-signer auth env keys. Each mirror route enforces that the signed-in
// wallet matches the on-chain transaction sender (`assertTransactionSender`
// in web/lib/soulidity/server.ts), so a single global cookie cannot service
// publisher / buyer / agent rows in the same matrix. Each role provides its
// own session cookie or bearer token, and `smokeHeaders()` selects them by
// `step.signer` instead of leaking publisher creds onto buyer-signed mirrors.
const SMOKE_AUTH_ENV_KEYS: Record<SmokeSigner, { authorization: string, cookie: string }> = {
  publisher: { authorization: 'SMOKE_PUBLISHER_AUTHORIZATION', cookie: 'SMOKE_PUBLISHER_COOKIE' },
  buyer: { authorization: 'SMOKE_BUYER_AUTHORIZATION', cookie: 'SMOKE_BUYER_COOKIE' },
  agent: { authorization: 'SMOKE_AGENT_AUTHORIZATION', cookie: 'SMOKE_AGENT_COOKIE' },
}

function smokeHeaders(signer: SmokeSigner, extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const keys = SMOKE_AUTH_ENV_KEYS[signer]
  const authorization = process.env[keys.authorization]
  const cookie = process.env[keys.cookie]
  if (authorization) headers.Authorization = authorization
  if (cookie) headers.Cookie = cookie
  // Per-mirror explicit headers always win — a row can pin a specific token
  // (e.g. an agent api key) without inheriting the role default.
  if (extra) {
    for (const [k, v] of Object.entries(extra)) headers[k] = v
  }
  return headers
}

function warnMissingMirrorAuth(scenario: SmokeScenario) {
  const needed = new Set<SmokeSigner>()
  for (const row of scenario.rows) {
    for (const step of row.steps) {
      const mirrors = Array.isArray(step.mirror) ? step.mirror : step.mirror ? [step.mirror] : []
      if (mirrors.length > 0) needed.add(step.signer)
    }
  }
  for (const signer of needed) {
    const keys = SMOKE_AUTH_ENV_KEYS[signer]
    if (!process.env[keys.authorization] && !process.env[keys.cookie]) {
      console.warn(
        `[smoke] ${signer} rows have mirror calls but neither ${keys.authorization} nor ${keys.cookie} is set; mirror requests will be rejected as unauthenticated.`,
      )
    }
  }
}

function resolveJsonPath(payload: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, payload)
}

function assertMirrorBody(payload: unknown, assertions: SmokeJsonAssertion[], mirrorPath: string) {
  for (const assertion of assertions) {
    const value = resolveJsonPath(payload, assertion.path)
    if (assertion.present && value == null) {
      throw new Error(`mirror response assertion failed for ${mirrorPath}: ${assertion.path} is missing`)
    }
    if ('equals' in assertion && JSON.stringify(value) !== JSON.stringify(assertion.equals)) {
      throw new Error(
        `mirror response assertion failed for ${mirrorPath}: ${assertion.path} expected ${JSON.stringify(assertion.equals)} got ${JSON.stringify(value)}`,
      )
    }
  }
}

function formatContentVersionEventAssertion(assertion: SmokeContentVersionEventAssertion) {
  return [
    assertion.kind === undefined ? null : `kind=${assertion.kind}`,
    assertion.name === undefined ? null : `name=${assertion.name}`,
    assertion.versionIndex === undefined ? null : `versionIndex=${assertion.versionIndex}`,
  ].filter(Boolean).join(',')
}

function assertSmokeEvents(
  row: SmokeRow,
  step: SmokeStep,
  transaction: Parameters<typeof extractAllContentVersionAppendedEvents>[0],
) {
  const assertions = step.assertEvents
  if (!assertions) return
  if (assertions.contentVersions?.length) {
    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
    const contentVersionEvents = extractAllContentVersionAppendedEvents(transaction, packageId)
    for (const assertion of assertions.contentVersions) {
      const actual = contentVersionEvents.filter((event) => (
        (assertion.kind === undefined || event.kind === assertion.kind)
        && (assertion.name === undefined || event.name === assertion.name)
        && (assertion.versionIndex === undefined || event.versionIndex === assertion.versionIndex)
      )).length
      if (actual !== assertion.count) {
        throw new Error(
          `${row.name}/${step.label}: ContentVersionAppended ${formatContentVersionEventAssertion(assertion)} expected count ${assertion.count}, got ${actual}`,
        )
      }
    }
  }
}

async function assertMirrorOk(c: RunContext, mirror: SmokeMirrorRequest, txDigest: string, signer: SmokeSigner) {
  const body = substituteDigest(mirror.body ?? { txDigest }, txDigest)
  const res = await fetch(new URL(mirror.path, c.webBaseUrl), {
    method: mirror.method ?? 'POST',
    headers: smokeHeaders(signer, mirror.headers),
    body: JSON.stringify(body),
  })
  const text = await res.text().catch(() => '')
  const expectedStatus = mirror.expectedStatus ?? 200
  if (res.status !== expectedStatus) {
    throw new Error(`mirror ${mirror.path} returned ${res.status}, expected ${expectedStatus}: ${text.slice(0, 400)}`)
  }
  if (mirror.assertBody?.length) {
    let payload: unknown
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      throw new Error(`mirror ${mirror.path} response was not JSON`)
    }
    assertMirrorBody(payload, mirror.assertBody, mirror.path)
  }
}

async function runSmokeStep(c: RunContext, row: SmokeRow, step: SmokeStep, trace: SignTrace) {
  const signer = c.wallets[step.signer]
  const bytes = Buffer.from(step.transactionBase64, 'base64')
  if (bytes.length === 0) {
    throw new Error(`${row.name}/${step.label}: transactionBase64 decoded to empty bytes`)
  }
  const dryRun = await c.suiClient.dryRunTransactionBlock({ transactionBlock: bytes })
  if (dryRun.effects.status.status !== 'success') {
    throw new Error(`${row.name}/${step.label}: dry-run failure: ${dryRun.effects.status.error}`)
  }
  trace.bytes.push(bytes.length)
  trace.dryRunGas.push(
    Number(dryRun.effects.gasUsed.computationCost) + Number(dryRun.effects.gasUsed.storageCost),
  )
  const result = await c.suiClient.signAndExecuteTransaction({
    signer,
    transaction: bytes,
    options: { showEffects: true, showObjectChanges: true, showEvents: true },
  })
  if (result.effects?.status?.status !== 'success') {
    throw new Error(`${row.name}/${step.label}: tx settled with failure: ${result.effects?.status?.error ?? 'unknown'}`)
  }
  trace.signatures += 1
  assertSmokeEvents(row, step, result)
  const mirrors = Array.isArray(step.mirror) ? step.mirror : step.mirror ? [step.mirror] : []
  for (const mirror of mirrors) {
    await assertMirrorOk(c, mirror, result.digest, step.signer)
  }
  return result
}

async function main() {
  const scenario = readSmokeScenario()
  const c = await ctx()
  const results: SmokeRowResult[] = []

  warnMissingMirrorAuth(scenario)
  console.log(`smoke-soulidity: ${c.network} (web: ${c.webBaseUrl})`)
  for (const row of scenario.rows) {
    console.log(`→ ${row.name}`)
    const trace: SignTrace = { signatures: 0, bytes: [], dryRunGas: [] }
    let passed = false
    let failure: string | null = null
    const expected = row.expectedSignatures
    try {
      for (const step of row.steps) {
        await runSmokeStep(c, row, step, trace)
      }
      passed = trace.signatures === expected
      if (!passed) {
        failure = `expected ${expected} signatures, got ${trace.signatures}`
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e)
    }
    results.push({
      name: row.name,
      expectedSignatures: expected,
      actualSignatures: trace.signatures,
      ptbBytes: trace.bytes,
      dryRunGas: trace.dryRunGas,
      passed,
      failure,
    })
    console.log(`  ${passed ? 'PASS' : 'FAIL'} sigs=${trace.signatures} (expected ${expected}) bytes=[${trace.bytes.join(',')}] gas=[${trace.dryRunGas.join(',')}]${failure ? ` reason=${failure}` : ''}`)
  }

  // Bench-equivalent output (free side-effect of running the matrix).
  const benchDir = resolve(process.cwd(), 'docs/benchmarks')
  mkdirSync(benchDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const out = resolve(benchDir, `smoke-soulidity-${c.network}-${stamp}.md`)
  const lines: string[] = []
  lines.push(`# Soulidity smoke matrix (${c.network})`)
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('| Row | expected sigs | actual sigs | bytes | gas (MIST) | result |')
  lines.push('|-----|--------------:|------------:|-------|------------|--------|')
  for (const r of results) {
    lines.push(`| ${r.name} | ${r.expectedSignatures} | ${r.actualSignatures} | [${r.ptbBytes.join(', ')}] | [${r.dryRunGas.join(', ')}] | ${r.passed ? 'PASS' : `FAIL — ${r.failure ?? 'unknown'}`} |`)
  }
  writeFileSync(out, lines.join('\n') + '\n', 'utf8')
  console.log(`\nWrote ${out}`)

  const failed = results.filter((r) => !r.passed)
  if (failed.length > 0) {
    console.error(`\nSmoke matrix FAILED — ${failed.length} row(s):`)
    for (const r of failed) console.error(`  - ${r.name}: ${r.failure}`)
    process.exit(1)
  }
  console.log('\nSmoke matrix passed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
