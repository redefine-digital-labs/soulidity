import { describe, expect, it } from 'vitest'

import {
  validateSoulUploadFile,
  validateSoulUploadSignature,
} from '../../web/lib/souls/upload-validation.ts'

describe('Soul upload validation', () => {
  it('rejects non-image public uploads', () => {
    expect(
      validateSoulUploadFile(
        {
          name: 'payload.html',
          size: 1024,
          type: 'text/html',
        } as File,
        'public',
      ),
    ).toBe('Public uploads must be JPEG, PNG, WebP, or GIF images')
  })

  it('accepts image previews and zip bundles', () => {
    expect(
      validateSoulUploadFile(
        {
          name: 'preview.png',
          size: 1024,
          type: 'image/png',
        } as File,
        'public',
      ),
    ).toBeNull()

    expect(
      validateSoulUploadFile(
        {
          name: 'bundle.zip',
          size: 1024,
          type: 'application/octet-stream',
        } as File,
        'encrypted',
      ),
    ).toBeNull()
  })

  it('rejects non-zip encrypted uploads', () => {
    expect(
      validateSoulUploadFile(
        {
          name: 'bundle.tar',
          size: 1024,
          type: 'application/x-tar',
        } as File,
        'encrypted',
      ),
    ).toBe('Encrypted uploads must be ZIP archives')
  })

  it('rejects spoofed public uploads whose bytes are not an image', () => {
    expect(
      validateSoulUploadSignature(
        Buffer.from('PK\x03\x04not-an-image', 'binary'),
        'public',
      ),
    ).toBe('Public uploads must be JPEG, PNG, WebP, or GIF images')
  })

  it('rejects spoofed encrypted uploads whose bytes are not a zip archive', () => {
    expect(
      validateSoulUploadSignature(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'encrypted',
      ),
    ).toBe('Encrypted uploads must be ZIP archives')
  })
})
