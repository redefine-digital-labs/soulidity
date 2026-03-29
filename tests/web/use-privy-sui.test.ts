import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('use-privy-sui helpers', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('BCS-encodes personal messages before wrapping them with the Sui PersonalMessage intent', async () => {
    const { bcs } = await import('@mysten/sui/bcs')
    const { toSuiPersonalMessageBytes } = await import('../../web/lib/souls/use-privy-sui.ts')
    const message = new Uint8Array([1, 2, 3, 4])

    expect(toSuiPersonalMessageBytes(message)).toEqual(
      bcs.byteVector().serialize(message).toBytes(),
    )
  })

  it('extracts the first linked Sui wallet with both address and public key', async () => {
    const { getPrivySuiWallet } = await import('../../web/lib/souls/use-privy-sui.ts')

    expect(getPrivySuiWallet({
      linkedAccounts: [
        { type: 'wallet', chainType: 'ethereum', address: '0xeth', publicKey: '0xethpk' },
        { type: 'wallet', chainType: 'sui', address: '0xsui', publicKey: '0x1234' },
      ],
    })).toEqual({
      address: '0xsui',
      publicKey: '0x1234',
    })
  })

  it('roundtrips hex helpers without losing the 0x prefix', async () => {
    const { bytesToHex, hexToBytes } = await import('../../web/lib/souls/use-privy-sui.ts')

    expect(bytesToHex(hexToBytes('0x0102ff'))).toBe('0x0102ff')
  })

  it('strips the leading 33rd byte from Privy ed25519 public keys', async () => {
    const { normalizePrivyEd25519PublicKeyBytes } = await import('../../web/lib/souls/use-privy-sui.ts')

    const prefixed = `0x00${'11'.repeat(32)}`
    expect(Array.from(normalizePrivyEd25519PublicKeyBytes(prefixed))).toEqual(
      Array.from({ length: 32 }, () => 0x11),
    )
  })
})
