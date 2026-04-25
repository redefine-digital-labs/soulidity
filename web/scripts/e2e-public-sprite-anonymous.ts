/**
 * E2E — Anonymous Public Sprite Download
 *
 * Verifies that a Soul's public sprite version can be fetched by ANY caller
 * (no Authorization header, no cookie) and that the returned Walrus blob
 * bytes byte-match the original sprite file on disk.
 *
 * Usage:
 *   SOUL_ID=0x... \
 *   COMPARE_DIR=/path/to/original/sprites \
 *   EXPECTED_FILENAME=wusaqi.png \
 *   BASE_URL=http://localhost:3000 \
 *   npx tsx web/scripts/e2e-public-sprite-anonymous.ts
 *
 * Optional:
 *   ASSET_NAME            default: persona-sprite
 *   ASSET_VERSION_INDEX   default: 0
 *   FETCH_TIMEOUT_MS      default: 30000
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOUL_ID = process.env.SOUL_ID?.trim()
const COMPARE_DIR = process.env.COMPARE_DIR?.trim()
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const ASSET_NAME = process.env.ASSET_NAME?.trim() || 'persona-sprite'
const ASSET_VERSION_INDEX = process.env.ASSET_VERSION_INDEX?.trim() || '0'
const EXPECTED_FILENAME = process.env.EXPECTED_FILENAME?.trim() || 'sprite.png'
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? '30000')

interface PublicAccessResponse {
  visibility: 'public' | 'private' | string
  accessKind?: string
  artifact?: {
    walrusBlobUrl?: string | null
    walrusBlobId?: string | null
    blobObjectId?: string
  }
  sealSidecar?: unknown
  sealSession?: unknown
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function endpoint(): string {
  return `${BASE_URL}/api/agent/souls/${encodeURIComponent(SOUL_ID!)}/assets/${encodeURIComponent(ASSET_NAME)}/versions/${encodeURIComponent(ASSET_VERSION_INDEX)}/access`
}

async function callAccess(label: string, headers: Record<string, string>): Promise<PublicAccessResponse> {
  const url = endpoint()
  console.log(`[access:${label}] GET ${url}`)
  const res = await fetchWithTimeout(url, { headers })
  const text = await res.text()
  let body: PublicAccessResponse | null = null
  try {
    body = text ? (JSON.parse(text) as PublicAccessResponse) : null
  } catch {
    // fall through
  }
  if (res.status !== 200) {
    throw new Error(`[access:${label}] expected 200, got ${res.status}: ${text}`)
  }
  if (!body) {
    throw new Error(`[access:${label}] response body is not JSON: ${text}`)
  }
  if (body.visibility !== 'public') {
    throw new Error(
      `[access:${label}] expected visibility=public, got "${body.visibility}". ` +
        `The target sprite version is not marked public — fix via persona-asset-panel before rerunning.`,
    )
  }
  if (body.sealSidecar != null || body.sealSession != null) {
    throw new Error(`[access:${label}] public response must not include sealSidecar/sealSession: ${text}`)
  }
  if (!body.artifact?.walrusBlobUrl) {
    throw new Error(`[access:${label}] response missing artifact.walrusBlobUrl: ${text}`)
  }
  console.log(`[access:${label}] visibility=public walrusBlobId=${body.artifact.walrusBlobId ?? '-'}`)
  return body
}

async function downloadAndCompare(walrusBlobUrl: string) {
  console.log(`[download] GET ${walrusBlobUrl}`)
  const res = await fetchWithTimeout(walrusBlobUrl)
  if (!res.ok) {
    throw new Error(`[download] Walrus returned ${res.status}`)
  }
  const actual = new Uint8Array(await res.arrayBuffer())

  const comparePath = join(COMPARE_DIR!, EXPECTED_FILENAME)
  const expected = new Uint8Array(readFileSync(comparePath))

  const actualHash = createHash('sha256').update(actual).digest('hex')
  const expectedHash = createHash('sha256').update(expected).digest('hex')

  if (actualHash !== expectedHash) {
    throw new Error(
      `[compare] byte mismatch:\n  expected ${comparePath} (${expected.length}B sha256=${expectedHash})\n  got walrus blob (${actual.length}B sha256=${actualHash})`,
    )
  }
  console.log(`[compare] OK ${comparePath} (${expected.length} bytes, sha256=${expectedHash})`)
}

async function main() {
  requireEnv('SOUL_ID', SOUL_ID)
  requireEnv('COMPARE_DIR', COMPARE_DIR)

  // Round 1: truly anonymous — no Authorization, no cookie.
  const anonymous = await callAccess('anonymous', {})

  // Round 2: garbage Bearer — public short-circuit must run BEFORE auth, so this must still 200.
  await callAccess('bogus-bearer', { Authorization: 'Bearer invalid-token-must-still-pass' })

  await downloadAndCompare(anonymous.artifact!.walrusBlobUrl!)

  console.log('\nPASS — public sprite is reachable by anonymous callers and bytes match.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
