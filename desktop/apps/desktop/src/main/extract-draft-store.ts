import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'

import type { ExtractSoulDraft } from '@soulidity/shared'

const EXTRACT_DRAFT_FILE = 'extract_soul_draft.json'

function getStatePath() {
  return path.join(app.getPath('userData'), 'state')
}

function getDraftPath() {
  return path.join(getStatePath(), EXTRACT_DRAFT_FILE)
}

export function loadExtractSoulDraft(): ExtractSoulDraft | null {
  try {
    const raw = fs.readFileSync(getDraftPath(), 'utf-8')
    return JSON.parse(raw) as ExtractSoulDraft
  } catch {
    return null
  }
}

export function saveExtractSoulDraft(draft: ExtractSoulDraft): void {
  const dir = getStatePath()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getDraftPath(), JSON.stringify(draft, null, 2))
}

export function clearExtractSoulDraft(): void {
  try {
    fs.unlinkSync(getDraftPath())
  } catch {
    // Already cleared.
  }
}
