import { describe, expect, it, vi } from 'vitest'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const AUTH_TAG_BYTES = 16

// Mock server-only modules that seal-crypto.ts imports transitively
vi.mock('@web/lib/services/seal', () => ({
  AccessPolicyDescriptor: {},
}))
vi.mock('@web/lib/sui', () => ({
  suiClient: {},
}))

function aesGcmEncrypt(plaintext: Buffer, dek: Buffer, iv: Buffer) {
  const cipher = createCipheriv('aes-256-gcm', dek, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
  return ciphertext
}

function aesGcmDecrypt(ciphertext: Buffer, dek: Buffer, iv: Buffer) {
  const authTag = ciphertext.subarray(ciphertext.length - AUTH_TAG_BYTES)
  const encrypted = ciphertext.subarray(0, ciphertext.length - AUTH_TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', dek, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}

function sha256hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

describe('Seal AES-GCM encrypt-decrypt roundtrip', () => {
  it('encrypts plaintext and decrypts back with matching hash', () => {
    const plaintext = Buffer.from('Hello Soul bundle content — 你好世界!')
    const contentHash = sha256hex(plaintext)
    const dek = randomBytes(32)
    const iv = randomBytes(12)

    const ciphertext = aesGcmEncrypt(plaintext, dek, iv)

    // File is actually encrypted — ciphertext differs from plaintext
    expect(Buffer.compare(ciphertext, plaintext)).not.toBe(0)
    // Ciphertext includes 16-byte auth tag
    expect(ciphertext.length).toBe(plaintext.length + AUTH_TAG_BYTES)

    const recovered = aesGcmDecrypt(ciphertext, dek, iv)

    // Decrypted content matches original
    expect(Buffer.compare(recovered, plaintext)).toBe(0)
    expect(sha256hex(recovered)).toBe(contentHash)
  })

  it('rejects tampered ciphertext via GCM auth tag', () => {
    const plaintext = Buffer.from('Integrity-protected content')
    const dek = randomBytes(32)
    const iv = randomBytes(12)

    const ciphertext = aesGcmEncrypt(plaintext, dek, iv)

    // Tamper with the first byte of the ciphertext body
    const tampered = Buffer.from(ciphertext)
    tampered[0] ^= 0xff

    expect(() => aesGcmDecrypt(tampered, dek, iv)).toThrow()
  })

  it('rejects decryption with wrong IV', () => {
    const plaintext = Buffer.from('IV-bound content')
    const dek = randomBytes(32)
    const iv1 = randomBytes(12)
    const iv2 = randomBytes(12)

    const ciphertext = aesGcmEncrypt(plaintext, dek, iv1)

    expect(() => aesGcmDecrypt(ciphertext, dek, iv2)).toThrow()
  })

  it('handles 1MB file roundtrip with hash verification', () => {
    const plaintext = randomBytes(1024 * 1024)
    const contentHash = sha256hex(plaintext)
    const dek = randomBytes(32)
    const iv = randomBytes(12)

    const ciphertext = aesGcmEncrypt(plaintext, dek, iv)
    expect(ciphertext.length).toBe(plaintext.length + AUTH_TAG_BYTES)

    const recovered = aesGcmDecrypt(ciphertext, dek, iv)
    expect(sha256hex(recovered)).toBe(contentHash)
  })

  it('handles empty plaintext', () => {
    const plaintext = Buffer.alloc(0)
    const contentHash = sha256hex(plaintext)
    const dek = randomBytes(32)
    const iv = randomBytes(12)

    const ciphertext = aesGcmEncrypt(plaintext, dek, iv)
    // Empty plaintext produces only the auth tag
    expect(ciphertext.length).toBe(AUTH_TAG_BYTES)

    const recovered = aesGcmDecrypt(ciphertext, dek, iv)
    expect(recovered.length).toBe(0)
    expect(sha256hex(recovered)).toBe(contentHash)
  })

  it('preserves binary content with null bytes', () => {
    const plaintext = randomBytes(256)
    // Ensure some null bytes
    plaintext[0] = 0x00
    plaintext[127] = 0x00
    plaintext[255] = 0x00
    const dek = randomBytes(32)
    const iv = randomBytes(12)

    const ciphertext = aesGcmEncrypt(plaintext, dek, iv)
    const recovered = aesGcmDecrypt(ciphertext, dek, iv)

    // Byte-for-byte identical
    expect(Buffer.compare(recovered, plaintext)).toBe(0)
  })

  it('createSealKeyMaterial produces correct 64-byte layout', async () => {
    const { createSealKeyMaterial } = await import('../../web/lib/services/seal-crypto')

    const dek = new Uint8Array(32).fill(0x42)
    const contentHash = 'ab'.repeat(32) // 64-char hex = 32 bytes

    const keyMaterial = createSealKeyMaterial(dek, contentHash)

    expect(keyMaterial.length).toBe(64)
    // First 32 bytes = DEK
    expect(Buffer.from(keyMaterial.subarray(0, 32))).toEqual(Buffer.from(dek))
    // Last 32 bytes = contentHash bytes
    const expectedHashBytes = Buffer.from(contentHash, 'hex')
    expect(Buffer.from(keyMaterial.subarray(32, 64))).toEqual(expectedHashBytes)
  })
})
