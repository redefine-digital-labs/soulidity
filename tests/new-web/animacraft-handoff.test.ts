import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANIMACRAFT_MAINNET_ORIGINAL_PACKAGE_ID,
  assertAnimacraftWalrusPatchUrl,
  getAnimacraftIntegrationConfig,
  parseAnimacraftMakerObject,
  parseAnimacraftOcPackage,
} from '../../web/lib/animacraft/handoff'

const MAKER_ID = `0x${'1'.repeat(64)}`
const TREASURY_ID = `0x${'2'.repeat(64)}`

afterEach(() => {
  vi.unstubAllEnvs()
})

function ocPackage() {
  return {
    schemaVersion: 'animacraft.oc-package.v1',
    profile: {
      name: 'Mira',
      world: 'Starlit City',
      description: 'A courier between worlds.',
      tags: ['oc', 'fantasy'],
    },
    livingContent: {
      makerId: MAKER_ID,
      content: {
        soulMd: '# Soul Character\nMira',
        memoryMd: '# Founding Memory\nArrival',
        skillMd: '---\nname: character-companion\ndescription: Keeps continuity.\n---\n# Skill',
      },
    },
    recipe: [
      { slot: 'eyes', part: 'bright', color: '#2DB7A3', renderOrder: 0 },
    ],
  }
}

describe('Animacraft handoff parser', () => {
  it('binds each Walrus URL to the certified quilt patch id', () => {
    expect(assertAnimacraftWalrusPatchUrl(
      'https://aggregator.walrus-mainnet.walrus.space/v1/blobs/by-quilt-patch-id/profile_patch-1',
      'profile_patch-1',
      'Profile',
    )).toContain('profile_patch-1')
    expect(() => assertAnimacraftWalrusPatchUrl(
      'https://aggregator.walrus-mainnet.walrus.space/v1/blobs/by-quilt-patch-id/other',
      'profile_patch-1',
      'Profile',
    )).toThrow(/does not match/)
  })

  it('normalizes a complete OC package into canonical recipe and Living Content', () => {
    const parsed = parseAnimacraftOcPackage(ocPackage(), MAKER_ID)
    expect(parsed.name).toBe('Mira')
    expect(parsed.skillName).toBe('character-companion')
    expect(parsed.recipe).toEqual([
      { partKey: 'eyes', itemKey: 'bright', colorHex: '#2db7a3', renderOrder: 0 },
    ])
  })

  it('rejects a Maker mismatch before any Walrus registration', () => {
    expect(() => parseAnimacraftOcPackage(ocPackage(), `0x${'3'.repeat(64)}`))
      .toThrow(/does not match/)
  })

  it('reads canonical mint economics from the on-chain Maker object', () => {
    const parsed = parseAnimacraftMakerObject({
      data: {
        objectId: MAKER_ID,
        content: {
          type: `${ANIMACRAFT_MAINNET_ORIGINAL_PACKAGE_ID}::animacraft::OCMaker`,
          fields: {
            treasury_id: { vec: [TREASURY_ID] },
            payment_coin_type: `${`0x${'4'.repeat(64)}`}::usdc::USDC`,
            minting_enabled: true,
            mint_fee_enabled: true,
            mint_price_atomic: '1000000',
            policy: { fields: { royalty_bps: '300' } },
            published: true,
            archived: false,
          },
        },
      },
    }, MAKER_ID)
    expect(parsed.treasuryId).toBe(TREASURY_ID)
    expect(parsed.mintPriceAtomic).toBe(1_000_000n)
    expect(parsed.royaltyBps).toBe(300)
  })

  it('rejects a lookalike Maker type from another package', () => {
    expect(() => parseAnimacraftMakerObject({
      data: {
        objectId: MAKER_ID,
        content: {
          type: `${MAKER_ID}::animacraft::OCMaker`,
          fields: {},
        },
      },
    }, MAKER_ID)).toThrow(/does not belong/)
  })

  it('keeps canonical minting fail-closed until every reviewed object is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED', 'false')
    vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_PACKAGE_ID', MAKER_ID)
    vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_FEE_CONFIG_ID', '')
    vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_TREASURY_ID', TREASURY_ID)

    const config = getAnimacraftIntegrationConfig()
    expect(config.ready).toBe(false)
    expect(config.missing).toEqual(expect.arrayContaining(['release gate', 'ProtocolFeeConfig']))
  })

  it('activates only with the release gate and all three canonical object ids', () => {
    vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet')
    vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED', 'true')
    vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_PACKAGE_ID', MAKER_ID)
    vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_FEE_CONFIG_ID', `0x${'3'.repeat(64)}`)
    vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_TREASURY_ID', TREASURY_ID)

    expect(getAnimacraftIntegrationConfig()).toMatchObject({
      enabled: true,
      ready: true,
      missing: [],
    })
  })
})
