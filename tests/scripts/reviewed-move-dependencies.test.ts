import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID,
  ANIMACRAFT_COMMERCE_V5_SOURCE_COMMIT,
  ANIMACRAFT_MAINNET_ORIGINAL_PACKAGE_ID,
  ANIMACRAFT_PRE_COMMERCE_MAINNET_PACKAGE_ID,
  REVIEWED_ANIMACRAFT_COMMERCE_V5_FUNCTIONS,
  assertReviewedAnimacraftDependencies,
  assertReviewedAnimacraftMainnetAbi,
} from '../../scripts/lib/reviewed-move-dependencies'

describe('reviewed Animacraft Move dependency binding', () => {
  it('rejects the stale Mainnet callable package without rewriting build output', () => {
    expect(() => assertReviewedAnimacraftDependencies('mainnet', [
      ANIMACRAFT_PRE_COMMERCE_MAINNET_PACKAGE_ID,
    ])).toThrow(/Refusing to rewrite build output/)
  })

  it('accepts one already-reviewed Mainnet dependency', () => {
    expect(assertReviewedAnimacraftDependencies('mainnet', [
      ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID,
    ])).toEqual([ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID])
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
      ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID,
    ])).toThrow(/stale pre-Commerce/)
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
      `published-at = "${ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID}"`,
    )
    expect(mainnetReplacement).toContain(
      `original-id = "${ANIMACRAFT_MAINNET_ORIGINAL_PACKAGE_ID}"`,
    )
    expect(manifest).toContain(
      `rev = "${ANIMACRAFT_COMMERCE_V5_SOURCE_COMMIT}"`,
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
        const expected = REVIEWED_ANIMACRAFT_COMMERCE_V5_FUNCTIONS.find(
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
          definingId: ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID,
          module: 'commerce_v5',
          name: input.struct,
        }
      },
    }
    await expect(assertReviewedAnimacraftMainnetAbi({
      client,
      dependencies: [ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID],
    })).resolves.toBeUndefined()
    expect(calls.map((call) => call.function)).toEqual(
      REVIEWED_ANIMACRAFT_COMMERCE_V5_FUNCTIONS.map(({ name }) => name),
    )
    expect(structCalls.map((call) => call.struct)).toEqual([
      'MakerRootV5',
      'CommerceProtocolConfigV5',
      'CommerceV5SoulMintAuthorization',
    ])
  })

  it('covers every Animacraft Commerce v5 function used by production Move', () => {
    const sourceDir = 'move/soulidity/sources'
    const source = readdirSync(sourceDir)
      .filter((name) => name.endsWith('.move') && name !== 'protocol_tests.move')
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
      dependencies: [ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID],
    })).rejects.toThrow(/ABI is unavailable.*Module not found/)
    await expect(assertReviewedAnimacraftMainnetAbi({
      client: missingClient,
      dependencies: ['0x2'],
    })).rejects.toThrow(/do not contain exactly one reviewed/)
  })
})
