import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { getCachedSprite } from './cache-manager'

export interface ActivePersonaPayload {
  catalogId: string
  spriteConfig: Record<string, unknown>
}

type SpriteSourceMode = 'file-url' | 'data-url'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildSpriteSource(spritePath: string, mode: SpriteSourceMode) {
  if (mode === 'data-url') {
    return `data:image/png;base64,${readFileSync(spritePath).toString('base64')}`
  }
  return pathToFileURL(spritePath).toString()
}

export function loadCachedActivePersona(
  catalogId: string,
  options: { spriteSource?: SpriteSourceMode } = {},
): ActivePersonaPayload {
  const cached = getCachedSprite(`catalog-${catalogId}`)
  if (!cached) throw new Error('Persona not cached — download it first')

  let parsedConfig: unknown
  try {
    parsedConfig = JSON.parse(readFileSync(cached.configPath, 'utf-8'))
  } catch {
    throw new Error('Failed to load cached persona config')
  }

  if (!isRecord(parsedConfig)) {
    throw new Error('Cached persona config is invalid')
  }

  return {
    catalogId,
    spriteConfig: {
      ...parsedConfig,
      src: buildSpriteSource(cached.spritePath, options.spriteSource ?? 'file-url'),
    },
  }
}
