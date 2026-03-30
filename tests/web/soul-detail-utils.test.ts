import { describe, expect, it } from 'vitest'
import {
  extractCreatedAllowlistCapObjectId,
  toSafeBackgroundImage,
} from '../../web/lib/souls/soul-detail-utils.ts'

const PACKAGE_ID = `0x${'1'.repeat(64)}`
const OTHER_PACKAGE_ID = `0x${'2'.repeat(64)}`
const ACCESS_CAP_ID = `0x${'3'.repeat(64)}`

describe('soul detail helpers', () => {
  it('only accepts raster data-image background URLs', () => {
    expect(toSafeBackgroundImage('data:image/png;base64,Zm9v')).toBe('url("data:image/png;base64,Zm9v")')
    expect(toSafeBackgroundImage('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
  })

  it('rejects unsafe or non-https background URLs', () => {
    expect(toSafeBackgroundImage('data:image/png;base64,Zm9v")')).toBeNull()
    expect(toSafeBackgroundImage('http://example.com/preview.png')).toBeNull()
    expect(toSafeBackgroundImage('https://example.com/preview.png')).toBe('url("https://example.com/preview.png")')
  })

  it('rejects https background URLs that keep CSS-significant characters after normalization', () => {
    expect(toSafeBackgroundImage('https://example.com/preview).png')).toBeNull()
  })

  it('rejects oversized raster data-image URLs', () => {
    const oversized = `data:image/png;base64,${'a'.repeat(600_000)}`
    expect(toSafeBackgroundImage(oversized)).toBeNull()
  })

  it('requires the created allowlist cap object type to match the configured Soul package id exactly', () => {
    expect(extractCreatedAllowlistCapObjectId({
      objectChanges: [
        {
          type: 'created',
          objectId: ACCESS_CAP_ID,
          objectType: `${OTHER_PACKAGE_ID}::allowlist::SoulAllowlistCap`,
        },
        {
          type: 'created',
          objectId: `0x${'4'.repeat(64)}`,
          objectType: `${PACKAGE_ID}::allowlist::SoulAllowlistCap`,
        },
      ],
    }, PACKAGE_ID)).toBe(`0x${'4'.repeat(64)}`)
  })

  it('returns null when the created cap belongs to a different package namespace', () => {
    expect(extractCreatedAllowlistCapObjectId({
      objectChanges: [{
        type: 'created',
        objectId: ACCESS_CAP_ID,
        objectType: `${OTHER_PACKAGE_ID}::allowlist::SoulAllowlistCap`,
      }],
    }, PACKAGE_ID)).toBeNull()
  })
})
