import { describe, expect, it } from 'vitest'
import {
  createWalrusUploaderToken,
  verifyWalrusUploaderToken,
} from '../../src/shared/walrus-uploader-token'

const SECRET = 'test-secret-with-enough-entropy'
const WALLET = `0x${'1'.repeat(64)}`

describe('Walrus uploader token', () => {
  it('binds uploads to wallet, network, file count, byte limit, and expiry', () => {
    const token = createWalrusUploaderToken({
      secret: SECRET,
      nowMs: 1_000,
      ttlMs: 60_000,
      walletAddress: WALLET,
      network: 'mainnet',
      fileCount: 3,
      byteLimit: 30_000,
    })

    const verified = verifyWalrusUploaderToken(token, {
      secret: SECRET,
      nowMs: 2_000,
      walletAddress: WALLET,
      network: 'mainnet',
      fileCount: 3,
      byteCount: 29_999,
    })

    expect(verified.walletAddress).toBe(WALLET)
    expect(verified.network).toBe('mainnet')
    expect(verified.fileCount).toBe(3)
    expect(verified.byteLimit).toBe(30_000)
  })

  it('rejects expired and over-budget uploader token use', () => {
    const token = createWalrusUploaderToken({
      secret: SECRET,
      nowMs: 1_000,
      ttlMs: 10_000,
      walletAddress: WALLET,
      network: 'testnet',
      fileCount: 2,
      byteLimit: 10,
    })

    expect(() =>
      verifyWalrusUploaderToken(token, {
        secret: SECRET,
        nowMs: 12_001,
        walletAddress: WALLET,
        network: 'testnet',
        fileCount: 1,
        byteCount: 1,
      }),
    ).toThrow(/expired/i)

    expect(() =>
      verifyWalrusUploaderToken(token, {
        secret: SECRET,
        nowMs: 2_000,
        walletAddress: WALLET,
        network: 'testnet',
        fileCount: 3,
        byteCount: 1,
      }),
    ).toThrow(/file count/i)

    expect(() =>
      verifyWalrusUploaderToken(token, {
        secret: SECRET,
        nowMs: 2_000,
        walletAddress: WALLET,
        network: 'testnet',
        fileCount: 1,
        byteCount: 11,
      }),
    ).toThrow(/byte limit/i)
  })
})
