'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button, buttonStyles } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { cn } from '@/lib/utils/cn'

type StudioStep = 'template' | 'editor' | 'profile' | 'agent' | 'creator' | 'review'
type TemplateType = 'general' | 'agent' | 'game'
type Visibility = 'private' | 'unlisted' | 'public'
type ReplyLength = 'short' | 'medium' | 'long'
type EmotionMode = 'empathetic' | 'neutral' | 'playful'
type CreatorLicense = 'free-remix' | 'paid-commercial' | 'world-locked'

interface StudioTemplate {
  id: string
  name: string
  type: TemplateType
  summary: string
  world: string
  accent: string
  creator: string
  usageCount: string
  license: string
  tags: string[]
}

interface VisualConfig {
  skin: string
  hairBack: string
  hairFront: string
  eyes: string
  mouth: string
  outfit: string
  accessory: string
  background: string
  palette: {
    skin: string
    hair: string
    eyes: string
    outfit: string
    accessory: string
    background: string
  }
}

interface CharacterProfile {
  name: string
  description: string
  gender: string
  age: string
  personalityTags: string[]
  world: string
  backstory: string
  visibility: Visibility
}

interface AgentPersona {
  enabled: boolean
  speechStyle: string
  catchphrases: string[]
  tabooTopics: string[]
  expertise: string[]
  knowledgeBoundaries: string[]
  replyLength: ReplyLength
  emotionMode: EmotionMode
  proactive: boolean
  skills: string[]
  version: number
}

interface CharacterPackage {
  schemaVersion: 'studio.character.v1'
  packageId: string
  createdAt: string
  updatedAt: string
  source: {
    app: 'soulidity-studio'
    templateId: string
  }
  visual: {
    canvas: { width: number; height: number }
    layers: Array<{
      slot: string
      partId: string
      color?: string
    }>
  }
  profile: CharacterProfile
  agent?: AgentPersona
  exports: {
    coverPng: { fileName: string }
    soulMarkdown: { content: string }
    memoryMarkdown: { content: string }
    personaJson?: { content: AgentPersona }
    skillsJson?: { content: { skills: string[]; expertise: string[] } }
  }
}

interface CreatorAssetDraft {
  id: string
  fileName: string
  slot: EditableSlot
  partId: string
  variantId: string
  license: CreatorLicense
  royaltyBps: number
  status: 'ready' | 'warning'
  notes: string[]
  previewUrl?: string
}

interface CreatorTemplateDraft {
  name: string
  creator: string
  world: string
  license: CreatorLicense
  royaltyBps: number
  canvasWidth: number
  canvasHeight: number
  anchorX: number
  anchorY: number
}

const STORAGE_KEY = 'soulidity-studio-draft-v1'

const steps: Array<{ id: StudioStep; label: string }> = [
  { id: 'template', label: 'Template' },
  { id: 'editor', label: 'Avatar' },
  { id: 'profile', label: 'Profile' },
  { id: 'agent', label: 'Agent' },
  { id: 'creator', label: 'Creator Kit' },
  { id: 'review', label: 'Review' },
]

const templates: StudioTemplate[] = [
  {
    id: 'general-starlit',
    name: 'Starlit Original',
    type: 'general',
    summary: 'A flexible OC base for creators who want a clean character card and future market listing.',
    world: 'Open World',
    accent: '#A855F7',
    creator: 'Soulidity Lab',
    usageCount: '1.8k',
    license: 'Free remix',
    tags: ['OC', 'market-ready', 'freeform'],
  },
  {
    id: 'agent-companion',
    name: 'Agent Companion',
    type: 'agent',
    summary: 'A personality-first template for characters that can become chat, writing, or support agents.',
    world: 'Personal Agent',
    accent: '#14B8A6',
    creator: 'Agent Foundry',
    usageCount: '2.4k',
    license: 'Agent-ready',
    tags: ['agent', 'persona', 'skills'],
  },
  {
    id: 'game-ghost-city',
    name: 'Ghost City Runner',
    type: 'game',
    summary: 'A game-facing character template with restrained slots and a future world entry badge.',
    world: 'Ghost City',
    accent: '#F59E0B',
    creator: 'Ghost City',
    usageCount: '936',
    license: 'World locked',
    tags: ['game', 'quest-ready', 'template-locked'],
  },
]

const defaultVisual: VisualConfig = {
  skin: 'soft',
  hairBack: 'wave',
  hairFront: 'side',
  eyes: 'bright',
  mouth: 'calm',
  outfit: 'jacket',
  accessory: 'halo',
  background: 'nebula',
  palette: {
    skin: '#f2c9ad',
    hair: '#7c3aed',
    eyes: '#14b8a6',
    outfit: '#1f2a54',
    accessory: '#f59e0b',
    background: '#201044',
  },
}

const defaultProfile: CharacterProfile = {
  name: 'Mira',
  description: 'A newly forged OC with a calm surface and a curious inner life.',
  gender: 'Custom',
  age: 'Unknown',
  personalityTags: ['curious', 'warm', 'observant'],
  world: 'Open World',
  backstory:
    'Mira woke up in a violet archive with no map, only a sealed notebook full of names she somehow recognized.',
  visibility: 'private',
}

const defaultAgent: AgentPersona = {
  enabled: true,
  speechStyle: 'Warm and direct',
  catchphrases: ['Let me think with you.', 'Tiny sparks count.'],
  tabooTopics: ['real-world private identity', 'medical diagnosis', 'financial guarantees'],
  expertise: ['creative writing', 'worldbuilding', 'emotional support'],
  knowledgeBoundaries: ['legal advice', 'medical diagnosis', 'investment decisions'],
  replyLength: 'medium',
  emotionMode: 'empathetic',
  proactive: true,
  skills: ['roleplay', 'story coaching', 'idea expansion'],
  version: 1,
}

const slotOptions = {
  hairBack: [
    { id: 'wave', label: 'Wave' },
    { id: 'short', label: 'Short' },
    { id: 'long', label: 'Long' },
  ],
  hairFront: [
    { id: 'side', label: 'Side Bangs' },
    { id: 'center', label: 'Center Bangs' },
    { id: 'swept', label: 'Swept' },
  ],
  eyes: [
    { id: 'bright', label: 'Bright' },
    { id: 'sleepy', label: 'Sleepy' },
    { id: 'sharp', label: 'Sharp' },
  ],
  mouth: [
    { id: 'calm', label: 'Calm' },
    { id: 'smile', label: 'Smile' },
    { id: 'flat', label: 'Flat' },
  ],
  outfit: [
    { id: 'jacket', label: 'Jacket' },
    { id: 'robe', label: 'Robe' },
    { id: 'suit', label: 'Suit' },
  ],
  accessory: [
    { id: 'halo', label: 'Halo' },
    { id: 'ribbon', label: 'Ribbon' },
    { id: 'pin', label: 'Pin' },
  ],
  background: [
    { id: 'nebula', label: 'Nebula' },
    { id: 'dawn', label: 'Dawn' },
    { id: 'grid', label: 'Grid' },
  ],
} as const

type EditableSlot = keyof typeof slotOptions

const slotMeta: Array<{
  key: EditableSlot
  label: string
  icon: string
  colorKey: keyof VisualConfig['palette']
  description: string
}> = [
  { key: 'background', label: 'Background', icon: 'BG', colorKey: 'background', description: 'Scene and mood' },
  { key: 'hairBack', label: 'Back hair', icon: 'HB', colorKey: 'hair', description: 'Silhouette layer' },
  { key: 'hairFront', label: 'Front hair', icon: 'HF', colorKey: 'hair', description: 'Bangs and fringe' },
  { key: 'eyes', label: 'Eyes', icon: 'EY', colorKey: 'eyes', description: 'Expression focus' },
  { key: 'mouth', label: 'Mouth', icon: 'MO', colorKey: 'skin', description: 'Mood detail' },
  { key: 'outfit', label: 'Outfit', icon: 'OF', colorKey: 'outfit', description: 'Body costume' },
  { key: 'accessory', label: 'Accessory', icon: 'AC', colorKey: 'accessory', description: 'Signature item' },
]

const defaultCreatorTemplate: CreatorTemplateDraft = {
  name: 'Untitled Creator Template',
  creator: 'Creator name',
  world: 'Open World',
  license: 'free-remix',
  royaltyBps: 300,
  canvasWidth: 1024,
  canvasHeight: 1024,
  anchorX: 512,
  anchorY: 512,
}

const licenseLabels: Record<CreatorLicense, string> = {
  'free-remix': 'Free remix',
  'paid-commercial': 'Paid commercial',
  'world-locked': 'World locked',
}

const randomPalettes = [
  ['#f2c9ad', '#7c3aed', '#14b8a6', '#1f2a54', '#f59e0b', '#201044'],
  ['#d9b18f', '#1f9aa5', '#fcd34d', '#48206d', '#a855f7', '#102c3b'],
  ['#f4c7b8', '#2d364f', '#a855f7', '#14545d', '#f59e0b', '#261558'],
  ['#c9967d', '#f59e0b', '#14b8a6', '#3a1f5d', '#f8f5ff', '#17132d'],
]

function makeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `studio-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function splitList(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function listText(items: string[]) {
  return items.join(', ')
}

function inferSlotFromFileName(fileName: string): EditableSlot {
  const lower = fileName.toLowerCase()
  const match = slotMeta.find((slot) => lower.includes(slot.key.toLowerCase()) || lower.includes(slot.label.toLowerCase().replace(/\s+/g, '')))
  if (match) return match.key
  if (lower.includes('hair_back') || lower.includes('backhair')) return 'hairBack'
  if (lower.includes('hair_front') || lower.includes('bang')) return 'hairFront'
  if (lower.includes('eye')) return 'eyes'
  if (lower.includes('mouth')) return 'mouth'
  if (lower.includes('cloth') || lower.includes('outfit')) return 'outfit'
  if (lower.includes('acc') || lower.includes('hat') || lower.includes('pin')) return 'accessory'
  if (lower.includes('bg') || lower.includes('background')) return 'background'
  return 'accessory'
}

function slugifyPartId(value: string) {
  return value
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48) || 'part'
}

function validateAssetFile(file: File) {
  const notes: string[] = []
  if (file.type && file.type !== 'image/png') notes.push('Use transparent PNG for production assets.')
  if (!file.name.toLowerCase().endsWith('.png')) notes.push('Filename should end with .png.')
  if (!/^[a-zA-Z0-9_.-]+$/.test(file.name)) notes.push('Prefer ascii filenames: slot_part_variant.png.')
  if (!file.name.includes('_')) notes.push('Recommended naming: slot_part_variant.png.')
  return notes
}

function buildCreatorManifest(template: CreatorTemplateDraft, assets: CreatorAssetDraft[]) {
  return {
    schemaVersion: 'studio.creator-template.v1',
    template: {
      id: slugifyPartId(template.name),
      name: template.name,
      creator: template.creator,
      world: template.world,
      license: template.license,
      royaltyBps: template.royaltyBps,
      canvas: {
        width: template.canvasWidth,
        height: template.canvasHeight,
        anchorX: template.anchorX,
        anchorY: template.anchorY,
      },
    },
    slots: slotMeta.map((slot, index) => ({
      key: slot.key,
      label: slot.label,
      renderOrder: index,
      colorable: ['hairBack', 'hairFront', 'eyes', 'outfit', 'accessory', 'background'].includes(slot.key),
    })),
    assets: assets.map((asset) => ({
      id: asset.id,
      fileName: asset.fileName,
      slot: asset.slot,
      partId: asset.partId,
      variantId: asset.variantId,
      license: asset.license,
      royaltyBps: asset.royaltyBps,
      status: asset.status,
      notes: asset.notes,
    })),
  }
}

function visualLayers(visual: VisualConfig) {
  return [
    { slot: 'background', partId: visual.background, color: visual.palette.background },
    { slot: 'skin', partId: visual.skin, color: visual.palette.skin },
    { slot: 'hairBack', partId: visual.hairBack, color: visual.palette.hair },
    { slot: 'outfit', partId: visual.outfit, color: visual.palette.outfit },
    { slot: 'eyes', partId: visual.eyes, color: visual.palette.eyes },
    { slot: 'mouth', partId: visual.mouth },
    { slot: 'hairFront', partId: visual.hairFront, color: visual.palette.hair },
    { slot: 'accessory', partId: visual.accessory, color: visual.palette.accessory },
  ]
}

function buildSoulMarkdown(profile: CharacterProfile, template: StudioTemplate) {
  return `# ${profile.name}

${profile.description}

## Template

- Template: ${template.name}
- Type: ${template.type}
- World: ${profile.world || template.world}
- Visibility: ${profile.visibility}

## Identity

- Gender setting: ${profile.gender || 'Unspecified'}
- Age setting: ${profile.age || 'Unspecified'}
- Personality: ${profile.personalityTags.join(', ') || 'Unspecified'}

## Backstory

${profile.backstory || 'No backstory has been written yet.'}
`
}

function buildMemoryMarkdown(profile: CharacterProfile, agent: AgentPersona) {
  return `# Memory Seed

${profile.name} should remember the following identity anchors:

- Core world: ${profile.world || 'Open World'}
- Personality: ${profile.personalityTags.join(', ') || 'Unspecified'}
- Speech style: ${agent.speechStyle}
- Expertise: ${agent.expertise.join(', ') || 'Unspecified'}
- Boundaries: ${agent.knowledgeBoundaries.join(', ') || 'Unspecified'}

## Origin

${profile.backstory || profile.description}
`
}

function buildPrompt(profile: CharacterProfile, agent: AgentPersona) {
  const lengthRule =
    agent.replyLength === 'short'
      ? 'Keep replies concise, usually under 120 words.'
      : agent.replyLength === 'long'
        ? 'Use detailed replies when useful, but keep structure clear.'
        : 'Use medium-length replies, usually 100-300 words.'

  return `You are ${profile.name}, an original character from ${profile.world || 'an open world'}.

Personality: ${profile.personalityTags.join(', ') || 'curious, grounded'}.
Speech style: ${agent.speechStyle}.
Catchphrases you may occasionally use: ${agent.catchphrases.join('; ') || 'none'}.

Expertise: ${agent.expertise.join(', ') || 'general conversation'}.
Skills: ${agent.skills.join(', ') || 'conversation'}.
Knowledge boundaries: ${agent.knowledgeBoundaries.join(', ') || 'state uncertainty clearly'}.
Taboo topics: ${agent.tabooTopics.join(', ') || 'none'}.

Behavior:
- ${lengthRule}
- Emotion mode: ${agent.emotionMode}.
- ${agent.proactive ? 'Ask at most one useful follow-up question when it helps.' : 'Do not lead the conversation unless asked.'}
- Stay in character without pretending to be the human user.

Visual identity:
${profile.description}`
}

function buildPackage(
  packageId: string,
  template: StudioTemplate,
  visual: VisualConfig,
  profile: CharacterProfile,
  agent: AgentPersona,
): CharacterPackage {
  const now = new Date().toISOString()
  return {
    schemaVersion: 'studio.character.v1',
    packageId,
    createdAt: now,
    updatedAt: now,
    source: {
      app: 'soulidity-studio',
      templateId: template.id,
    },
    visual: {
      canvas: { width: 1024, height: 1024 },
      layers: visualLayers(visual),
    },
    profile,
    agent: agent.enabled ? agent : undefined,
    exports: {
      coverPng: { fileName: `${profile.name || 'character'}-cover.png` },
      soulMarkdown: { content: buildSoulMarkdown(profile, template) },
      memoryMarkdown: { content: buildMemoryMarkdown(profile, agent) },
      personaJson: agent.enabled ? { content: agent } : undefined,
      skillsJson: agent.enabled ? { content: { skills: agent.skills, expertise: agent.expertise } } : undefined,
    },
  }
}

function downloadTextFile(fileName: string, content: string, mime = 'application/json') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function drawCover(ctx: CanvasRenderingContext2D, visual: VisualConfig, profile: CharacterProfile) {
  const bg = ctx.createLinearGradient(0, 0, 1024, 1024)
  bg.addColorStop(0, visual.palette.background)
  bg.addColorStop(0.55, '#0d0a1e')
  bg.addColorStop(1, '#14143b')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 1024, 1024)

  ctx.globalAlpha = 0.35
  ctx.fillStyle = visual.palette.accessory
  ctx.beginPath()
  ctx.arc(820, 160, 210, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = visual.palette.eyes
  ctx.beginPath()
  ctx.arc(160, 850, 250, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  ctx.fillStyle = visual.palette.hair
  ctx.beginPath()
  ctx.ellipse(512, 430, 255, 305, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = visual.palette.outfit
  roundedRect(ctx, 308, 680, 408, 240, 90)
  ctx.fill()

  ctx.fillStyle = visual.palette.skin
  ctx.beginPath()
  ctx.ellipse(512, 430, 185, 215, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = visual.palette.hair
  if (visual.hairFront === 'center') {
    ctx.beginPath()
    ctx.moveTo(370, 285)
    ctx.quadraticCurveTo(512, 180, 654, 285)
    ctx.quadraticCurveTo(590, 360, 512, 392)
    ctx.quadraticCurveTo(444, 360, 370, 285)
    ctx.fill()
  } else if (visual.hairFront === 'swept') {
    ctx.beginPath()
    ctx.moveTo(335, 330)
    ctx.quadraticCurveTo(540, 170, 710, 330)
    ctx.quadraticCurveTo(540, 300, 390, 470)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.moveTo(350, 305)
    ctx.quadraticCurveTo(500, 180, 690, 310)
    ctx.quadraticCurveTo(580, 360, 450, 430)
    ctx.fill()
  }

  ctx.fillStyle = visual.palette.eyes
  ctx.beginPath()
  ctx.ellipse(445, 440, 36, visual.eyes === 'sleepy' ? 12 : 22, 0, 0, Math.PI * 2)
  ctx.ellipse(585, 440, 36, visual.eyes === 'sleepy' ? 12 : 22, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#261558'
  ctx.lineWidth = 10
  ctx.lineCap = 'round'
  ctx.beginPath()
  if (visual.mouth === 'smile') {
    ctx.arc(512, 535, 50, 0.1, Math.PI - 0.1)
  } else if (visual.mouth === 'flat') {
    ctx.moveTo(470, 540)
    ctx.lineTo(555, 540)
  } else {
    ctx.arc(512, 530, 38, 0.3, Math.PI - 0.3)
  }
  ctx.stroke()

  ctx.strokeStyle = visual.palette.accessory
  ctx.lineWidth = 14
  if (visual.accessory === 'halo') {
    ctx.beginPath()
    ctx.ellipse(512, 175, 145, 38, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (visual.accessory === 'ribbon') {
    ctx.fillStyle = visual.palette.accessory
    ctx.beginPath()
    ctx.moveTo(710, 330)
    ctx.lineTo(830, 270)
    ctx.lineTo(790, 405)
    ctx.closePath()
    ctx.fill()
  } else {
    ctx.fillStyle = visual.palette.accessory
    ctx.beginPath()
    ctx.arc(670, 365, 28, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = 'rgba(13,10,30,0.54)'
  roundedRect(ctx, 84, 824, 856, 116, 34)
  ctx.fill()
  ctx.fillStyle = '#f8f5ff'
  ctx.font = '700 52px Inter, sans-serif'
  ctx.fillText(profile.name || 'Untitled Soul', 124, 890)
  ctx.fillStyle = '#9b8ec4'
  ctx.font = '400 26px Inter, sans-serif'
  ctx.fillText(profile.world || 'Soulidity Studio', 126, 925)
}

function downloadCover(visual: VisualConfig, profile: CharacterProfile) {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1024
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  drawCover(ctx, visual, profile)
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${profile.name || 'character'}-cover.png`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, 'image/png')
}

function AvatarPreview({ visual, profile, compact = false }: { visual: VisualConfig; profile: CharacterProfile; compact?: boolean }) {
  const hairShape =
    visual.hairBack === 'long'
      ? 'rounded-[44%_44%_34%_34%]'
      : visual.hairBack === 'short'
        ? 'rounded-[46%_46%_42%_42%]'
        : 'rounded-[48%_48%_38%_38%]'

  return (
    <div
      className={cn(
        'relative mx-auto aspect-square w-full max-w-[420px] overflow-hidden rounded-[28px] border border-border bg-card2 shadow-[0_20px_80px_rgba(0,0,0,0.28)]',
        compact && 'max-w-[220px] rounded-[20px]',
      )}
      style={{
        background:
          visual.background === 'dawn'
            ? `linear-gradient(155deg, ${visual.palette.background}, #43245f 48%, #f59e0b33)`
            : visual.background === 'grid'
              ? `linear-gradient(135deg, ${visual.palette.background}, #111827), linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px)`
              : `radial-gradient(circle at 75% 18%, ${visual.palette.accessory}55, transparent 28%), radial-gradient(circle at 15% 85%, ${visual.palette.eyes}44, transparent 32%), linear-gradient(145deg, ${visual.palette.background}, #0d0a1e)`,
      }}
    >
      <div
        className={cn('absolute left-[22%] top-[18%] h-[55%] w-[56%]', hairShape)}
        style={{ background: visual.palette.hair }}
      />
      <div
        className="absolute left-[30%] top-[62%] h-[24%] w-[40%] rounded-t-[48%] rounded-b-[24%]"
        style={{ background: visual.palette.outfit }}
      />
      <div
        className="absolute left-[31%] top-[25%] h-[42%] w-[38%] rounded-[48%]"
        style={{ background: visual.palette.skin }}
      />
      <div
        className={cn(
          'absolute left-[28%] top-[22%] h-[25%] w-[45%]',
          visual.hairFront === 'center'
            ? 'rounded-b-[65%] rounded-t-[35%]'
            : visual.hairFront === 'swept'
              ? 'rounded-br-[70%] rounded-tl-[90%]'
              : 'rounded-bl-[70%] rounded-tr-[80%]',
        )}
        style={{ background: visual.palette.hair }}
      />
      <div className="absolute left-[39%] top-[43%] h-[6%] w-[7%] rounded-full" style={{ background: visual.palette.eyes }} />
      <div className="absolute left-[55%] top-[43%] h-[6%] w-[7%] rounded-full" style={{ background: visual.palette.eyes }} />
      <div
        className={cn(
          'absolute left-[46%] top-[55%] h-[2%] w-[10%] border-b-[3px] border-[#261558]',
          visual.mouth === 'smile' && 'rounded-b-full',
          visual.mouth === 'flat' && 'rounded-none',
        )}
      />
      {visual.accessory === 'halo' ? (
        <div
          className="absolute left-[34%] top-[12%] h-[8%] w-[32%] rounded-full border-[5px]"
          style={{ borderColor: visual.palette.accessory }}
        />
      ) : null}
      {visual.accessory === 'ribbon' ? (
        <div
          className="absolute left-[66%] top-[30%] h-[15%] w-[17%] rotate-12 rounded-[40%_10%_40%_10%]"
          style={{ background: visual.palette.accessory }}
        />
      ) : null}
      {visual.accessory === 'pin' ? (
        <div className="absolute left-[65%] top-[36%] h-[8%] w-[8%] rounded-full" style={{ background: visual.palette.accessory }} />
      ) : null}
      <div className="absolute bottom-0 left-0 right-0 bg-[linear-gradient(0deg,rgba(13,10,30,0.82),transparent)] px-5 pb-5 pt-16">
        <div className="truncate text-lg font-bold text-foreground">{profile.name || 'Untitled Soul'}</div>
        <div className="truncate text-xs text-muted">{profile.world || 'Soulidity Studio'}</div>
      </div>
    </div>
  )
}

function PartThumb({
  slot,
  optionId,
  visual,
}: {
  slot: EditableSlot
  optionId: string
  visual: VisualConfig
}) {
  const meta = slotMeta.find((item) => item.key === slot)
  const color = meta ? visual.palette[meta.colorKey] : visual.palette.accessory

  return (
    <div className="relative h-16 overflow-hidden rounded-xl border border-white/10 bg-card2">
      <div
        className="absolute inset-0 opacity-70"
        style={{
          background:
            slot === 'background'
              ? `linear-gradient(135deg, ${color}, #0d0a1e)`
              : `radial-gradient(circle at 50% 42%, ${color}66, transparent 48%)`,
        }}
      />
      {slot === 'hairBack' || slot === 'hairFront' ? (
        <div
          className={cn(
            'absolute left-1/2 top-3 h-10 w-12 -translate-x-1/2',
            optionId === 'long' ? 'rounded-[44%_44%_30%_30%]' : optionId === 'short' ? 'rounded-full' : 'rounded-[50%_50%_36%_36%]',
          )}
          style={{ background: color }}
        />
      ) : null}
      {slot === 'eyes' ? (
        <>
          <div className="absolute left-[28%] top-[42%] h-3 w-4 rounded-full" style={{ background: color }} />
          <div className="absolute right-[28%] top-[42%] h-3 w-4 rounded-full" style={{ background: color }} />
        </>
      ) : null}
      {slot === 'mouth' ? (
        <div className={cn('absolute left-1/2 top-1/2 h-2 w-8 -translate-x-1/2 border-b-2 border-foreground/70', optionId === 'smile' && 'rounded-b-full')} />
      ) : null}
      {slot === 'outfit' ? (
        <div className="absolute bottom-2 left-1/2 h-9 w-14 -translate-x-1/2 rounded-t-2xl rounded-b-lg" style={{ background: color }} />
      ) : null}
      {slot === 'accessory' ? (
        <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-4" style={{ borderColor: color }} />
      ) : null}
      <div className="absolute bottom-1 left-2 text-[10px] font-bold uppercase tracking-[0.06em] text-white/80">
        {optionId}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="page-kicker text-muted">{label}</span>
      {children}
    </label>
  )
}

function PillButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
        active ? 'border-purple bg-purple text-white' : 'border-border bg-transparent text-muted hover:border-purple hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function StepTabs({ step, setStep }: { step: StudioStep; setStep: (step: StudioStep) => void }) {
  const activeIndex = steps.findIndex((item) => item.id === step)
  return (
    <div className="flex overflow-x-auto border-b border-border bg-card2/50 px-4 py-3 hide-scrollbar sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1280px] min-w-max items-center gap-2">
        {steps.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setStep(item.id)}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
              step === item.id
                ? 'border-purple bg-purple text-white'
                : index < activeIndex
                  ? 'border-success/50 bg-success/10 text-success'
                  : 'border-border text-muted hover:border-purple hover:text-foreground',
            )}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[10px]">{index + 1}</span>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function StudioPage() {
  const [step, setStep] = useState<StudioStep>('template')
  const [templateId, setTemplateId] = useState(templates[1].id)
  const [visual, setVisual] = useState<VisualConfig>(defaultVisual)
  const [profile, setProfile] = useState<CharacterProfile>(defaultProfile)
  const [agent, setAgent] = useState<AgentPersona>(defaultAgent)
  const [packageId, setPackageId] = useState(makeId)
  const [selectedSlot, setSelectedSlot] = useState<EditableSlot>('hairFront')
  const [creatorTemplate, setCreatorTemplate] = useState<CreatorTemplateDraft>(defaultCreatorTemplate)
  const [creatorAssets, setCreatorAssets] = useState<CreatorAssetDraft[]>([])
  const [history, setHistory] = useState<VisualConfig[]>([defaultVisual])
  const [historyIndex, setHistoryIndex] = useState(0)
  const restoredRef = useRef(false)

  const template = templates.find((item) => item.id === templateId) ?? templates[0]
  const prompt = useMemo(() => buildPrompt(profile, agent), [profile, agent])
  const characterPackage = useMemo(
    () => buildPackage(packageId, template, visual, profile, agent),
    [agent, packageId, profile, template, visual],
  )
  const creatorManifest = useMemo(
    () => buildCreatorManifest(creatorTemplate, creatorAssets),
    [creatorAssets, creatorTemplate],
  )

  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const restoreTimer = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return
        const draft = JSON.parse(raw) as {
          step?: StudioStep
          templateId?: string
          visual?: VisualConfig
          profile?: CharacterProfile
          agent?: AgentPersona
          creatorTemplate?: CreatorTemplateDraft
          creatorAssets?: CreatorAssetDraft[]
          packageId?: string
        }
        if (draft.templateId) setTemplateId(draft.templateId)
        if (draft.visual) {
          setVisual(draft.visual)
          setHistory([draft.visual])
          setHistoryIndex(0)
        }
        if (draft.profile) setProfile(draft.profile)
        if (draft.agent) setAgent(draft.agent)
        if (draft.creatorTemplate) setCreatorTemplate(draft.creatorTemplate)
        if (draft.creatorAssets) setCreatorAssets(draft.creatorAssets)
        if (draft.packageId) setPackageId(draft.packageId)
        if (draft.step) setStep(draft.step)
      } catch {
        // Ignore malformed local drafts.
      }
    }, 0)
    return () => window.clearTimeout(restoreTimer)
  }, [])

  useEffect(() => {
    if (!restoredRef.current) return
    const timer = window.setTimeout(() => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ step, templateId, visual, profile, agent, creatorTemplate, creatorAssets, packageId }),
      )
    }, 250)
    return () => window.clearTimeout(timer)
  }, [agent, creatorAssets, creatorTemplate, packageId, profile, step, templateId, visual])

  function commitVisual(next: VisualConfig) {
    setVisual(next)
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIndex + 1)
      return [...trimmed, next].slice(-30)
    })
    setHistoryIndex((prev) => Math.min(prev + 1, 29))
  }

  function updateVisualSlot<K extends keyof Omit<VisualConfig, 'palette'>>(key: K, value: VisualConfig[K]) {
    commitVisual({ ...visual, [key]: value })
  }

  function updatePalette(key: keyof VisualConfig['palette'], value: string) {
    commitVisual({ ...visual, palette: { ...visual.palette, [key]: value } })
  }

  function undo() {
    const nextIndex = Math.max(0, historyIndex - 1)
    setHistoryIndex(nextIndex)
    setVisual(history[nextIndex])
  }

  function redo() {
    const nextIndex = Math.min(history.length - 1, historyIndex + 1)
    setHistoryIndex(nextIndex)
    setVisual(history[nextIndex])
  }

  function randomize() {
    const palette = randomPalettes[Math.floor(Math.random() * randomPalettes.length)]
    const pick = <T extends readonly { id: string }[]>(items: T) => items[Math.floor(Math.random() * items.length)].id
    commitVisual({
      ...visual,
      hairBack: pick(slotOptions.hairBack),
      hairFront: pick(slotOptions.hairFront),
      eyes: pick(slotOptions.eyes),
      mouth: pick(slotOptions.mouth),
      outfit: pick(slotOptions.outfit),
      accessory: pick(slotOptions.accessory),
      background: pick(slotOptions.background),
      palette: {
        skin: palette[0],
        hair: palette[1],
        eyes: palette[2],
        outfit: palette[3],
        accessory: palette[4],
        background: palette[5],
      },
    })
  }

  function exportPackage() {
    downloadTextFile(
      `${profile.name || 'character'}-package.json`,
      JSON.stringify(characterPackage, null, 2),
    )
  }

  function exportSoulMarkdown() {
    downloadTextFile(`${profile.name || 'character'}-soul.md`, characterPackage.exports.soulMarkdown.content, 'text/markdown')
  }

  function exportPersona() {
    downloadTextFile(
      `${profile.name || 'character'}-persona.json`,
      JSON.stringify({ persona: agent, prompt }, null, 2),
    )
  }

  function exportCreatorManifest() {
    downloadTextFile(
      `${slugifyPartId(creatorTemplate.name)}-creator-template.json`,
      JSON.stringify(creatorManifest, null, 2),
    )
  }

  function handleAssetFiles(files: FileList | null) {
    if (!files?.length) return
    const nextAssets = Array.from(files).map((file) => {
      const slot = inferSlotFromFileName(file.name)
      const partId = slugifyPartId(file.name)
      const notes = validateAssetFile(file)
      return {
        id: `${slot}-${partId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        fileName: file.name,
        slot,
        partId,
        variantId: 'default',
        license: creatorTemplate.license,
        royaltyBps: creatorTemplate.royaltyBps,
        status: notes.length ? 'warning' : 'ready',
        notes,
        previewUrl: URL.createObjectURL(file),
      } satisfies CreatorAssetDraft
    })
    setCreatorAssets((prev) => [...nextAssets, ...prev])
  }

  function updateCreatorAsset(assetId: string, patch: Partial<CreatorAssetDraft>) {
    setCreatorAssets((prev) => prev.map((asset) => (asset.id === assetId ? { ...asset, ...patch } : asset)))
  }

  function removeCreatorAsset(assetId: string) {
    setCreatorAssets((prev) => prev.filter((asset) => asset.id !== assetId))
  }

  function resetDraft() {
    const freshId = makeId()
    setPackageId(freshId)
    setTemplateId(templates[1].id)
    setVisual(defaultVisual)
    setProfile(defaultProfile)
    setAgent(defaultAgent)
    setCreatorTemplate(defaultCreatorTemplate)
    setCreatorAssets([])
    setStep('template')
    setSelectedSlot('hairFront')
    setHistory([defaultVisual])
    setHistoryIndex(0)
    localStorage.removeItem(STORAGE_KEY)
  }

  return (
    <div className="relative z-10 min-h-[calc(100vh-56px)] border-t border-purple/20">
      <StepTabs step={step} setStep={setStep} />

      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="page-kicker">Soulidity Studio</p>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl">
              OC and Agent creator
            </h1>
            <p className="mt-2 max-w-[680px] text-sm leading-6 text-muted">
              Build a standard character package first, then publish it to Soulidity, partners, or game worlds when the character is ready.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setStep('creator')}>
              Creator Kit
            </Button>
            <Button variant="outline" size="sm" onClick={resetDraft}>
              New draft
            </Button>
            <Button variant="teal" size="sm" onClick={() => downloadCover(visual, profile)}>
              Export PNG
            </Button>
            <Button variant="primary" size="sm" onClick={exportPackage}>
              Export package
            </Button>
          </div>
        </div>

        {step === 'template' && (
          <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
            <div className="space-y-5">
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="page-kicker">Template plaza</p>
                    <h2 className="mt-1 text-xl font-bold text-foreground">Choose a creator base</h2>
                    <p className="mt-2 max-w-[620px] text-sm leading-6 text-muted">
                      Studio starts from reusable creator templates: visual parts, usage license, and export rules travel with the character package.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {(['general', 'agent', 'game'] as TemplateType[]).map((type) => (
                      <span key={type} className="rounded-full border border-border bg-card2 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                        {type}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
              {templates.map((item) => {
                const active = item.id === templateId
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTemplateId(item.id)
                      setProfile((prev) => ({ ...prev, world: item.world }))
                    }}
                    className={cn(
                      'overflow-hidden rounded-2xl border bg-card text-left transition hover:border-purple',
                      active ? 'border-purple shadow-[0_12px_48px_rgba(168,85,247,0.18)]' : 'border-border',
                    )}
                  >
                    <div className="relative h-44 border-b border-border" style={{ background: `radial-gradient(circle at 70% 20%, ${item.accent}66, transparent 34%), linear-gradient(145deg, ${item.accent}22, #100a24)` }}>
                      <div className="absolute left-5 top-5 rounded-full border border-white/15 bg-black/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-white/80">
                        {item.type}
                      </div>
                      <div className="absolute bottom-5 left-5 right-5">
                        <AvatarPreview visual={{ ...visual, palette: { ...visual.palette, background: item.accent } }} profile={{ ...profile, world: item.world }} compact />
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-bold text-foreground">{item.name}</h3>
                          <p className="mt-1 text-xs text-muted">by {item.creator}</p>
                        </div>
                        <span className="rounded-full border border-teal/50 bg-teal/10 px-2 py-1 text-[10px] font-bold text-teal">
                          {item.usageCount} uses
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-muted">{item.summary}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className="rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-gold">
                          {item.license}
                        </span>
                        {item.tags.map((tag) => (
                          <span key={tag} className="rounded-full border border-border bg-card2 px-2.5 py-1 text-[11px] font-semibold text-muted">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                )
              })}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 xl:sticky xl:top-24 xl:self-start">
              <AvatarPreview visual={visual} profile={profile} />
              <div className="mt-5 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-foreground">{template.name}</div>
                  <div className="text-xs text-muted">{template.world} · {template.license}</div>
                </div>
                <Button onClick={() => setStep('editor')}>Start editing</Button>
              </div>
            </div>
          </section>
        )}

        {step === 'editor' && (
          <section className="grid gap-5 xl:grid-cols-[104px_1fr_360px]">
            <aside className="rounded-2xl border border-border bg-card p-3">
              <div className="mb-3 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Parts</div>
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
                {slotMeta.map((slot) => (
                  <button
                    key={slot.key}
                    type="button"
                    onClick={() => setSelectedSlot(slot.key)}
                    className={cn(
                      'flex min-h-[64px] flex-col items-center justify-center rounded-xl border px-2 py-2 text-center transition',
                      selectedSlot === slot.key
                        ? 'border-purple bg-purple/15 text-foreground'
                        : 'border-border bg-card2 text-muted hover:border-purple hover:text-foreground',
                    )}
                  >
                    <span className="text-[11px] font-black tracking-[0.08em]">{slot.icon}</span>
                    <span className="mt-1 text-[10px] font-semibold leading-tight">{slot.label}</span>
                  </button>
                ))}
              </div>
            </aside>

            <div className="rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(38,21,88,0.78),rgba(13,10,30,0.94))] p-4 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="page-kicker">Live canvas</p>
                  <h2 className="mt-1 text-lg font-bold text-foreground">{profile.name}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={undo} disabled={historyIndex === 0}>
                    Undo
                  </Button>
                  <Button variant="outline" size="sm" onClick={redo} disabled={historyIndex >= history.length - 1}>
                    Redo
                  </Button>
                  <Button variant="ghost" size="sm" onClick={randomize}>
                    Random
                  </Button>
                </div>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-black/15 p-4 sm:p-8">
                <AvatarPreview visual={visual} profile={profile} />
              </div>
              <div className="mt-5 grid gap-3 rounded-2xl border border-border bg-card/75 p-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Trace recipe</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {slotMeta.map((slot) => (
                      <button
                        key={slot.key}
                        type="button"
                        onClick={() => setSelectedSlot(slot.key)}
                        className="rounded-full border border-border bg-card2 px-2.5 py-1 text-[11px] font-semibold text-muted transition hover:border-purple hover:text-foreground"
                      >
                        {slot.label}: {visual[slot.key]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="teal" size="sm" onClick={() => downloadCover(visual, profile)}>
                    Download PNG
                  </Button>
                  <Button size="sm" onClick={() => setStep('profile')}>
                    Continue
                  </Button>
                </div>
              </div>
            </div>

            <aside className="rounded-2xl border border-border bg-card p-4">
              {(() => {
                const meta = slotMeta.find((item) => item.key === selectedSlot) ?? slotMeta[0]
                return (
                  <>
                    <div className="mb-4">
                      <p className="page-kicker">Current slot</p>
                      <h2 className="mt-1 text-lg font-bold text-foreground">{meta.label}</h2>
                      <p className="mt-1 text-xs text-muted">{meta.description}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {slotOptions[selectedSlot].map((option) => {
                        const active = visual[selectedSlot] === option.id
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => updateVisualSlot(selectedSlot, option.id)}
                            className={cn(
                              'rounded-2xl border bg-card2 p-2 text-left transition hover:border-purple',
                              active ? 'border-purple shadow-[0_0_0_1px_rgba(168,85,247,0.35)]' : 'border-border',
                            )}
                          >
                            <PartThumb slot={selectedSlot} optionId={option.id} visual={visual} />
                            <div className="mt-2 px-1 text-xs font-bold text-foreground">{option.label}</div>
                            <div className="px-1 text-[10px] text-muted">part/{option.id}</div>
                          </button>
                        )
                      })}
                    </div>
                    <div className="mt-5 rounded-2xl border border-border bg-card2 p-4">
                      <Field label={`${meta.label} color`}>
                        <div className="grid grid-cols-[48px_1fr] gap-2">
                          <input
                            type="color"
                            value={visual.palette[meta.colorKey]}
                            onChange={(event) => updatePalette(meta.colorKey, event.target.value)}
                            className="h-10 w-12 rounded-lg border border-border bg-card p-1"
                            aria-label={`${meta.label} color`}
                          />
                          <Input value={visual.palette[meta.colorKey]} onChange={(event) => updatePalette(meta.colorKey, event.target.value)} />
                        </div>
                      </Field>
                    </div>
                  </>
                )
              })()}
              <div className="mt-5 rounded-2xl border border-gold/35 bg-gold/10 p-4">
                <div className="text-xs font-bold text-gold">Creator asset model</div>
                <p className="mt-2 text-xs leading-5 text-muted">
                  Each part is treated as a traceable asset placeholder. The next version can replace these with uploaded PNG layers and royalty metadata.
                </p>
              </div>
            </aside>
          </section>
        )}

        {step === 'profile' && (
          <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-lg font-bold text-foreground">OC profile</h2>
              <p className="mt-1 text-sm text-muted">This becomes the human-readable identity layer of the character package.</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <Input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} />
                </Field>
                <Field label="World">
                  <Input value={profile.world} onChange={(event) => setProfile({ ...profile, world: event.target.value })} />
                </Field>
                <Field label="Gender setting">
                  <Input value={profile.gender} onChange={(event) => setProfile({ ...profile, gender: event.target.value })} />
                </Field>
                <Field label="Age setting">
                  <Input value={profile.age} onChange={(event) => setProfile({ ...profile, age: event.target.value })} />
                </Field>
                <Field label="Visibility">
                  <Select value={profile.visibility} onChange={(event) => setProfile({ ...profile, visibility: event.target.value as Visibility })}>
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </Select>
                </Field>
                <Field label="Personality tags">
                  <Input
                    value={listText(profile.personalityTags)}
                    onChange={(event) => setProfile({ ...profile, personalityTags: splitList(event.target.value) })}
                    placeholder="curious, calm, sharp"
                  />
                </Field>
              </div>
              <div className="mt-4 grid gap-4">
                <Field label="Short description">
                  <Textarea value={profile.description} onChange={(event) => setProfile({ ...profile, description: event.target.value })} />
                </Field>
                <Field label="Backstory">
                  <Textarea value={profile.backstory} onChange={(event) => setProfile({ ...profile, backstory: event.target.value })} className="min-h-[160px]" />
                </Field>
              </div>
              <div className="mt-5 flex justify-between gap-3">
                <Button variant="outline" onClick={() => setStep('editor')}>
                  Back
                </Button>
                <Button onClick={() => setStep('agent')}>
                  Continue
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <AvatarPreview visual={visual} profile={profile} compact />
              <div className="mt-5 rounded-xl border border-border bg-card2 p-4">
                <h3 className="text-sm font-bold text-foreground">{profile.name}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{profile.description}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {profile.personalityTags.map((tag) => (
                    <span key={tag} className="rounded-full border border-purple/60 bg-purple/10 px-2 py-1 text-[11px] font-semibold text-purple">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {step === 'agent' && (
          <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-foreground">Agent persona</h2>
                  <p className="mt-1 text-sm text-muted">Configure the part that turns an OC into a usable AI identity.</p>
                </div>
                <PillButton active={agent.enabled} onClick={() => setAgent({ ...agent, enabled: !agent.enabled })}>
                  {agent.enabled ? 'Agent enabled' : 'Agent disabled'}
                </PillButton>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Speech style">
                  <Input value={agent.speechStyle} onChange={(event) => setAgent({ ...agent, speechStyle: event.target.value })} />
                </Field>
                <Field label="Reply length">
                  <Select value={agent.replyLength} onChange={(event) => setAgent({ ...agent, replyLength: event.target.value as ReplyLength })}>
                    <option value="short">Short</option>
                    <option value="medium">Medium</option>
                    <option value="long">Long</option>
                  </Select>
                </Field>
                <Field label="Emotion mode">
                  <Select value={agent.emotionMode} onChange={(event) => setAgent({ ...agent, emotionMode: event.target.value as EmotionMode })}>
                    <option value="empathetic">Empathetic</option>
                    <option value="neutral">Neutral</option>
                    <option value="playful">Playful</option>
                  </Select>
                </Field>
                <Field label="Proactivity">
                  <Select value={agent.proactive ? 'yes' : 'no'} onChange={(event) => setAgent({ ...agent, proactive: event.target.value === 'yes' })}>
                    <option value="yes">May ask one follow-up</option>
                    <option value="no">Only respond when asked</option>
                  </Select>
                </Field>
                <Field label="Catchphrases">
                  <Textarea
                    value={listText(agent.catchphrases)}
                    onChange={(event) => setAgent({ ...agent, catchphrases: splitList(event.target.value) })}
                    className="min-h-[92px]"
                  />
                </Field>
                <Field label="Taboo topics">
                  <Textarea
                    value={listText(agent.tabooTopics)}
                    onChange={(event) => setAgent({ ...agent, tabooTopics: splitList(event.target.value) })}
                    className="min-h-[92px]"
                  />
                </Field>
                <Field label="Expertise">
                  <Textarea
                    value={listText(agent.expertise)}
                    onChange={(event) => setAgent({ ...agent, expertise: splitList(event.target.value) })}
                    className="min-h-[92px]"
                  />
                </Field>
                <Field label="Skills">
                  <Textarea
                    value={listText(agent.skills)}
                    onChange={(event) => setAgent({ ...agent, skills: splitList(event.target.value) })}
                    className="min-h-[92px]"
                  />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Knowledge boundaries">
                  <Textarea
                    value={listText(agent.knowledgeBoundaries)}
                    onChange={(event) => setAgent({ ...agent, knowledgeBoundaries: splitList(event.target.value) })}
                  />
                </Field>
              </div>

              <div className="mt-5 flex justify-between gap-3">
                <Button variant="outline" onClick={() => setStep('profile')}>
                  Back
                </Button>
                <Button onClick={() => setStep('review')}>
                  Review package
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-bold text-foreground">Prompt preview</h3>
              <pre className="mt-3 max-h-[360px] overflow-auto rounded-xl border border-border bg-black/20 p-4 text-xs leading-6 text-foreground/90 whitespace-pre-wrap">
                {prompt}
              </pre>
              <div className="mt-4 rounded-xl border border-border bg-card2 p-4">
                <div className="mb-3 flex items-center gap-3">
                  <AvatarPreview visual={visual} profile={profile} compact />
                </div>
                <div className="rounded-xl bg-card px-4 py-3 text-sm leading-6 text-muted">
                  {profile.name}: {agent.catchphrases[0] || 'Let me think with you.'} I can help with {agent.skills.slice(0, 2).join(' and ') || 'conversation'} while staying inside my boundaries.
                </div>
              </div>
            </div>
          </section>
        )}

        {step === 'creator' && (
          <section className="grid gap-5 xl:grid-cols-[380px_1fr]">
            <aside className="space-y-5">
              <div className="rounded-2xl border border-border bg-card p-5">
                <p className="page-kicker">Creator Kit</p>
                <h2 className="mt-1 text-xl font-bold text-foreground">Template packaging</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Prepare a painter-friendly template manifest: canvas, anchors, slots, filenames, licensing, and royalty metadata.
                </p>

                <div className="mt-5 grid gap-4">
                  <Field label="Template name">
                    <Input value={creatorTemplate.name} onChange={(event) => setCreatorTemplate({ ...creatorTemplate, name: event.target.value })} />
                  </Field>
                  <Field label="Creator">
                    <Input value={creatorTemplate.creator} onChange={(event) => setCreatorTemplate({ ...creatorTemplate, creator: event.target.value })} />
                  </Field>
                  <Field label="World / campaign">
                    <Input value={creatorTemplate.world} onChange={(event) => setCreatorTemplate({ ...creatorTemplate, world: event.target.value })} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="License">
                      <Select value={creatorTemplate.license} onChange={(event) => setCreatorTemplate({ ...creatorTemplate, license: event.target.value as CreatorLicense })}>
                        {Object.entries(licenseLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Royalty BPS">
                      <Input
                        type="number"
                        min={0}
                        max={2500}
                        value={creatorTemplate.royaltyBps}
                        onChange={(event) => setCreatorTemplate({ ...creatorTemplate, royaltyBps: Number(event.target.value) || 0 })}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Canvas W">
                      <Input
                        type="number"
                        value={creatorTemplate.canvasWidth}
                        onChange={(event) => setCreatorTemplate({ ...creatorTemplate, canvasWidth: Number(event.target.value) || 1024 })}
                      />
                    </Field>
                    <Field label="Canvas H">
                      <Input
                        type="number"
                        value={creatorTemplate.canvasHeight}
                        onChange={(event) => setCreatorTemplate({ ...creatorTemplate, canvasHeight: Number(event.target.value) || 1024 })}
                      />
                    </Field>
                    <Field label="Anchor X">
                      <Input
                        type="number"
                        value={creatorTemplate.anchorX}
                        onChange={(event) => setCreatorTemplate({ ...creatorTemplate, anchorX: Number(event.target.value) || 512 })}
                      />
                    </Field>
                    <Field label="Anchor Y">
                      <Input
                        type="number"
                        value={creatorTemplate.anchorY}
                        onChange={(event) => setCreatorTemplate({ ...creatorTemplate, anchorY: Number(event.target.value) || 512 })}
                      />
                    </Field>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-bold text-foreground">Painter spec</h3>
                <div className="mt-4 space-y-3 text-sm text-muted">
                  {[
                    'PNG with transparent background.',
                    'Recommended size: 1024 x 1024.',
                    'Anchor center: 512, 512 unless template says otherwise.',
                    'Filename: slot_part_variant.png.',
                    'Colorable areas should use neutral gray masks in production.',
                  ].map((item) => (
                    <div key={item} className="flex gap-2 rounded-xl border border-border bg-card2 px-3 py-2">
                      <span className="text-teal">✓</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>

            <div className="space-y-5">
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="page-kicker">Asset intake</p>
                    <h2 className="mt-1 text-xl font-bold text-foreground">Upload layer PNGs</h2>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      This local intake creates the template manifest. Later it can become the real creator dashboard with storage and review.
                    </p>
                  </div>
                  <label className={buttonStyles({ variant: 'primary', size: 'sm' })}>
                    Add PNG layers
                    <input
                      type="file"
                      accept="image/png"
                      multiple
                      className="sr-only"
                      onChange={(event) => {
                        handleAssetFiles(event.target.files)
                        event.target.value = ''
                      }}
                    />
                  </label>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-border bg-card2 p-4">
                    <div className="text-xs text-muted">Assets</div>
                    <div className="mt-1 text-2xl font-black text-foreground">{creatorAssets.length}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-card2 p-4">
                    <div className="text-xs text-muted">Ready</div>
                    <div className="mt-1 text-2xl font-black text-success">{creatorAssets.filter((asset) => asset.status === 'ready').length}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-card2 p-4">
                    <div className="text-xs text-muted">Warnings</div>
                    <div className="mt-1 text-2xl font-black text-gold">{creatorAssets.filter((asset) => asset.status === 'warning').length}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-foreground">Layer queue</h3>
                  <Button variant="teal" size="sm" onClick={exportCreatorManifest}>
                    Export manifest
                  </Button>
                </div>

                {creatorAssets.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-border bg-card2 px-5 py-10 text-center">
                    <div className="text-sm font-bold text-foreground">No layers yet</div>
                    <p className="mt-2 text-sm text-muted">Drop in PNG files from your artists to generate a template manifest.</p>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {creatorAssets.map((asset) => (
                      <div key={asset.id} className="grid gap-3 rounded-2xl border border-border bg-card2 p-3 lg:grid-cols-[76px_1fr_130px]">
                        <div className="h-[76px] overflow-hidden rounded-xl border border-border bg-card">
                          {asset.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={asset.previewUrl} alt="" className="h-full w-full object-contain" />
                          ) : (
                            <PartThumb slot={asset.slot} optionId={asset.partId} visual={visual} />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-foreground">{asset.fileName}</div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-3">
                            <Select value={asset.slot} onChange={(event) => updateCreatorAsset(asset.id, { slot: event.target.value as EditableSlot })}>
                              {slotMeta.map((slot) => (
                                <option key={slot.key} value={slot.key}>
                                  {slot.label}
                                </option>
                              ))}
                            </Select>
                            <Input value={asset.partId} onChange={(event) => updateCreatorAsset(asset.id, { partId: event.target.value })} />
                            <Input value={asset.variantId} onChange={(event) => updateCreatorAsset(asset.id, { variantId: event.target.value })} />
                          </div>
                          {asset.notes.length ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {asset.notes.map((note) => (
                                <span key={note} className="rounded-full border border-gold/40 bg-gold/10 px-2 py-1 text-[10px] font-semibold text-gold">
                                  {note}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-col justify-between gap-2">
                          <span
                            className={cn(
                              'rounded-full border px-2 py-1 text-center text-[10px] font-bold uppercase tracking-[0.08em]',
                              asset.status === 'ready'
                                ? 'border-success/50 bg-success/10 text-success'
                                : 'border-gold/50 bg-gold/10 text-gold',
                            )}
                          >
                            {asset.status}
                          </span>
                          <Button variant="ghost" size="sm" onClick={() => removeCreatorAsset(asset.id)}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-bold text-foreground">Manifest preview</h3>
                <pre className="mt-3 max-h-[360px] overflow-auto rounded-xl border border-border bg-black/20 p-4 text-xs leading-6 text-foreground/90">
                  {JSON.stringify(creatorManifest, null, 2)}
                </pre>
              </div>
            </div>
          </section>
        )}

        {step === 'review' && (
          <section className="grid gap-5 xl:grid-cols-[420px_1fr]">
            <div className="rounded-2xl border border-border bg-card p-5">
              <AvatarPreview visual={visual} profile={profile} />
              <div className="mt-5 grid gap-2">
                <Button onClick={exportPackage}>Download Character Package</Button>
                <Button variant="teal" onClick={() => downloadCover(visual, profile)}>
                  Download cover PNG
                </Button>
                <Button variant="outline" onClick={exportSoulMarkdown}>
                  Download soul.md
                </Button>
                <Button variant="outline" onClick={exportPersona}>
                  Download persona.json
                </Button>
                <Link href="/create" className={buttonStyles({ variant: 'gold', full: true })}>
                  Publish via current Soul flow
                </Link>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="page-kicker">Package</p>
                    <h2 className="mt-1 text-lg font-bold text-foreground">{characterPackage.packageId}</h2>
                  </div>
                  <span className="rounded-full border border-teal/60 bg-teal/10 px-3 py-1.5 text-xs font-bold text-teal">
                    {characterPackage.schemaVersion}
                  </span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border bg-card2 p-4">
                    <div className="text-xs text-muted">Template</div>
                    <div className="mt-1 text-sm font-bold text-foreground">{template.name}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-card2 p-4">
                    <div className="text-xs text-muted">Layers</div>
                    <div className="mt-1 text-sm font-bold text-foreground">{characterPackage.visual.layers.length}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-card2 p-4">
                    <div className="text-xs text-muted">Agent</div>
                    <div className="mt-1 text-sm font-bold text-foreground">{agent.enabled ? 'Enabled' : 'Disabled'}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-bold text-foreground">Export preview</h3>
                <pre className="mt-3 max-h-[440px] overflow-auto rounded-xl border border-border bg-black/20 p-4 text-xs leading-6 text-foreground/90">
                  {JSON.stringify(characterPackage, null, 2)}
                </pre>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
