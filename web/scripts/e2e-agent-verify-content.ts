/**
 * E2E Content Verification (Phase 2 unified content, SOUL_DOC v0 only):
 * Agent access API -> Walrus download -> direct AES-GCM decrypt -> byte compare.
 *
 * Captures the SOUL_DOC pending Seal material from the upload flow
 * (`window.__e2eLastSealMaterial` mirrored into env), then bypasses the
 * on-chain Seal approval path entirely and decrypts the Walrus blob using
 * the original DEK / IV. Used as the byte-level cross-check for the
 * agent-mediated Seal path covered separately by `e2e-agent-decrypt.ts`.
 *
 * Coverage scope: only `char` (the unified `(KIND_SOUL_DOC, "soul", v0)`
 * slot returned by `GET /api/agent/souls/{id}/access`). Per-kind agent
 * routes for memory / skills / sprite / audio do not exist in the current
 * unified content API (tracked by phase 9.6 in `tasks/todo.md`); the legacy
 * `/memory/.../access`, `/skills/.../access`, `/assets/.../access` routes
 * have been removed. Until per-kind agent endpoints land, this script
 * intentionally only verifies the SOUL_DOC artifact.
 *
 * Single-artifact usage:
 *   SOUL_ID="0x..." \
 *   AGENT_API_KEY="sk-..." \
 *   PENDING_SEAL_MATERIAL='{"dek":"...","iv":"...","contentHash":"...","mimeType":"text/markdown","fileName":"soul.md"}' \
 *   COMPARE_FILE="soul.md" \
 *   COMPARE_DIR="/Users/admin/Documents/example" \
 *   npx tsx web/scripts/e2e-agent-verify-content.ts
 *
 * Compatibility: `PENDING_SEAL_MATERIALS_JSON` is still accepted (only its
 * `char` entry is used; non-`char` keys are ignored with a warning).
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

const SOUL_ID = process.env.SOUL_ID!
const AGENT_API_KEY = process.env.AGENT_API_KEY!
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100'
const COMPARE_DIR = process.env.COMPARE_DIR!

type ArtifactKind = 'char'

interface PendingSealMaterial {
  dek: string
  iv: string
  contentHash: string
  mimeType: string
  fileName: string
}

type PendingSealMaterialMap = Partial<Record<string, PendingSealMaterial | null>>

const DEFAULT_COMPARE_FILES: Record<ArtifactKind, string> = {
  char: 'soul.md',
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

function resolveMaterialMap(): PendingSealMaterialMap {
  const map = readJsonEnv<PendingSealMaterialMap>('PENDING_SEAL_MATERIALS_JSON')
  if (map) {
    const supportedKinds = new Set<string>(Object.keys(DEFAULT_COMPARE_FILES))
    const unsupported = Object.keys(map).filter((kind) => !supportedKinds.has(kind))
    if (unsupported.length > 0) {
      console.warn(
        `[verify-content] Ignoring unsupported PENDING_SEAL_MATERIALS_JSON keys: ${unsupported.join(', ')}.`
        + ' Only "char" (SOUL_DOC v0) is verified by the current unified content API.',
      )
    }
    return map
  }

  const singleMaterial = readJsonEnv<PendingSealMaterial>('PENDING_SEAL_MATERIAL')
  if (singleMaterial) return { char: singleMaterial }

  throw new Error('PENDING_SEAL_MATERIALS_JSON or PENDING_SEAL_MATERIAL is required')
}

function resolveCompareFiles() {
  const compareMap = readJsonEnv<Partial<Record<ArtifactKind, string>>>('COMPARE_MAP_JSON') ?? {}
  if (process.env.COMPARE_FILE?.trim()) {
    compareMap.char = process.env.COMPARE_FILE.trim()
  }
  return compareMap
}

function resolveKinds(materialMap: PendingSealMaterialMap): ArtifactKind[] {
  return (Object.keys(DEFAULT_COMPARE_FILES) as ArtifactKind[])
    .filter((kind) => Boolean(materialMap[kind]))
}

function endpointFor(kind: ArtifactKind) {
  switch (kind) {
    case 'char':
      return `/api/agent/souls/${encodeURIComponent(SOUL_ID)}/access`
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

function materialToBytes(material: PendingSealMaterial) {
  return {
    dek: new Uint8Array(Buffer.from(material.dek, 'base64')),
    iv: new Uint8Array(Buffer.from(material.iv, 'base64')),
    contentHash: material.contentHash,
    mimeType: material.mimeType,
    fileName: material.fileName,
  }
}

async function verifyArtifact(kind: ArtifactKind, material: PendingSealMaterial, compareFile?: string) {
  console.log(`\n--- ${kind} ---`)
  const access = await fetchAccessPayload(kind)
  console.log(`accessKind=${access.accessKind ?? access.visibility ?? 'unknown'}`)
  console.log(`blob=${access.artifact.walrusBlobUrl}`)

  const envelope = materialToBytes(material)
  console.log(`material file=${envelope.fileName} mime=${envelope.mimeType}`)

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

  const materialMap = resolveMaterialMap()
  const compareFiles = resolveCompareFiles()
  const kinds = resolveKinds(materialMap)

  if (kinds.length === 0) {
    throw new Error('No artifacts selected for verification (PENDING_SEAL_MATERIALS_JSON contained no usable kinds)')
  }

  for (const kind of kinds) {
    await verifyArtifact(kind, materialMap[kind]!, compareFiles[kind])
  }

  console.log(`\nOK ${kinds.length} artifact(s) matched byte-for-byte.`)
}

main().catch((error) => {
  console.error('Fatal:', error instanceof Error ? error.message : error)
  process.exit(1)
})
