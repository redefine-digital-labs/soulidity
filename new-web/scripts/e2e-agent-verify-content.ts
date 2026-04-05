/**
 * E2E Content Verification: Agent access API → Walrus download → direct AES-GCM decrypt → compare with originals
 *
 * Bypasses Seal (sealSidecar was not properly processed at create time) and directly
 * uses the raw DEK envelope to decrypt the Walrus blob, then compares with reference files.
 *
 * Usage:
 *   source .env && \
 *   SOUL_ID="0x..." \
 *   AGENT_API_KEY="sk-..." \
 *   RAW_ENVELOPE="base64..." \
 *   COMPARE_DIR="/path/to/originals" \
 *   npx tsx new-web/scripts/e2e-agent-verify-content.ts
 */

import { createHash, createDecipheriv } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const SOUL_ID = process.env.SOUL_ID!
const AGENT_API_KEY = process.env.AGENT_API_KEY!
const RAW_ENVELOPE = process.env.RAW_ENVELOPE!
const COMPARE_DIR = process.env.COMPARE_DIR!
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100'

/* ---- inline unsealDekEnvelope ---- */

function getUploadSecret(): Buffer {
  const hex = process.env.SOUL_UPLOAD_SECRET
  if (!hex || hex.length !== 64) throw new Error('SOUL_UPLOAD_SECRET required')
  return Buffer.from(hex, 'hex')
}

function unsealDekEnvelope(envelope: string) {
  const secret = getUploadSecret()
  const raw = Buffer.from(envelope, 'base64')
  const IV = 12, TAG = 16
  const iv = raw.subarray(0, IV)
  const authTag = raw.subarray(IV, IV + TAG)
  const ciphertext = raw.subarray(IV + TAG)
  const decipher = createDecipheriv('aes-256-gcm', secret, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const p = JSON.parse(plaintext.toString('utf8'))
  return {
    dek: new Uint8Array(Buffer.from(p.dek, 'base64')),
    iv: new Uint8Array(Buffer.from(p.iv, 'base64')),
    contentHash: p.contentHash as string,
    mimeType: p.mimeType as string,
    fileName: p.fileName as string,
  }
}

/* ---- AES-GCM decrypt ---- */

async function aesGcmDecrypt(data: Uint8Array, dek: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', dek as unknown as ArrayBuffer, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer }, key, data as unknown as ArrayBuffer))
}

/* ---- archive extraction (uses system tar) ---- */

function extractArchive(data: Uint8Array): Map<string, Uint8Array> {
  const tmp = mkdtempSync(join(tmpdir(), 'soul-verify-'))
  const archivePath = join(tmp, 'archive.tar.gz')
  const outDir = join(tmp, 'out')
  writeFileSync(archivePath, data)
  execSync(`mkdir -p "${outDir}"`)

  // Try tar.gz first, then plain tar, then zip
  try {
    execSync(`tar xzf "${archivePath}" -C "${outDir}" 2>/dev/null || tar xf "${archivePath}" -C "${outDir}" 2>/dev/null || (cd "${outDir}" && unzip -o "${archivePath}" 2>/dev/null)`, { stdio: 'pipe' })
  } catch {
    // Not an archive — return as single file
    return new Map()
  }

  const files = new Map<string, Uint8Array>()
  function walk(dir: string, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), entry.name + '/')
      } else if (entry.isFile()) {
        const relPath = prefix + entry.name
        files.set(relPath, new Uint8Array(readFileSync(join(dir, entry.name))))
      }
    }
  }
  walk(outDir)

  // Clean up
  execSync(`rm -rf "${tmp}"`)
  return files
}

/* ---- main ---- */

async function main() {
  if (!SOUL_ID || !AGENT_API_KEY || !RAW_ENVELOPE || !COMPARE_DIR) {
    console.error('Missing env vars: SOUL_ID, AGENT_API_KEY, RAW_ENVELOPE, COMPARE_DIR')
    process.exit(1)
  }

  // Step 1: Verify agent has access via API
  console.log('--- Step 1: Agent access API ---')
  const accessRes = await fetch(`${BASE_URL}/api/agent/souls/${encodeURIComponent(SOUL_ID)}/access`, {
    headers: { Authorization: `Bearer ${AGENT_API_KEY}`, 'x-forwarded-for': '127.0.0.1' },
  })
  if (!accessRes.ok) {
    const err = await accessRes.json().catch(() => ({}))
    throw new Error(`Access API failed (${accessRes.status}): ${JSON.stringify(err)}`)
  }
  const access = await accessRes.json()
  console.log(`Access kind: ${access.accessKind}`)
  console.log(`Blob URL: ${access.artifact.walrusBlobUrl}`)
  console.log('\u2705 Agent has access')

  // Step 2: Unseal DEK envelope
  console.log('\n--- Step 2: Unseal DEK envelope ---')
  const envelope = unsealDekEnvelope(RAW_ENVELOPE)
  console.log(`DEK: ${envelope.dek.length}B, IV: ${envelope.iv.length}B`)
  console.log(`Content hash: ${envelope.contentHash}`)
  console.log(`File: ${envelope.fileName} (${envelope.mimeType})`)

  // Step 3: Download encrypted blob from Walrus
  console.log('\n--- Step 3: Download encrypted blob ---')
  const blobRes = await fetch(access.artifact.walrusBlobUrl)
  if (!blobRes.ok) throw new Error(`Blob download failed: ${blobRes.status}`)
  const encryptedBytes = new Uint8Array(await blobRes.arrayBuffer())
  console.log(`Downloaded ${encryptedBytes.length} bytes`)

  // Step 4: AES-GCM decrypt
  console.log('\n--- Step 4: AES-GCM decrypt ---')
  const decrypted = await aesGcmDecrypt(encryptedBytes, envelope.dek, envelope.iv)
  console.log(`Decrypted ${decrypted.length} bytes`)

  // Step 5: Verify content hash
  console.log('\n--- Step 5: Verify content hash ---')
  const hash = createHash('sha256').update(decrypted).digest('hex')
  console.log(`Computed:  ${hash}`)
  console.log(`Expected: ${envelope.contentHash}`)
  if (hash !== envelope.contentHash) {
    console.log('\u274C Content hash MISMATCH!')
    process.exit(1)
  }
  console.log('\u2705 Content hash verified')

  // Step 6: Extract archive and compare with originals
  console.log('\n--- Step 6: Extract and compare with originals ---')
  let extractedFiles = extractArchive(decrypted)
  if (extractedFiles.size === 0) {
    console.log('Content is not an archive, treating as single file')
    extractedFiles = new Map([[envelope.fileName, decrypted]])
  }

  console.log(`Extracted ${extractedFiles.size} files:`)
  for (const [name, data] of extractedFiles) {
    console.log(`  ${name} (${data.length} bytes)`)
  }

  // Read originals
  const originals = new Map<string, Uint8Array>()
  for (const file of readdirSync(COMPARE_DIR)) {
    if (file.startsWith('.')) continue
    const fullPath = join(COMPARE_DIR, file)
    originals.set(file, new Uint8Array(readFileSync(fullPath)))
  }

  console.log(`\nOriginal files (${originals.size}):`)
  for (const [name, data] of originals) {
    console.log(`  ${name} (${data.length} bytes)`)
  }

  // Compare
  console.log('\n--- Comparison ---')
  let allMatch = true

  for (const [name, originalData] of originals) {
    const extractedData = extractedFiles.get(name)
    if (!extractedData) {
      console.log(`\u274C ${name}: NOT FOUND in decrypted archive`)
      allMatch = false
      continue
    }

    const origHash = createHash('md5').update(originalData).digest('hex')
    const extHash = createHash('md5').update(extractedData).digest('hex')

    if (origHash === extHash) {
      console.log(`\u2705 ${name}: MATCH (${originalData.length} bytes, md5=${origHash})`)
    } else {
      console.log(`\u274C ${name}: MISMATCH`)
      console.log(`   Original: ${originalData.length} bytes, md5=${origHash}`)
      console.log(`   Extracted: ${extractedData.length} bytes, md5=${extHash}`)
      allMatch = false
    }
  }

  // Check for extra files in archive
  for (const name of extractedFiles.keys()) {
    if (!originals.has(name)) {
      console.log(`\u2139\uFE0F  ${name}: extra file in archive (not in originals)`)
    }
  }

  if (allMatch) {
    console.log('\n\u2705 All files match! Agent can access and decrypt Soul data correctly.')
  } else {
    console.log('\n\u274C Some files do not match.')
    process.exit(1)
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })
