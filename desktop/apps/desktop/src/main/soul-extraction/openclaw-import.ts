import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ExtractSoulDraft, ImportOpenClawDraftInput, OpenClawImportStatus, OpenClawSkillOption, SessionScanResult } from '@soulidity/shared'
import { createExtractSoulDraftFromSeed } from '@soulidity/shared'

type WorkspaceOptions = {
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

function expandHomePath(input: string, homeDir: string) {
  if (input === '~') return homeDir
  if (input.startsWith('~/')) return path.join(homeDir, input.slice(2))
  return input
}

function trimShellValue(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null
  return trimmed.replace(/^['"]|['"]$/g, '')
}

function readWorkspaceFromOpenClawCli(homeDir: string): string | null {
  const result = spawnSync('openclaw', ['config', 'get', 'agents.defaults.workspace'], {
    cwd: homeDir,
    encoding: 'utf8',
    timeout: 5_000,
    shell: process.platform === 'win32',
  })

  if (result.error || result.status !== 0) {
    return null
  }

  return trimShellValue(result.stdout)
}

function readWorkspaceFromOpenClawConfig(homeDir: string) {
  const configPath = path.join(homeDir, '.openclaw', 'openclaw.json')
  if (!fs.existsSync(configPath)) return null

  try {
    const source = fs.readFileSync(configPath, 'utf8')
    const match = source.match(/agents\s*:\s*\{[\s\S]*?defaults\s*:\s*\{[\s\S]*?workspace\s*:\s*["']([^"']+)["']/i)
      ?? source.match(/"agents"\s*:\s*\{[\s\S]*?"defaults"\s*:\s*\{[\s\S]*?"workspace"\s*:\s*"([^"]+)"/i)
    return trimShellValue(match?.[1])
  } catch {
    return null
  }
}

function getDefaultWorkspacePath(homeDir: string, env: NodeJS.ProcessEnv) {
  const profile = env['OPENCLAW_PROFILE']?.trim()
  if (profile && profile !== 'default') {
    return path.join(homeDir, '.openclaw', `workspace-${profile}`)
  }
  return path.join(homeDir, '.openclaw', 'workspace')
}

export function resolveOpenClawWorkspacePath(options: WorkspaceOptions = {}): string {
  const homeDir = options.homeDir ?? os.homedir()
  const env = options.env ?? process.env
  const configuredPath = readWorkspaceFromOpenClawCli(homeDir) ?? readWorkspaceFromOpenClawConfig(homeDir)
  const rawPath = configuredPath ?? getDefaultWorkspacePath(homeDir, env)
  return path.resolve(expandHomePath(rawPath, homeDir))
}

function readOptionalFile(filePath: string | null) {
  if (!filePath || !fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf8')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractBulletValue(source: string, label: string) {
  const match = source.match(new RegExp(`^-\\s*${escapeRegExp(label)}\\s*:\\s*(.+)$`, 'im'))
  return match?.[1]?.trim() ?? null
}

function extractFirstHeading(source: string | null) {
  if (!source) return null
  const match = source.match(/^#\s+(.+)$/m)
  if (!match) return null
  const heading = match[1]?.trim() ?? ''
  if (!heading) return null
  if (/^(Soul Character|Founding Memory)$/i.test(heading)) return null
  return heading
}

function splitListValues(value: string | null | undefined) {
  if (!value) return []
  return value
    .split(/[,;/|]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function titleCaseSlug(value: string) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function sanitizeTag(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function deriveEvidence(scanResults: SessionScanResult[]) {
  const sessionCount = scanResults.reduce((sum, result) => sum + result.sessionCount, 0)
  const turnCount = scanResults.reduce((sum, result) => sum + result.totalTurns, 0)

  const toolCounts = new Map<string, number>()
  const languageOrder = new Set<string>()
  const hourCounts = new Map<number, number>()

  for (const result of scanResults) {
    for (const [tool, count] of Object.entries(result.features.toolUsageFrequency)) {
      toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + count)
    }

    for (const language of result.features.primaryLanguages) {
      languageOrder.add(language)
    }

    for (const hour of result.features.peakHours) {
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1)
    }
  }

  return {
    sessionCount,
    turnCount,
    topTools: [...toolCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([tool]) => tool),
    primaryLanguages: [...languageOrder].slice(0, 5),
    peakHours: [...hourCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([hour]) => hour),
  }
}

function deriveName(workspacePath: string, soulSource: string | null, identitySource: string | null) {
  return extractFirstHeading(identitySource)
    ?? extractFirstHeading(soulSource)
    ?? (() => {
      const workspaceName = path.basename(workspacePath)
      if (workspaceName && workspaceName !== 'workspace') {
        return titleCaseSlug(workspaceName)
      }
      return 'OpenClaw Soul'
    })()
}

function deriveDescription(soulSource: string | null, memorySource: string | null) {
  return extractBulletValue(soulSource ?? '', 'What this Soul is here to do')
    ?? extractBulletValue(memorySource ?? '', 'Why it exists now')
    ?? extractBulletValue(soulSource ?? '', 'Who it serves')
    ?? 'Imported from the local OpenClaw workspace and ready for final review.'
}

function deriveTags(soulSource: string | null, validSkills: OpenClawSkillOption[], evidence: ReturnType<typeof deriveEvidence>) {
  const tagCandidates = [
    'openclaw',
    ...splitListValues(extractBulletValue(soulSource ?? '', 'Native domains')),
    ...validSkills.map((skill) => skill.skillName),
    ...evidence.primaryLanguages,
  ]

  const deduped = new Set<string>()
  for (const value of tagCandidates) {
    const normalized = sanitizeTag(value)
    if (normalized) deduped.add(normalized)
    if (deduped.size >= 5) break
  }
  return [...deduped]
}

function deriveTraits(soulSource: string | null) {
  const candidates = [
    extractBulletValue(soulSource ?? '', 'The standard it refuses to compromise'),
    extractBulletValue(soulSource ?? '', 'Social energy'),
    extractBulletValue(soulSource ?? '', 'Voice and tone'),
  ]

  return candidates.filter((value): value is string => Boolean(value)).slice(0, 4)
}

function createSkillOption(workspacePath: string, skillDirPath: string): OpenClawSkillOption | null {
  const skillMdPath = path.join(skillDirPath, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) return null

  const skillSource = fs.readFileSync(skillMdPath, 'utf8')
  const match = skillSource.match(/^---\s*\n[\s\S]*?^\s*name\s*:\s*(.+?)\s*$/im)
  if (!match?.[1]) return null

  const skillName = match[1].trim().replace(/^['"]|['"]$/g, '')
  if (!skillName) return null

  return {
    id: path.relative(workspacePath, skillDirPath).replace(/\\/g, '/'),
    label: `${skillName} (${path.basename(skillDirPath)})`,
    relativePath: path.relative(workspacePath, skillDirPath).replace(/\\/g, '/'),
    skillName,
  }
}

function collectOpenClawSkills(workspacePath: string) {
  const skillsRoot = path.join(workspacePath, 'skills')
  if (!fs.existsSync(skillsRoot)) return [] as OpenClawSkillOption[]

  const entries = fs.readdirSync(skillsRoot, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => createSkillOption(workspacePath, path.join(skillsRoot, entry.name)))
    .filter((value): value is OpenClawSkillOption => value !== null)
    .sort((left, right) => left.label.localeCompare(right.label))
}

function resolveOpenClawFiles(workspacePath: string) {
  const soulFilePath = path.join(workspacePath, 'SOUL.md')
  const lowercaseMemory = path.join(workspacePath, 'memory.md')
  const uppercaseMemory = path.join(workspacePath, 'MEMORY.md')

  return {
    soulFilePath: fs.existsSync(soulFilePath) ? soulFilePath : null,
    memoryFilePath: fs.existsSync(lowercaseMemory)
      ? lowercaseMemory
      : fs.existsSync(uppercaseMemory)
        ? uppercaseMemory
        : null,
    agentsFilePath: fs.existsSync(path.join(workspacePath, 'AGENTS.md')) ? path.join(workspacePath, 'AGENTS.md') : null,
    toolsFilePath: fs.existsSync(path.join(workspacePath, 'TOOLS.md')) ? path.join(workspacePath, 'TOOLS.md') : null,
    identityFilePath: fs.existsSync(path.join(workspacePath, 'IDENTITY.md')) ? path.join(workspacePath, 'IDENTITY.md') : null,
    userFilePath: fs.existsSync(path.join(workspacePath, 'USER.md')) ? path.join(workspacePath, 'USER.md') : null,
  }
}

export function getOpenClawImportStatus(options: WorkspaceOptions = {}): OpenClawImportStatus {
  const workspacePath = resolveOpenClawWorkspacePath(options)
  if (!fs.existsSync(workspacePath)) {
    return {
      detected: false,
      ready: false,
      workspacePath: null,
      soulFilePath: null,
      memoryFilePath: null,
      agentsFilePath: null,
      toolsFilePath: null,
      identityFilePath: null,
      userFilePath: null,
      validSkills: [],
      detail: 'No OpenClaw workspace was detected on this machine.',
    }
  }

  const files = resolveOpenClawFiles(workspacePath)
  const validSkills = collectOpenClawSkills(workspacePath)
  const ready = Boolean(files.soulFilePath && files.memoryFilePath)
  const detail = ready
    ? 'OpenClaw workspace is ready to import into the local create flow.'
    : !files.soulFilePath
      ? 'OpenClaw workspace is missing SOUL.md.'
      : 'OpenClaw workspace is missing memory.md or MEMORY.md.'

  return {
    detected: true,
    ready,
    workspacePath,
    validSkills,
    detail,
    ...files,
  }
}

function createSkillArchive(skillDirPath: string) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soulidity-openclaw-skill-'))
  const zipPath = path.join(tempDir, 'skills.zip')

  try {
    const result = process.platform === 'win32'
      ? spawnSync('powershell', [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path * -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
      ], {
        cwd: skillDirPath,
        encoding: 'utf8',
        timeout: 20_000,
      })
      : spawnSync('zip', ['-rq', zipPath, '.'], {
        cwd: skillDirPath,
        encoding: 'utf8',
        timeout: 20_000,
      })

    if (result.error || result.status !== 0 || !fs.existsSync(zipPath)) {
      const detail = result.error?.message ?? result.stderr?.trim() ?? result.stdout?.trim() ?? 'unknown zip error'
      throw new Error(`Failed to package OpenClaw skill bundle: ${detail}`)
    }

    return {
      fileName: 'skills.zip',
      mimeType: 'application/zip',
      dataBase64: fs.readFileSync(zipPath).toString('base64'),
    } satisfies NonNullable<ExtractSoulDraft['skillsArchive']>
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

export function importOpenClawDraft(
  input: ImportOpenClawDraftInput,
  options: WorkspaceOptions = {},
): ExtractSoulDraft {
  const status = getOpenClawImportStatus(options)
  if (!status.ready || !status.workspacePath || !status.soulFilePath || !status.memoryFilePath) {
    throw new Error(status.detail)
  }

  const soulSource = readOptionalFile(status.soulFilePath)
  const memorySource = readOptionalFile(status.memoryFilePath)
  const identitySource = readOptionalFile(status.identityFilePath)
  const evidence = deriveEvidence(input.scanResults)
  const selectedSkill = input.skillId
    ? status.validSkills.find((skill) => skill.id === input.skillId)
    : status.validSkills.length === 1
      ? status.validSkills[0]
      : null

  const skillsArchive = selectedSkill
    ? createSkillArchive(path.join(status.workspacePath, selectedSkill.relativePath))
    : null

  const expertise = splitListValues(extractBulletValue(soulSource ?? '', 'Native domains'))
  const communicationStyle = [
    extractBulletValue(soulSource ?? '', 'Voice and tone'),
    extractBulletValue(soulSource ?? '', 'Default response rhythm'),
  ].filter((value): value is string => Boolean(value)).join(' | ')

  return createExtractSoulDraftFromSeed({
    creationSource: {
      kind: 'openclaw-import',
      label: 'Imported from OpenClaw',
      workspacePath: status.workspacePath,
    },
    name: deriveName(status.workspacePath, soulSource, identitySource),
    description: deriveDescription(soulSource, memorySource),
    tags: deriveTags(soulSource, status.validSkills, evidence),
    traits: deriveTraits(soulSource),
    communicationStyle: communicationStyle || 'Preserve the voice already defined in SOUL.md.',
    expertise,
    workStyle: extractBulletValue(soulSource ?? '', 'Default response rhythm')
      ?? extractBulletValue(soulSource ?? '', 'The standard it refuses to compromise')
      ?? 'Stay coherent with the imported OpenClaw workspace.',
    evidence,
    soulMarkdown: soulSource,
    memoryMarkdown: memorySource,
    skillsArchive,
  })
}
