import { unzipSync } from 'fflate'
import { parseSkillMd } from '@/lib/soulidity/content-schema'
import { SKILL_MD_TEMPLATE } from '@/lib/soulidity/content-templates'

export const MAX_SOUL_UPLOAD_BYTES = 50 * 1024 * 1024
export const FILE_TOO_LARGE_ERROR = 'File exceeds 50 MB limit'
export const JSON_METADATA_TOO_LARGE_ERROR = 'JSON metadata exceeds 5 MB limit'
export const SKILL_BUNDLE_NOT_ZIP_ERROR = "Can't use this file. Upload a .zip file for Skills & Docs."
export const SKILL_BUNDLE_MISSING_SKILL_MD_ERROR = "Can't use this ZIP file. Put SKILL.md at the ZIP root or inside one folder, then upload it again."
export const SKILL_BUNDLE_INVALID_FRONTMATTER_ERROR = "Can't use this ZIP file. SKILL.md must start with frontmatter and include name."
export const INVALID_SKILL_BUNDLE_ERROR = "Can't use this skill bundle. Upload a .zip file with SKILL.md at the root or inside one folder, and make sure SKILL.md frontmatter includes name."
export const SKILL_BUNDLE_FORMAT_SUMMARY = 'Upload a .zip file. The archive can place SKILL.md at the root or inside one folder. SKILL.md must start with frontmatter and include name.'
export const SKILL_BUNDLE_FRONTMATTER_EXAMPLE = SKILL_MD_TEMPLATE
const PUBLIC_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const PUBLIC_METADATA_MIME_TYPES = new Set(['application/json'])
const PUBLIC_ZIP_MIME_TYPES = new Set(['application/zip', 'application/x-zip-compressed'])
const MAX_PUBLIC_JSON_METADATA_BYTES = 5 * 1024 * 1024
const MIN_ENCRYPTED_PAYLOAD_BYTES = 32
export const PUBLIC_UPLOAD_ERROR = 'Public uploads must be JPEG, PNG, WebP, GIF images, JSON metadata, or ZIP skill bundles'
const ENCRYPTED_UPLOAD_ERROR = 'Encrypted upload is too small (minimum 32 bytes)'

export function validateSoulUploadFile(file: Pick<File, 'size' | 'type'>, type: 'public' | 'encrypted') {
  if (file.size > MAX_SOUL_UPLOAD_BYTES) {
    return FILE_TOO_LARGE_ERROR
  }

  if (type === 'public') {
    if (file.type === 'application/json' && file.size > MAX_PUBLIC_JSON_METADATA_BYTES) {
      return JSON_METADATA_TOO_LARGE_ERROR
    }
    // Allow empty MIME through to signature-based validation — some browsers
    // and OS integrations leave the type blank for valid .zip files.
    if (
      file.type !== ''
      && !PUBLIC_IMAGE_MIME_TYPES.has(file.type)
      && !PUBLIC_METADATA_MIME_TYPES.has(file.type)
      && !PUBLIC_ZIP_MIME_TYPES.has(file.type)
    ) {
      return PUBLIC_UPLOAD_ERROR
    }
    return null
  }

  if (file.size < MIN_ENCRYPTED_PAYLOAD_BYTES) {
    return ENCRYPTED_UPLOAD_ERROR
  }
  return null
}

function hasPrefix(bytes: Uint8Array, prefix: number[]) {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

function hasJpegSignature(bytes: Uint8Array) {
  return hasPrefix(bytes, [0xff, 0xd8, 0xff])
}

function hasPngSignature(bytes: Uint8Array) {
  return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

function hasWebpSignature(bytes: Uint8Array) {
  return (
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytes.length >= 12
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  )
}

function hasGifSignature(bytes: Uint8Array) {
  return hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
}

export function hasZipSignature(bytes: Uint8Array) {
  return hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])
}

function isSkillMdZipPath(name: string) {
  const normalized = name.replace(/\\/g, '/')
  return normalized === 'SKILL.md' || normalized.endsWith('/SKILL.md')
}

function isJsonPayload(bytes: Uint8Array) {
  if (bytes.length > MAX_PUBLIC_JSON_METADATA_BYTES) {
    return false
  }

  try {
    const raw = new TextDecoder().decode(bytes).trim()
    if (!raw.startsWith('{') || !raw.endsWith('}')) {
      return false
    }
    JSON.parse(raw)
    return true
  } catch {
    return false
  }
}

export function validateSoulUploadSignature(
  bytes: Uint8Array,
  type: 'public' | 'encrypted',
  mimeType = '',
) {
  if (type === 'public') {
    if (mimeType === 'application/json') {
      return isJsonPayload(bytes) ? null : PUBLIC_UPLOAD_ERROR
    }
    if (PUBLIC_ZIP_MIME_TYPES.has(mimeType)) {
      return hasZipSignature(bytes) ? null : PUBLIC_UPLOAD_ERROR
    }
    // When MIME is empty (browser omitted it), accept any recognised signature.
    if (mimeType === '') {
      if (
        hasZipSignature(bytes)
        || hasJpegSignature(bytes) || hasPngSignature(bytes)
        || hasWebpSignature(bytes) || hasGifSignature(bytes)
        || isJsonPayload(bytes)
      ) {
        return null
      }
      return PUBLIC_UPLOAD_ERROR
    }
    if (hasJpegSignature(bytes) || hasPngSignature(bytes) || hasWebpSignature(bytes) || hasGifSignature(bytes)) {
      return null
    }
    return PUBLIC_UPLOAD_ERROR
  }

  if (bytes.length >= MIN_ENCRYPTED_PAYLOAD_BYTES) {
    return null
  }

  return ENCRYPTED_UPLOAD_ERROR
}

function parseSkillBundleMetadata(bytes: Uint8Array): { skillName: string } {
  if (!hasZipSignature(bytes)) {
    throw new Error(SKILL_BUNDLE_NOT_ZIP_ERROR)
  }

  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      // Only extract SKILL.md so unrelated archive entries cannot blow up server memory.
      filter(file) {
        return isSkillMdZipPath(file.name)
      },
    })
  } catch {
    throw new Error(INVALID_SKILL_BUNDLE_ERROR)
  }

  const skillMdEntry = Object.entries(files).find(([name]) => {
    return isSkillMdZipPath(name)
  })
  if (!skillMdEntry) {
    throw new Error(SKILL_BUNDLE_MISSING_SKILL_MD_ERROR)
  }

  const source = new TextDecoder().decode(skillMdEntry[1])
  let skillName: string | null = null
  try {
    skillName = parseSkillMd(source).frontmatter.name
  } catch {
    skillName = null
  }
  if (!skillName) {
    throw new Error(SKILL_BUNDLE_INVALID_FRONTMATTER_ERROR)
  }

  return { skillName }
}

export function extractSkillBundleMetadata(bytes: Uint8Array): { skillName: string } {
  return parseSkillBundleMetadata(bytes)
}

export async function validateSelectedSkillBundle(
  file: Pick<File, 'name' | 'type' | 'size' | 'arrayBuffer'>,
): Promise<{ ok: true; skillName: string } | { ok: false; error: string }> {
  if (file.size > MAX_SOUL_UPLOAD_BYTES) {
    return { ok: false, error: FILE_TOO_LARGE_ERROR }
  }

  const normalizedName = file.name.trim().toLowerCase()
  const looksLikeZip = normalizedName.endsWith('.zip') || PUBLIC_ZIP_MIME_TYPES.has(file.type) || file.type === ''
  if (!looksLikeZip) {
    return { ok: false, error: SKILL_BUNDLE_NOT_ZIP_ERROR }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    const metadata = parseSkillBundleMetadata(bytes)
    return { ok: true, skillName: metadata.skillName }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : INVALID_SKILL_BUNDLE_ERROR,
    }
  }
}
