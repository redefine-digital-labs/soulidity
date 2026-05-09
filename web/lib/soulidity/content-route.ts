import { NextResponse } from 'next/server'
import {
  KIND_AUDIO,
  KIND_MEMORY,
  KIND_SKILL,
  KIND_SOUL_DOC,
  KIND_SPRITE,
} from '@soulidity/sdk'

const KIND_ALIASES = new Map<string, number>([
  ['soul', KIND_SOUL_DOC],
  ['soul_doc', KIND_SOUL_DOC],
  ['soul-doc', KIND_SOUL_DOC],
  ['memory', KIND_MEMORY],
  ['skill', KIND_SKILL],
  ['skills', KIND_SKILL],
  ['sprite', KIND_SPRITE],
  ['persona-sprite', KIND_SPRITE],
  ['audio', KIND_AUDIO],
])

export function parseContentKindParam(value: string | null | undefined): number | null {
  const raw = value?.trim()
  if (!raw) return null
  const alias = KIND_ALIASES.get(raw.toLowerCase())
  if (alias != null) return alias
  if (!/^\d+$/.test(raw)) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export function parseContentVersionIndexParam(value: string | null | undefined): number | null {
  const raw = value?.trim()
  if (!raw || !/^\d+$/.test(raw)) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export function parseContentLimitParam(value: string | null): number | null {
  const raw = value?.trim()
  if (!raw) return null
  if (!/^\d+$/.test(raw)) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function decodeRouteName(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 })
}
