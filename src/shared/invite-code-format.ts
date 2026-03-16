export const CURRENT_INVITE_CODE_LENGTH = 16
export const LEGACY_INVITE_CODE_LENGTH = 8
export const INVITE_CODE_PATTERN = /^(?:[A-F0-9]{8}|[A-F0-9]{16})$/

export function normalizeInviteCode(value: string): string {
  return value.trim().replace(/[-\s]/g, '').toUpperCase()
}

export function isInviteCode(value: string): boolean {
  return INVITE_CODE_PATTERN.test(value)
}
