import { describe, expect, it } from 'vitest'

import {
  validateSoulUploadFile,
  validateSoulUploadSignature,
} from '../../new-web/lib/soulidity/upload-validation'

describe('Soulidity upload validation', () => {
  it('accepts public markdown skill documents', () => {
    const file = {
      size: 128,
      type: 'text/markdown',
    } as Pick<File, 'size' | 'type'>

    expect(validateSoulUploadFile(file, 'public')).toBeNull()
    expect(
      validateSoulUploadSignature(
        new TextEncoder().encode('# Soul Skills\n\n- scouting\n- memory'),
        'public',
        'text/markdown',
      ),
    ).toBeNull()
  })
})
