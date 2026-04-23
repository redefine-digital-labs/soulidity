import { describe, expect, it } from 'vitest'
import {
  buildCanonicalSoulMetadata,
  CANONICAL_PERSONA_SPRITE_ASSET_NAME,
  parseSoulMetadata,
  resolveSoulSpriteContract,
} from '../../web/lib/soulidity/metadata'
import {
  buildPersonaSpriteMetadata,
  parsePersonaSpriteConfig,
  validatePersonaSpriteDraft,
} from '../../web/lib/soulidity/persona-sprite'
import type { SoulMetadata } from '../../web/lib/soulidity/metadata'

describe('parseSoulMetadata', () => {
  it('normalizes canonical moodMap metadata', () => {
    const input: SoulMetadata = {
      version: 1,
      persona: {
        format: 'sprite-sheet',
        moodMap: {
          idle: 'idle',
          happy: 'celebrate',
        },
        publicAssets: {
          type: 'sprite-sheet',
          sheetUrl: 'https://walrus.example/blob/abc',
          frameWidth: 64,
          frameHeight: 64,
          columns: 6,
          animations: {
            idle: { frames: [0, 1, 2, 3], fps: 8, loop: true },
            celebrate: { frames: [4, 5], fps: 8, loop: true },
          },
        },
      },
    }

    const result = parseSoulMetadata(JSON.stringify(input))

    expect(result).not.toBeNull()
    expect(result!.persona!.moodMap.idle).toBe('idle')
    expect(result!.persona!.moodMap.happy).toBe('celebrate')
  })

  it('reads legacy stateMap and normalizes it to moodMap', () => {
    const input: SoulMetadata = {
      version: 1,
      persona: {
        format: 'sprite-sheet',
        stateMap: {
          idle: 'idle',
          completed: 'celebrate',
          working: 'working',
          error: 'angry',
        },
      },
    }

    const result = parseSoulMetadata(JSON.stringify(input))

    expect(result).not.toBeNull()
    expect(result!.persona!.moodMap.idle).toBe('idle')
    expect(result!.persona!.moodMap.happy).toBe('celebrate')
    expect(result!.persona!.moodMap.working).toBe('working')
    expect(result!.persona!.moodMap.angry).toBe('angry')
  })

  it('rejects invalid version', () => {
    expect(parseSoulMetadata(JSON.stringify({ version: 2 }))).toBeNull()
  })

  it('accepts metadata without persona', () => {
    const result = parseSoulMetadata(JSON.stringify({ version: 1 }))

    expect(result).not.toBeNull()
    expect(result!.persona).toBeUndefined()
  })
})

describe('resolveSoulSpriteContract', () => {
  it('accepts canonical public sprite metadata', () => {
    const metadata = buildCanonicalSoulMetadata({
      moodMap: { idle: 'idle' },
      publicAssets: {
        type: 'sprite-sheet',
        sheetUrl: 'https://walrus.example/blob/abc',
        frameWidth: 64,
        frameHeight: 64,
        columns: 6,
        animations: {
          idle: { frames: [0, 1], fps: 8, loop: true },
        },
      },
    })

    const contract = resolveSoulSpriteContract(metadata)

    expect(contract.policy).toBe('public')
    expect(contract.issues).toEqual([])
  })

  it('accepts canonical owner-only sprite metadata', () => {
    const metadata = buildCanonicalSoulMetadata({
      moodMap: { idle: 'idle' },
      protectedAssets: {
        assetName: CANONICAL_PERSONA_SPRITE_ASSET_NAME,
        versionIndex: 3,
        type: 'sprite-sheet',
        frameWidth: 64,
        frameHeight: 64,
        columns: 6,
        animations: {
          idle: { frames: [0, 1], fps: 8, loop: true },
        },
      },
    })

    const contract = resolveSoulSpriteContract(metadata, {
      availableProtectedVersionIndexes: [3],
    })

    expect(contract.policy).toBe('owner_only')
    expect(contract.protectedAssets?.assetName).toBe(CANONICAL_PERSONA_SPRITE_ASSET_NAME)
  })

  it('marks missing sprite metadata as missing', () => {
    const contract = resolveSoulSpriteContract({ version: 1, persona: {
      format: 'sprite-sheet',
      moodMap: { idle: 'idle' },
    } })

    expect(contract.policy).toBe('missing')
    expect(contract.issues).toContain('persona sprite asset is missing')
  })

  it('marks invalid protected sprite metadata as invalid', () => {
    const metadata: SoulMetadata = {
      version: 1,
      persona: {
        format: 'sprite-sheet',
        moodMap: { idle: 'idle' },
        protectedAssets: {
          type: 'sprite-sheet',
          assetName: 'legacy-sprite',
          versionIndex: 0,
          frameWidth: 64,
          frameHeight: 64,
          columns: 6,
          animations: {
            idle: { frames: [0, 1], fps: 8, loop: true },
          },
        },
      },
    }

    const contract = resolveSoulSpriteContract(parseSoulMetadata(JSON.stringify(metadata)))

    expect(contract.policy).toBe('invalid')
    expect(contract.issues).toContain(
      `protectedAssets.assetName must be ${CANONICAL_PERSONA_SPRITE_ASSET_NAME}`,
    )
  })
})

describe('persona-sprite.ts helpers', () => {
  const validConfigSource = JSON.stringify({
    frameWidth: 64,
    frameHeight: 64,
    columns: 4,
    animations: {
      idle: { frames: [0, 1], fps: 8, loop: true },
      completed: { frames: [2, 3], fps: 8, loop: true },
    },
  })

  it('parses a valid persona sprite config', () => {
    const parsed = parsePersonaSpriteConfig(validConfigSource)

    expect(parsed).not.toBeNull()
    expect(parsed?.columns).toBe(4)
    expect(parsed?.animations.completed.frames).toEqual([2, 3])
  })

  it('builds canonical private sprite metadata with legacy mood fallback', () => {
    const metadata = buildPersonaSpriteMetadata({
      config: parsePersonaSpriteConfig(validConfigSource)!,
      visibility: 'private',
      versionIndex: 0,
    })

    expect(metadata.persona?.moodMap.idle).toBe('idle')
    expect(metadata.persona?.moodMap.happy).toBe('completed')
    expect(metadata.persona?.protectedAssets?.assetName).toBe(CANONICAL_PERSONA_SPRITE_ASSET_NAME)
    expect(metadata.persona?.protectedAssets?.versionIndex).toBe(0)
  })

  it('rejects sprite drafts with only one file present', async () => {
    const result = await validatePersonaSpriteDraft({
      sheetFile: new File(['sheet'], 'persona-sprite.png', { type: 'image/png' }),
      configFile: null,
    })

    expect(result.ok).toBe(false)
  })

  it('rejects sprite drafts with invalid config json', async () => {
    const result = await validatePersonaSpriteDraft({
      sheetFile: new File(['sheet'], 'persona-sprite.png', { type: 'image/png' }),
      configFile: new File(['{"frameWidth":64}'], 'persona-sprite-config.json', { type: 'application/json' }),
    })

    expect(result.ok).toBe(false)
  })
})
