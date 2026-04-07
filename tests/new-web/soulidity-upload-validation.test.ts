import { describe, expect, it } from 'vitest'

import {
  validateSoulUploadFile,
  validateSoulUploadSignature,
} from '../../new-web/lib/soulidity/upload-validation'

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
})
