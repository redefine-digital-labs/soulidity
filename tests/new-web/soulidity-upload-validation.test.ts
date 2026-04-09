import { strToU8, zipSync } from '../../new-web/node_modules/fflate/esm/index.mjs'
import { describe, expect, it } from 'vitest'

import {
  extractSkillBundleMetadata,
  validateSoulUploadFile,
  validateSoulUploadSignature,
} from '../../new-web/lib/soulidity/upload-validation'

function createZipWithBrokenNonSkillEntry() {
  const bytes = zipSync({
    'bundle/SKILL.md': strToU8('---\nname: market-scout\n---\n# Market Scout'),
    'bundle/README.md': strToU8('# Notes'),
  })
  const mutated = bytes.slice()
  const CENTRAL_DIRECTORY_HEADER = Uint8Array.from([0x50, 0x4b, 0x01, 0x02])
  const targetName = 'bundle/README.md'
  const targetNameBytes = new TextEncoder().encode(targetName)

  for (let index = 0; index <= mutated.length - 46; index += 1) {
    if (!CENTRAL_DIRECTORY_HEADER.every((byte, offset) => mutated[index + offset] === byte)) {
      continue
    }

    const fileNameLength = mutated[index + 28] | (mutated[index + 29] << 8)
    const extraLength = mutated[index + 30] | (mutated[index + 31] << 8)
    const commentLength = mutated[index + 32] | (mutated[index + 33] << 8)
    const fileNameStart = index + 46
    const fileNameEnd = fileNameStart + fileNameLength
    const fileName = mutated.slice(fileNameStart, fileNameEnd)
    const isTarget = fileName.length === targetNameBytes.length
      && fileName.every((byte, offset) => byte === targetNameBytes[offset])

    if (!isTarget) {
      index = fileNameEnd + extraLength + commentLength - 1
      continue
    }

    mutated[index + 10] = 12
    mutated[index + 11] = 0
    return mutated
  }

  throw new Error(`Unable to locate central directory entry for ${targetName}`)
}

describe('Soulidity upload validation', () => {
  it('rejects public markdown skill documents for skill uploads', () => {
    const file = {
      size: 128,
      type: 'text/markdown',
    } as Pick<File, 'size' | 'type'>

    expect(validateSoulUploadFile(file, 'public')).toBe('Public uploads must be JPEG, PNG, WebP, GIF images, JSON metadata, or ZIP skill bundles')
    expect(
      validateSoulUploadSignature(
        new TextEncoder().encode('# Soul Skills\n\n- scouting\n- memory'),
        'public',
        'text/markdown',
      ),
    ).toBe('Public uploads must be JPEG, PNG, WebP, GIF images, JSON metadata, or ZIP skill bundles')
  })

  it('accepts ZIP skill bundles as public uploads', () => {
    const file = {
      size: 4096,
      type: 'application/zip',
    } as Pick<File, 'size' | 'type'>

    expect(validateSoulUploadFile(file, 'public')).toBeNull()
  })

  it('extracts metadata even when unrelated ZIP entries are invalid to decompress', () => {
    expect(
      extractSkillBundleMetadata(createZipWithBrokenNonSkillEntry()),
    ).toEqual({ skillName: 'market-scout' })
  })
})
