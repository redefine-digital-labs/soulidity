import { describe, it, expect } from 'vitest'
import { parseSoulMetadata } from '../../web/lib/soulidity/metadata'
import type { SoulMetadata } from '../../web/lib/soulidity/metadata'

describe('parseSoulMetadata', () => {
  it('parses valid sprite-sheet metadata', () => {
    const input: SoulMetadata = {
      version: 1,
      persona: {
        format: 'sprite-sheet',
        stateMap: {
          idle: 'idle',
          thinking: 'thinking',
          working: 'working',
          'needs-attention': 'alert',
          completed: 'done',
          error: 'error',
        },
        publicAssets: {
          type: 'sprite-sheet',
          sheetUrl: 'https://walrus.example/blob/abc',
          frameWidth: 64,
          frameHeight: 64,
          columns: 6,
          animations: {
            idle: { frames: [0, 1, 2, 3], fps: 8, loop: true },
          },
        },
      },
    }
    const result = parseSoulMetadata(JSON.stringify(input))
    expect(result).not.toBeNull()
    expect(result!.persona!.format).toBe('sprite-sheet')
    expect(result!.persona!.publicAssets!.frameWidth).toBe(64)
  })

  it('rejects invalid version', () => {
    expect(parseSoulMetadata(JSON.stringify({ version: 2 }))).toBeNull()
  })

  it('accepts metadata without persona (minimal)', () => {
    const result = parseSoulMetadata(JSON.stringify({ version: 1 }))
    expect(result).not.toBeNull()
    expect(result!.persona).toBeUndefined()
  })

  it('accepts metadata with voice only', () => {
    const input: SoulMetadata = {
      version: 1,
      voice: {
        format: 'tts-profile',
        ttsProfile: { provider: 'elevenlabs', voiceId: 'abc123' },
      },
    }
    const result = parseSoulMetadata(JSON.stringify(input))
    expect(result).not.toBeNull()
    expect(result!.voice!.format).toBe('tts-profile')
  })

  it('accepts metadata with protectedAssets reference', () => {
    const input: SoulMetadata = {
      version: 1,
      persona: {
        format: 'sprite-sheet',
        stateMap: {
          idle: 'idle', thinking: 'think', working: 'work',
          'needs-attention': 'alert', completed: 'done', error: 'err',
        },
        protectedAssets: { assetName: 'hires-sprite', versionIndex: 0 },
      },
    }
    const result = parseSoulMetadata(JSON.stringify(input))
    expect(result!.persona!.protectedAssets!.assetName).toBe('hires-sprite')
  })

  it('returns null for malformed JSON', () => {
    expect(parseSoulMetadata('not json')).toBeNull()
    expect(parseSoulMetadata('')).toBeNull()
  })

  it('preserves extra fields', () => {
    const input = { version: 1, extra: { customKey: 'value' } }
    const result = parseSoulMetadata(JSON.stringify(input))
    expect(result!.extra!.customKey).toBe('value')
  })
})
