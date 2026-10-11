export type SoulUploadType = 'public' | 'encrypted'

const PUBLIC_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json',
  '.zip': 'application/zip',
}

const ENCRYPTED_MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

function fileExtension(file: File): string {
  const name = file.name.toLowerCase()
  const dotIndex = name.lastIndexOf('.')
  return dotIndex >= 0 ? name.slice(dotIndex) : ''
}

export function inferSoulUploadContentType(
  file: File,
  uploadType: SoulUploadType,
): string {
  if (file.type) return file.type
  const ext = fileExtension(file)
  if (uploadType === 'public') {
    return PUBLIC_MIME_BY_EXT[ext] ?? 'application/octet-stream'
  }
  return ENCRYPTED_MIME_BY_EXT[ext] ?? 'application/octet-stream'
}
