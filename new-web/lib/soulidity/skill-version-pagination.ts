export interface SkillVersionCursorShape {
  skillName: string
  versionIndex: number
}

export interface SkillVersionPageItem {
  skillName: string
  versionIndex: number
}

export interface PaginateSkillVersionsParams {
  limit: number
  cursor: string | null
}

export const DEFAULT_SKILL_VERSION_PAGE_SIZE = 24
export const MAX_SKILL_VERSION_PAGE_SIZE = 100

export function encodeSkillVersionCursor(item: SkillVersionPageItem): string {
  return `${encodeURIComponent(item.skillName)}:${item.versionIndex}`
}

export function parseSkillVersionCursor(cursor: string | null | undefined): SkillVersionCursorShape | null {
  if (!cursor) return null
  const splitAt = cursor.lastIndexOf(':')
  if (splitAt <= 0) return null

  const rawSkillName = cursor.slice(0, splitAt)
  const rawVersionIndex = cursor.slice(splitAt + 1)
  const versionIndex = Number.parseInt(rawVersionIndex, 10)
  if (!Number.isInteger(versionIndex) || versionIndex < 0) {
    return null
  }

  let skillName: string
  try {
    skillName = decodeURIComponent(rawSkillName).trim()
  } catch {
    return null
  }
  if (!skillName) {
    return null
  }

  return { skillName, versionIndex }
}

function compareSkillVersionOrder(left: SkillVersionPageItem, right: SkillVersionPageItem) {
  if (left.skillName < right.skillName) return -1
  if (left.skillName > right.skillName) return 1
  return right.versionIndex - left.versionIndex
}

function isAfterCursor(item: SkillVersionPageItem, cursor: SkillVersionCursorShape | null) {
  if (!cursor) return true
  if (item.skillName > cursor.skillName) return true
  if (item.skillName < cursor.skillName) return false
  return item.versionIndex < cursor.versionIndex
}

export function clampSkillVersionPageSize(limitRaw: string | null | undefined) {
  const parsed = Number.parseInt(limitRaw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SKILL_VERSION_PAGE_SIZE
  }
  return Math.min(parsed, MAX_SKILL_VERSION_PAGE_SIZE)
}

export function paginateSoulSkillVersions<T extends SkillVersionPageItem>(
  items: T[],
  params: PaginateSkillVersionsParams,
) {
  const cursor = parseSkillVersionCursor(params.cursor)
  const ordered = [...items].sort(compareSkillVersionOrder)
  const filtered = ordered.filter((item) => isAfterCursor(item, cursor))
  const pageItems = filtered.slice(0, params.limit)
  const nextItem = filtered[params.limit] ?? null

  return {
    items: pageItems,
    nextCursor: nextItem ? encodeSkillVersionCursor(pageItems[pageItems.length - 1]!) : null,
    total: ordered.length,
  }
}
