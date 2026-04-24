import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {
  CreateLocalExtractDraftInput,
  ExtractSoulDraft,
  LocalExtractAgent,
  LocalExtractAgentStatus,
  SessionScanResult,
} from '@soulidity/shared'
import { createExtractSoulDraftFromSeed } from '@soulidity/shared'
import { resolveCliCommand } from '../task-executor'
import { getOpenClawImportStatus } from './openclaw-import'

type DraftPayload = {
  name: string
  description: string
  tags: string[]
  traits: string[]
  communicationStyle: string
  expertise: string[]
  workStyle: string
  soulMarkdown: string
  memoryMarkdown: string
}

const READ_ONLY_AGENT_TIMEOUT_MS = 120_000
const READ_ONLY_AGENT_KILL_GRACE_MS = 5_000
const SESSION_SNIPPET_FILE_LIMIT = 4
const SESSION_SNIPPET_LIMIT_PER_FILE = 4
const SESSION_SNIPPET_READ_BYTES = 64_000
const SESSION_SNIPPET_MAX_CHARS = 480
const OPENCLAW_PRIMARY_CONTEXT_MAX_CHARS = 5_000
const OPENCLAW_SUPPORTING_CONTEXT_MAX_CHARS = 2_000

type ExtractContextSource = {
  label: string
  content: string
}

type ExtractContextBundle = {
  evidence: ReturnType<typeof aggregateEvidence>
  scanSummary: ReturnType<typeof summarizeScanResults>
  openClawDetected: boolean
  openClawReady: boolean
  sources: ExtractContextSource[]
}

function classifyAgentError(agent: LocalExtractAgent, detail: string): LocalExtractAgentStatus['status'] {
  const normalized = detail.toLowerCase()
  if (
    /not found|enoent|is not recognized|command not found/.test(normalized)
  ) {
    return 'not-installed'
  }

  if (
    /login|log in|sign in|authenticate|authentication|api key|token|oauth|unauthorized|forbidden|subscription|billing|quota|required/.test(normalized)
  ) {
    return 'not-authenticated'
  }

  console.warn(`[extract] ${agent} probe failed: ${detail}`)
  return 'error'
}

function collectClaudeText(rawStdout: string) {
  let text = ''
  let fallback = ''

  for (const line of rawStdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        for (const block of event.message.content) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            text += block.text
          }
        }
      } else if (event.type === 'content_block_delta' && typeof event.delta?.text === 'string') {
        text += event.delta.text
      } else if (event.type === 'result' && typeof event.result === 'string') {
        text += event.result
      }
    } catch {
      fallback += `${line}\n`
    }
  }

  return (text || fallback).trim()
}

async function runReadOnlyAgent(agent: LocalExtractAgent, prompt: string) {
  const cli = resolveCliCommand(agent, prompt, 'read')
  const isolatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'soulidity-extract-'))

  return new Promise<string>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (killTimer) {
        clearTimeout(killTimer)
        killTimer = null
      }
      fs.rmSync(isolatedCwd, { recursive: true, force: true })
    }

    const finish = (error: Error | null, output = '') => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        reject(error)
        return
      }
      resolve(output)
    }

    try {
      const child = spawn(cli.cmd, cli.args, {
        cwd: isolatedCwd,
        shell: process.platform === 'win32',
        env: {
          ...process.env,
          SOULIDITY_DISABLE_HOOK_BRIDGE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const timeout = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        killTimer = setTimeout(() => {
          child.kill('SIGKILL')
        }, READ_ONLY_AGENT_KILL_GRACE_MS)
      }, READ_ONLY_AGENT_TIMEOUT_MS)

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')

      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk
      })

      child.on('error', (error) => {
        clearTimeout(timeout)
        finish(new Error(error.message))
      })

      child.on('close', (code, signal) => {
        clearTimeout(timeout)
        const output = agent === 'claude' ? collectClaudeText(stdout) : stdout.trim()

        if (timedOut) {
          finish(new Error(`${agent} timed out after ${READ_ONLY_AGENT_TIMEOUT_MS}ms.`))
          return
        }

        if (code !== 0) {
          const detail = [
            signal ? `${agent} exited from signal ${signal}` : null,
            stderr.trim(),
            output,
          ].filter(Boolean).join('\n').trim() || `${agent} exited with code ${code ?? 'unknown'}`
          finish(new Error(detail))
          return
        }

        finish(null, output)
      })
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function aggregateEvidence(scanResults: SessionScanResult[]) {
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

function pickRepresentativeSourceFiles(scanResults: SessionScanResult[], limit = 12) {
  return [...new Set(scanResults.flatMap((result) => result.sourceFiles))]
    .map((filePath) => ({
      filePath,
      mtimeMs: (() => {
        try {
          return fs.statSync(filePath).mtimeMs
        } catch {
          return 0
        }
      })(),
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limit)
    .map((entry) => entry.filePath)
}

function summarizeScanResults(scanResults: SessionScanResult[]) {
  return scanResults.map((result) => ({
    agentType: result.agentType,
    coverage: result.coverage,
    sessionCount: result.sessionCount,
    totalTurns: result.totalTurns,
    topTools: result.features.topTools,
    primaryLanguages: result.features.primaryLanguages,
    peakHours: result.features.peakHours,
    sourceFileCount: result.sourceFiles.length,
  }))
}

function truncatePromptText(source: string, maxChars: number) {
  const normalized = source.replace(/\r\n/g, '\n').trim()
  if (normalized.length <= maxChars) return normalized
  const truncated = normalized.slice(0, Math.max(0, maxChars - 40)).trimEnd()
  return `${truncated}\n\n[Truncated by desktop for prompt budget.]`
}

function readPromptContextFile(filePath: string | null, maxChars: number) {
  if (!filePath || !fs.existsSync(filePath)) return null
  try {
    return truncatePromptText(fs.readFileSync(filePath, 'utf8'), maxChars)
  } catch {
    return null
  }
}

function readFileTail(filePath: string, maxBytes: number) {
  const stat = fs.statSync(filePath)
  const size = Math.min(stat.size, maxBytes)
  const buffer = Buffer.alloc(size)
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.readSync(fd, buffer, 0, size, stat.size - size)
  } finally {
    fs.closeSync(fd)
  }
  return buffer.toString('utf8')
}

function normalizeInlineSnippet(source: string) {
  return source
    .replace(/\s+/g, ' ')
    .replace(/\u0000/g, '')
    .trim()
}

function collectEntryTextSnippets(entry: unknown): string[] {
  const snippets: string[] = []

  const addTextBlocks = (blocks: unknown, role?: string) => {
    if (!Array.isArray(blocks)) return
    for (const block of blocks) {
      if (typeof block !== 'object' || block === null) continue
      const text = typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text
        : null
      if (!text) continue
      const normalized = normalizeInlineSnippet(text)
      if (normalized.length < 24) continue
      snippets.push(role ? `${role}: ${normalized}` : normalized)
    }
  }

  if (typeof entry !== 'object' || entry === null) return snippets

  const record = entry as {
    delta?: { text?: unknown }
    result?: unknown
    message?: { role?: unknown; content?: unknown[] }
    item?: { role?: unknown; content?: unknown[] }
  }

  addTextBlocks(record.message?.content, typeof record.message?.role === 'string' ? record.message.role : undefined)
  addTextBlocks(record.item?.content, typeof record.item?.role === 'string' ? record.item.role : undefined)

  if (typeof record.delta?.text === 'string') {
    const normalized = normalizeInlineSnippet(record.delta.text)
    if (normalized.length >= 24) snippets.push(normalized)
  }

  if (typeof record.result === 'string') {
    const normalized = normalizeInlineSnippet(record.result)
    if (normalized.length >= 24) snippets.push(normalized)
  }

  return snippets
}

function collectSessionSnippets(filePath: string) {
  try {
    const tail = readFileTail(filePath, SESSION_SNIPPET_READ_BYTES)
    const lines = tail.split(/\r?\n/).filter((line) => line.trim())
    const snippets: string[] = []
    const seen = new Set<string>()

    for (let index = lines.length - 1; index >= 0 && snippets.length < SESSION_SNIPPET_LIMIT_PER_FILE; index -= 1) {
      const line = lines[index]
      if (!line) continue

      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      const entrySnippets = collectEntryTextSnippets(parsed)
      for (let snippetIndex = entrySnippets.length - 1; snippetIndex >= 0; snippetIndex -= 1) {
        const snippet = truncatePromptText(entrySnippets[snippetIndex] ?? '', SESSION_SNIPPET_MAX_CHARS)
        if (!snippet || seen.has(snippet)) continue
        seen.add(snippet)
        snippets.push(snippet)
        if (snippets.length >= SESSION_SNIPPET_LIMIT_PER_FILE) break
      }
    }

    return snippets.reverse()
  } catch {
    return []
  }
}

function buildContextBundle(scanResults: SessionScanResult[]): ExtractContextBundle {
  const evidence = aggregateEvidence(scanResults)
  const scanSummary = summarizeScanResults(scanResults)
  const openClawStatus = getOpenClawImportStatus()
  const sources: ExtractContextSource[] = []

  const openClawSources = [
    {
      label: 'OpenClaw SOUL.md',
      content: readPromptContextFile(openClawStatus.soulFilePath, OPENCLAW_PRIMARY_CONTEXT_MAX_CHARS),
    },
    {
      label: 'OpenClaw memory.md',
      content: readPromptContextFile(openClawStatus.memoryFilePath, OPENCLAW_PRIMARY_CONTEXT_MAX_CHARS),
    },
    {
      label: 'OpenClaw AGENTS.md',
      content: readPromptContextFile(openClawStatus.agentsFilePath, OPENCLAW_SUPPORTING_CONTEXT_MAX_CHARS),
    },
    {
      label: 'OpenClaw TOOLS.md',
      content: readPromptContextFile(openClawStatus.toolsFilePath, OPENCLAW_SUPPORTING_CONTEXT_MAX_CHARS),
    },
    {
      label: 'OpenClaw IDENTITY.md',
      content: readPromptContextFile(openClawStatus.identityFilePath, OPENCLAW_SUPPORTING_CONTEXT_MAX_CHARS),
    },
    {
      label: 'OpenClaw USER.md',
      content: readPromptContextFile(openClawStatus.userFilePath, OPENCLAW_SUPPORTING_CONTEXT_MAX_CHARS),
    },
  ]

  for (const source of openClawSources) {
    if (source.content) sources.push({ label: source.label, content: source.content })
  }

  if (openClawStatus.validSkills.length > 0) {
    sources.push({
      label: 'OpenClaw Skills',
      content: openClawStatus.validSkills
        .map((skill) => `- ${skill.skillName}`)
        .join('\n'),
    })
  }

  const representativeFiles = pickRepresentativeSourceFiles(scanResults, SESSION_SNIPPET_FILE_LIMIT)
  for (const filePath of representativeFiles) {
    const snippets = collectSessionSnippets(filePath)
    if (snippets.length === 0) continue
    sources.push({
      label: `Recent session excerpts (${path.basename(filePath)})`,
      content: snippets.map((snippet) => `- ${snippet}`).join('\n'),
    })
  }

  return {
    evidence,
    scanSummary,
    openClawDetected: openClawStatus.detected,
    openClawReady: openClawStatus.ready,
    sources,
  }
}

function extractJsonBlock(source: string) {
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()

  const firstBrace = source.indexOf('{')
  const lastBrace = source.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return source.slice(firstBrace, lastBrace + 1).trim()
  }

  return source.trim()
}

function toArrayOfStrings(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
}

function parseDraftPayload(source: string): DraftPayload {
  let parsed: unknown

  try {
    parsed = JSON.parse(extractJsonBlock(source))
  } catch {
    throw new Error('Local agent did not return valid JSON.')
  }

  const record = parsed as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const description = typeof record.description === 'string' ? record.description.trim() : ''
  const communicationStyle = typeof record.communicationStyle === 'string' ? record.communicationStyle.trim() : ''
  const workStyle = typeof record.workStyle === 'string' ? record.workStyle.trim() : ''
  const soulMarkdown = typeof record.soulMarkdown === 'string' ? record.soulMarkdown.trim() : ''
  const memoryMarkdown = typeof record.memoryMarkdown === 'string' ? record.memoryMarkdown.trim() : ''

  if (!name || !description || !communicationStyle || !workStyle || !soulMarkdown || !memoryMarkdown) {
    throw new Error('Local agent JSON is missing required draft fields.')
  }

  if (!soulMarkdown.startsWith('# Soul Character')) {
    throw new Error('Local agent soulMarkdown must start with "# Soul Character".')
  }

  if (!memoryMarkdown.startsWith('# Founding Memory')) {
    throw new Error('Local agent memoryMarkdown must start with "# Founding Memory".')
  }

  return {
    name,
    description,
    tags: toArrayOfStrings(record.tags, []),
    traits: toArrayOfStrings(record.traits, []),
    communicationStyle,
    expertise: toArrayOfStrings(record.expertise, []),
    workStyle,
    soulMarkdown,
    memoryMarkdown,
  }
}

function buildPrompt(agent: LocalExtractAgent, bundle: ExtractContextBundle) {
  return [
    `You are ${agent === 'codex' ? 'Codex' : 'Claude Code'} running in an isolated read-only extract flow to prepare a Soulidity create draft.`,
    'Use only the structured evidence and source materials included in this prompt.',
    'Do not inspect additional files or directories. Do not rely on any local context outside this prompt.',
    'Return ONLY valid JSON. No markdown fences. No commentary.',
    '',
    'JSON schema:',
    '{',
    '  "name": "short soul name",',
    '  "description": "one-sentence description",',
    '  "tags": ["tag-1", "tag-2"],',
    '  "traits": ["trait 1", "trait 2"],',
    '  "communicationStyle": "how this soul sounds and replies",',
    '  "expertise": ["domain 1", "domain 2"],',
    '  "workStyle": "how this soul operates",',
    '  "soulMarkdown": "# Soul Character\\n...",',
    '  "memoryMarkdown": "# Founding Memory\\n..."',
    '}',
    '',
    'Content rules:',
    '- soulMarkdown must start with "# Soul Character" and include the sections: Core Truths, Boundaries, Vibe, Knowledge, Continuity.',
    '- memoryMarkdown must start with "# Founding Memory" and include the sections: Origin Snapshot, Initial Direction.',
    '- Write in a distinct soul-native voice. Make it feel personal, not generic assistant copy.',
    '- Every claim must stay grounded in the evidence and source materials below. If signal is weak, say less instead of inventing lore.',
    '- If OpenClaw source materials are present, treat SOUL.md as the primary identity source. Use AGENTS.md, TOOLS.md, IDENTITY.md, USER.md, and session excerpts only as supporting context.',
    '- If OpenClaw is absent, infer cautiously from the scan evidence and recent session excerpts only.',
    '- Prefer stable patterns over one-off moments. Keep boundaries explicit and avoid marketing language.',
    '',
    'Aggregated evidence:',
    JSON.stringify({
      evidence: bundle.evidence,
      scanResults: bundle.scanSummary,
      openClawDetected: bundle.openClawDetected,
      openClawReady: bundle.openClawReady,
    }, null, 2),
    '',
    'Source materials:',
    '',
    ...(bundle.sources.length > 0
      ? bundle.sources.flatMap((source) => [
        `--- ${source.label} ---`,
        source.content,
        '',
      ])
      : ['No raw source materials were available beyond the aggregated scan evidence.']),
  ].join('\n')
}

export async function getLocalExtractAgentStatuses(): Promise<LocalExtractAgentStatus[]> {
  return Promise.all((['codex', 'claude'] as const).map(async (agent) => {
    try {
      const output = await runReadOnlyAgent(agent, 'Reply with exactly READY.')
      return {
        agent,
        status: 'available',
        detail: output || 'Ready.',
      } satisfies LocalExtractAgentStatus
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return {
        agent,
        status: classifyAgentError(agent, detail),
        detail,
      } satisfies LocalExtractAgentStatus
    }
  }))
}

export async function createLocalExtractDraft(input: CreateLocalExtractDraftInput): Promise<ExtractSoulDraft> {
  const bundle = buildContextBundle(input.scanResults)
  const response = await runReadOnlyAgent(input.agent, buildPrompt(input.agent, bundle))
  const payload = parseDraftPayload(response)

  return createExtractSoulDraftFromSeed({
    creationSource: {
      kind: 'local-agent',
      label: input.agent === 'codex' ? 'Created with Codex' : 'Created with Claude',
      agent: input.agent,
    },
    name: payload.name,
    description: payload.description,
    tags: payload.tags,
    traits: payload.traits,
    communicationStyle: payload.communicationStyle,
    expertise: payload.expertise,
    workStyle: payload.workStyle,
    evidence: bundle.evidence,
    soulMarkdown: payload.soulMarkdown,
    memoryMarkdown: payload.memoryMarkdown,
  })
}
