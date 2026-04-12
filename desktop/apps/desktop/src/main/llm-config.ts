import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'

export interface LlmConfig {
  provider: 'anthropic' | 'openai' | 'local' | 'custom'
  apiKey?: string
  useLocalSubscription: boolean
  customEndpoint?: string
  model?: string
}

const CONFIG_FILE = 'llm_config.json'

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'state', CONFIG_FILE)
}

export async function loadLlmConfig(): Promise<LlmConfig | null> {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8')
    return JSON.parse(raw) as LlmConfig
  } catch {
    return null
  }
}

export async function saveLlmConfig(config: LlmConfig): Promise<void> {
  const configPath = getConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}
