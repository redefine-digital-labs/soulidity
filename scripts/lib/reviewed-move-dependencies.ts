import { normalizeSuiAddress } from '@mysten/sui/utils'

/**
 * Animacraft source commit 31073bd is the reviewed Commerce v5 source. The
 * record-only commit below adds its missing Published.toml version-3 metadata,
 * so Sui CLI can generate both publish dependencies and upgrade digests from
 * the exact callable package that was reviewed.
 *
 * Keep this binding release-specific and fail closed. Advancing either package
 * requires a reviewed source/deployment update rather than silently following
 * the latest Animacraft upgrade or rewriting a built package after the fact.
 */
export const ANIMACRAFT_PRE_COMMERCE_MAINNET_PACKAGE_ID =
  '0xc1bbfe03cc93e27903e1ffd1a712745384cd537d6edadfb0e759bf6e090e53cc'

export const ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID =
  '0xcf369b8b02ac1e997146fc3be3f03870db14eaccf3d2cb7a9b93724be463108e'

export const ANIMACRAFT_MAINNET_ORIGINAL_PACKAGE_ID =
  '0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea'

export const ANIMACRAFT_COMMERCE_V5_SOURCE_COMMIT =
  '827abcbea3e81ff10bc54c2443deee375878d7d5'

export function assertReviewedAnimacraftDependencies(
  network: 'mainnet' | 'testnet',
  dependencies: string[],
): string[] {
  const normalized = dependencies.map((dependency) =>
    normalizeSuiAddress(dependency),
  )
  if (network !== 'mainnet') return normalized

  const stalePackage = normalizeSuiAddress(
    ANIMACRAFT_PRE_COMMERCE_MAINNET_PACKAGE_ID,
  )
  const reviewedPackage = normalizeSuiAddress(
    ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID,
  )
  const staleIndexes = normalized.flatMap((dependency, index) =>
    dependency === stalePackage ? [index] : [],
  )
  const reviewedIndexes = normalized.flatMap((dependency, index) =>
    dependency === reviewedPackage ? [index] : [],
  )

  if (reviewedIndexes.length !== 1 || staleIndexes.length !== 0) {
    throw new Error(
      'Soulidity build does not contain exactly one reviewed Animacraft '
        + 'Commerce v5 Mainnet dependency, or still contains the stale '
        + 'pre-Commerce package. Refusing to rewrite build output; update '
        + 'the pinned source/deployment record first.',
    )
  }
  return normalized
}

type MoveFunctionClient = {
  getNormalizedMoveFunction(input: {
    package: string
    module: string
    function: string
  }): Promise<unknown>
  getNormalizedMoveStruct(input: {
    package: string
    module: string
    struct: string
  }): Promise<unknown>
}

type ReviewedFunctionShape = {
  name: string
  typeParameters: number
  parameters: number
  returns: number
}

export const REVIEWED_ANIMACRAFT_COMMERCE_V5_FUNCTIONS:
  ReadonlyArray<ReviewedFunctionShape> = [
  { name: 'root_id_v5', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'root_treasury_id_v5', typeParameters: 0, parameters: 1, returns: 1 },
  {
    name: 'consume_commerce_v5_soul_mint_authorization',
    typeParameters: 0,
    parameters: 1,
    returns: 3,
  },
  {
    name: 'bind_complete_output_to_soul_v5',
    typeParameters: 1,
    parameters: 5,
    returns: 0,
  },
  {
    name: 'derive_complete_output_seal_id_v5',
    typeParameters: 0,
    parameters: 5,
    returns: 1,
  },
  { name: 'complete_output_exists_v5', typeParameters: 0, parameters: 2, returns: 1 },
  { name: 'complete_output_record_v5', typeParameters: 0, parameters: 2, returns: 1 },
  { name: 'complete_output_bound_soul_id_v5', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'complete_output_ciphertext_blob_id_v5', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'complete_output_digest_v5', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'complete_output_is_soul_bound_v5', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'complete_output_nonce_v5', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'complete_output_payer_v5', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'complete_output_recipe_hash_v5', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'complete_output_seal_id_v5', typeParameters: 0, parameters: 1, returns: 1 },
  {
    name: 'complete_output_soul_binding_seal_id_v5',
    typeParameters: 0,
    parameters: 1,
    returns: 1,
  },
]

const REVIEWED_ANIMACRAFT_COMMERCE_V5_STRUCTS = [
  'MakerRootV5',
  'CommerceProtocolConfigV5',
  'CommerceV5SoulMintAuthorization',
] as const

function assertReviewedFunctionShape(
  value: unknown,
  expected: ReviewedFunctionShape,
): void {
  if (!value || typeof value !== 'object') {
    throw new Error(`${expected.name} returned no normalized ABI`)
  }
  const record = value as Record<string, unknown>
  const returns = record.returns ?? record.return
  if (
    record.visibility !== 'public'
    || record.isEntry !== false
    || !Array.isArray(record.typeParameters)
    || record.typeParameters.length !== expected.typeParameters
    || !Array.isArray(record.parameters)
    || record.parameters.length !== expected.parameters
    || !Array.isArray(returns)
    || returns.length !== expected.returns
  ) {
    throw new Error(`${expected.name} does not match the reviewed normalized ABI`)
  }
}

function assertReviewedStructOrigin(value: unknown, name: string): void {
  if (!value || typeof value !== 'object') {
    throw new Error(`${name} returned no normalized ABI`)
  }
  const record = value as Record<string, unknown>
  if (
    normalizeSuiAddress(String(record.definingId ?? '0x0'))
      !== normalizeSuiAddress(ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID)
    || record.module !== 'commerce_v5'
    || record.name !== name
  ) {
    throw new Error(`${name} does not originate from reviewed Commerce v5`)
  }
}

export async function assertReviewedAnimacraftMainnetAbi(input: {
  client: MoveFunctionClient
  dependencies: string[]
}): Promise<void> {
  const reviewedPackage = normalizeSuiAddress(
    ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID,
  )
  const matches = input.dependencies.filter(
    (dependency) => normalizeSuiAddress(dependency) === reviewedPackage,
  )
  if (matches.length !== 1) {
    throw new Error(
      'Final Soulidity publish dependencies do not contain exactly one '
        + 'reviewed Animacraft Commerce v5 package.',
    )
  }

  try {
    const [functions, structs] = await Promise.all([
      Promise.all(REVIEWED_ANIMACRAFT_COMMERCE_V5_FUNCTIONS.map(
        async (expected) => ({
          expected,
          value: await input.client.getNormalizedMoveFunction({
            package: reviewedPackage,
            module: 'commerce_v5',
            function: expected.name,
          }),
        }),
      )),
      Promise.all(REVIEWED_ANIMACRAFT_COMMERCE_V5_STRUCTS.map(
        async (name) => ({
          name,
          value: await input.client.getNormalizedMoveStruct({
            package: reviewedPackage,
            module: 'commerce_v5',
            struct: name,
          }),
        }),
      )),
    ])
    for (const { expected, value } of functions) {
      assertReviewedFunctionShape(value, expected)
    }
    for (const { name, value } of structs) {
      assertReviewedStructOrigin(value, name)
    }
  } catch (cause) {
    throw new Error(
      `Reviewed Animacraft Commerce v5 ABI is unavailable on Mainnet: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    )
  }
}
