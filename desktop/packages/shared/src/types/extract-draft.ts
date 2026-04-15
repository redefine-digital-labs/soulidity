import type { SoulProfile } from './soul-profile'

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

const DEFAULT_ROYALTY_BPS = 500

function formatList(items: string[]) {
  if (items.length === 0) {
    return 'Not enough signal yet.'
  }

  return items.map((item) => `- ${item}`).join('\n')
}

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
  return [
    `# ${input.name}`,
    '',
    '## Essence',
    input.description,
    '',
    '## Traits',
    formatList(input.traits),
    '',
    '## Communication Style',
    input.communicationStyle || 'Direct and adaptive.',
    '',
    '## Expertise',
    formatList(input.expertise),
    '',
    '## Work Style',
    input.workStyle || 'Persistent and implementation-first.',
    '',
    '## Evidence Snapshot',
    `- Sessions analyzed: ${input.evidence.sessionCount}`,
    `- Turns analyzed: ${input.evidence.turnCount}`,
    `- Frequent tools: ${input.evidence.topTools.join(', ') || 'No dominant tools yet.'}`,
    `- Primary languages: ${input.evidence.primaryLanguages.join(', ') || 'No language signal yet.'}`,
    `- Peak hours: ${formatPeakHours(input.evidence.peakHours)}`,
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
    `- ${input.name} emerged from ${input.evidence.sessionCount} coding sessions and ${input.evidence.turnCount} turns.`,
    `- It was distilled as: ${input.description}`,
    `- Repeated signals suggest a ${traitSummary} operating style.`,
    '',
    '## Initial Direction',
    `- Native domains: ${expertiseSummary}`,
    `- Working pattern: ${input.workStyle || 'Iterative and concrete.'}`,
    `- Tooling bias: ${input.evidence.topTools.join(', ') || 'No stable tooling pattern yet.'}`,
    `- Peak hours to remember: ${formatPeakHours(input.evidence.peakHours)}`,
    '',
    '## Constraints To Preserve',
    '- Stay grounded in observed coding behavior rather than invented lore.',
    '- Admit uncertainty when the extracted evidence is thin.',
    '- Prefer concrete implementation steps over abstract persona fluff.',
  ].join('\n')
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
  const nowIso = options.nowIso ?? new Date().toISOString()

  return applyGeneratedContent({
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    sourceProfile: profile,
    name: profile.suggested.name,
    description: profile.suggested.description,
    tags: [...profile.suggested.tags],
    royaltyBps: DEFAULT_ROYALTY_BPS,
    traits: [...profile.personality.traits],
    communicationStyle: profile.personality.communicationStyle,
    expertise: [...profile.personality.expertise],
    workStyle: profile.personality.workStyle,
    evidence: { ...profile.evidence },
    coverImageDataUrl: '',
    coverImageFileName: 'extract-cover.svg',
    coverImageMimeType: 'image/svg+xml',
    coverImageGenerated: true,
    soulMarkdown: '',
    memoryMarkdown: '',
    skillsArchive: null,
  }, { nowIso })
}

export function regenerateExtractSoulDraftContent(
  draft: ExtractSoulDraft,
  options: RegenerateDraftOptions = {},
): ExtractSoulDraft {
  return applyGeneratedContent(draft, options)
}
