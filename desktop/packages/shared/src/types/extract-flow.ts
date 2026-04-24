export type LocalExtractAgent = 'claude' | 'codex'

export type LocalExtractAgentStatusKind =
  | 'available'
  | 'not-installed'
  | 'not-authenticated'
  | 'error'

export interface LocalExtractAgentStatus {
  agent: LocalExtractAgent
  status: LocalExtractAgentStatusKind
  detail: string
}

export interface OpenClawSkillOption {
  id: string
  label: string
  relativePath: string
  skillName: string
}

export interface OpenClawImportStatus {
  detected: boolean
  ready: boolean
  workspacePath: string | null
  soulFilePath: string | null
  memoryFilePath: string | null
  agentsFilePath: string | null
  toolsFilePath: string | null
  identityFilePath: string | null
  userFilePath: string | null
  validSkills: OpenClawSkillOption[]
  detail: string
}

export interface ImportOpenClawDraftInput {
  scanResults: import('./soul-profile').SessionScanResult[]
  skillId?: string | null
}

export interface CreateLocalExtractDraftInput {
  agent: LocalExtractAgent
  scanResults: import('./soul-profile').SessionScanResult[]
}

