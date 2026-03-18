function sanitizeFileNameBase(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._() -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80)
}

export function buildDownloadFileName(name: string, fallbackBase = 'bundle'): string {
  const safeBase = sanitizeFileNameBase(name) || fallbackBase
  return `${safeBase}.zip`
}
