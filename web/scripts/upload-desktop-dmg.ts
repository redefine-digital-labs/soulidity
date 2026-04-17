/**
 * Upload the packaged Soulidity Desktop dmg to Vercel Blob.
 *
 * Prerequisites:
 *   - dmg built at desktop/apps/desktop/release/Soulidity Desktop-<ver>-arm64.dmg
 *   - BLOB_READ_WRITE_TOKEN set in env (create in Vercel Dashboard → Storage → Blob)
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxx \
 *   npx tsx web/scripts/upload-desktop-dmg.ts \
 *     "../desktop/apps/desktop/release/Soulidity Desktop-0.0.4-arm64.dmg"
 *
 * Prints the public URL and suggests the env-var update.
 */

import { createReadStream, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { put } from '@vercel/blob'

async function main() {
  const rawPath = process.argv[2]
  if (!rawPath) {
    console.error('Usage: tsx upload-desktop-dmg.ts <path-to-dmg>')
    process.exit(1)
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  if (!token) {
    console.error('BLOB_READ_WRITE_TOKEN is not set. Create a Vercel Blob store and copy the rw token.')
    process.exit(1)
  }

  const absolute = resolve(rawPath)
  const fileName = basename(absolute)
  const stat = statSync(absolute)
  const sizeMb = (stat.size / 1024 / 1024).toFixed(1)

  console.log(`Uploading ${fileName} (${sizeMb} MB) to Vercel Blob...`)

  const blob = await put(fileName, createReadStream(absolute), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/x-apple-diskimage',
    token,
  })

  console.log('\n✓ Upload complete.')
  console.log('Public URL:')
  console.log(`  ${blob.url}`)
  console.log('\nAdd to Vercel env vars (Production):')
  console.log(`  NEXT_PUBLIC_DESKTOP_MAC_ARM64_URL=${blob.url}`)
}

main().catch((err) => {
  console.error('Upload failed:', err)
  process.exit(1)
})
