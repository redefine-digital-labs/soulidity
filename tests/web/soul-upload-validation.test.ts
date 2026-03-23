import { describe, expect, it } from 'vitest'

import {
  FILE_TOO_LARGE_ERROR,
  validateSoulUploadFile,
  validateSoulUploadSignature,
} from '../../web/lib/souls/upload-validation.ts'

describe('Soul upload validation', () => {
  it('rejects unsupported public uploads', () => {
    expect(
      validateSoulUploadFile(
        {
          name: 'payload.html',
          size: 1024,
          type: 'text/html',
        } as File,
        'public',
      ),
    ).toBe('Public uploads must be JPEG, PNG, WebP, GIF images, or JSON metadata')
  })

  it('accepts image previews and opaque encrypted bundles', () => {
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
          name: 'metadata.json',
          size: 1024,
          type: 'application/json',
        } as File,
        'public',
      ),
    ).toBeNull()

    expect(
      validateSoulUploadFile(
        {
          name: 'bundle.sealed',
          size: 1024,
          type: 'application/octet-stream',
        } as File,
        'encrypted',
      ),
    ).toBeNull()
  })

  it('rejects encrypted uploads that are too small before signature validation runs', () => {
    expect(
      validateSoulUploadFile(
        {
          name: 'bundle.sealed',
          size: 16,
          type: 'application/octet-stream',
        } as File,
        'encrypted',
      ),
    ).toBe('Encrypted upload is too small (minimum 32 bytes)')
  })

  it('rejects oversized public JSON metadata before decoding it', () => {
    expect(
      validateSoulUploadFile(
        {
          name: 'sidecar.json',
          size: 6 * 1024 * 1024,
          type: 'application/json',
        } as File,
        'public',
      ),
    ).toBe('JSON metadata exceeds 5 MB limit')
  })

  it('rejects uploads above the overall 50 MB limit before MIME-specific checks', () => {
    expect(
      validateSoulUploadFile(
        {
          name: 'huge-preview.png',
          size: 51 * 1024 * 1024,
          type: 'image/png',
        } as File,
        'public',
      ),
    ).toBe(FILE_TOO_LARGE_ERROR)
  })

  it('accepts encrypted uploads with any MIME type (pre-Seal bundles can be any format)', () => {
    for (const type of ['text/plain', 'application/json', 'application/octet-stream', 'image/png', '']) {
      expect(
        validateSoulUploadFile(
          { name: 'bundle.bin', size: 1024, type } as File,
          'encrypted',
        ),
      ).toBeNull()
    }
  })

  it('rejects spoofed public uploads whose bytes are not an image', () => {
    expect(
      validateSoulUploadSignature(
        Buffer.from('PK\x03\x04not-an-image', 'binary'),
        'public',
      ),
    ).toBe('Public uploads must be JPEG, PNG, WebP, GIF images, or JSON metadata')
  })

  it('accepts public JSON sidecars', () => {
    expect(
      validateSoulUploadSignature(
        Buffer.from(JSON.stringify({ version: 1, mode: 'seal-envelope' })),
        'public',
        'application/json',
      ),
    ).toBeNull()
  })

  it('accepts opaque encrypted payload bytes without requiring a ZIP signature', () => {
    expect(
      validateSoulUploadSignature(
        Buffer.alloc(32, 0x7),
        'encrypted',
      ),
    ).toBeNull()
  })

  it('rejects encrypted payloads that are too small to be a sealed blob', () => {
    expect(
      validateSoulUploadSignature(
        Buffer.alloc(16, 0x7),
        'encrypted',
      ),
    ).toBe('Encrypted upload is too small (minimum 32 bytes)')

    expect(
      validateSoulUploadSignature(
        Buffer.from([0x01, 0x02, 0x03, 0x04]),
        'encrypted',
      ),
    ).toBe('Encrypted upload is too small (minimum 32 bytes)')
  })
})
