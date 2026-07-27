'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  THEME_COLOR,
  VISUAL_THEME_STORAGE_KEY,
  resolveThemePreference,
  selectThemePreference,
  serializeThemeCookie,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme/visual-theme'

interface VisualThemeContextValue {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
}

const VisualThemeContext = createContext<VisualThemeContextValue | null>(null)

function readStoredPreference(): string | null {
  try {
    return window.localStorage.getItem(VISUAL_THEME_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredPreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(VISUAL_THEME_STORAGE_KEY, preference)
  } catch {
    // The cookie remains the primary persistence channel when storage is denied.
  }
}

function applyDocumentTheme(preference: ThemePreference) {
  const resolvedTheme = resolveThemePreference(preference)
  const root = document.documentElement
  root.dataset.themePreference = preference
  root.dataset.theme = resolvedTheme
  root.style.colorScheme = resolvedTheme === 'animacraft' ? 'light' : 'dark'

  const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  themeColorMeta?.setAttribute('content', THEME_COLOR[resolvedTheme])
  const colorSchemeMeta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  colorSchemeMeta?.setAttribute(
    'content',
    resolvedTheme === 'animacraft' ? 'light' : 'dark',
  )

  return resolvedTheme
}

function persistTheme(preference: ThemePreference) {
  document.cookie = serializeThemeCookie(preference, window.location)
  writeStoredPreference(preference)
}

export function VisualThemeProvider({ children }: { children: ReactNode }) {
  // Keep the server and first client render identical. The synchronous head
  // bootstrap already paints the saved theme; the effect below then hydrates
  // React state from the shared cookie without producing a mismatch.
  const [preference, setPreferenceState] = useState<ThemePreference>('auto')

  const synchronize = useCallback(() => {
    const nextPreference = selectThemePreference(document.cookie, readStoredPreference())
    persistTheme(nextPreference)
    applyDocumentTheme(nextPreference)
    setPreferenceState(nextPreference)
  }, [])

  useEffect(() => {
    // The head bootstrap already applied the persisted theme before paint.
    // Defer only the React state synchronization so the first client render
    // remains hydration-safe and no synchronous state update runs in an effect.
    const synchronizationFrame = window.requestAnimationFrame(synchronize)
    window.addEventListener('focus', synchronize)
    window.addEventListener('pageshow', synchronize)
    return () => {
      window.cancelAnimationFrame(synchronizationFrame)
      window.removeEventListener('focus', synchronize)
      window.removeEventListener('pageshow', synchronize)
    }
  }, [synchronize])

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    persistTheme(nextPreference)
    applyDocumentTheme(nextPreference)
    setPreferenceState(nextPreference)
  }, [])

  const value = useMemo<VisualThemeContextValue>(
    () => ({
      preference,
      resolvedTheme: resolveThemePreference(preference),
      setPreference,
    }),
    [preference, setPreference],
  )

  return (
    <VisualThemeContext.Provider value={value}>
      {children}
    </VisualThemeContext.Provider>
  )
}

export function useVisualTheme(): VisualThemeContextValue {
  const context = useContext(VisualThemeContext)
  if (!context) {
    throw new Error('useVisualTheme must be used within VisualThemeProvider')
  }
  return context
}
