export type CliAgentStatus =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'needs-attention'
  | 'completed'
  | 'error'

export interface SpriteSheetAsset {
  type: 'sprite-sheet'
  sheetUrl: string
  frameWidth: number
  frameHeight: number
  columns: number
  animations: {
    [name: string]: {
      frames: number[]
      fps: number
      loop: boolean
    }
  }
}

export interface SoulMetadata {
  version: 1

  persona?: {
    format: 'sprite-sheet' | 'live2d'
    stateMap: Record<CliAgentStatus, string>
    publicAssets?: SpriteSheetAsset
    protectedAssets?: {
      assetName: string
      versionIndex: number
    }
  }

  voice?: {
    format: 'clips' | 'tts-profile'
    clips?: Record<string, string>
    ttsProfile?: {
      provider: string
      voiceId: string
      config?: Record<string, unknown>
    }
  }

  extra?: Record<string, unknown>
}

export function parseSoulMetadata(raw: string): SoulMetadata | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1) return null
    return parsed as SoulMetadata
  } catch {
    return null
  }
}
