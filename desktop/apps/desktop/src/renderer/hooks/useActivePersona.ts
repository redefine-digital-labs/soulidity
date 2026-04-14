import { useState, useEffect } from 'react'
import type { SpriteSheetConfig } from '../components/SpriteRenderer'

// The bundled default config — used as initial value and offline fallback
import defaultSpriteConfigJson from '../../../resources/default-persona/sprite-config.json'

const DEFAULT_SPRITE_CONFIG: SpriteSheetConfig = {
  ...defaultSpriteConfigJson,
  src: new URL('../../../resources/default-persona/sprite.png', import.meta.url).href,
}

function isSpriteSheetConfig(value: unknown): value is SpriteSheetConfig {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SpriteSheetConfig>
  return (
    typeof candidate.src === 'string' &&
    typeof candidate.frameWidth === 'number' &&
    typeof candidate.frameHeight === 'number' &&
    typeof candidate.columns === 'number' &&
    !!candidate.animations &&
    typeof candidate.animations === 'object'
  )
}

interface ActivePersonaState {
  config: SpriteSheetConfig
  isDefault: boolean
  isLoading: boolean
}

/**
 * Hook that manages the active persona for the FloatingBall.
 *
 * Lifecycle:
 * 1. Start with default sprite immediately (no flash)
 * 2. On mount, try IPC `soul:get-active` to load cached/synced persona
 * 3. Listen for `persona-changed` events from main process
 * 4. On persona change, load the new sprite config from cache
 * 5. Fallback to default if loading fails
 */
export function useActivePersona(): ActivePersonaState {
  const [state, setState] = useState<ActivePersonaState>({
    config: DEFAULT_SPRITE_CONFIG,
    isDefault: true,
    isLoading: false,
  })

  useEffect(() => {
    let disposed = false

    async function loadActive() {
      try {
        setState(prev => ({ ...prev, isLoading: true }))
        const result = await window.electronAPI.soulGetActive()

        if (disposed) return

        if (result && isSpriteSheetConfig(result.spriteConfig)) {
          setState({
            config: result.spriteConfig,
            isDefault: false,
            isLoading: false,
          })
        } else {
          setState({
            config: DEFAULT_SPRITE_CONFIG,
            isDefault: true,
            isLoading: false,
          })
        }
      } catch {
        if (!disposed) {
          setState({
            config: DEFAULT_SPRITE_CONFIG,
            isDefault: true,
            isLoading: false,
          })
        }
      }
    }

    loadActive()

    // Listen for persona changes from main process
    const unsubscribe = window.electronAPI.onPersonaChanged?.((data: unknown) => {
      if (disposed) return
      const personaData = data as { spriteConfig?: unknown } | null
      if (isSpriteSheetConfig(personaData?.spriteConfig)) {
        setState({
          config: personaData.spriteConfig,
          isDefault: false,
          isLoading: false,
        })
      } else {
        setState({
          config: DEFAULT_SPRITE_CONFIG,
          isDefault: true,
          isLoading: false,
        })
      }
    })

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  return state
}
