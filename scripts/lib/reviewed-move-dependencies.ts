import { normalizeSuiAddress } from '@mysten/sui/utils'

/**
 * Animacraft source commit 7fd4ff6 is the reviewed Composable v6 source. The
 * record-only commit below adds its Published.toml version-4 metadata, so Sui
 * CLI can generate Soulidity upgrade digests against the exact callable
 * package that was reviewed and deployed with every release gate disabled.
 *
 * Keep this binding release-specific and fail closed. Advancing either package
 * requires a reviewed source/deployment update rather than silently following
 * the latest Animacraft upgrade or rewriting a built package after the fact.
 */
export const ANIMACRAFT_PRE_COMMERCE_MAINNET_PACKAGE_ID =
  '0xc1bbfe03cc93e27903e1ffd1a712745384cd537d6edadfb0e759bf6e090e53cc'

export const ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID =
  '0xcf369b8b02ac1e997146fc3be3f03870db14eaccf3d2cb7a9b93724be463108e'

export const ANIMACRAFT_COMPOSABLE_V6_MAINNET_PACKAGE_ID =
  '0x2221610b5513ef3f926433229b7f0b565e850d56020e344266737cdca078af3b'

export const ANIMACRAFT_MAINNET_ORIGINAL_PACKAGE_ID =
  '0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea'

export const ANIMACRAFT_COMPOSABLE_V6_SOURCE_COMMIT =
  '7cc6cbf93db984bfc285cf3c99b3e79a7ce8259b'

export function assertReviewedAnimacraftDependencies(
  network: 'mainnet' | 'testnet',
  dependencies: string[],
): string[] {
  const normalized = dependencies.map((dependency) =>
    normalizeSuiAddress(dependency),
  )
  if (network !== 'mainnet') return normalized

  const reviewedPackage = normalizeSuiAddress(
    ANIMACRAFT_COMPOSABLE_V6_MAINNET_PACKAGE_ID,
  )
  const supersededPackages = new Set([
    normalizeSuiAddress(ANIMACRAFT_PRE_COMMERCE_MAINNET_PACKAGE_ID),
    normalizeSuiAddress(ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID),
  ])
  const staleIndexes = normalized.flatMap((dependency, index) =>
    supersededPackages.has(dependency) ? [index] : [],
  )
  const reviewedIndexes = normalized.flatMap((dependency, index) =>
    dependency === reviewedPackage ? [index] : [],
  )

  if (reviewedIndexes.length !== 1 || staleIndexes.length !== 0) {
    throw new Error(
      'Soulidity build does not contain exactly one reviewed Animacraft '
        + 'Composable v6 Mainnet dependency, or still contains a superseded '
        + 'Animacraft callable package. Refusing to rewrite build output; update '
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
  { name: 'complete_authorization_recipe_hash_v5', typeParameters: 0, parameters: 1, returns: 1 },
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

export const REVIEWED_ANIMACRAFT_COMPOSITION_V6_FUNCTIONS:
  ReadonlyArray<ReviewedFunctionShape> = [
  { name: 'assert_secondary_market_loadout_v6', typeParameters: 0, parameters: 8, returns: 0 },
  { name: 'authorize_initial_loadout_v6', typeParameters: 1, parameters: 11, returns: 1 },
  { name: 'authorize_loadout_v6', typeParameters: 1, parameters: 11, returns: 1 },
  { name: 'claim_free_soul_item_v6', typeParameters: 1, parameters: 10, returns: 0 },
  { name: 'composition_protocol_version_v6', typeParameters: 0, parameters: 0, returns: 1 },
  { name: 'consume_initial_loadout_authorization_v6', typeParameters: 0, parameters: 1, returns: 10 },
  { name: 'consume_loadout_authorization_v6', typeParameters: 0, parameters: 1, returns: 10 },
  { name: 'loadout_selection_owned_instance_id_v6', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'loadout_selection_subject_kind_v6', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'lock_owned_item_to_soul_v6', typeParameters: 1, parameters: 9, returns: 0 },
  { name: 'profile_extensions_hash_v6', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'profile_id_v6', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'profile_loadout_mutable_v6', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'profile_mode_v6', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'profile_renderer_commitment_v6', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'profile_root_id_v6', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'profile_slot_schema_commitment_v6', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'purchase_soul_item_v6', typeParameters: 2, parameters: 12, returns: 0 },
  { name: 'subject_embedded_v6', typeParameters: 0, parameters: 0, returns: 1 },
  { name: 'subject_soul_v6', typeParameters: 0, parameters: 0, returns: 1 },
  { name: 'subject_wallet_v6', typeParameters: 0, parameters: 0, returns: 1 },
  { name: 'unlock_owned_item_from_soul_v6', typeParameters: 1, parameters: 9, returns: 0 },
]

export const REVIEWED_ANIMACRAFT_PHYSICAL_V7_FUNCTIONS:
  ReadonlyArray<ReviewedFunctionShape> = [
  { name: 'assert_physical_profile_binding_v7', typeParameters: 0, parameters: 5, returns: 0 },
  { name: 'assert_wardrobe_transferable_v7', typeParameters: 0, parameters: 2, returns: 0 },
  { name: 'claim_initial_included_style_v7', typeParameters: 0, parameters: 8, returns: 0 },
  { name: 'create_soul_wardrobe_v7', typeParameters: 1, parameters: 12, returns: 1 },
  { name: 'deposit_and_equip_style_v7', typeParameters: 1, parameters: 13, returns: 0 },
  { name: 'deposit_and_swap_style_v7', typeParameters: 1, parameters: 14, returns: 0 },
  { name: 'emergency_unequip_and_withdraw_style_v7', typeParameters: 1, parameters: 7, returns: 0 },
  { name: 'equip_style_v7', typeParameters: 1, parameters: 12, returns: 0 },
  { name: 'finalize_soul_wardrobe_v7', typeParameters: 1, parameters: 6, returns: 0 },
  { name: 'physical_profile_id_v7', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'set_wardrobe_listed_v7', typeParameters: 1, parameters: 7, returns: 0 },
  { name: 'swap_style_v7', typeParameters: 1, parameters: 13, returns: 0 },
  { name: 'unequip_style_v7', typeParameters: 1, parameters: 11, returns: 0 },
  { name: 'wardrobe_id_v7', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'wardrobe_listed_v7', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'wardrobe_profile_id_v7', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'wardrobe_revision_v7', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'wardrobe_root_id_v7', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'wardrobe_soul_id_v7', typeParameters: 0, parameters: 1, returns: 1 },
  { name: 'withdraw_style_v7', typeParameters: 1, parameters: 7, returns: 0 },
]

const REVIEWED_ANIMACRAFT_COMMERCE_V5_STRUCTS = [
  'MakerRootV5',
  'CommerceProtocolConfigV5',
  'CommerceV5SoulMintAuthorization',
] as const

const REVIEWED_ANIMACRAFT_COMPOSITION_V6_STRUCTS = [
  'CompositionProtocolConfigV6',
  'CompositionProtocolTreasuryV6',
  'CompositionRegistryV6',
  'InitialLoadoutAuthorizationV6',
  'ItemProductV6',
  'LoadoutAuthorizationV6',
  'LoadoutSelectionV6',
  'MakerProfileV6',
  'OwnedItemV6',
] as const

const REVIEWED_ANIMACRAFT_PHYSICAL_V7_STRUCTS = [
  'InitialPhysicalLoadoutAuthorizationV7',
  'MakerPhysicalProfileV7',
  'PhysicalProtocolConfigV7',
  'PhysicalRegistryV7',
  'SoulWardrobeV7',
  'StyleAssetV7',
  'StyleProductV7',
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

function assertReviewedStructOrigin(
  value: unknown,
  input: { name: string; module: string; definingPackage: string },
): void {
  if (!value || typeof value !== 'object') {
    throw new Error(`${input.name} returned no normalized ABI`)
  }
  const record = value as Record<string, unknown>
  if (
    normalizeSuiAddress(String(record.definingId ?? '0x0'))
      !== normalizeSuiAddress(input.definingPackage)
    || record.module !== input.module
    || record.name !== input.name
  ) {
    throw new Error(`${input.name} does not originate from reviewed ${input.module}`)
  }
}

export async function assertReviewedAnimacraftMainnetAbi(input: {
  client: MoveFunctionClient
  dependencies: string[]
}): Promise<void> {
  const reviewedPackage = normalizeSuiAddress(
    ANIMACRAFT_COMPOSABLE_V6_MAINNET_PACKAGE_ID,
  )
  const matches = input.dependencies.filter(
    (dependency) => normalizeSuiAddress(dependency) === reviewedPackage,
  )
  if (matches.length !== 1) {
    throw new Error(
      'Final Soulidity publish dependencies do not contain exactly one '
        + 'reviewed Animacraft Composable v6 package.',
    )
  }

  try {
    const [
      v5Functions,
      v5Structs,
      v6Functions,
      v6Structs,
      v7Functions,
      v7Structs,
    ] = await Promise.all([
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
      Promise.all(REVIEWED_ANIMACRAFT_COMPOSITION_V6_FUNCTIONS.map(
        async (expected) => ({
          expected,
          value: await input.client.getNormalizedMoveFunction({
            package: reviewedPackage,
            module: 'composition_v6',
            function: expected.name,
          }),
        }),
      )),
      Promise.all(REVIEWED_ANIMACRAFT_COMPOSITION_V6_STRUCTS.map(
        async (name) => ({
          name,
          value: await input.client.getNormalizedMoveStruct({
            package: reviewedPackage,
            module: 'composition_v6',
            struct: name,
          }),
        }),
      )),
      Promise.all(REVIEWED_ANIMACRAFT_PHYSICAL_V7_FUNCTIONS.map(
        async (expected) => ({
          expected,
          value: await input.client.getNormalizedMoveFunction({
            package: reviewedPackage,
            module: 'physical_v7',
            function: expected.name,
          }),
        }),
      )),
      Promise.all(REVIEWED_ANIMACRAFT_PHYSICAL_V7_STRUCTS.map(
        async (name) => ({
          name,
          value: await input.client.getNormalizedMoveStruct({
            package: reviewedPackage,
            module: 'physical_v7',
            struct: name,
          }),
        }),
      )),
    ])
    for (const { expected, value } of [
      ...v5Functions,
      ...v6Functions,
      ...v7Functions,
    ]) {
      assertReviewedFunctionShape(value, expected)
    }
    for (const { name, value } of v5Structs) {
      assertReviewedStructOrigin(value, {
        name,
        module: 'commerce_v5',
        definingPackage: ANIMACRAFT_COMMERCE_V5_MAINNET_PACKAGE_ID,
      })
    }
    for (const { name, value } of v6Structs) {
      assertReviewedStructOrigin(value, {
        name,
        module: 'composition_v6',
        definingPackage: ANIMACRAFT_COMPOSABLE_V6_MAINNET_PACKAGE_ID,
      })
    }
    for (const { name, value } of v7Structs) {
      assertReviewedStructOrigin(value, {
        name,
        module: 'physical_v7',
        definingPackage: reviewedPackage,
      })
    }
  } catch (cause) {
    throw new Error(
      `Reviewed Animacraft v5/v6/v7 ABI is unavailable on Mainnet: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    )
  }
}
