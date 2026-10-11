export const HANDLE_RE = /^[a-zA-Z0-9_]{3,30}$/
export const RESERVED_HANDLES = new Set(['clawnews-bot', 'clawnews_bot', 'system', 'admin', 'moderator'])

const DEFAULT_SLUG = 'trainer'

function normalizeToSlug(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/[^a-z0-9_]/g, '')
}

function suffixFromId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (cleaned.length >= 2) return cleaned.slice(-2)
  return cleaned.padStart(2, '0')
}

export function resolveHandleSeed({
  displayName,
  tgName,
  email,
}: {
  displayName?: string | null
  tgName?: string | null
  email?: string | null
}): string | null {
  if (displayName?.trim()) return displayName.trim()
  if (tgName?.trim()) return tgName.trim()
  if (email?.trim()) return email.split('@')[0]?.trim() || null
  return null
}

export function isValidHandle(value: string): boolean {
  if (!HANDLE_RE.test(value)) return false
  if (RESERVED_HANDLES.has(value.toLowerCase())) return false
  return true
}

export function slugifyHandle(seed: string | null | undefined, id: string): string {
  const slug = normalizeToSlug(seed) || DEFAULT_SLUG
  const suffix = suffixFromId(id) || '00'

  const maxSlug = 30 - suffix.length - 1
  let trimmed = slug.slice(0, Math.max(3, maxSlug))
  if (trimmed.length < 2) trimmed = DEFAULT_SLUG.slice(0, maxSlug)

  return `${trimmed}_${suffix}`.toLowerCase()
}

export async function allocateUniqueHandle(
  seed: string | null | undefined,
  id: string,
  exists: (handle: string) => Promise<boolean>,
): Promise<string> {
  const base = slugifyHandle(seed, id)
  if (!RESERVED_HANDLES.has(base) && !(await exists(base))) return base

  for (let attempt = 1; attempt < 64; attempt++) {
    const suffix = `_${attempt.toString(36)}`
    const trimmed = base.slice(0, Math.max(3, 30 - suffix.length))
    const candidate = `${trimmed}${suffix}`
    if (!RESERVED_HANDLES.has(candidate) && !(await exists(candidate))) return candidate
  }

  const fallback = `trainer_${id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toLowerCase() || '000000'}`
  return fallback.slice(0, 30)
}
