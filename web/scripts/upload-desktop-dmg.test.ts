import { describe, expect, it } from 'vitest'
import { parseVersionFromFileName } from './upload-desktop-dmg'

describe('parseVersionFromFileName', () => {
  it('strips the architecture suffix from standard release names', () => {
    expect(parseVersionFromFileName('Soulidity Desktop-0.0.4-arm64.dmg')).toBe('0.0.4')
  })

  it('keeps prerelease identifiers before the architecture token', () => {
    expect(parseVersionFromFileName('Soulidity Desktop-0.0.4-beta.1-arm64.dmg')).toBe(
      '0.0.4-beta.1',
    )
  })

  it('rejects file names that do not match the desktop dmg convention', () => {
    expect(() => parseVersionFromFileName('Soulidity Desktop-0.0.4.dmg')).toThrow(
      /Could not parse version/,
    )
  })
})
