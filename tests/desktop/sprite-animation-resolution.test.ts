import { describe, expect, it } from 'vitest'
import { MOOD_TO_SPRITE } from '../../desktop/packages/shared/src/types/emotion'
import { resolveAnimationName } from '../../desktop/apps/desktop/src/renderer/components/SpriteRenderer'
import defaultSpriteConfig from '../../desktop/apps/desktop/resources/default-persona/sprite-config.json'

describe('sprite animation resolution', () => {
  it('maps dragging mood to dragging animation name', () => {
    expect(MOOD_TO_SPRITE.dragging).toBe('dragging')
  })

  it('falls back to idle when requested animation is missing', () => {
    expect(resolveAnimationName({
      animations: {
        idle: { frames: [0], fps: 4, loop: true },
        working: { frames: [1], fps: 4, loop: true },
      },
      requestedAnimation: 'dragging',
    })).toBe('idle')
  })

  it('uses dragging animation when config provides it', () => {
    expect(resolveAnimationName({
      animations: {
        idle: { frames: [0], fps: 4, loop: true },
        dragging: { frames: [1], fps: 12, loop: true },
      },
      requestedAnimation: 'dragging',
    })).toBe('dragging')
  })

  it('wires the default persona dragging row into sprite config', () => {
    expect(defaultSpriteConfig.animations.dragging.frames).toEqual([48, 49, 50, 51, 52, 53, 54, 55])
  })
})
