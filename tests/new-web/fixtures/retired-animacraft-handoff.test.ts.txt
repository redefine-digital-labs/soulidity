import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANIMACRAFT_MAINNET_ORIGINAL_PACKAGE_ID,
  assertAnimacraftWalrusPatchUrl,
  fetchAnimacraftPassesV5,
  getAnimacraftIntegrationConfig,
  parseAnimacraftMakerObject,
  parseAnimacraftMakerRootV5Object,
  parseAnimacraftMakerTreasuryV5Object,
  parseAnimacraftOcPackage,
  parseAnimacraftPassV5Object,
  parseAnimacraftProtocolTreasuryV5Object,
  parseAnimacraftProtocolV5Object,
  verifyAnimacraftCommerceV5State,
} from '../../web/lib/animacraft/handoff'

const MAKER_ID = `0x${'1'.repeat(64)}`
const TREASURY_ID = `0x${'2'.repeat(64)}`
const ROOT_ID = `0x${'3'.repeat(64)}`
const TYPE_ORIGIN_ID = `0x${'4'.repeat(64)}`
const PROTOCOL_ID = `0x${'5'.repeat(64)}`
const PROTOCOL_TREASURY_ID = `0x${'6'.repeat(64)}`
const PASS_ID = `0x${'7'.repeat(64)}`
const WALLET_ID = `0x${'8'.repeat(64)}`

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

function ocPackageV2() {
  const legacy = ocPackage()
  return {
    schemaVersion: 'animacraft.oc-package.v2',
    maker: {
      makerObjectId: MAKER_ID,
      versionId: 'mira-maker-v2',
    },
    profile: legacy.profile,
    livingContent: legacy.livingContent,
    recipe: {
      selections: [
        { partId: 'eyes', itemId: 'bright', styleId: 'starlit' },
      ],
      colors: [
        { channelId: 'eyes-color', swatchId: 'teal' },
      ],
    },
    suiSummary: {
      recipeEncoding: 'BCS vector<RecipeSlot>',
      recipe: [
        { partKey: 'eyes', itemKey: 'bright--starlit', colorHex: '#2DB7A3', renderOrder: 7 },
      ],
    },
  }
}

function ocPackageV5() {
  const value = ocPackageV2()
  return {
    ...value,
    commerce: {
      schemaVersion: 'animacraft.maker-commerce.v1',
      usedPackIds: ['premium-hair'],
    },
    suiSummary: {
      ...value.suiSummary,
      usedPackIds: ['premium-hair'],
      styleSelections: [
        { partKey: 'eyes', itemKey: 'bright--starlit', styleKey: 'starlit' },
      ],
    },
  }
}

describe('Animacraft handoff parser', () => {
  it('binds each Walrus URL to the certified quilt patch id', () => {
    expect(assertAnimacraftWalrusPatchUrl(
      'https://aggregator.walrus-mainnet.walrus.space/v1/blobs/by-quilt-patch-id/profile_patch-1',
      'profile_patch-1',
      'Profile',
    )).toBe(
      'https://aggregator.walrus-mainnet.walrus.space/v1/blobs/by-quilt-patch-id/profile_patch-1',
    )
    expect(() => assertAnimacraftWalrusPatchUrl(
      'https://aggregator.walrus-mainnet.walrus.space/v1/blobs/by-quilt-patch-id/other',
      'profile_patch-1',
      'Profile',
    )).toThrow(/does not match/)
    expect(() => assertAnimacraftWalrusPatchUrl(
      'https://evil.example/v1/blobs/by-quilt-patch-id/profile_patch-1',
      'profile_patch-1',
      'Profile',
    )).toThrow(/trusted Animacraft Walrus Mainnet aggregator/)
  })

  it('ignores Passes owned for unrelated Maker roots', async () => {
    const unrelatedRoot = `0x${'9'.repeat(64)}`
    const passObject = (
      objectId: string,
      structName: 'MakerAccessPassV5' | 'PackPassV5',
      rootId: string,
    ) => ({
      data: {
        objectId,
        content: {
          type: `${TYPE_ORIGIN_ID}::commerce_v5::${structName}`,
          fields: {
            root_id: rootId,
            holder: WALLET_ID,
            ...(structName === 'PackPassV5' ? { pack_key: 'premium-hair' } : {}),
          },
        },
      },
    })
    const client = {
      getOwnedObjects: vi.fn(async (input: { filter: { StructType: string } }) => {
        const structName = input.filter.StructType.endsWith('::MakerAccessPassV5')
          ? 'MakerAccessPassV5'
          : 'PackPassV5'
        return {
          data: [
            passObject(
              structName === 'MakerAccessPassV5'
                ? `0x${'a'.repeat(64)}`
                : `0x${'b'.repeat(64)}`,
              structName,
              unrelatedRoot,
            ),
            passObject(
              structName === 'MakerAccessPassV5'
                ? `0x${'c'.repeat(64)}`
                : `0x${'d'.repeat(64)}`,
              structName,
              ROOT_ID,
            ),
          ],
          hasNextPage: false,
          nextCursor: null,
        }
      }),
    }

    const passes = await fetchAnimacraftPassesV5(client, {
      owner: WALLET_ID,
      typeOriginPackageId: TYPE_ORIGIN_ID,
      expectedRootId: ROOT_ID,
    })

    expect(passes.makerAccessPasses).toHaveLength(1)
    expect(passes.packPasses).toHaveLength(1)
    expect([
      ...passes.makerAccessPasses,
      ...passes.packPasses,
    ].every((pass) => pass.rootId === ROOT_ID)).toBe(true)
  })

  it('normalizes a complete OC package into canonical recipe and Living Content', () => {
    const parsed = parseAnimacraftOcPackage(ocPackage(), MAKER_ID)
    expect(parsed.name).toBe('Mira')
    expect(parsed.skillName).toBe('character-companion')
    expect(parsed.recipe).toEqual([
      { partKey: 'eyes', itemKey: 'bright', colorHex: '#2db7a3', renderOrder: 0 },
    ])
  })

  it('normalizes the signed Sui summary from an Animacraft OC package v2', () => {
    const parsed = parseAnimacraftOcPackage(ocPackageV2(), MAKER_ID)
    expect(parsed.name).toBe('Mira')
    expect(parsed.skillName).toBe('character-companion')
    expect(parsed.recipe).toEqual([
      {
        partKey: 'eyes',
        itemKey: 'bright--starlit',
        colorHex: '#2db7a3',
        renderOrder: 7,
      },
    ])
  })

  it('binds commerce v5 to one exact Style selection per Recipe slot', () => {
    const parsed = parseAnimacraftOcPackage(ocPackageV5(), MAKER_ID)
    expect(parsed.protocolVersion).toBe(5)
    expect(parsed.styleSelections).toEqual([
      { partKey: 'eyes', itemKey: 'bright--starlit', styleKey: 'starlit' },
    ])
    expect(parsed.usedPackIds).toEqual(['premium-hair'])
    expect(parsed.soulCreatorRoyaltyBps).toBe(250)

    const mismatched = ocPackageV5()
    mismatched.suiSummary.styleSelections[0].itemKey = 'another-item'
    expect(() => parseAnimacraftOcPackage(mismatched, MAKER_ID))
      .toThrow(/does not match/)

    const explicitZero = ocPackageV5()
    ;(explicitZero.commerce as Record<string, unknown>).royalties = { soulCreatorBps: 0 }
    expect(parseAnimacraftOcPackage(explicitZero, MAKER_ID).soulCreatorRoyaltyBps)
      .toBe(0)
  })

  it('does not reinterpret the full v5 recipe as a v2 on-chain recipe', () => {
    const value = ocPackageV2()
    delete (value as { suiSummary?: unknown }).suiSummary
    expect(() => parseAnimacraftOcPackage(value, MAKER_ID))
      .toThrow(/Sui summary/)
  })

  it('rejects unsafe keys and colors in the v2 Sui summary', () => {
    const unsafeKey = ocPackageV2()
    unsafeKey.suiSummary.recipe[0].partKey = '../eyes'
    expect(() => parseAnimacraftOcPackage(unsafeKey, MAKER_ID))
      .toThrow(/unsafe key/)

    const unsafeColor = ocPackageV2()
    unsafeColor.suiSummary.recipe[0].colorHex = 'red'
    expect(() => parseAnimacraftOcPackage(unsafeColor, MAKER_ID))
      .toThrow(/invalid color/)
  })

  it('applies Maker binding and Living Content limits to v2 packages', () => {
    const makerMismatch = ocPackageV2()
    makerMismatch.livingContent.makerId = `0x${'3'.repeat(64)}`
    expect(() => parseAnimacraftOcPackage(makerMismatch, MAKER_ID))
      .toThrow(/does not match/)

    const oversizedSoul = ocPackageV2()
    oversizedSoul.livingContent.content.soulMd = 'x'.repeat(64 * 1024 + 1)
    expect(() => parseAnimacraftOcPackage(oversizedSoul, MAKER_ID))
      .toThrow(/exceeds/)
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

  it('keeps commerce v5 behind an independent default-off gate', () => {
    vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet')
    vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED', 'false')
    vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PACKAGE_ID', ROOT_ID)
    vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_TYPE_ORIGIN_PACKAGE_ID', TYPE_ORIGIN_ID)
    vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_CONFIG_ID', PROTOCOL_ID)
    vi.stubEnv(
      'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_TREASURY_ID',
      PROTOCOL_TREASURY_ID,
    )
    expect(getAnimacraftIntegrationConfig()).toMatchObject({
      commerceV5Enabled: false,
      commerceV5Ready: false,
      commerceV5Missing: expect.arrayContaining(['commerce v5 release gate']),
    })
  })

  it('parses and links the reviewed v5 Root, treasuries, protocol, and Pass', () => {
    const paymentCoinType = `${TYPE_ORIGIN_ID}::usdc::USDC`
    const root = parseAnimacraftMakerRootV5Object({
      data: {
        objectId: ROOT_ID,
        content: {
          type: `${TYPE_ORIGIN_ID}::commerce_v5::MakerRootV5`,
          fields: {
            legacy_maker_id: MAKER_ID,
            treasury_id: TREASURY_ID,
            protocol_config_id: PROTOCOL_ID,
            payment_coin_type: paymentCoinType,
            original_creator: WALLET_ID,
            current_owner: WALLET_ID,
            rights_origin: 0,
            soul_creator_royalty_bps: '250',
            lifecycle: 0,
            ownership_epoch: '3',
            current_control_cap_id: { vec: [] },
            active_listing_id: { vec: [] },
            base_access_kind: 0,
            base_purchase_price_atomic: '0',
            base_policy: {
              fields: {
                mode: 0,
                free_quota_per_wallet: '0',
                price_atomic: '0',
                total_cap: '0',
              },
            },
            pack_keys: ['premium-hair'],
            style_registry_sealed: true,
            total_completes: '9',
          },
        },
      },
    }, ROOT_ID, TYPE_ORIGIN_ID)
    const makerTreasury = parseAnimacraftMakerTreasuryV5Object({
      data: {
        objectId: TREASURY_ID,
        content: {
          type: `${TYPE_ORIGIN_ID}::commerce_v5::MakerTreasuryV5<${paymentCoinType}>`,
          fields: {
            root_id: ROOT_ID,
            revenue: { fields: { value: '100' } },
          },
        },
      },
    }, TREASURY_ID, TYPE_ORIGIN_ID)
    const protocol = parseAnimacraftProtocolV5Object({
      data: {
        objectId: PROTOCOL_ID,
        content: {
          type: `${TYPE_ORIGIN_ID}::commerce_v5::CommerceProtocolConfigV5`,
          fields: {
            treasury_id: PROTOCOL_TREASURY_ID,
            payment_coin_type: paymentCoinType,
            primary_protocol_fee_bps: '1000',
            fixed_complete_fee_atomic: '50',
            enabled: true,
          },
        },
      },
    }, PROTOCOL_ID, TYPE_ORIGIN_ID)
    const protocolTreasury = parseAnimacraftProtocolTreasuryV5Object({
      data: {
        objectId: PROTOCOL_TREASURY_ID,
        content: {
          type: `${TYPE_ORIGIN_ID}::commerce_v5::CommerceProtocolTreasuryV5<${paymentCoinType}>`,
          fields: { config_id: PROTOCOL_ID },
        },
      },
    }, PROTOCOL_TREASURY_ID, TYPE_ORIGIN_ID)
    const packPass = parseAnimacraftPassV5Object({
      data: {
        objectId: PASS_ID,
        content: {
          type: `${TYPE_ORIGIN_ID}::commerce_v5::PackPassV5`,
          fields: {
            root_id: ROOT_ID,
            holder: WALLET_ID,
            pack_key: 'premium-hair',
          },
        },
      },
    }, TYPE_ORIGIN_ID)

    const verifyParams = {
      expectedLegacyMakerId: MAKER_ID,
      expectedRootId: ROOT_ID,
      expectedMakerTreasuryId: TREASURY_ID,
      expectedProtocolConfigId: PROTOCOL_ID,
      expectedProtocolTreasuryId: PROTOCOL_TREASURY_ID,
      expectedPaymentCoinType: paymentCoinType,
      wallet: WALLET_ID,
      usedPackIds: ['premium-hair'],
      legacyMaker: {
        objectId: MAKER_ID,
        treasuryId: TREASURY_ID,
        paymentCoinType,
        mintingEnabled: false,
        mintFeeEnabled: false,
        mintPriceAtomic: 0n,
        royaltyBps: 300,
        published: true,
        archived: true,
      },
      soulCreatorRoyaltyBps: 250,
    } as const
    expect(() => verifyAnimacraftCommerceV5State({
      root,
      makerTreasury,
      protocol,
      protocolTreasury,
      makerAccessPasses: [],
      packPasses: [packPass],
    }, verifyParams)).not.toThrow()

    expect(() => verifyAnimacraftCommerceV5State({
      root: { ...root, soulCreatorRoyaltyBps: 0 },
      makerTreasury,
      protocol,
      protocolTreasury,
      makerAccessPasses: [],
      packPasses: [packPass],
    }, verifyParams)).toThrow(/does not match the certified Animacraft handoff/)
  })
})
