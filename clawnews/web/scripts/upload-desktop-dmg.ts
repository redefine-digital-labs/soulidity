/**
 * Upload the packaged Soulidity Desktop dmg to Vercel Blob AND publish a
 * stable JSON manifest that the `/download` page reads at runtime.
 *
 * The manifest lives at a fixed Blob path (`desktop/manifest.json`) so its
 * public URL is stable across releases. Publishing a new desktop build only
 * requires running this script — the web app picks up the new version on
 * the next ISR revalidation cycle, with no Vercel redeploy.
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
 * First-time setup: copy the manifest URL printed at the end into Vercel env
 * vars as `DESKTOP_MANIFEST_URL`. Subsequent releases need no env changes.
 */

import { createReadStream, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { put } from '@vercel/blob'

const MANIFEST_BLOB_PATH = 'desktop/manifest.json'
const MANIFEST_VERSION = 1

interface DesktopManifest {
  manifestVersion: number
  version: string
  publishedAt: string
  mac: {
    arm64: {
      url: string
      fileName: string
      sizeBytes: number
    }
  }
}

const DESKTOP_DMG_FILE_PATTERN =
  /^Soulidity Desktop-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-(?:arm64|x64|universal)\.dmg$/

export function parseVersionFromFileName(fileName: string): string {
  const match = fileName.match(DESKTOP_DMG_FILE_PATTERN)
  if (!match) {
    throw new Error(
      `Could not parse version from file name: ${fileName}. Expected "Soulidity Desktop-<version>-arm64.dmg".`,
    )
  }
  return match[1]
}

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
  const version = parseVersionFromFileName(fileName)

  console.log(`Uploading ${fileName} (${sizeMb} MB, v${version}) to Vercel Blob...`)

  const dmgBlob = await put(fileName, createReadStream(absolute), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/x-apple-diskimage',
    token,
  })

  console.log(`✓ dmg uploaded: ${dmgBlob.url}`)

  const manifest: DesktopManifest = {
    manifestVersion: MANIFEST_VERSION,
    version,
    publishedAt: new Date().toISOString(),
    mac: {
      arm64: {
        url: dmgBlob.url,
        fileName,
        sizeBytes: stat.size,
      },
    },
  }

  const manifestBlob = await put(MANIFEST_BLOB_PATH, JSON.stringify(manifest, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
    token,
    cacheControlMaxAge: 60,
  })

  console.log('\n✓ Manifest published.')
  console.log(`  Manifest URL: ${manifestBlob.url}`)
  console.log('\nOne-time Vercel env var (set once, then future releases need no redeploy):')
  console.log(`  DESKTOP_MANIFEST_URL=${manifestBlob.url}`)
  console.log('\nLegacy fallback env vars (only needed if the manifest URL is unreachable):')
  console.log(`  NEXT_PUBLIC_DESKTOP_VERSION=${version}`)
  console.log(`  NEXT_PUBLIC_DESKTOP_MAC_ARM64_URL=${dmgBlob.url}`)
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Upload failed:', err)
    process.exit(1)
  })
}
