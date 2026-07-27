import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  THEME_COLOR,
  VISUAL_THEME_COOKIE_MAX_AGE,
  parseThemePreference,
  resolveThemePreference,
  selectThemePreference,
  serializeThemeCookie,
} from './visual-theme'

const bootstrapSource = readFileSync(
  fileURLToPath(new URL('../../public/theme-bootstrap.js', import.meta.url)),
  'utf8',
)
const globalsSource = readFileSync(
  fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
  'utf8',
)
const providerSource = readFileSync(
  fileURLToPath(
    new URL('../../components/providers/visual-theme-provider.tsx', import.meta.url),
  ),
  'utf8',
)

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
}

function contrastRatio(left: string, right: string): number {
  function luminance(hex: string) {
    const components = hexToRgb(hex).map((channel) => {
      const normalized = channel / 255
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return (
      0.2126 * components[0]
      + 0.7152 * components[1]
      + 0.0722 * components[2]
    )
  }

  const leftLuminance = luminance(left)
  const rightLuminance = luminance(right)
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05)
    / (Math.min(leftLuminance, rightLuminance) + 0.05)
  )
}

function readThemeToken(theme: 'animacraft' | 'soulidity', token: string): string {
  const selector = theme === 'animacraft'
    ? /\[data-theme='animacraft'\] \{([\s\S]*?)\n\}/
    : /\[data-theme='soulidity'\] \{([\s\S]*?)\n\}/
  const block = globalsSource.match(selector)?.[1]
  const value = block?.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
  if (!value) throw new Error(`Missing ${theme} token: --${token}`)
  return value
}

function runBootstrap({
  cookie = '',
  stored = null,
  hostname = 'www.soulidity.ai',
  protocol = 'https:',
}: {
  cookie?: string
  stored?: string | null
  hostname?: string
  protocol?: string
}) {
  const attributes = new Map<string, string>()
  const storage = new Map<string, string>()
  if (stored !== null) storage.set('soulidity-visual-theme', stored)
  const cookieWrites: string[] = []
  const themeColor = { content: '#0d0a1e' }
  const colorScheme = { content: 'dark' }

  const documentElement = {
    style: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      attributes.set(name, value)
    },
  }
  const document = {
    documentElement,
    querySelector(selector: string) {
      const target =
        selector === 'meta[name="theme-color"]'
          ? themeColor
          : selector === 'meta[name="color-scheme"]'
            ? colorScheme
            : null
      if (!target) return null
      return {
        setAttribute(name: string, value: string) {
          if (name === 'content') target.content = value
        },
      }
    },
  }
  Object.defineProperty(document, 'cookie', {
    get: () => cookie,
    set: (value: string) => cookieWrites.push(value),
  })

  const window = {
    location: { hostname, protocol },
    localStorage: {
      getItem(key: string) {
        return storage.get(key) ?? null
      },
      setItem(key: string, value: string) {
        storage.set(key, value)
      },
    },
  }

  vm.runInNewContext(bootstrapSource, {
    document,
    window,
    decodeURIComponent,
    encodeURIComponent,
  })

  return { attributes, colorScheme, cookieWrites, documentElement, storage, themeColor }
}

describe('visual theme contract', () => {
  it('keeps the server and first client render identical before effect synchronization', () => {
    expect(providerSource).toContain(
      "useState<ThemePreference>('auto')",
    )
    expect(providerSource).not.toContain('readPreferenceFromDocument')
    expect(providerSource).toContain(
      'window.requestAnimationFrame(synchronize)',
    )
    expect(providerSource).toContain(
      'window.cancelAnimationFrame(synchronizationFrame)',
    )
  })

  it('accepts only public preferences and always resolves auto to Soulidity', () => {
    expect(parseThemePreference('auto')).toBe('auto')
    expect(parseThemePreference('animacraft')).toBe('animacraft')
    expect(parseThemePreference('soulidity')).toBe('soulidity')
    expect(parseThemePreference('dark')).toBeNull()
    expect(resolveThemePreference('auto')).toBe('soulidity')
    expect(resolveThemePreference('animacraft')).toBe('animacraft')
  })

  it('uses the cookie first and local storage only as a fallback', () => {
    expect(
      selectThemePreference('x=1; soulidity_visual_theme=animacraft', 'soulidity'),
    ).toBe('animacraft')
    expect(selectThemePreference('soulidity_visual_theme=invalid', 'animacraft')).toBe(
      'animacraft',
    )
    expect(selectThemePreference('', null)).toBe('auto')
  })

  it('serializes a one-year shared production cookie without weakening local development', () => {
    const production = serializeThemeCookie('animacraft', {
      hostname: 'app.soulidity.ai',
      protocol: 'https:',
    })
    expect(production).toContain('soulidity_visual_theme=animacraft')
    expect(production).toContain(`Max-Age=${VISUAL_THEME_COOKIE_MAX_AGE}`)
    expect(production).toContain('SameSite=Lax')
    expect(production).toContain('Domain=.soulidity.ai')
    expect(production).toContain('Secure')

    const development = serializeThemeCookie('soulidity', {
      hostname: 'localhost',
      protocol: 'http:',
    })
    expect(development).not.toContain('Domain=')
    expect(development).not.toContain('Secure')

    const insecureSouliditySubdomain = serializeThemeCookie('auto', {
      hostname: 'local.soulidity.ai',
      protocol: 'http:',
    })
    expect(insecureSouliditySubdomain).toContain('Domain=.soulidity.ai')
    expect(insecureSouliditySubdomain).not.toContain('Secure')
  })

  it('keeps small action and brand text AA-readable on both Animacraft surfaces', () => {
    const background = readThemeToken('animacraft', 'ui-bg')
    const surface = readThemeToken('animacraft', 'ui-surface')
    const action = readThemeToken('animacraft', 'ui-action')
    const brandText = readThemeToken('animacraft', 'ui-brand-text')

    expect(contrastRatio(action, background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(action, surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(brandText, background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(brandText, surface)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps Soulidity action labels readable while using the protocol action fill', () => {
    const background = readThemeToken('soulidity', 'ui-bg')
    const surface = readThemeToken('soulidity', 'ui-surface')
    const actionFill = readThemeToken('soulidity', 'ui-action')
    const actionLabel = readThemeToken('soulidity', 'ui-action-label')

    expect(actionFill).toBe('#7c3aed')
    expect(contrastRatio(actionLabel, background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(actionLabel, surface)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('pre-paint theme bootstrap', () => {
  it('applies and re-persists the local-storage fallback before hydration', () => {
    const result = runBootstrap({ stored: 'animacraft' })
    expect(result.attributes.get('data-theme-preference')).toBe('animacraft')
    expect(result.attributes.get('data-theme')).toBe('animacraft')
    expect(result.documentElement.style.colorScheme).toBe('light')
    expect(result.colorScheme.content).toBe('light')
    expect(result.themeColor.content).toBe(THEME_COLOR.animacraft)
    expect(result.cookieWrites.at(-1)).toContain('Domain=.soulidity.ai')
  })

  it('keeps auto as the preference while rendering the Soulidity palette', () => {
    const result = runBootstrap({
      cookie: 'soulidity_visual_theme=auto',
      stored: 'animacraft',
    })
    expect(result.attributes.get('data-theme-preference')).toBe('auto')
    expect(result.attributes.get('data-theme')).toBe('soulidity')
    expect(result.documentElement.style.colorScheme).toBe('dark')
    expect(result.colorScheme.content).toBe('dark')
    expect(result.storage.get('soulidity-visual-theme')).toBe('auto')
    expect(result.themeColor.content).toBe(THEME_COLOR.soulidity)
  })
})
