/**
 * Cursor pagination for `soul_content_version_records`. Replaces the legacy
 * `skill-version-pagination.ts`; works for any (kind, name) pair.
 *
 * Cursor format: `${encodeURIComponent(name)}:${versionIndex}`. Decoding is
 * tolerant — invalid cursors return null so callers can fall back to the
 * first page.
 */
export interface ContentVersionCursorShape {
  name: string
  versionIndex: number
}

export interface ContentVersionPageItem {
  name: string
  versionIndex: number
}

export interface PaginateContentVersionsParams {
  limit: number
  cursor: string | null
}

export const DEFAULT_CONTENT_VERSION_PAGE_SIZE = 24
export const MAX_CONTENT_VERSION_PAGE_SIZE = 100

export function encodeContentVersionCursor(item: ContentVersionPageItem): string {
  return `${encodeURIComponent(item.name)}:${item.versionIndex}`
}

export function decodeContentVersionCursor(
  cursor: string | null | undefined,
): ContentVersionCursorShape | null {
  if (!cursor) return null
  const colonIdx = cursor.lastIndexOf(':')
  if (colonIdx <= 0 || colonIdx >= cursor.length - 1) {
    return null
  }
  const namePart = cursor.slice(0, colonIdx)
  const versionPart = cursor.slice(colonIdx + 1)
  let decodedName: string
  try {
    decodedName = decodeURIComponent(namePart)
  } catch {
    return null
  }
  if (!decodedName) {
    return null
  }
  const versionIndex = Number.parseInt(versionPart, 10)
  if (!Number.isFinite(versionIndex) || versionIndex < 0) {
    return null
  }
  return { name: decodedName, versionIndex }
}

export function clampContentVersionPageSize(limit: number | null | undefined): number {
  if (limit == null || !Number.isFinite(limit)) {
    return DEFAULT_CONTENT_VERSION_PAGE_SIZE
  }
  const clamped = Math.max(1, Math.min(MAX_CONTENT_VERSION_PAGE_SIZE, Math.floor(limit)))
  return clamped
}
