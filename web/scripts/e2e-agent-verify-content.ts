/**
 * E2E Content Verification:
 * Agent access API -> Walrus download -> direct AES-GCM decrypt -> byte compare.
 *
 * Preferred multi-artifact usage:
 *   SOUL_ID="0x..." \
 *   AGENT_API_KEY="sk-..." \
 *   RAW_ENVELOPES_JSON='{"char":"...","memory":"...","skills":"..."}' \
 *   MEMORY_ENTRY_KEY="..." \
 *   SKILL_NAME="default" \
 *   SKILL_VERSION_INDEX="0" \
 *   COMPARE_DIR="/Users/admin/Documents/example" \
 *   npx tsx web/scripts/e2e-agent-verify-content.ts
 *
 * Backwards-compatible single-artifact usage:
 *   RAW_ENVELOPE="..." COMPARE_FILE="soul.md" ...
 */

import { createDecipheriv, createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

const SOUL_ID = process.env.SOUL_ID!
const AGENT_API_KEY = process.env.AGENT_API_KEY!
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100'
const COMPARE_DIR = process.env.COMPARE_DIR!

type ArtifactKind = 'char' | 'memory' | 'skills' | 'sprite'

type RawEnvelopeMap = Partial<Record<ArtifactKind, string | null>>

const DEFAULT_COMPARE_FILES: Record<ArtifactKind, string> = {
  char: 'soul.md',
  memory: 'memory.md',
  skills: 'skill.zip',
  sprite: 'sprite.png',
}

/* ---- inline unsealDekEnvelope ---- */

function getUploadSecret(): Buffer {
  const hex = process.env.SOUL_UPLOAD_SECRET
  if (!hex || hex.length !== 64) throw new Error('SOUL_UPLOAD_SECRET required')
  return Buffer.from(hex, 'hex')
}

function unsealDekEnvelope(envelope: string) {
  const secret = getUploadSecret()
  const raw = Buffer.from(envelope, 'base64')
  const ivLength = 12
  const tagLength = 16
  const iv = raw.subarray(0, ivLength)
  const authTag = raw.subarray(ivLength, ivLength + tagLength)
  const ciphertext = raw.subarray(ivLength + tagLength)
  const decipher = createDecipheriv('aes-256-gcm', secret, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const payload = JSON.parse(plaintext.toString('utf8'))
  return {
    dek: new Uint8Array(Buffer.from(payload.dek, 'base64')),
    iv: new Uint8Array(Buffer.from(payload.iv, 'base64')),
    contentHash: payload.contentHash as string,
    mimeType: payload.mimeType as string,
    fileName: payload.fileName as string,
  }
}

/* ---- AES-GCM decrypt ---- */

async function aesGcmDecrypt(data: Uint8Array, dek: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    dek as unknown as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer }, key, data as unknown as ArrayBuffer),
  )
}

function readJsonEnv<T>(name: string): T | null {
  const raw = process.env[name]
  if (!raw?.trim()) return null
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function resolveEnvelopeMap(): RawEnvelopeMap {
  const map = readJsonEnv<RawEnvelopeMap>('RAW_ENVELOPES_JSON')
  if (map) return map

  const rawEnvelope = process.env.RAW_ENVELOPE
  if (!rawEnvelope?.trim()) {
    throw new Error('RAW_ENVELOPES_JSON or RAW_ENVELOPE is required')
  }
  return { char: rawEnvelope }
}

function resolveCompareFiles() {
  const compareMap = readJsonEnv<Partial<Record<ArtifactKind, string>>>('COMPARE_MAP_JSON') ?? {}
  if (process.env.COMPARE_FILE?.trim()) {
    compareMap.char = process.env.COMPARE_FILE.trim()
  }
  return compareMap
}

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function endpointFor(kind: ArtifactKind) {
  switch (kind) {
    case 'char':
      return `/api/agent/souls/${encodeURIComponent(SOUL_ID)}/access`
    case 'memory':
      return `/api/agent/souls/${encodeURIComponent(SOUL_ID)}/memory/${encodeURIComponent(requireEnv('MEMORY_ENTRY_KEY'))}/access`
    case 'skills':
      return `/api/agent/souls/${encodeURIComponent(SOUL_ID)}/skills/${encodeURIComponent(requireEnv('SKILL_NAME'))}/versions/${encodeURIComponent(requireEnv('SKILL_VERSION_INDEX'))}/access`
    case 'sprite':
      return `/api/agent/souls/${encodeURIComponent(SOUL_ID)}/assets/${encodeURIComponent(process.env.ASSET_NAME ?? 'persona-sprite')}/versions/${encodeURIComponent(process.env.ASSET_VERSION_INDEX ?? '0')}/access`
  }
}

async function fetchAccessPayload(kind: ArtifactKind) {
  const accessRes = await fetch(`${BASE_URL}${endpointFor(kind)}`, {
    headers: { Authorization: `Bearer ${AGENT_API_KEY}`, 'x-forwarded-for': '127.0.0.1' },
  })
  const access = await accessRes.json().catch(() => null)
  if (!accessRes.ok) {
    throw new Error(`${kind} access API failed (${accessRes.status}): ${JSON.stringify(access)}`)
  }
  if (!access?.artifact?.walrusBlobUrl) {
    throw new Error(`${kind} access payload did not include artifact.walrusBlobUrl`)
  }
  return access
}

function compareBytes(kind: ArtifactKind, decrypted: Uint8Array, comparePath: string) {
  const original = new Uint8Array(readFileSync(comparePath))
  const originalHash = createHash('sha256').update(original).digest('hex')
  const decryptedHash = createHash('sha256').update(decrypted).digest('hex')
  if (originalHash !== decryptedHash) {
    throw new Error(
      `${kind} byte mismatch: original=${original.length}B sha256=${originalHash}, decrypted=${decrypted.length}B sha256=${decryptedHash}`,
    )
  }
  console.log(`OK ${kind}: ${comparePath} (${original.length} bytes, sha256=${originalHash})`)
}

function findComparePath(kind: ArtifactKind, envelopeFileName: string, compareFile?: string) {
  const candidates = [
    compareFile,
    DEFAULT_COMPARE_FILES[kind],
    envelopeFileName,
  ].filter((value): value is string => Boolean(value?.trim()))

  for (const candidate of candidates) {
    const fullPath = join(COMPARE_DIR, candidate)
    try {
      readFileSync(fullPath)
      return fullPath
    } catch {
      // Try next candidate.
    }
  }

  const files = readdirSync(COMPARE_DIR).filter((file) => !file.startsWith('.'))
  const matchingExtension = files.find((file) => extname(file) && extname(file) === extname(envelopeFileName))
  if (matchingExtension) return join(COMPARE_DIR, matchingExtension)

  throw new Error(`${kind} compare file not found in ${COMPARE_DIR}; tried ${candidates.join(', ')}`)
}

async function verifyArtifact(kind: ArtifactKind, rawEnvelope: string, compareFile?: string) {
  console.log(`\n--- ${kind} ---`)
  const access = await fetchAccessPayload(kind)
  console.log(`accessKind=${access.accessKind ?? access.visibility ?? 'unknown'}`)
  console.log(`blob=${access.artifact.walrusBlobUrl}`)

  const envelope = unsealDekEnvelope(rawEnvelope)
  console.log(`envelope file=${envelope.fileName} mime=${envelope.mimeType}`)

  const blobRes = await fetch(access.artifact.walrusBlobUrl)
  if (!blobRes.ok) throw new Error(`${kind} blob download failed: ${blobRes.status}`)
  const encryptedBytes = new Uint8Array(await blobRes.arrayBuffer())
  const decrypted = await aesGcmDecrypt(encryptedBytes, envelope.dek, envelope.iv)

  const contentHash = createHash('sha256').update(decrypted).digest('hex')
  if (contentHash !== envelope.contentHash) {
    throw new Error(`${kind} content hash mismatch: computed=${contentHash}, envelope=${envelope.contentHash}`)
  }

  const comparePath = findComparePath(kind, envelope.fileName, compareFile)
  compareBytes(kind, decrypted, comparePath)
}

async function main() {
  if (!SOUL_ID || !AGENT_API_KEY || !COMPARE_DIR) {
    throw new Error('Missing env vars: SOUL_ID, AGENT_API_KEY, COMPARE_DIR')
  }

  const envelopeMap = resolveEnvelopeMap()
  const compareFiles = resolveCompareFiles()
  const kinds = (Object.keys(DEFAULT_COMPARE_FILES) as ArtifactKind[])
    .filter((kind) => typeof envelopeMap[kind] === 'string' && envelopeMap[kind]?.trim())

  if (kinds.length === 0) {
    throw new Error('No non-empty raw envelopes were provided')
  }

  for (const kind of kinds) {
    await verifyArtifact(kind, envelopeMap[kind]!, compareFiles[kind])
  }

  console.log(`\nOK ${kinds.length} artifact(s) matched byte-for-byte.`)
}

main().catch((error) => {
  console.error('Fatal:', error instanceof Error ? error.message : error)
  process.exit(1)
})
