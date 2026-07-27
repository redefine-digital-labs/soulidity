export const VISUAL_THEME_COOKIE = 'soulidity_visual_theme'
export const VISUAL_THEME_STORAGE_KEY = 'soulidity-visual-theme'
export const VISUAL_THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export const THEME_PREFERENCES = ['auto', 'animacraft', 'soulidity'] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]
export type ResolvedTheme = Exclude<ThemePreference, 'auto'>

export const THEME_COLOR: Record<ResolvedTheme, string> = {
  animacraft: '#f3f7f8',
  soulidity: '#0d0a1e',
}

export function parseThemePreference(value: unknown): ThemePreference | null {
  if (typeof value !== 'string') return null
  return THEME_PREFERENCES.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : null
}

export function resolveThemePreference(preference: ThemePreference): ResolvedTheme {
  return preference === 'animacraft' ? 'animacraft' : 'soulidity'
}

export function readThemeCookie(cookieHeader: string): ThemePreference | null {
  const encoded = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${VISUAL_THEME_COOKIE}=`))
    ?.slice(VISUAL_THEME_COOKIE.length + 1)

  if (!encoded) return null

  try {
    return parseThemePreference(decodeURIComponent(encoded))
  } catch {
    return null
  }
}

export function selectThemePreference(
  cookieHeader: string,
  storedValue: string | null,
): ThemePreference {
  return readThemeCookie(cookieHeader) ?? parseThemePreference(storedValue) ?? 'auto'
}

export function isSoulidityHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  return normalized === 'soulidity.ai' || normalized.endsWith('.soulidity.ai')
}

export function serializeThemeCookie(
  preference: ThemePreference,
  location: { hostname: string; protocol: string },
): string {
  const segments = [
    `${VISUAL_THEME_COOKIE}=${encodeURIComponent(preference)}`,
    'Path=/',
    `Max-Age=${VISUAL_THEME_COOKIE_MAX_AGE}`,
    'SameSite=Lax',
  ]

  if (isSoulidityHostname(location.hostname)) {
    segments.push('Domain=.soulidity.ai')
  }
  if (location.protocol === 'https:') {
    segments.push('Secure')
  }

  return segments.join('; ')
}
