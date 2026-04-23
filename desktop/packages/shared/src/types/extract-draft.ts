import type { LocalExtractAgent } from './extract-flow'
import type { SoulProfile } from './soul-profile'

export interface ExtractDraftCreationSource {
  kind: 'legacy-profile' | 'openclaw-import' | 'local-agent'
  label: string
  agent?: LocalExtractAgent
  workspacePath?: string | null
}

export interface ExtractSoulDraftPendingSync {
  txDigest: string
  tags: string[]
  previewImages: string[]
  readme: string | null
  sealSidecar: string | null
  memorySealSidecar: string | null
  skillsSealSidecar: string | null
}

export interface ExtractSoulDraft {
  version: 1
  createdAt: string
  updatedAt: string
  sourceProfile: SoulProfile
  creationSource?: ExtractDraftCreationSource
  name: string
  description: string
  tags: string[]
  royaltyBps: number
  traits: string[]
  communicationStyle: string
  expertise: string[]
  workStyle: string
  evidence: SoulProfile['evidence']
  coverImageDataUrl: string
  coverImageFileName: string
  coverImageMimeType: string
  coverImageGenerated: boolean
  soulMarkdown: string
  memoryMarkdown: string
  skillsArchive: {
    fileName: string
    mimeType: string
    dataBase64: string
  } | null
  pendingSync?: ExtractSoulDraftPendingSync | null
}

type CreateExtractSoulDraftOptions = {
  nowIso?: string
}

type RegenerateDraftOptions = {
  nowIso?: string
}

export interface CreateExtractSoulDraftSeed {
  sourceProfile?: SoulProfile
  creationSource?: ExtractDraftCreationSource
  name: string
  description: string
  tags: string[]
  traits: string[]
  communicationStyle: string
  expertise: string[]
  workStyle: string
  evidence: SoulProfile['evidence']
  soulMarkdown?: string | null
  memoryMarkdown?: string | null
  skillsArchive?: ExtractSoulDraft['skillsArchive']
  royaltyBps?: number
}

const DEFAULT_ROYALTY_BPS = 500

function formatPeakHours(hours: number[]) {
  if (hours.length === 0) {
    return 'No clear pattern yet.'
  }

  return hours.map((hour) => `${hour}:00`).join(', ')
}

function hashSeed(input: string) {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function pickCoverPalette(seed: number) {
  const palettes = [
    ['#101820', '#f2aa4c', '#fff4e0'],
    ['#14213d', '#fca311', '#e5e5e5'],
    ['#1f2933', '#2bb0ed', '#d9f0ff'],
    ['#111827', '#34d399', '#d1fae5'],
    ['#1b1b1b', '#f97316', '#ffedd5'],
    ['#172554', '#60a5fa', '#dbeafe'],
  ] as const

  return palettes[seed % palettes.length]
}

function buildCoverImageDataUrl(name: string, tags: string[]) {
  const seed = hashSeed(`${name}|${tags.join('|')}`)
  const [background, accent, foreground] = pickCoverPalette(seed)
  const initials = (name.trim().match(/[A-Za-z0-9]/g) ?? ['S']).slice(0, 2).join('').toUpperCase()
  const tagLine = tags.slice(0, 3).join(' · ') || 'Soul'

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200" role="img" aria-label="${name}">
  <defs>
    <linearGradient id="bg" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="${background}" />
      <stop offset="100%" stop-color="${accent}" />
    </linearGradient>
  </defs>
  <rect width="1200" height="1200" fill="url(#bg)" rx="72" />
  <circle cx="930" cy="260" r="170" fill="${foreground}" fill-opacity="0.12" />
  <circle cx="260" cy="930" r="220" fill="${foreground}" fill-opacity="0.08" />
  <rect x="96" y="96" width="1008" height="1008" rx="56" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" />
  <text x="120" y="250" fill="${foreground}" font-size="68" font-family="SF Pro Display, Segoe UI, sans-serif" font-weight="600">${tagLine}</text>
  <text x="120" y="760" fill="${foreground}" font-size="420" font-family="SF Pro Display, Segoe UI, sans-serif" font-weight="700">${initials}</text>
  <text x="120" y="980" fill="${foreground}" font-size="88" font-family="SF Pro Display, Segoe UI, sans-serif" font-weight="600">${name}</text>
  <text x="120" y="1052" fill="${foreground}" font-size="42" font-family="SF Pro Text, Segoe UI, sans-serif" opacity="0.9">${tagLine}</text>
</svg>`.trim()

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function buildSoulMarkdown(input: {
  name: string
  description: string
  traits: string[]
  communicationStyle: string
  expertise: string[]
  workStyle: string
  evidence: SoulProfile['evidence']
}) {
  const primaryAudience = input.expertise.join(', ') || 'the people who rely on it'
  const primaryTrait = input.traits.join(', ') || 'steady and grounded'
  const communication = input.communicationStyle || 'direct, calm, and specific'
  const workStyle = input.workStyle || 'persistent, implementation-first, and clear about tradeoffs'

  return [
    '# Soul Character',
    '',
    '## Core Truths',
    `- What this Soul is here to do: ${input.description}`,
    `- Who it serves: ${primaryAudience}`,
    `- The standard it refuses to compromise: Stay ${primaryTrait} and anchored in real evidence.`,
    '',
    '## Boundaries',
    '- Hard constraints: Do not invent signal that is not grounded in the source behavior or workspace files.',
    '- Topics to avoid: Empty hype, fake certainty, and lore that drifts away from the observed operator.',
    '- Escalation rules: Surface weak evidence, contradictory signal, or missing context before pretending the profile is settled.',
    '',
    '## Vibe',
    `- Voice and tone: ${communication}`,
    `- Social energy: ${primaryTrait}`,
    `- Default response rhythm: ${workStyle}`,
    '',
    '## Knowledge',
    `- Native domains: ${input.expertise.join(', ') || 'Still emerging from sparse signal.'}`,
    `- Sources it trusts: ${input.evidence.topTools.join(', ') || 'Direct observation from the workspace and recent sessions.'}`,
    `- Knowledge edges to admit clearly: ${input.evidence.primaryLanguages.join(', ') || 'No dominant stack or domain signal yet.'}`,
    '',
    '## Continuity',
    `- Memories worth preserving: ${input.evidence.sessionCount} sessions and ${input.evidence.turnCount} turns of repeated behavior.`,
    `- What should stay stable across sessions: ${primaryTrait}, ${communication}, and a bias toward concrete execution.`,
    `- Signals that should trigger a course correction: Tooling shifts (${input.evidence.topTools.join(', ') || 'none yet'}), language shifts (${input.evidence.primaryLanguages.join(', ') || 'none yet'}), or time-pattern drift (${formatPeakHours(input.evidence.peakHours)}).`,
  ].join('\n')
}

function buildMemoryMarkdown(input: {
  name: string
  description: string
  traits: string[]
  expertise: string[]
  workStyle: string
  evidence: SoulProfile['evidence']
}) {
  const traitSummary = input.traits.join(', ') || 'adaptable'
  const expertiseSummary = input.expertise.join(', ') || 'general coding support'

  return [
    '# Founding Memory',
    '',
    '## Origin Snapshot',
    `- Where this Soul starts: ${input.name} emerged from ${input.evidence.sessionCount} coding sessions and ${input.evidence.turnCount} turns.`,
    `- Why it exists now: ${input.description}`,
    `- The operating context at mint: repeated signal suggests a ${traitSummary} operator with roots in ${expertiseSummary}.`,
    '',
    '## Initial Direction',
    `- Initial mission: ${input.description}`,
    `- Initial assumptions: native domains include ${expertiseSummary}, and the working pattern is ${input.workStyle || 'iterative and concrete'}.`,
    `- First constraints to remember: keep faith with ${input.evidence.topTools.join(', ') || 'the observed workspace tools'}, admit uncertainty when signal is thin, and remember the peak rhythm around ${formatPeakHours(input.evidence.peakHours)}.`,
  ].join('\n')
}

function buildSourceProfile(seed: CreateExtractSoulDraftSeed): SoulProfile {
  if (seed.sourceProfile) {
    return seed.sourceProfile
  }

  return {
    version: 1,
    personality: {
      traits: [...seed.traits],
      communicationStyle: seed.communicationStyle,
      expertise: [...seed.expertise],
      workStyle: seed.workStyle,
    },
    evidence: { ...seed.evidence },
    suggested: {
      name: seed.name,
      description: seed.description,
      tags: [...seed.tags],
    },
  }
}

function applyGeneratedContent(
  draft: ExtractSoulDraft,
  options: RegenerateDraftOptions = {},
): ExtractSoulDraft {
  const updatedAt = options.nowIso ?? new Date().toISOString()

  return {
    ...draft,
    updatedAt,
    coverImageDataUrl: draft.coverImageGenerated
      ? buildCoverImageDataUrl(draft.name, draft.tags)
      : draft.coverImageDataUrl,
    coverImageFileName: draft.coverImageGenerated ? 'extract-cover.svg' : draft.coverImageFileName,
    coverImageMimeType: 'image/svg+xml',
    soulMarkdown: buildSoulMarkdown({
      name: draft.name,
      description: draft.description,
      traits: draft.traits,
      communicationStyle: draft.communicationStyle,
      expertise: draft.expertise,
      workStyle: draft.workStyle,
      evidence: draft.evidence,
    }),
    memoryMarkdown: buildMemoryMarkdown({
      name: draft.name,
      description: draft.description,
      traits: draft.traits,
      expertise: draft.expertise,
      workStyle: draft.workStyle,
      evidence: draft.evidence,
    }),
  }
}

export function createExtractSoulDraft(
  profile: SoulProfile,
  options: CreateExtractSoulDraftOptions = {},
): ExtractSoulDraft {
  return createExtractSoulDraftFromSeed({
    sourceProfile: profile,
    creationSource: {
      kind: 'legacy-profile',
      label: 'Extracted from local session signals',
    },
    name: profile.suggested.name,
    description: profile.suggested.description,
    tags: [...profile.suggested.tags],
    traits: [...profile.personality.traits],
    communicationStyle: profile.personality.communicationStyle,
    expertise: [...profile.personality.expertise],
    workStyle: profile.personality.workStyle,
    evidence: { ...profile.evidence },
  }, options)
}

export function createExtractSoulDraftFromSeed(
  seed: CreateExtractSoulDraftSeed,
  options: CreateExtractSoulDraftOptions = {},
): ExtractSoulDraft {
  const nowIso = options.nowIso ?? new Date().toISOString()
  const draft = {
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    sourceProfile: buildSourceProfile(seed),
    creationSource: seed.creationSource,
    name: seed.name,
    description: seed.description,
    tags: [...seed.tags],
    royaltyBps: seed.royaltyBps ?? DEFAULT_ROYALTY_BPS,
    traits: [...seed.traits],
    communicationStyle: seed.communicationStyle,
    expertise: [...seed.expertise],
    workStyle: seed.workStyle,
    evidence: { ...seed.evidence },
    coverImageDataUrl: '',
    coverImageFileName: 'extract-cover.svg',
    coverImageMimeType: 'image/svg+xml',
    coverImageGenerated: true,
    soulMarkdown: seed.soulMarkdown?.trim() ?? '',
    memoryMarkdown: seed.memoryMarkdown?.trim() ?? '',
    skillsArchive: seed.skillsArchive ?? null,
  } satisfies ExtractSoulDraft

  if (draft.soulMarkdown && draft.memoryMarkdown) {
    return refreshExtractSoulDraftCover(draft, { nowIso })
  }

  return applyGeneratedContent(draft, { nowIso })
}

export function refreshExtractSoulDraftCover(
  draft: ExtractSoulDraft,
  options: RegenerateDraftOptions = {},
): ExtractSoulDraft {
  const updatedAt = options.nowIso ?? new Date().toISOString()

  return {
    ...draft,
    updatedAt,
    coverImageDataUrl: draft.coverImageGenerated
      ? buildCoverImageDataUrl(draft.name, draft.tags)
      : draft.coverImageDataUrl,
    coverImageFileName: draft.coverImageGenerated ? 'extract-cover.svg' : draft.coverImageFileName,
    coverImageMimeType: draft.coverImageGenerated ? 'image/svg+xml' : draft.coverImageMimeType,
  }
}

export function regenerateExtractSoulDraftContent(
  draft: ExtractSoulDraft,
  options: RegenerateDraftOptions = {},
): ExtractSoulDraft {
  return applyGeneratedContent(draft, options)
}
