import { describe, expect, it } from 'vitest'

import {
  CANONICAL_MEMORY_NAME,
  CANONICAL_SOUL_DOC_NAME,
  KIND_MEMORY,
  KIND_SKILL,
  KIND_SOUL_DOC,
  KIND_SPRITE,
  READ_GRANT,
  READ_OWNER,
  buildLegacyInitialContent,
  validateInitialContentEntries,
} from '@soulidity/sdk'
import { buildPhase2InitialContent } from '../../web/lib/hooks/phase2-mint-helpers'

const INVARIANT_READ_MODE = READ_OWNER | READ_GRANT

function byKind(entries: ReturnType<typeof buildLegacyInitialContent>, kind: number) {
  const entry = entries.find((item) => item.kind === kind)
  if (!entry) throw new Error(`missing kind ${kind}`)
  return entry
}

function validSoulEntry() {
  return {
    kind: KIND_SOUL_DOC,
    name: CANONICAL_SOUL_DOC_NAME,
    slotReadModeMask: INVARIANT_READ_MODE,
    downloadPolicy: 'public' as const,
    setActive: false,
    blobObjectId: '0x1',
  }
}

function validMemoryEntry() {
  return {
    kind: KIND_MEMORY,
    name: CANONICAL_MEMORY_NAME,
    slotReadModeMask: INVARIANT_READ_MODE,
    downloadPolicy: 'public' as const,
    setActive: false,
    blobObjectId: '0x2',
  }
}

describe('Soulidity initial content download policy', () => {
  it('uses the protocol no-policy value for non-download-policy built-in kinds', () => {
    const entries = buildLegacyInitialContent({
      protectedBlobObjectId: '0x1',
      foundingMemoryBlobObjectId: '0x2',
      skillsBlobObjectId: '0x3',
    })

    // On-chain encodes "this kind has no download policy" as policy byte 0,
    // which the TS enum names `public`.
    expect(byKind(entries, KIND_SOUL_DOC).downloadPolicy).toBe('public')
    expect(byKind(entries, KIND_MEMORY).downloadPolicy).toBe('public')
    expect(byKind(entries, KIND_SKILL).downloadPolicy).toBe('public')
  })

  it('keeps import helper defaults aligned with the same no-policy invariant', () => {
    const { initialContent } = buildPhase2InitialContent({
      protectedBlobObjectId: '0x1',
      foundingMemoryBlobObjectId: '0x2',
      skillsBlobObjectId: '0x3',
    })

    expect(byKind(initialContent, KIND_SOUL_DOC).downloadPolicy).toBe('public')
    expect(byKind(initialContent, KIND_MEMORY).downloadPolicy).toBe('public')
    expect(byKind(initialContent, KIND_SKILL).downloadPolicy).toBe('public')
  })

  it('still uses owner_only for private active-binding assets', () => {
    const entries = buildLegacyInitialContent({
      protectedBlobObjectId: '0x1',
      foundingMemoryBlobObjectId: '0x2',
      initialSprite: {
        blobObjectId: '0x4',
        spriteConfigJson: '{}',
      },
    })

    expect(byKind(entries, KIND_SPRITE).downloadPolicy).toBe('owner_only')
  })

  it('rejects non-policy built-in kinds before wallet dry-run', () => {
    expect(() => validateInitialContentEntries([
      { ...validSoulEntry(), downloadPolicy: 'owner_only' },
      validMemoryEntry(),
    ])).toThrow('kind 0 (soul_doc) does not accept download_policy')

    expect(() => validateInitialContentEntries([
      validSoulEntry(),
      { ...validMemoryEntry(), downloadPolicy: 'owner_only' },
    ])).toThrow('kind 1 (memory) does not accept download_policy')

    expect(() => validateInitialContentEntries([
      validSoulEntry(),
      validMemoryEntry(),
      {
        kind: KIND_SKILL,
        name: 'default',
        slotReadModeMask: INVARIANT_READ_MODE,
        downloadPolicy: 'owner_only',
        setActive: false,
        blobObjectId: '0x3',
      },
    ])).toThrow('kind 2 (skill) does not accept download_policy')
  })
})
