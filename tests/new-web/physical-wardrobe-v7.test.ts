import { describe, expect, it } from 'vitest'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import {
  PhysicalWardrobeV7DisabledError,
  assertPhysicalWardrobeV7Runtime,
  fetchPhysicalWardrobeV7Snapshot,
  parsePhysicalSoulWardrobeV7Object,
  parsePhysicalStyleAssetV7Object,
  physicalPartPolicyV7AcceptsAsset,
  physicalPartPolicyV7CanUnequip,
  physicalWardrobeV7OperationReadbackMatches,
  physicalWardrobeV7SlotKeys,
  physicalWardrobeV7CreatedEventType,
  type PhysicalWardrobeV7Runtime,
} from '../../packages/soulidity-sdk/src/physical-wardrobe-v7'
import {
  buildCreatePhysicalSoulWardrobeV7Tx,
  buildDepositAndEquipPhysicalStyleV7Tx,
  buildDepositAndSwapPhysicalStyleV7Tx,
  buildEmergencyWithdrawPhysicalStyleV7Tx,
  buildEquipPhysicalStyleV7Tx,
  buildSwapPhysicalStyleV7Tx,
  buildTransferOwnedPhysicalStyleV7Tx,
  buildUnequipPhysicalStyleV7Tx,
  buildWithdrawPhysicalStyleV7Tx,
} from '../../packages/soulidity-sdk/src/tx/physical-wardrobe-v7'
import {
  PhysicalRendererV7IntegrityError,
  resolvePhysicalRendererV7Scene,
} from '../../packages/soulidity-sdk/src/physical-renderer-v7'

const id = (value: number) => `0x${value.toString(16)}`

const runtime: PhysicalWardrobeV7Runtime = {
  enabled: true,
  soulidityCallablePackageId: id(1),
  soulidityTypeOriginPackageId: id(2),
  animacraftCallablePackageId: id(3),
  animacraftTypeOriginPackageId: id(4),
  physicalRegistryObjectId: id(5),
  physicalProtocolConfigObjectId: id(6),
  compositionProtocolConfigObjectId: id(19),
  commerceProtocolConfigObjectId: id(7),
}

const maker = {
  physicalProfileObjectId: id(8),
  compositionProfileObjectId: id(20),
  makerRootObjectId: id(9),
}

const soul = {
  soulObjectId: id(10),
  soulStateObjectId: id(11),
  wardrobeObjectId: id(12),
  expectedRevision: 3n,
}

describe('physical wardrobe v7 runtime', () => {
  it('fails closed until the explicit deployment gate is enabled', () => {
    expect(() => assertPhysicalWardrobeV7Runtime({ ...runtime, enabled: false }))
      .toThrow(PhysicalWardrobeV7DisabledError)
    expect(() => assertPhysicalWardrobeV7Runtime({ ...runtime, animacraftCallablePackageId: '' }))
      .toThrow('Missing Animacraft v7 callable package ID')
  })

  it('builds the exact v5-row authorization before owner-proof adapter mutations', async () => {
    const create = await buildCreatePhysicalSoulWardrobeV7Tx({
      runtime,
      maker,
      soulStateObjectId: soul.soulStateObjectId,
      recipe: [
        {
          partKey: 'hair',
          itemKey: 'hair/long',
          colorHex: '#000000',
          renderOrder: 0,
        },
        {
          partKey: 'palette',
          itemKey: 'palette/blue',
          colorHex: '#0000ff',
          renderOrder: 1,
        },
      ],
      styleSelections: [
        { partKey: 'hair', itemKey: 'hair/long', styleKey: 'hair/long/blue' },
        { partKey: 'palette', itemKey: 'palette/blue', styleKey: 'blue' },
      ],
      initialRows: [
        {
          kind: 'visual',
          familyObjectId: id(21),
          styleProductObjectId: id(22),
        },
        { kind: 'logical' },
      ],
    })
    const deposit = buildDepositAndEquipPhysicalStyleV7Tx({
      runtime,
      maker,
      soul,
      styleProductObjectId: id(13),
      walletStyleAssetObjectId: id(14),
    })
    const withdraw = buildWithdrawPhysicalStyleV7Tx({
      runtime,
      maker,
      soul,
      wardrobeStyleAssetObjectId: id(14),
    })

    const commands = [create, deposit, withdraw].map((tx) => tx.getData().commands)
    // Two canonical RecipeSlot constructors + begin + visual/logical rows +
    // seal + create + claim + finalize. Logical v5 rows are authenticated
    // even though they deliberately mint no physical asset.
    expect(commands[0]).toHaveLength(10)
    expect(commands[1]).toHaveLength(1)
    expect(commands[2]).toHaveLength(1)
    expect(JSON.stringify(commands[0])).toContain('begin_initial_physical_loadout_authorization_v7')
    expect(JSON.stringify(commands[0])).toContain('append_initial_style_to_authorization_v7')
    expect(JSON.stringify(commands[0])).toContain('append_initial_logical_style_to_authorization_v7')
    expect(JSON.stringify(commands[0])).toContain('seal_initial_physical_loadout_authorization_v7')
    expect(JSON.stringify(commands[0])).toContain('animacraft_wardrobe_adapter_v7')
    expect(JSON.stringify(commands[0])).toContain('claim_initial_included_style_v7')
    expect(JSON.stringify(commands[0])).toContain('finalize_soul_wardrobe_v7')
    expect(JSON.stringify(commands[1])).toContain('deposit_and_equip_style_v7')
    expect(JSON.stringify(commands[2])).toContain('withdraw_style_v7')
    expect(JSON.stringify(commands)).not.toContain('physical_composition_v7::deposit')
  })

  it('builds every reviewed wardrobe mutation against the Soulidity owner-proof adapter', () => {
    const transactions = [
      buildDepositAndSwapPhysicalStyleV7Tx({
        runtime,
        maker,
        soul,
        styleProductObjectId: id(13),
        walletStyleAssetObjectId: id(14),
        equippedStyleAssetObjectId: id(15),
      }),
      buildEquipPhysicalStyleV7Tx({
        runtime,
        maker,
        soul,
        styleProductObjectId: id(13),
        wardrobeStyleAssetObjectId: id(14),
      }),
      buildSwapPhysicalStyleV7Tx({
        runtime,
        maker,
        soul,
        styleProductObjectId: id(13),
        wardrobeStyleAssetObjectId: id(14),
        equippedStyleAssetObjectId: id(15),
      }),
      buildUnequipPhysicalStyleV7Tx({
        runtime,
        maker,
        soul,
        equippedStyleAssetObjectId: id(15),
      }),
      buildEmergencyWithdrawPhysicalStyleV7Tx({
        runtime,
        maker,
        soul,
        equippedStyleAssetObjectId: id(15),
      }),
    ]
    const targets = [
      'deposit_and_swap_style_v7',
      'equip_style_v7',
      'swap_style_v7',
      'unequip_style_v7',
      'emergency_unequip_and_withdraw_style_v7',
    ]

    transactions.forEach((tx, index) => {
      const commands = tx.getData().commands
      expect(commands).toHaveLength(1)
      expect(JSON.stringify(commands)).toContain('animacraft_wardrobe_adapter_v7')
      expect(JSON.stringify(commands)).toContain(targets[index])
    })
  })

  it('rejects stale or malformed mutation inputs before wallet signing', () => {
    expect(() => buildEquipPhysicalStyleV7Tx({
      runtime,
      maker,
      soul: { ...soul, expectedRevision: -1 },
      styleProductObjectId: id(13),
      wardrobeStyleAssetObjectId: id(14),
    })).toThrow('expectedRevision')
    expect(() => buildWithdrawPhysicalStyleV7Tx({
      runtime,
      maker,
      soul,
      wardrobeStyleAssetObjectId: '',
    })).toThrow('wardrobeStyleAssetObjectId is required')
  })

  it('rejects incomplete initial row projections before mint construction', async () => {
    await expect(buildCreatePhysicalSoulWardrobeV7Tx({
      runtime,
      maker,
      soulStateObjectId: soul.soulStateObjectId,
      recipe: [{
        partKey: 'hair',
        itemKey: 'hair/long',
        colorHex: '#000000',
        renderOrder: 0,
      }],
      styleSelections: [{
        partKey: 'hair',
        itemKey: 'hair/long',
        styleKey: 'hair/long/blue',
      }],
      initialRows: [],
    })).rejects.toThrow('cover every v5 Recipe row')
  })

  it('builds only the reviewed direct gift ABI for an unbound wallet Style', () => {
    const transfer = buildTransferOwnedPhysicalStyleV7Tx({
      runtime,
      styleAssetObjectId: id(14),
      recipient: id(18),
    })
    const commands = transfer.getData().commands
    expect(commands).toHaveLength(1)
    expect(JSON.stringify(commands)).toContain('physical_composition_v7')
    expect(JSON.stringify(commands)).toContain('transfer_owned_style_v7')
    expect(JSON.stringify(commands)).not.toContain('animacraft_wardrobe_adapter_v7')
    expect(JSON.stringify(commands)).not.toMatch(/price|coin|kiosk|royalt/i)
  })

  it('rejects zero-address gift recipients before a transaction is built', () => {
    expect(() => buildTransferOwnedPhysicalStyleV7Tx({
      runtime,
      styleAssetObjectId: id(14),
      recipient: id(0),
    })).toThrow('zero address')
  })
})

describe('physical wardrobe v7 object parsing', () => {
  const wardrobeFixture = {
    data: {
      objectId: id(12),
      content: {
        dataType: 'moveObject',
        fields: {
          version: '7',
          config_id: id(6),
          profile_id: id(8),
          root_id: id(9),
          soul_id: id(10),
          slot_schema_commitment: [1, 2, 3],
          revision: '4',
          initialized: true,
          listed: false,
          equipped_asset_ids: [id(14)],
          external_asset_count: '0',
          soul_local_asset_count: '1',
          equipped_count: '1',
        },
      },
    },
  }

  const styleAssetFixture = {
    data: {
      objectId: id(14),
      display: { data: { name: 'Midnight Blue', image_url: 'https://example.com/style.png' } },
      content: {
        dataType: 'moveObject',
        fields: {
          version: '7',
          config_id: id(6),
          profile_id: id(8),
          family_id: id(15),
          style_product_id: id(13),
          v6_product_id: id(16),
          original_creator: id(17),
          slot_key: 'hair.front',
          source_kind: 1,
          asset_kind: 0,
          serial: '42',
          transferable: true,
          holder: id(0),
          bound_soul_id: { vec: [id(10)] },
          ownership_epoch: '0',
          required_v6_product_ids: [],
          excluded_v6_product_ids: [],
        },
      },
    },
  }

  const physicalProfileFixture = {
    data: {
      objectId: id(8),
      content: {
        dataType: 'moveObject',
        fields: {
          version: '7',
          config_id: id(6),
          v6_profile_id: id(20),
          root_id: id(9),
          slot_schema_commitment: [1, 2, 3],
          renderer_commitment: [4, 5, 6],
          part_policies: { fields: { id: { id: id(23) }, size: '2' } },
          required_slot_keys: ['hair.front'],
          part_policy_count: '2',
          sealed: true,
        },
      },
    },
  }

  const partPolicyFixture = (
    objectId: string,
    slotKey: string,
    required: boolean,
  ) => ({
    data: {
      objectId,
      content: {
        dataType: 'moveObject',
        fields: {
          name: { fields: { slot_key: slotKey } },
          value: {
            fields: {
              slot_key: slotKey,
              behavior: '3',
              required,
              max_source_kind: '2',
            },
          },
        },
      },
    },
  })

  it('uses the exact SoulWardrobeCreatedV7 event type', () => {
    expect(physicalWardrobeV7CreatedEventType(runtime)).toContain(
      '::physical_composition_v7::SoulWardrobeCreatedV7',
    )
  })

  it('parses the exact snake_case SoulWardrobeV7 fields', () => {
    const wardrobe = parsePhysicalSoulWardrobeV7Object(wardrobeFixture)
    expect(wardrobe.revision).toBe(4n)
    expect(wardrobe.rootObjectId).toBe(normalizeSuiAddress(id(9)))
    expect(wardrobe.externalAssetCount).toBe(0)
    expect(wardrobe.soulLocalAssetCount).toBe(1)
    expect(wardrobe.equippedAssetObjectIds).toHaveLength(1)
    expect(wardrobe.loadout).toEqual([])
  })

  it('keeps Style as the concrete wallet/Soul asset and has no Smart Color field', () => {
    const asset = parsePhysicalStyleAssetV7Object(styleAssetFixture)
    expect(asset.name).toBe('hair.front Style')
    expect(asset.imageUrl).toBeNull()
    expect(asset.itemFamilyObjectId).not.toBeNull()
    expect(asset.assetKind).toBe(0)
    expect(asset.soulLocal).toBe(true)
    expect(asset.equipped).toBe(false)
    expect('smartColor' in asset).toBe(false)
  })

  it('derives equipped/loadout state by joining equipped_asset_ids to child assets', async () => {
    let ownedCall = 0
    const snapshot = await fetchPhysicalWardrobeV7Snapshot({
      getDynamicFieldObject: async ({ name }: { name: { value: number } }) => ({
        data: name.value === 4 ? {
          content: {
            dataType: 'moveObject',
            fields: { value: id(12) },
          },
        } : null,
      }),
      getObject: async ({ id: objectId }: { id: string }) => {
        if (normalizeSuiAddress(objectId) === normalizeSuiAddress(id(12))) return wardrobeFixture
        if (normalizeSuiAddress(objectId) === normalizeSuiAddress(id(8))) return physicalProfileFixture
        if (normalizeSuiAddress(objectId) === normalizeSuiAddress(id(24))) {
          return partPolicyFixture(id(24), 'hair.front', true)
        }
        if (normalizeSuiAddress(objectId) === normalizeSuiAddress(id(25))) {
          return partPolicyFixture(id(25), 'accessory', false)
        }
        throw new Error(`Unexpected object ${objectId}`)
      },
      getDynamicFields: async () => ({
        data: [{ objectId: id(24) }, { objectId: id(25) }],
        hasNextPage: false,
        nextCursor: null,
      }),
      getOwnedObjects: async () => {
        ownedCall += 1
        return {
          data: ownedCall === 1 ? [styleAssetFixture] : [],
          hasNextPage: false,
          nextCursor: null,
        }
      },
    } as never, runtime, {
      soulObjectId: id(10),
      soulStateObjectId: id(11),
      walletAddress: id(18),
    })

    expect(snapshot?.wardrobeAssets[0]?.equipped).toBe(true)
    expect(snapshot?.maker.compositionProfileObjectId).toBe(normalizeSuiAddress(id(20)))
    expect(snapshot?.maker.partPolicies).toEqual([
      expect.objectContaining({ slotKey: 'accessory', required: false, behavior: 3 }),
      expect.objectContaining({ slotKey: 'hair.front', required: true, behavior: 3 }),
    ])
    expect(physicalWardrobeV7SlotKeys(snapshot!)).toEqual(['accessory', 'hair.front'])
    expect(snapshot?.wardrobe.loadout).toEqual([expect.objectContaining({
      slotKey: 'hair.front',
      soulLocal: true,
    })])
    const hairPolicy = snapshot?.maker.partPolicies.find((policy) => policy.slotKey === 'hair.front')
    const accessoryPolicy = snapshot?.maker.partPolicies.find((policy) => policy.slotKey === 'accessory')
    expect(physicalPartPolicyV7AcceptsAsset(hairPolicy, snapshot!.wardrobeAssets[0]!)).toBe(true)
    expect(physicalPartPolicyV7AcceptsAsset(
      { slotKey: 'hair.front', behavior: 0, required: true, maxSourceKind: 0 },
      snapshot!.wardrobeAssets[0]!,
    )).toBe(false)
    expect(physicalPartPolicyV7AcceptsAsset(
      hairPolicy,
      { ...snapshot!.wardrobeAssets[0]!, slotKey: 'another.slot' },
    )).toBe(false)
    expect(physicalPartPolicyV7CanUnequip(hairPolicy)).toBe(false)
    expect(physicalPartPolicyV7CanUnequip(accessoryPolicy)).toBe(true)
    expect(physicalWardrobeV7OperationReadbackMatches(
      snapshot!,
      'equip',
      id(14),
      3n,
    )).toBe(true)

    const replacementAsset = {
      ...snapshot!.wardrobeAssets[0]!,
      objectId: normalizeSuiAddress(id(16)),
      styleProductObjectId: normalizeSuiAddress(id(17)),
      equipped: true,
    }
    const swappedSnapshot = {
      ...snapshot!,
      wardrobe: {
        ...snapshot!.wardrobe,
        revision: 5n,
        equippedAssetObjectIds: [replacementAsset.objectId],
        loadout: snapshot!.wardrobe.loadout.map((row) => ({
          ...row,
          styleAssetObjectId: replacementAsset.objectId,
        })),
      },
      wardrobeAssets: [
        { ...snapshot!.wardrobeAssets[0]!, equipped: false },
        replacementAsset,
      ],
      walletAssets: [],
    }
    expect(physicalWardrobeV7OperationReadbackMatches(
      swappedSnapshot,
      'swap',
      replacementAsset.objectId,
      4n,
      id(14),
    )).toBe(true)
    expect(physicalWardrobeV7OperationReadbackMatches(
      swappedSnapshot,
      'swap',
      replacementAsset.objectId,
      4n,
    )).toBe(false)
    expect(physicalWardrobeV7OperationReadbackMatches(
      {
        ...swappedSnapshot,
        wardrobeAssets: [replacementAsset],
      },
      'swap',
      replacementAsset.objectId,
      4n,
      id(14),
    )).toBe(false)

    const unequippedSnapshot = {
      ...snapshot!,
      wardrobe: {
        ...snapshot!.wardrobe,
        revision: 5n,
        equippedCount: 0,
        equippedAssetObjectIds: [],
        loadout: [],
      },
      wardrobeAssets: snapshot!.wardrobeAssets.map((asset) => ({ ...asset, equipped: false })),
    }
    expect(physicalWardrobeV7OperationReadbackMatches(
      unequippedSnapshot,
      'unequip',
      id(14),
      4n,
    )).toBe(true)

    const withdrawnSnapshot = {
      ...unequippedSnapshot,
      wardrobe: { ...unequippedSnapshot.wardrobe, revision: 6n },
      wardrobeAssets: [],
      walletAssets: snapshot!.wardrobeAssets.map((asset) => ({ ...asset, equipped: false })),
    }
    expect(physicalWardrobeV7OperationReadbackMatches(
      withdrawnSnapshot,
      'withdraw',
      id(14),
      5n,
    )).toBe(true)
    expect(physicalWardrobeV7OperationReadbackMatches(
      withdrawnSnapshot,
      'withdraw',
      id(14),
      6n,
    )).toBe(false)
    expect(physicalWardrobeV7OperationReadbackMatches(
      {
        ...withdrawnSnapshot,
        wardrobe: { ...withdrawnSnapshot.wardrobe, listed: true, revision: 7n },
      },
      'withdraw',
      id(14),
      6n,
    )).toBe(false)
  })
})

async function hash(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', value)
  return Array.from(new Uint8Array(digest), (entry) => entry.toString(16).padStart(2, '0')).join('')
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(source).sort().map((key) => [key, stableValue(source[key])]),
  )
}

async function stableHash(value: unknown): Promise<string> {
  return hash(jsonBytes(stableValue(value)))
}

function png(width: number, height: number): Uint8Array {
  const value = new Uint8Array(24)
  value.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  value.set([73, 72, 68, 82], 12)
  new DataView(value.buffer).setUint32(16, width)
  new DataView(value.buffer).setUint32(20, height)
  return value
}

function moveObject(objectId: string, module: string, name: string, fields: Record<string, unknown>) {
  return {
    data: {
      objectId,
      content: {
        dataType: 'moveObject',
        type: `${normalizeSuiAddress(runtime.animacraftTypeOriginPackageId)}::${module}::${name}`,
        fields,
      },
    },
  }
}

async function rendererFixture() {
  const physicalProfileObjectId = id(30)
  const compositionProfileObjectId = id(31)
  const makerRootObjectId = id(32)
  const legacyMakerObjectId = id(33)
  const styleAssetObjectId = id(34)
  const styleProductObjectId = id(35)
  const v6ProductObjectId = id(36)
  const familyObjectId = id(37)
  const slotCommitment = '11'.repeat(32)
  const rendererCommitment = '22'.repeat(32)
  const imageBytes = png(2, 3)
  const imageHash = await hash(imageBytes)
  const component = {
    id: 'body-main',
    layerTrackId: 'body',
    assetHash: imageHash,
    assetWidth: 2,
    assetHeight: 3,
    transform: {
      x: 4,
      y: 5,
      scale: 1,
      rotation: 0,
      opacity: 1,
      blendMode: 'normal',
    },
    baseSource: null,
  }
  const contentCommitment = await stableHash({
    schemaVersion: 'animacraft.item-content.v6',
    components: [{
      layerTrackId: component.layerTrackId,
      assetHash: component.assetHash,
      assetWidth: component.assetWidth,
      assetHeight: component.assetHeight,
      transform: component.transform,
      baseSource: component.baseSource,
    }],
  })
  const definition = stableValue({
    schemaVersion: 'animacraft.item-product-definition.v6',
    id: 'late-external-body',
    version: 1,
    parentVersionId: null,
    makerRootId: makerRootObjectId,
    compatibilityHash: slotCommitment,
    creator: id(40),
    publisher: id(40),
    originClass: 'CERTIFIED',
    display: {
      name: 'Verified Body',
      description: 'Immutable test Style',
      thumbnailHash: '',
    },
    components: [component],
    contentHash: contentCommitment,
    slotClaims: [{ slotId: 'body', units: 1 }],
    requires: [],
    excludes: [],
    rightsOrigin: 'LICENSE_WRAPPED',
    rightsManifestHash: '55'.repeat(32),
    access: {
      mode: 'FREE_CLAIM',
      binding: 'OWNED',
      priceAtomic: 0,
      transferable: true,
    },
    makerEcosystemFeeBps: 0,
    extensionsHash: '66'.repeat(32),
  })
  const definitionBytes = jsonBytes(definition)
  const definitionCommitment = await hash(definitionBytes)
  const baseManifest = {
    schemaVersion: 'animacraft.maker.v5',
    version: { rootMakerId: 'maker-root', versionId: 'release-1', number: 1 },
    parts: [],
    assets: [],
  }
  const baseBytes = jsonBytes(baseManifest)
  const baseHash = await hash(baseBytes)
  const companion = {
    schemaVersion: 'animacraft.maker-composable.v6',
    baseMaker: {
      makerRootId: makerRootObjectId,
      manifestHash: baseHash,
      manifestSchemaVersion: 'animacraft.maker.v5',
      rootMakerId: 'maker-root',
      versionId: 'release-1',
      versionNumber: 1,
    },
    compatibility: {
      manifestHash: slotCommitment,
      renderer: { commitment: rendererCommitment },
      canvas: { width: 64, height: 64 },
      coordinate: { origin: 'TOP_LEFT', unit: 'PIXEL', pixelMode: false },
      layerTrackIds: ['body'],
      slots: [{ id: 'body', layerTrackIds: ['body'] }],
    },
    // A Certified/Open Style may be admitted after the immutable companion
    // was published. Its executable definition is resolved from Sui instead.
    items: [],
  }
  const companionBytes = jsonBytes(companion)
  const companionHash = await hash(companionBytes)
  const objects = new Map<string, unknown>([
    [normalizeSuiAddress(physicalProfileObjectId), moveObject(
      physicalProfileObjectId,
      'physical_composition_v7',
      'MakerPhysicalProfileV7',
      {
        root_id: makerRootObjectId,
        v6_profile_id: compositionProfileObjectId,
        slot_schema_commitment: slotCommitment,
        renderer_commitment: rendererCommitment,
        sealed: true,
      },
    )],
    [normalizeSuiAddress(compositionProfileObjectId), moveObject(
      compositionProfileObjectId,
      'composition_v6',
      'MakerProfileV6',
      {
        root_id: makerRootObjectId,
        companion_manifest_blob_id: 'companion-blob',
        companion_manifest_hash: companionHash,
        slot_schema_commitment: slotCommitment,
        renderer_commitment: rendererCommitment,
        sealed: true,
      },
    )],
    [normalizeSuiAddress(makerRootObjectId), moveObject(
      makerRootObjectId,
      'commerce_v5',
      'MakerRootV5',
      { legacy_maker_id: legacyMakerObjectId },
    )],
    [normalizeSuiAddress(legacyMakerObjectId), moveObject(
      legacyMakerObjectId,
      'animacraft',
      'OCMaker',
      { manifest_blob_id: 'base-quilt', published: true },
    )],
    [normalizeSuiAddress(v6ProductObjectId), moveObject(
      v6ProductObjectId,
      'composition_v6',
      'ItemProductV6',
      {
        source_root_id: { vec: [] },
        origin_kind: 1,
        definition_commitment: definitionCommitment,
        asset_commitment: contentCommitment,
        slot_key: 'body',
        slot_schema_commitment: slotCommitment,
      },
    )],
    [normalizeSuiAddress(styleProductObjectId), moveObject(
      styleProductObjectId,
      'physical_composition_v7',
      'StyleProductV7',
      {
        profile_id: physicalProfileObjectId,
        v6_profile_id: compositionProfileObjectId,
        v6_product_id: v6ProductObjectId,
        slot_key: 'body',
        label: 'Verified Body Style',
        definition_commitment: definitionCommitment,
        asset_commitment: contentCommitment,
        definition_blob_id: 'late-definition-blob',
        definition_identifier: '',
        asset_blob_id: 'component-blob',
        asset_identifier: '',
        renderer_commitment: rendererCommitment,
      },
    )],
  ])
  const snapshot = {
    wardrobe: {
      objectId: id(38),
      soulObjectId: id(39),
      rootObjectId: makerRootObjectId,
      profileObjectId: physicalProfileObjectId,
      revision: 1n,
      initialized: true,
      listed: false,
      externalAssetCount: 1,
      soulLocalAssetCount: 0,
      equippedCount: 1,
      equippedAssetObjectIds: [styleAssetObjectId],
      loadout: [{
        slotKey: 'body',
        styleAssetObjectId,
        styleProductObjectId,
        itemFamilyObjectId: familyObjectId,
        soulLocal: false,
      }],
    },
    maker: {
      physicalProfileObjectId,
      compositionProfileObjectId,
      makerRootObjectId,
      sealed: true,
      partPoliciesTableObjectId: id(41),
      requiredSlotKeys: [],
      partPolicyCount: 1,
      partPolicies: [{
        slotKey: 'body',
        behavior: 3 as const,
        required: false,
        maxSourceKind: 2 as const,
      }],
    },
    wardrobeAssets: [{
      objectId: styleAssetObjectId,
      styleProductObjectId,
      itemFamilyObjectId: familyObjectId,
      profileObjectId: physicalProfileObjectId,
      v6ProductObjectId,
      slotKey: 'body',
      sourceKind: 1,
      assetKind: 0,
      soulLocal: false,
      transferable: true,
      serial: 1n,
      holderAddress: null,
      equipped: true,
      name: 'untrusted fallback',
      imageUrl: null,
    }],
    walletAssets: [],
  }
  const client = {
    getObject: async ({ id: objectId }: { id: string }) => {
      const result = objects.get(normalizeSuiAddress(objectId))
      if (!result) throw new Error(`Unexpected Sui object ${objectId}`)
      return result
    },
  }
  const fetcher = async (input: RequestInfo | URL) => {
    const url = String(input)
    const bytes = url.includes('companion-blob')
      ? companionBytes
      : url.includes('late-definition-blob')
        ? definitionBytes
      : url.includes('animacraft-manifest.json')
        ? baseBytes
        : url.includes('component-blob')
          ? imageBytes
          : null
    if (!bytes) return new Response(null, { status: 404 })
    return new Response(bytes.slice(), {
      status: 200,
      headers: { 'content-length': String(bytes.byteLength) },
    })
  }
  return { client, snapshot, fetcher, imageBytes }
}

describe('physical wardrobe v7 canonical renderer', () => {
  it('renders a late external Style absent from companion.items via its chain locator', async () => {
    const fixture = await rendererFixture()
    const scene = await resolvePhysicalRendererV7Scene(
      fixture.client as never,
      runtime,
      fixture.snapshot,
      fixture.fetcher,
    )
    expect(scene.layers).toEqual([expect.objectContaining({
      slotKey: 'body',
      styleName: 'Verified Body Style',
      expectedAssetHash: await hash(fixture.imageBytes),
      integrity: 'sha256',
    })])
    expect(scene.assetMetadata[id(34)]?.verified).toBe(true)
  })

  it('fails closed when the immutable PNG bytes are substituted', async () => {
    const fixture = await rendererFixture()
    const tamperedFetcher = async (input: RequestInfo | URL) => {
      if (String(input).includes('component-blob')) {
        const tampered = fixture.imageBytes.slice()
        tampered[8] = 1
        return new Response(tampered)
      }
      return fixture.fetcher(input)
    }
    await expect(resolvePhysicalRendererV7Scene(
      fixture.client as never,
      runtime,
      fixture.snapshot,
      tamperedFetcher,
    )).rejects.toBeInstanceOf(PhysicalRendererV7IntegrityError)
  })
})
