import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID,
  ANIMACRAFT_COMPOSABLE_V6_MAINNET_PACKAGE_ID,
  ANIMACRAFT_COMPOSABLE_V6_SOURCE_COMMIT,
  ANIMACRAFT_COMPOSABLE_V6_TYPE_ORIGIN_PACKAGE_ID,
  ANIMACRAFT_MAINNET_ORIGINAL_PACKAGE_ID,
  ANIMACRAFT_PHYSICAL_V7_MAINNET_PACKAGE_ID,
  ANIMACRAFT_PRE_COMMERCE_MAINNET_PACKAGE_ID,
  REVIEWED_ANIMACRAFT_COMMERCE_V5_FUNCTIONS,
  REVIEWED_ANIMACRAFT_COMPOSITION_V6_FUNCTIONS,
  REVIEWED_ANIMACRAFT_PHYSICAL_V7_FUNCTIONS,
  assertReviewedAnimacraftDependencies,
  assertReviewedAnimacraftMainnetAbi,
} from '../../scripts/lib/reviewed-move-dependencies'

describe('reviewed Animacraft Move dependency binding', () => {
  it('rejects the stale Mainnet callable package without rewriting build output', () => {
    expect(() => assertReviewedAnimacraftDependencies('mainnet', [
      ANIMACRAFT_PRE_COMMERCE_MAINNET_PACKAGE_ID,
    ])).toThrow(/Refusing to rewrite build output/)
  })

  it('accepts exactly one reviewed Core and one Physical v7 dependency', () => {
    expect(assertReviewedAnimacraftDependencies('mainnet', [
      ANIMACRAFT_COMPOSABLE_V6_MAINNET_PACKAGE_ID,
      ANIMACRAFT_PHYSICAL_V7_MAINNET_PACKAGE_ID,
    ])).toEqual([
      ANIMACRAFT_COMPOSABLE_V6_MAINNET_PACKAGE_ID,
      ANIMACRAFT_PHYSICAL_V7_MAINNET_PACKAGE_ID,
    ])
  })

  it('rejects missing, duplicate, or ambiguous Mainnet bindings', () => {
    expect(() => assertReviewedAnimacraftDependencies('mainnet', ['0x2']))
      .toThrow(/exactly one reviewed/)
    expect(() => assertReviewedAnimacraftDependencies('mainnet', [
      ANIMACRAFT_PRE_COMMERCE_MAINNET_PACKAGE_ID,
      ANIMACRAFT_PRE_COMMERCE_MAINNET_PACKAGE_ID,
    ])).toThrow(/exactly one reviewed/)
    expect(() => assertReviewedAnimacraftDependencies('mainnet', [
      ANIMACRAFT_PRE_COMMERCE_MAINNET_PACKAGE_ID,
      ANIMACRAFT_COMPOSABLE_V6_MAINNET_PACKAGE_ID,
      ANIMACRAFT_PHYSICAL_V7_MAINNET_PACKAGE_ID,
    ])).toThrow(/superseded/)
    expect(() => assertReviewedAnimacraftDependencies('mainnet', [
      ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID,
    ])).toThrow(/superseded/)
  })

  it('does not apply Mainnet release policy to testnet builds', () => {
    expect(assertReviewedAnimacraftDependencies('testnet', ['0x2']))
      .toEqual([`0x${'0'.repeat(63)}2`])
  })

  it('matches the reviewed Mainnet dep replacement in Move.toml', () => {
    const manifest = readFileSync('move/soulidity/Move.toml', 'utf8')
    const mainnetReplacement = manifest.match(
      /\[dep-replacements\.mainnet\][\s\S]*?^animacraft\s*=\s*\{([^\n]+)\}/m,
    )?.[1]
    expect(mainnetReplacement).toBeDefined()
    expect(mainnetReplacement).toContain(
      `published-at = "${ANIMACRAFT_COMPOSABLE_V6_MAINNET_PACKAGE_ID}"`,
    )
    expect(mainnetReplacement).toContain(
      `original-id = "${ANIMACRAFT_MAINNET_ORIGINAL_PACKAGE_ID}"`,
    )
    const physicalReplacement = manifest.match(
      /\[dep-replacements\.mainnet\][\s\S]*?^animacraft_physical_v7\s*=\s*\{([^\n]+)\}/m,
    )?.[1]
    expect(physicalReplacement).toContain(
      `published-at = "${ANIMACRAFT_PHYSICAL_V7_MAINNET_PACKAGE_ID}"`,
    )
    expect(physicalReplacement).toContain(
      `original-id = "${ANIMACRAFT_PHYSICAL_V7_MAINNET_PACKAGE_ID}"`,
    )
    expect(manifest).toContain(
      `rev = "${ANIMACRAFT_COMPOSABLE_V6_SOURCE_COMMIT}"`,
    )
  })

  it('probes the reviewed Mainnet ABI before transaction construction', async () => {
    const calls: Array<{ package: string; module: string; function: string }> = []
    const structCalls: Array<{ package: string; module: string; struct: string }> = []
    const client = {
      getNormalizedMoveFunction: async (input: {
        package: string
        module: string
        function: string
      }) => {
        calls.push(input)
        const expected = [
          ...REVIEWED_ANIMACRAFT_COMMERCE_V5_FUNCTIONS,
          ...REVIEWED_ANIMACRAFT_COMPOSITION_V6_FUNCTIONS,
          ...REVIEWED_ANIMACRAFT_PHYSICAL_V7_FUNCTIONS,
        ].find(
          (candidate) => candidate.name === input.function,
        )!
        return {
          visibility: 'public',
          isEntry: false,
          typeParameters: Array(expected.typeParameters).fill({}),
          parameters: Array(expected.parameters).fill({}),
          returns: Array(expected.returns).fill({}),
        }
      },
      getNormalizedMoveStruct: async (input: {
        package: string
        module: string
        struct: string
      }) => {
        structCalls.push(input)
        return {
          definingId: input.module === 'commerce_v5'
            ? ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID
            : input.module === 'composition_v6'
              ? ANIMACRAFT_COMPOSABLE_V6_TYPE_ORIGIN_PACKAGE_ID
              : ANIMACRAFT_PHYSICAL_V7_MAINNET_PACKAGE_ID,
          module: input.module,
          name: input.struct,
        }
      },
    }
    await expect(assertReviewedAnimacraftMainnetAbi({
      client,
      dependencies: [
        ANIMACRAFT_COMPOSABLE_V6_MAINNET_PACKAGE_ID,
        ANIMACRAFT_PHYSICAL_V7_MAINNET_PACKAGE_ID,
      ],
    })).resolves.toBeUndefined()
    expect(calls.map((call) => call.function)).toEqual(
      [
        ...REVIEWED_ANIMACRAFT_COMMERCE_V5_FUNCTIONS,
        ...REVIEWED_ANIMACRAFT_COMPOSITION_V6_FUNCTIONS,
        ...REVIEWED_ANIMACRAFT_PHYSICAL_V7_FUNCTIONS,
      ].map(({ name }) => name),
    )
    expect(structCalls.map((call) => call.struct)).toEqual([
      'MakerRootV5',
      'CommerceProtocolConfigV5',
      'CommerceV5SoulMintAuthorization',
      'CompositionProtocolConfigV6',
      'CompositionProtocolTreasuryV6',
      'CompositionRegistryV6',
      'InitialLoadoutAuthorizationV6',
      'ItemProductV6',
      'LoadoutAuthorizationV6',
      'LoadoutSelectionV6',
      'MakerProfileV6',
      'OwnedItemV6',
      'InitialPhysicalLoadoutAuthorizationV7',
      'MakerPhysicalProfileV7',
      'PhysicalProtocolConfigV7',
      'PhysicalRegistryV7',
      'SoulWardrobeV7',
      'StyleAssetV7',
      'StyleProductV7',
    ])
  })

  it('covers every Animacraft Commerce v5 function used by production Move', () => {
    const sourceDir = 'move/soulidity/sources'
    const source = readdirSync(sourceDir)
      .filter((name) => name.endsWith('.move') && !name.endsWith('_tests.move'))
      .map((name) => readFileSync(join(sourceDir, name), 'utf8'))
      .join('\n')
    const usedFunctions = [...source.matchAll(
      /(?:animacraft_commerce_v5|commerce)::([a-zA-Z0-9_]+)/g,
    )].map((match) => match[1])
    expect([...new Set(usedFunctions)].sort()).toEqual(
      REVIEWED_ANIMACRAFT_COMMERCE_V5_FUNCTIONS
        .map(({ name }) => name)
        .sort(),
    )
  })

  it('covers every Animacraft Composition v6 function used by production Move', () => {
    const sourceDir = 'move/soulidity/sources'
    const source = readdirSync(sourceDir)
      .filter((name) => name.endsWith('.move') && !name.endsWith('_tests.move'))
      .map((name) => readFileSync(join(sourceDir, name), 'utf8'))
      .join('\n')
    const usedFunctions = [...source.matchAll(
      /(?:composition_v6|animacraft_composition_v6)::([a-zA-Z0-9_]+)/g,
    )].map((match) => match[1])
    expect([...new Set(usedFunctions)].sort()).toEqual(
      REVIEWED_ANIMACRAFT_COMPOSITION_V6_FUNCTIONS
        .map(({ name }) => name)
        .sort(),
    )
  })

  it('covers every Animacraft Physical v7 function used by production Move', () => {
    const sourceDir = 'move/soulidity/sources'
    const source = readdirSync(sourceDir)
      .filter((name) => name.endsWith('.move') && !name.endsWith('_tests.move'))
      .map((name) => readFileSync(join(sourceDir, name), 'utf8'))
      .join('\n')
    const usedFunctions = [...source.matchAll(
      /\bphysical_v7::([a-zA-Z0-9_]+)/g,
    )].map((match) => match[1])
    expect([...new Set(usedFunctions)].sort()).toEqual(
      REVIEWED_ANIMACRAFT_PHYSICAL_V7_FUNCTIONS
        .map(({ name }) => name)
        .sort(),
    )
  })

  it('fails closed when the reviewed ABI is missing or not selected', async () => {
    const missingClient = {
      getNormalizedMoveFunction: async () => {
        throw new Error('Module not found')
      },
      getNormalizedMoveStruct: async () => {
        throw new Error('Module not found')
      },
    }
    await expect(assertReviewedAnimacraftMainnetAbi({
      client: missingClient,
      dependencies: [
        ANIMACRAFT_COMPOSABLE_V6_MAINNET_PACKAGE_ID,
        ANIMACRAFT_PHYSICAL_V7_MAINNET_PACKAGE_ID,
      ],
    })).rejects.toThrow(/ABI is unavailable.*Module not found/)
    await expect(assertReviewedAnimacraftMainnetAbi({
      client: missingClient,
      dependencies: ['0x2'],
    })).rejects.toThrow(/do not contain exactly one reviewed/)
  })
})
