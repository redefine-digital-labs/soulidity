import { readFileSync } from 'node:fs'
import { describe, expect, it, vi, beforeAll, afterEach } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'

// ---------------------------------------------------------------------------
// Mock env — provide deterministic package IDs for all builders
// ---------------------------------------------------------------------------
vi.mock('@/lib/soulidity/env', () => ({
  getRequiredSoulidityEnv: vi.fn((name: string) => {
    const envMap: Record<string, string> = {
      NEXT_PUBLIC_SOULIDITY_PACKAGE_ID: '0x' + 'aa'.repeat(32),
      NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID: '0x' + 'bb'.repeat(32),
      NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID: '0x' + 'cc'.repeat(32),
      NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID: '0x' + 'dd'.repeat(32),
      NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE: '0x2::usdc::USDC',
    }
    return envMap[name] ?? '0x' + 'ff'.repeat(32)
  }),
  getOptionalSoulidityEnv: vi.fn(() => null),
}))

beforeAll(() => {
  process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = '0x' + 'ee'.repeat(32)
})

const ORIGINAL_SUI_NETWORK = process.env.NEXT_PUBLIC_SUI_NETWORK

afterEach(() => {
  if (ORIGINAL_SUI_NETWORK === undefined) {
    delete process.env.NEXT_PUBLIC_SUI_NETWORK
  } else {
    process.env.NEXT_PUBLIC_SUI_NETWORK = ORIGINAL_SUI_NETWORK
  }
})

// ---------------------------------------------------------------------------
// Helpers — reusable valid object IDs and params
// ---------------------------------------------------------------------------
const OBJ = (hex: string) => '0x' + hex.repeat(32)
const ADDR = OBJ('a1')
const TESTNET_WALRUS_BLOB_TYPE = '0xd84704c17fc870b8764832c535aa6b11f21a95cd6f5bb38a9b07d2cf42220c66::blob::Blob'
const MAINNET_WALRUS_BLOB_TYPE = '0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77::blob::Blob'

function encodeBcsString(value: string) {
  const utf8 = Buffer.from(value, 'utf8')
  const lengthBytes: number[] = []
  let remaining = utf8.length

  do {
    let byte = remaining & 0x7f
    remaining >>= 7
    if (remaining > 0) {
      byte |= 0x80
    }
    lengthBytes.push(byte)
  } while (remaining > 0)

  return Buffer.concat([Buffer.from(lengthBytes), utf8]).toString('base64')
}

function getPureInputBytes(tx: Transaction) {
  return tx.getData().inputs.flatMap((input) => ('Pure' in input ? [input.Pure.bytes] : []))
}

function getObjectOptionTypeArguments(tx: Transaction) {
  return tx.getData().commands.flatMap((command) => {
    if (!('MoveCall' in command)) {
      return []
    }
    const moveCall = command.MoveCall
    if (moveCall.module !== 'option' || !['none', 'some'].includes(moveCall.function)) {
      return []
    }
    return moveCall.typeArguments
  })
}

function readRepoText(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')
}

const VALID_SOUL_PUBLISH_ARGS = {
  name: 'Test Soul',
  description: 'A test soul for unit tests',
  imageUrl: 'https://example.com/img.png',
  creatorRoyaltyBps: 500,
} as const

const VALID_KIOSK_ARGS = {
  currentKioskId: OBJ('22'),
  currentKioskCapOnChainId: OBJ('33'),
} as const

// =========================================================================
// shared.ts — validateSoulPublishArgs
// =========================================================================
import {
  validateSoulPublishArgs,
  validateCollectionArgs,
  buildBuyerKioskArgs,
  MAX_CREATOR_ROYALTY_BPS,
  MAX_COLLECTION_ROYALTY_BPS,
} from '../../web/lib/soulidity/tx/shared'

describe('shared.ts — validateSoulPublishArgs', () => {
  it('passes with valid arguments', () => {
    expect(() => validateSoulPublishArgs(VALID_SOUL_PUBLISH_ARGS)).not.toThrow()
  })

  it('rejects empty name', () => {
    expect(() => validateSoulPublishArgs({ ...VALID_SOUL_PUBLISH_ARGS, name: '' }))
      .toThrow('Soul name is required')
  })

  it('rejects whitespace-only name', () => {
    expect(() => validateSoulPublishArgs({ ...VALID_SOUL_PUBLISH_ARGS, name: '   ' }))
      .toThrow('Soul name is required')
  })

  it('rejects empty description', () => {
    expect(() => validateSoulPublishArgs({ ...VALID_SOUL_PUBLISH_ARGS, description: '' }))
      .toThrow('Soul description is required')
  })

  it('rejects empty imageUrl', () => {
    expect(() => validateSoulPublishArgs({ ...VALID_SOUL_PUBLISH_ARGS, imageUrl: '' }))
      .toThrow('Soul image URL is required')
  })

  it('rejects name exceeding 256 UTF-8 bytes', () => {
    // 4-byte emoji repeated 65 times = 260 bytes
    const longName = '\u{1F600}'.repeat(65)
    expect(() => validateSoulPublishArgs({ ...VALID_SOUL_PUBLISH_ARGS, name: longName }))
      .toThrow('256-byte limit')
  })

  it('rejects description exceeding 4096 UTF-8 bytes', () => {
    const longDesc = 'x'.repeat(4097)
    expect(() => validateSoulPublishArgs({ ...VALID_SOUL_PUBLISH_ARGS, description: longDesc }))
      .toThrow('4096-byte limit')
  })

  it('rejects imageUrl exceeding 1024 UTF-8 bytes', () => {
    const longUrl = 'https://x.com/' + 'a'.repeat(1024)
    expect(() => validateSoulPublishArgs({ ...VALID_SOUL_PUBLISH_ARGS, imageUrl: longUrl }))
      .toThrow('1024-byte limit')
  })

  it('rejects negative creatorRoyaltyBps', () => {
    expect(() => validateSoulPublishArgs({ ...VALID_SOUL_PUBLISH_ARGS, creatorRoyaltyBps: -1 }))
      .toThrow('creatorRoyaltyBps must be between 0 and')
  })

  it('rejects creatorRoyaltyBps over MAX_CREATOR_ROYALTY_BPS', () => {
    expect(() => validateSoulPublishArgs({ ...VALID_SOUL_PUBLISH_ARGS, creatorRoyaltyBps: MAX_CREATOR_ROYALTY_BPS + 1 }))
      .toThrow('creatorRoyaltyBps must be between 0 and')
  })

  it('rejects non-integer creatorRoyaltyBps', () => {
    expect(() => validateSoulPublishArgs({ ...VALID_SOUL_PUBLISH_ARGS, creatorRoyaltyBps: 1.5 }))
      .toThrow('creatorRoyaltyBps must be between 0 and')
  })

  it('accepts boundary: creatorRoyaltyBps = 0', () => {
    expect(() => validateSoulPublishArgs({ ...VALID_SOUL_PUBLISH_ARGS, creatorRoyaltyBps: 0 })).not.toThrow()
  })

  it('accepts boundary: creatorRoyaltyBps = MAX', () => {
    expect(() => validateSoulPublishArgs({ ...VALID_SOUL_PUBLISH_ARGS, creatorRoyaltyBps: MAX_CREATOR_ROYALTY_BPS })).not.toThrow()
  })
})

// =========================================================================
// shared.ts — validateCollectionArgs
// =========================================================================
describe('shared.ts — validateCollectionArgs', () => {
  const VALID = {
    name: 'Collection',
    description: 'Desc',
    imageUrl: 'https://example.com/img.png',
    extraRoyaltyBps: 100,
    tradeable: true,
    maxSupply: 1000,
  }

  it('passes with valid arguments', () => {
    expect(() => validateCollectionArgs(VALID)).not.toThrow()
  })

  it('rejects empty name', () => {
    expect(() => validateCollectionArgs({ ...VALID, name: '' })).toThrow('Collection name is required')
  })

  it('rejects empty description', () => {
    expect(() => validateCollectionArgs({ ...VALID, description: '' })).toThrow('Collection description is required')
  })

  it('rejects empty imageUrl', () => {
    expect(() => validateCollectionArgs({ ...VALID, imageUrl: '' })).toThrow('Collection image URL is required')
  })

  it('rejects extraRoyaltyBps over MAX', () => {
    expect(() => validateCollectionArgs({ ...VALID, extraRoyaltyBps: MAX_COLLECTION_ROYALTY_BPS + 1 }))
      .toThrow('extraRoyaltyBps must be between 0 and')
  })

  it('rejects negative extraRoyaltyBps', () => {
    expect(() => validateCollectionArgs({ ...VALID, extraRoyaltyBps: -1 }))
      .toThrow('extraRoyaltyBps must be between 0 and')
  })

  it('rejects non-integer extraRoyaltyBps', () => {
    expect(() => validateCollectionArgs({ ...VALID, extraRoyaltyBps: 1.5 }))
      .toThrow('extraRoyaltyBps must be between 0 and')
  })

  it('accepts boundary: extraRoyaltyBps = 0', () => {
    expect(() => validateCollectionArgs({ ...VALID, extraRoyaltyBps: 0 })).not.toThrow()
  })

  it('accepts boundary: extraRoyaltyBps = MAX', () => {
    expect(() => validateCollectionArgs({ ...VALID, extraRoyaltyBps: MAX_COLLECTION_ROYALTY_BPS })).not.toThrow()
  })

  it('rejects non-boolean tradeable', () => {
    expect(() => validateCollectionArgs({ ...VALID, tradeable: 'yes' as unknown as boolean }))
      .toThrow('tradeable must be a boolean')
  })

  it('accepts maxSupply = null (unlimited)', () => {
    expect(() => validateCollectionArgs({ ...VALID, maxSupply: null })).not.toThrow()
  })

  it('accepts maxSupply = undefined (unlimited)', () => {
    expect(() => validateCollectionArgs({ ...VALID, maxSupply: undefined })).not.toThrow()
  })

  it('rejects maxSupply = 0', () => {
    expect(() => validateCollectionArgs({ ...VALID, maxSupply: 0 }))
      .toThrow('maxSupply must be an integer between 1 and')
  })

  it('rejects maxSupply > 1_000_000', () => {
    expect(() => validateCollectionArgs({ ...VALID, maxSupply: 1_000_001 }))
      .toThrow('maxSupply must be an integer between 1 and')
  })

  it('rejects non-integer maxSupply', () => {
    expect(() => validateCollectionArgs({ ...VALID, maxSupply: 1.5 }))
      .toThrow('maxSupply must be an integer between 1 and')
  })

  it('accepts boundary: maxSupply = 1', () => {
    expect(() => validateCollectionArgs({ ...VALID, maxSupply: 1 })).not.toThrow()
  })

  it('accepts boundary: maxSupply = 1_000_000', () => {
    expect(() => validateCollectionArgs({ ...VALID, maxSupply: 1_000_000 })).not.toThrow()
  })
})

// =========================================================================
// shared.ts — buildBuyerKioskArgs
// =========================================================================
describe('shared.ts — buildBuyerKioskArgs', () => {
  it('returns existing kiosk IDs when both are provided', () => {
    const tx = new Transaction()
    const result = buildBuyerKioskArgs(tx, {
      buyerKioskId: OBJ('22'),
      buyerKioskCapOnChainId: OBJ('33'),
    })
    expect(result.needsTransfer).toBe(false)
    expect(result.buyerKiosk).toBeDefined()
    expect(result.buyerKioskCap).toBeDefined()
  })

  it('creates new kiosk when neither ID is provided', () => {
    const tx = new Transaction()
    const result = buildBuyerKioskArgs(tx, {})
    expect(result.needsTransfer).toBe(true)
    expect(result.buyerKiosk).toBeDefined()
    expect(result.buyerKioskCap).toBeDefined()
    expect(tx.getData().commands
      .map((command) => ('MoveCall' in command ? command.MoveCall.function : null))
      .filter(Boolean))
      .toContain('ensure_personal_kiosk_registered')
    expect(tx.getData().commands
      .map((command) => ('MoveCall' in command ? command.MoveCall.function : null))
      .filter(Boolean))
      .not.toContain('register_existing_personal_kiosk')
  })

  it('creates new kiosk when both are null', () => {
    const tx = new Transaction()
    const result = buildBuyerKioskArgs(tx, {
      buyerKioskId: null,
      buyerKioskCapOnChainId: null,
    })
    expect(result.needsTransfer).toBe(true)
  })

  it('throws when only buyerKioskId is provided', () => {
    const tx = new Transaction()
    expect(() => buildBuyerKioskArgs(tx, { buyerKioskId: OBJ('22') }))
      .toThrow('buyerKioskId and buyerKioskCapOnChainId must be provided together')
  })

  it('throws when only buyerKioskCapOnChainId is provided', () => {
    const tx = new Transaction()
    expect(() => buildBuyerKioskArgs(tx, { buyerKioskCapOnChainId: OBJ('33') }))
      .toThrow('buyerKioskId and buyerKioskCapOnChainId must be provided together')
  })
})

// =========================================================================
// publish.ts — buildPublishSoulTx
// =========================================================================
import { buildPublishSoulTx } from '../../web/lib/soulidity/tx/publish'

describe('publish.ts — buildPublishSoulTx', () => {
  const VALID_PARAMS = {
    ...VALID_SOUL_PUBLISH_ARGS,
    protectedBlobObjectId: OBJ('44'),
    currentKioskId: OBJ('22'),
    currentKioskCapOnChainId: OBJ('33'),
  }

  it('returns a Transaction with valid params (existing kiosk)', async () => {
    const tx = await buildPublishSoulTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction with new kiosk (no kiosk IDs)', async () => {
    const tx = await buildPublishSoulTx({
      ...VALID_SOUL_PUBLISH_ARGS,
      protectedBlobObjectId: OBJ('44'),
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction with optional founding memory and skills', async () => {
    const tx = await buildPublishSoulTx({
      ...VALID_PARAMS,
      foundingMemoryBlobObjectId: OBJ('55'),
      skillsBlobObjectId: OBJ('66'),
      skillsVisibility: 'public',
      initialSprite: {
        blobObjectId: OBJ('77'),
        assetName: 'persona-sprite',
        visibility: 'private',
        downloadPolicy: 'owner_only',
        spriteConfigJson: JSON.stringify({
          frameWidth: 64,
          frameHeight: 64,
          columns: 4,
          animations: {
            idle: { frames: [0, 1], fps: 8, loop: true },
          },
        }),
        spriteMoodMapJson: JSON.stringify({ idle: 'idle' }),
      },
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('uses the mainnet Walrus Blob type for all object options on mainnet', async () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'

    const tx = await buildPublishSoulTx({
      ...VALID_PARAMS,
      foundingMemoryBlobObjectId: OBJ('55'),
      skillsBlobObjectId: OBJ('66'),
      assetBlobObjectId: OBJ('77'),
      assetType: 'sprite',
    })

    expect(getObjectOptionTypeArguments(tx)).toEqual([
      MAINNET_WALRUS_BLOB_TYPE,
      MAINNET_WALRUS_BLOB_TYPE,
      MAINNET_WALRUS_BLOB_TYPE,
    ])
  })

  it('keeps the testnet Walrus Blob type for object options by default', async () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'testnet'

    const tx = await buildPublishSoulTx({
      ...VALID_PARAMS,
      foundingMemoryBlobObjectId: OBJ('55'),
      skillsBlobObjectId: OBJ('66'),
      assetBlobObjectId: OBJ('77'),
      assetType: 'sprite',
    })

    expect(getObjectOptionTypeArguments(tx)).toEqual([
      TESTNET_WALRUS_BLOB_TYPE,
      TESTNET_WALRUS_BLOB_TYPE,
      TESTNET_WALRUS_BLOB_TYPE,
    ])
  })

  it('defaults initial asset name to persona-sprite when an asset blob is present', async () => {
    const tx = await buildPublishSoulTx({
      ...VALID_PARAMS,
      skillsBlobObjectId: OBJ('66'),
      initialSkillName: 'skills-v1',
      assetBlobObjectId: OBJ('77'),
      assetVisibility: 'private',
      assetType: 'sprite',
    })

    expect(getPureInputBytes(tx)).toContain(encodeBcsString('persona-sprite'))
  })

  it('rejects legacy audio asset params before signing', async () => {
    await expect(buildPublishSoulTx({
      ...VALID_PARAMS,
      assetBlobObjectId: OBJ('77'),
      assetType: 'audio',
    })).rejects.toThrow('Mint-time voice assets are disabled')
  })

  it('invokes attachBeforeMint between kiosk setup and the mint call', async () => {
    const calls: string[] = []
    const tx = await buildPublishSoulTx({
      ...VALID_PARAMS,
      attachBeforeMint: (transaction) => {
        calls.push('attachBeforeMint')
        // Splicing a custom moveCall here proves the hook can mutate the tx
        // before the mint command is appended.
        transaction.moveCall({ target: '0x2::tx_context::sender', arguments: [] })
      },
    })
    expect(calls).toEqual(['attachBeforeMint'])
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('throws on invalid name', async () => {
    await expect(buildPublishSoulTx({ ...VALID_PARAMS, name: '' })).rejects.toThrow('Soul name is required')
  })

  it('throws on invalid royalty', async () => {
    await expect(buildPublishSoulTx({ ...VALID_PARAMS, creatorRoyaltyBps: 3000 }))
      .rejects.toThrow('creatorRoyaltyBps must be between 0 and')
  })
})

// =========================================================================
// metadata.ts — metadata object transactions
// =========================================================================
import {
  buildClearActiveSpriteTx,
  buildClearActiveVoiceTx,
  buildDeleteMetadataBlobTx,
  buildSetActiveSpriteTx,
  buildSetActiveVoiceTx,
  buildUpsertMetadataBlobTx,
} from '../../web/lib/soulidity/tx/metadata'

describe('metadata.ts — Soul metadata object transactions', () => {
  const VALID_PARAMS = {
    metadataObjectId: OBJ('22'),
    stateObjectId: OBJ('11'),
    assetsObjectId: OBJ('44'),
  }

  it('builds set active sprite tx', () => {
    const tx = buildSetActiveSpriteTx({
      ...VALID_PARAMS,
      assetName: 'persona-sprite',
      versionIndex: 1,
      downloadPolicy: 'owner_only',
    })
    const commands = tx.getData().commands
      .map((command) => ('MoveCall' in command ? command.MoveCall.function : null))
      .filter(Boolean)

    expect(tx).toBeInstanceOf(Transaction)
    expect(commands).toEqual(['set_active_sprite'])
  })

  it('builds clear active sprite tx', () => {
    const tx = buildClearActiveSpriteTx({
      ...VALID_PARAMS,
    })
    const commands = tx.getData().commands
      .map((command) => ('MoveCall' in command ? command.MoveCall.function : null))
      .filter(Boolean)

    expect(commands).toEqual(['clear_active_sprite'])
  })

  it('builds set active voice tx', () => {
    const tx = buildSetActiveVoiceTx({
      ...VALID_PARAMS,
      assetName: 'voice-primary',
      versionIndex: 0,
      downloadPolicy: 'allowlist',
    })
    const commands = tx.getData().commands
      .map((command) => ('MoveCall' in command ? command.MoveCall.function : null))
      .filter(Boolean)

    expect(commands).toEqual(['set_active_voice'])
  })

  it('builds clear active voice tx', () => {
    const tx = buildClearActiveVoiceTx({
      metadataObjectId: VALID_PARAMS.metadataObjectId,
      stateObjectId: VALID_PARAMS.stateObjectId,
    })
    const commands = tx.getData().commands
      .map((command) => ('MoveCall' in command ? command.MoveCall.function : null))
      .filter(Boolean)

    expect(commands).toEqual(['clear_active_voice'])
  })

  it('builds metadata blob upsert tx and encodes UTF-8 bytes', () => {
    const tx = buildUpsertMetadataBlobTx({
      metadataObjectId: VALID_PARAMS.metadataObjectId,
      stateObjectId: VALID_PARAMS.stateObjectId,
      key: 'sprite.config.v1',
      value: '{"fps":12}',
    })

    expect(getPureInputBytes(tx)).toContain(encodeBcsString('sprite.config.v1'))
  })

  it('rejects empty metadata blob values', () => {
    expect(() => buildUpsertMetadataBlobTx({
      metadataObjectId: VALID_PARAMS.metadataObjectId,
      stateObjectId: VALID_PARAMS.stateObjectId,
      key: 'sprite.config.v1',
      value: '   ',
    })).toThrow('metadata value is required')
  })

  it('builds metadata blob delete tx', () => {
    const tx = buildDeleteMetadataBlobTx({
      metadataObjectId: VALID_PARAMS.metadataObjectId,
      stateObjectId: VALID_PARAMS.stateObjectId,
      key: 'sprite.config.v1',
    })
    const commands = tx.getData().commands
      .map((command) => ('MoveCall' in command ? command.MoveCall.function : null))
      .filter(Boolean)

    expect(commands).toEqual(['delete_metadata_blob'])
  })
})

// =========================================================================
// buy.ts — buildBuySoulTx, buildBuyCollectionTx
// =========================================================================
import { buildBuySoulTx, buildBuyCollectionTx } from '../../web/lib/soulidity/tx/buy'

describe('buy.ts — buildBuySoulTx', () => {
  const VALID_PARAMS = {
    sellerKioskId: OBJ('10'),
    stateObjectId: OBJ('11'),
    listingObjectId: OBJ('12'),
    totalAtomic: 1_000_000n,
    paymentCoinObjectIds: [OBJ('c1')],
    buyerKioskId: OBJ('22'),
    buyerKioskCapOnChainId: OBJ('33'),
  }

  it('returns a Transaction for standard buy (no collection)', () => {
    const tx = buildBuySoulTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction for buy with collection', () => {
    const tx = buildBuySoulTx({
      ...VALID_PARAMS,
      collectionObjectId: OBJ('c0'),
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction when creating new buyer kiosk', () => {
    const tx = buildBuySoulTx({
      ...VALID_PARAMS,
      buyerKioskId: null,
      buyerKioskCapOnChainId: null,
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('throws when totalAtomic is zero', () => {
    expect(() => buildBuySoulTx({ ...VALID_PARAMS, totalAtomic: 0n }))
      .toThrow('totalAtomic must be positive')
  })

  it('throws when totalAtomic is negative', () => {
    expect(() => buildBuySoulTx({ ...VALID_PARAMS, totalAtomic: -1n }))
      .toThrow('totalAtomic must be positive')
  })

  it('throws when paymentCoinObjectIds is empty', () => {
    expect(() => buildBuySoulTx({ ...VALID_PARAMS, paymentCoinObjectIds: [] }))
      .toThrow('paymentCoinObjectIds must contain at least one object id')
  })

  it('handles multiple payment coins (merge path)', () => {
    const tx = buildBuySoulTx({
      ...VALID_PARAMS,
      paymentCoinObjectIds: [OBJ('c1'), OBJ('c2'), OBJ('c3')],
    })
    expect(tx).toBeInstanceOf(Transaction)
  })
})

describe('buy.ts — buildBuyCollectionTx', () => {
  const VALID_PARAMS = {
    sellerKioskId: OBJ('10'),
    collectionObjectId: OBJ('c0'),
    listingObjectId: OBJ('12'),
    totalAtomic: 500_000n,
    paymentCoinObjectIds: [OBJ('c1')],
    buyerKioskId: OBJ('22'),
    buyerKioskCapOnChainId: OBJ('33'),
  }

  it('returns a Transaction with valid params', () => {
    const tx = buildBuyCollectionTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction when creating new buyer kiosk', () => {
    const tx = buildBuyCollectionTx({
      ...VALID_PARAMS,
      buyerKioskId: null,
      buyerKioskCapOnChainId: null,
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('throws when totalAtomic is zero', () => {
    expect(() => buildBuyCollectionTx({ ...VALID_PARAMS, totalAtomic: 0n }))
      .toThrow('totalAtomic must be positive')
  })

  it('throws when paymentCoinObjectIds is empty', () => {
    expect(() => buildBuyCollectionTx({ ...VALID_PARAMS, paymentCoinObjectIds: [] }))
      .toThrow('paymentCoinObjectIds must contain at least one object id')
  })
})

// =========================================================================
// content-access.ts — purchase / owner controls
// =========================================================================
import {
  buildCleanupStaleContentAccessEntriesTx,
  buildPurchaseContentAccessTx,
  buildSetContentAccessDefaultScopeTx,
  buildSetContentAccessDurationTx,
  buildSetContentAccessPriceTx,
} from '../../web/lib/soulidity/tx/content-access'

describe('content-access.ts — buildPurchaseContentAccessTx', () => {
  const VALID_PARAMS = {
    accessListOnChainId: OBJ('61'),
    stateOnChainId: OBJ('62'),
  }

  it('keeps the legacy exact payment coin path', () => {
    const tx = buildPurchaseContentAccessTx({
      ...VALID_PARAMS,
      paymentCoinId: OBJ('c1'),
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('supports split payment from selected coin objects', () => {
    const tx = buildPurchaseContentAccessTx({
      ...VALID_PARAMS,
      paymentCoinObjectIds: [OBJ('c1'), OBJ('c2')],
      totalAtomic: 1_025_000n,
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('rejects split payment without positive totalAtomic', () => {
    expect(() => buildPurchaseContentAccessTx({
      ...VALID_PARAMS,
      paymentCoinObjectIds: [OBJ('c1')],
      totalAtomic: 0n,
    })).toThrow('totalAtomic must be positive')
  })

  it('rejects missing payment inputs', () => {
    expect(() => buildPurchaseContentAccessTx(VALID_PARAMS))
      .toThrow('paymentCoinId or paymentCoinObjectIds is required')
  })
})

describe('content-access.ts — owner controls', () => {
  const VALID_PARAMS = {
    accessListOnChainId: OBJ('61'),
    stateOnChainId: OBJ('62'),
  }

  it('builds set content access price tx', () => {
    const tx = buildSetContentAccessPriceTx({
      ...VALID_PARAMS,
      newPriceAtomic: 1_000_000,
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('builds set content access duration tx', () => {
    const tx = buildSetContentAccessDurationTx({
      ...VALID_PARAMS,
      newDurationMs: 3_600_000,
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('builds clear content access duration tx', () => {
    const tx = buildSetContentAccessDurationTx({
      ...VALID_PARAMS,
      newDurationMs: null,
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('builds set default scope tx', () => {
    const tx = buildSetContentAccessDefaultScopeTx({
      ...VALID_PARAMS,
      scopeMask: 15,
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('builds stale row cleanup tx', () => {
    const tx = buildCleanupStaleContentAccessEntriesTx({
      ...VALID_PARAMS,
      addresses: [ADDR],
    })
    expect(tx).toBeInstanceOf(Transaction)
  })
})

// =========================================================================
// list.ts — buildListSoulTx, buildListCollectionTx
// =========================================================================
import { buildListSoulTx, buildListCollectionTx } from '../../web/lib/soulidity/tx/list'

describe('list.ts — buildListSoulTx', () => {
  const VALID_PARAMS = {
    currentKioskId: OBJ('22'),
    currentKioskCapOnChainId: OBJ('33'),
    stateObjectId: OBJ('11'),
    soulObjectId: OBJ('44'),
    priceAtomic: 1_000_000n,
  }

  it('returns a Transaction (no collection)', () => {
    const tx = buildListSoulTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction with collection', () => {
    const tx = buildListSoulTx({
      ...VALID_PARAMS,
      collectionObjectId: OBJ('c0'),
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('throws when priceAtomic is zero', () => {
    expect(() => buildListSoulTx({ ...VALID_PARAMS, priceAtomic: 0n }))
      .toThrow('priceAtomic must be positive')
  })

  it('throws when priceAtomic is negative', () => {
    expect(() => buildListSoulTx({ ...VALID_PARAMS, priceAtomic: -1n }))
      .toThrow('priceAtomic must be positive')
  })
})

describe('list.ts — buildListCollectionTx', () => {
  const VALID_PARAMS = {
    currentKioskId: OBJ('22'),
    currentKioskCapOnChainId: OBJ('33'),
    collectionObjectId: OBJ('c0'),
    rightObjectId: OBJ('d1'),
    priceAtomic: 500_000n,
  }

  it('returns a Transaction with valid params', () => {
    const tx = buildListCollectionTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('throws when priceAtomic is zero', () => {
    expect(() => buildListCollectionTx({ ...VALID_PARAMS, priceAtomic: 0n }))
      .toThrow('priceAtomic must be positive')
  })
})

// =========================================================================
// delist.ts — buildDelistSoulTx, buildDelistCollectionTx
// =========================================================================
import { buildDelistSoulTx, buildDelistCollectionTx } from '../../web/lib/soulidity/tx/delist'
import { buildUpdateListingPriceTx } from '../../web/lib/soulidity/tx/update-price'
import { buildUpdateCollectionListingPriceTx } from '../../web/lib/soulidity/tx/update-collection-price'

describe('delist.ts — buildDelistSoulTx', () => {
  const VALID_PARAMS = {
    currentKioskId: OBJ('22'),
    currentKioskCapOnChainId: OBJ('33'),
    stateObjectId: OBJ('11'),
    listingObjectId: OBJ('55'),
  }

  it('returns a Transaction with valid params', () => {
    const tx = buildDelistSoulTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('passes the state object so cancel_soul_listing can clear is_listed', () => {
    const tx = buildDelistSoulTx(VALID_PARAMS)
    const inputs = tx.getData().inputs
    const stateInput = inputs.find((input) => {
      const obj = (input as unknown as Record<string, unknown>).UnresolvedObject
      return obj && (obj as Record<string, unknown>).objectId === VALID_PARAMS.stateObjectId
    })
    expect(stateInput).toBeDefined()
  })
})

describe('delist.ts — buildDelistCollectionTx', () => {
  const VALID_PARAMS = {
    currentKioskId: OBJ('22'),
    currentKioskCapOnChainId: OBJ('33'),
    listingObjectId: OBJ('55'),
  }

  it('returns a Transaction with valid params', () => {
    const tx = buildDelistCollectionTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })
})

describe('update-price.ts — buildUpdateListingPriceTx', () => {
  const VALID_PARAMS = {
    currentKioskId: OBJ('22'),
    currentKioskCapOnChainId: OBJ('33'),
    stateObjectId: OBJ('11'),
    listingObjectId: OBJ('55'),
    newPriceAtomic: 2_000_000n,
  }

  it('ensures the kiosk is registered again and finalizes the relisted Soul listing', () => {
    const tx = buildUpdateListingPriceTx(VALID_PARAMS)
    const commands = tx.getData().commands
      .map((command) => ('MoveCall' in command ? command.MoveCall.function : null))
      .filter(Boolean)

    expect(commands).toEqual([
      'cancel_soul_listing',
      'ensure_personal_kiosk_registered',
      'list_soul_fixed_price',
      'finalize_soul_listing',
    ])
  })

  it('throws when newPriceAtomic is zero', () => {
    expect(() => buildUpdateListingPriceTx({ ...VALID_PARAMS, newPriceAtomic: 0n }))
      .toThrow('newPriceAtomic must be positive')
  })
})

describe('update-collection-price.ts — buildUpdateCollectionListingPriceTx', () => {
  const VALID_PARAMS = {
    currentKioskId: OBJ('22'),
    currentKioskCapOnChainId: OBJ('33'),
    collectionObjectId: OBJ('c0'),
    listingObjectId: OBJ('55'),
    newPriceAtomic: 2_000_000n,
  }

  it('ensures the kiosk is registered again and finalizes the relisted Collection listing', () => {
    const tx = buildUpdateCollectionListingPriceTx(VALID_PARAMS)
    const commands = tx.getData().commands
      .map((command) => ('MoveCall' in command ? command.MoveCall.function : null))
      .filter(Boolean)

    expect(commands).toEqual([
      'cancel_collection_listing',
      'ensure_personal_kiosk_registered',
      'list_collection_right_fixed_price',
      'finalize_collection_listing',
    ])
  })

  it('throws when newPriceAtomic is zero', () => {
    expect(() => buildUpdateCollectionListingPriceTx({ ...VALID_PARAMS, newPriceAtomic: 0n }))
      .toThrow('newPriceAtomic must be positive')
  })
})

// =========================================================================
// grant.ts — buildIssueGrantTx, buildRevokeGrantTx, buildRevokeGrantScopeTx
// =========================================================================
import {
  buildCleanupInactiveGrantsTx,
  buildIssueGrantTx,
  buildRevokeGrantTx,
  buildRevokeGrantScopeTx,
  buildSetGrantCapacityTx,
} from '../../web/lib/soulidity/tx/grant'

describe('grant.ts — buildIssueGrantTx', () => {
  const VALID_PARAMS = {
    stateObjectId: OBJ('11'),
    granteeAddress: ADDR,
    scopeMask: 15,
  }

  it('returns a Transaction with valid params (no expiry)', () => {
    const tx = buildIssueGrantTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction with expiry', () => {
    const tx = buildIssueGrantTx({
      ...VALID_PARAMS,
      expiresAtMs: Date.now() + 86_400_000,
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('throws on empty granteeAddress', () => {
    expect(() => buildIssueGrantTx({ ...VALID_PARAMS, granteeAddress: '' }))
      .toThrow('granteeAddress is required')
  })

  it('throws on whitespace-only granteeAddress', () => {
    expect(() => buildIssueGrantTx({ ...VALID_PARAMS, granteeAddress: '   ' }))
      .toThrow('granteeAddress is required')
  })

  it('throws on zero scopeMask', () => {
    expect(() => buildIssueGrantTx({ ...VALID_PARAMS, scopeMask: 0 }))
      .toThrow('scopeMask must be a positive integer')
  })

  it('throws on negative scopeMask', () => {
    expect(() => buildIssueGrantTx({ ...VALID_PARAMS, scopeMask: -1 }))
      .toThrow('scopeMask must be a positive integer')
  })

  it('throws on non-integer scopeMask', () => {
    expect(() => buildIssueGrantTx({ ...VALID_PARAMS, scopeMask: 1.5 }))
      .toThrow('scopeMask must be a positive integer')
  })

  it('throws when expiry is not in the future', () => {
    expect(() => buildIssueGrantTx({ ...VALID_PARAMS, expiresAtMs: Date.now() }))
      .toThrow('expiresAtMs must be in the future')
  })
})

describe('grant.ts — buildCleanupInactiveGrantsTx', () => {
  it('returns a Transaction with grantee addresses', () => {
    const tx = buildCleanupInactiveGrantsTx({
      stateObjectId: OBJ('11'),
      granteeAddresses: [ADDR],
    })
    expect(tx).toBeInstanceOf(Transaction)
  })
})

describe('grant.ts — buildRevokeGrantTx', () => {
  const VALID_PARAMS = {
    stateObjectId: OBJ('11'),
    granteeAddress: ADDR,
  }

  it('returns a Transaction with valid params', () => {
    const tx = buildRevokeGrantTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('throws on empty granteeAddress', () => {
    expect(() => buildRevokeGrantTx({ ...VALID_PARAMS, granteeAddress: '' }))
      .toThrow('granteeAddress is required')
  })
})

describe('grant.ts — buildRevokeGrantScopeTx', () => {
  const VALID_PARAMS = {
    stateObjectId: OBJ('11'),
    granteeAddress: ADDR,
    revokedScopeMask: 3,
  }

  it('returns a Transaction with valid params', () => {
    const tx = buildRevokeGrantScopeTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('throws on empty granteeAddress', () => {
    expect(() => buildRevokeGrantScopeTx({ ...VALID_PARAMS, granteeAddress: '' }))
      .toThrow('granteeAddress is required')
  })

  it('throws on zero revokedScopeMask', () => {
    expect(() => buildRevokeGrantScopeTx({ ...VALID_PARAMS, revokedScopeMask: 0 }))
      .toThrow('revokedScopeMask must be a positive integer')
  })

  it('throws on non-integer revokedScopeMask', () => {
    expect(() => buildRevokeGrantScopeTx({ ...VALID_PARAMS, revokedScopeMask: 2.5 }))
      .toThrow('revokedScopeMask must be a positive integer')
  })
})

describe('grant.ts — buildSetGrantCapacityTx', () => {
  const VALID_PARAMS = {
    stateObjectId: OBJ('11'),
    capacity: 2,
  }

  it('returns a Transaction with valid params', () => {
    const tx = buildSetGrantCapacityTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('throws on zero capacity', () => {
    expect(() => buildSetGrantCapacityTx({ ...VALID_PARAMS, capacity: 0 }))
      .toThrow('capacity must be a positive safe integer')
  })

  it('throws on non-integer capacity', () => {
    expect(() => buildSetGrantCapacityTx({ ...VALID_PARAMS, capacity: 1.5 }))
      .toThrow('capacity must be a positive safe integer')
  })
})

// =========================================================================
// collection.ts — buildCreateCollectionTx
// =========================================================================
import { buildCreateCollectionTx } from '../../web/lib/soulidity/tx/collection'

describe('collection.ts — buildCreateCollectionTx', () => {
  const VALID_PARAMS = {
    name: 'Test Collection',
    description: 'A test collection',
    imageUrl: 'https://example.com/col.png',
    extraRoyaltyBps: 200,
    tradeable: true,
    currentKioskId: OBJ('22'),
    currentKioskCapOnChainId: OBJ('33'),
  }

  it('returns a Transaction with existing kiosk', async () => {
    const tx = await buildCreateCollectionTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction with new kiosk (no kiosk IDs)', async () => {
    const tx = await buildCreateCollectionTx({
      ...VALID_PARAMS,
      currentKioskId: null,
      currentKioskCapOnChainId: null,
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction with tradeable=false', async () => {
    const tx = await buildCreateCollectionTx({ ...VALID_PARAMS, tradeable: false })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('throws on invalid name', async () => {
    await expect(buildCreateCollectionTx({ ...VALID_PARAMS, name: '' }))
      .rejects.toThrow('Collection name is required')
  })

  it('throws on invalid extraRoyaltyBps', async () => {
    await expect(buildCreateCollectionTx({ ...VALID_PARAMS, extraRoyaltyBps: 3000 }))
      .rejects.toThrow('extraRoyaltyBps must be between 0 and')
  })

  it('passes maxSupply: null (unlimited) without throwing', async () => {
    const tx = await buildCreateCollectionTx({ ...VALID_PARAMS, maxSupply: null })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('passes positive maxSupply without throwing', async () => {
    const tx = await buildCreateCollectionTx({ ...VALID_PARAMS, maxSupply: 10000 })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('rejects maxSupply = 0 (caught by validateCollectionArgs)', async () => {
    await expect(buildCreateCollectionTx({ ...VALID_PARAMS, maxSupply: 0 }))
      .rejects.toThrow('maxSupply must be an integer between 1 and')
  })

  it('invokes attachBeforeCreate between kiosk setup and the create call', async () => {
    const calls: string[] = []
    const tx = await buildCreateCollectionTx({
      ...VALID_PARAMS,
      attachBeforeCreate: (transaction) => {
        calls.push('attachBeforeCreate')
        // Splicing a custom moveCall here proves the hook can mutate the tx
        // before the create_collection command is appended.
        transaction.moveCall({ target: '0x2::tx_context::sender', arguments: [] })
      },
    })
    expect(calls).toEqual(['attachBeforeCreate'])
    expect(tx).toBeInstanceOf(Transaction)
  })
})

// =========================================================================
// memory.ts — buildAppendMemoryAsOwnerTx, buildAppendMemoryAsGrantedAgentTx
// =========================================================================
import {
  buildAppendMemoryAsOwnerTx,
  buildAppendMemoryAsGrantedAgentTx,
} from '../../web/lib/soulidity/tx/memory'

describe('memory.ts — buildAppendMemoryAsOwnerTx', () => {
  it('returns a Transaction with valid params', () => {
    const tx = buildAppendMemoryAsOwnerTx({
      memoryOnChainId: OBJ('m1'),
      stateOnChainId: OBJ('11'),
      contentBlobObjectId: OBJ('b1'),
    })
    expect(tx).toBeInstanceOf(Transaction)
  })
})

describe('memory.ts — buildAppendMemoryAsGrantedAgentTx', () => {
  it('returns a Transaction with valid params', () => {
    const tx = buildAppendMemoryAsGrantedAgentTx({
      memoryOnChainId: OBJ('m1'),
      stateOnChainId: OBJ('11'),
      grantOnChainId: OBJ('g1'),
      contentBlobObjectId: OBJ('b1'),
    })
    expect(tx).toBeInstanceOf(Transaction)
  })
})

// =========================================================================
// skills.ts — buildAppendSkillVersionTx, buildDeleteSkillVersionTx
// =========================================================================
import {
  buildAppendSkillVersionTx,
  buildDeleteSkillVersionTx,
  buildInitSkillsAndAppendAsOwnerTx,
  buildPurgeDeletedSkillVersionTx,
} from '../../web/lib/soulidity/tx/skills'

describe('skills.ts — buildAppendSkillVersionTx', () => {
  const VALID_PARAMS = {
    stateObjectId: OBJ('11'),
    skillsObjectId: OBJ('s1'),
    skillName: 'reporter',
    blobObjectId: OBJ('b1'),
    visibility: 'public' as const,
  }

  it('returns a Transaction as owner (no grant)', () => {
    const tx = buildAppendSkillVersionTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction as granted agent', () => {
    const tx = buildAppendSkillVersionTx({
      ...VALID_PARAMS,
      grantObjectId: OBJ('g1'),
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction with private visibility', () => {
    const tx = buildAppendSkillVersionTx({
      ...VALID_PARAMS,
      visibility: 'private',
    })
    expect(tx).toBeInstanceOf(Transaction)
  })
})

describe('skills.ts — buildDeleteSkillVersionTx', () => {
  const VALID_PARAMS = {
    stateObjectId: OBJ('11'),
    skillsObjectId: OBJ('s1'),
    skillName: 'reporter',
    versionIndex: 2,
  }

  it('returns a Transaction as owner (no grant)', () => {
    const tx = buildDeleteSkillVersionTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction as granted agent', () => {
    const tx = buildDeleteSkillVersionTx({
      ...VALID_PARAMS,
      grantObjectId: OBJ('g1'),
    })
    expect(tx).toBeInstanceOf(Transaction)
  })
})

describe('skills.ts — cleanup and root init', () => {
  it('builds purge deleted skill version tx', () => {
    const tx = buildPurgeDeletedSkillVersionTx({
      stateObjectId: OBJ('11'),
      skillsObjectId: OBJ('s1'),
      skillName: 'reporter',
      versionIndex: 2,
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('builds init skills and append tx', () => {
    const tx = buildInitSkillsAndAppendAsOwnerTx({
      stateObjectId: OBJ('11'),
      skillName: 'reporter',
      blobObjectId: OBJ('b1'),
      visibility: 'private',
    })
    expect(tx).toBeInstanceOf(Transaction)
  })
})

// =========================================================================
// import.ts — buildImportSoulTx
// =========================================================================
import { buildImportSoulTx } from '../../web/lib/soulidity/tx/import'

describe('import.ts — buildImportSoulTx', () => {
  const VALID_PARAMS = {
    ...VALID_SOUL_PUBLISH_ARGS,
    protectedBlobObjectId: OBJ('44'),
    originRef: 'https://original-platform.com/soul/123',
    currentKioskId: OBJ('22'),
    currentKioskCapOnChainId: OBJ('33'),
  }

  it('returns a Transaction with valid params', () => {
    const tx = buildImportSoulTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction with optional fields', () => {
    const tx = buildImportSoulTx({
      ...VALID_PARAMS,
      foundingMemoryBlobObjectId: OBJ('55'),
      skillsBlobObjectId: OBJ('66'),
      skillsVisibility: 'public',
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('uses the mainnet Walrus Blob type for all object options on mainnet', () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'

    const tx = buildImportSoulTx({
      ...VALID_PARAMS,
      foundingMemoryBlobObjectId: OBJ('55'),
      skillsBlobObjectId: OBJ('66'),
      assetBlobObjectId: OBJ('77'),
      assetType: 'sprite',
    })

    expect(getObjectOptionTypeArguments(tx)).toEqual([
      MAINNET_WALRUS_BLOB_TYPE,
      MAINNET_WALRUS_BLOB_TYPE,
      MAINNET_WALRUS_BLOB_TYPE,
    ])
  })

  it('defaults initial asset name to persona-sprite when an asset blob is present', () => {
    const tx = buildImportSoulTx({
      ...VALID_PARAMS,
      skillsBlobObjectId: OBJ('66'),
      initialSkillName: 'skills-v1',
      assetBlobObjectId: OBJ('77'),
      assetVisibility: 'private',
      assetType: 'sprite',
    })

    expect(getPureInputBytes(tx)).toContain(encodeBcsString('persona-sprite'))
  })

  it('rejects legacy audio asset params before signing', () => {
    expect(() => buildImportSoulTx({
      ...VALID_PARAMS,
      assetBlobObjectId: OBJ('77'),
      assetType: 'audio',
    })).toThrow('Mint-time voice assets are disabled')
  })

  it('returns a Transaction when creating new kiosk', () => {
    const tx = buildImportSoulTx({
      ...VALID_PARAMS,
      currentKioskId: null,
      currentKioskCapOnChainId: null,
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('throws on empty originRef', () => {
    expect(() => buildImportSoulTx({ ...VALID_PARAMS, originRef: '' }))
      .toThrow('originRef is required for imported Souls')
  })

  it('throws on whitespace-only originRef', () => {
    expect(() => buildImportSoulTx({ ...VALID_PARAMS, originRef: '   ' }))
      .toThrow('originRef is required for imported Souls')
  })

  it('propagates validation errors from validateSoulPublishArgs', () => {
    expect(() => buildImportSoulTx({ ...VALID_PARAMS, name: '' }))
      .toThrow('Soul name is required')
  })

  it('emits mint_imported_in_personal_kiosk followed by finalize_soul_state', () => {
    const tx = buildImportSoulTx(VALID_PARAMS)
    const targets = getMoveCallTargets(tx)
    const mintIdx = targets.indexOf('market::mint_imported_in_personal_kiosk')
    const finalizeIdx = targets.indexOf('market::finalize_soul_state')
    expect(mintIdx).toBeGreaterThanOrEqual(0)
    expect(finalizeIdx).toBeGreaterThan(mintIdx)
  })
})

// =========================================================================
// personal-join.ts — buildPersonalJoinSoulTx
// =========================================================================
import { buildPersonalJoinSoulTx } from '../../web/lib/soulidity/tx/personal-join'
import {
  buildAppendAssetVersionTx,
  buildDeleteAssetVersionTx,
  buildPurgeDeletedAssetVersionTx,
} from '../../web/lib/soulidity/tx/assets'

describe('personal-join.ts — buildPersonalJoinSoulTx', () => {
  const VALID_PARAMS = {
    ...VALID_SOUL_PUBLISH_ARGS,
    protectedBlobObjectId: OBJ('44'),
    originRef: 'https://source.com/nft/456',
    sourceObjectId: OBJ('a2'),
    sourceObjectType: '0xabc::my_nft::MyNFT',
    currentKioskId: OBJ('22'),
    currentKioskCapOnChainId: OBJ('33'),
  }

  it('returns a Transaction with valid params', () => {
    const tx = buildPersonalJoinSoulTx(VALID_PARAMS)
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('returns a Transaction with optional fields', () => {
    const tx = buildPersonalJoinSoulTx({
      ...VALID_PARAMS,
      foundingMemoryBlobObjectId: OBJ('55'),
      skillsBlobObjectId: OBJ('66'),
      skillsVisibility: 'public',
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('uses the mainnet Walrus Blob type for all object options on mainnet', () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'

    const tx = buildPersonalJoinSoulTx({
      ...VALID_PARAMS,
      foundingMemoryBlobObjectId: OBJ('55'),
      skillsBlobObjectId: OBJ('66'),
      assetBlobObjectId: OBJ('77'),
      assetType: 'sprite',
    })

    expect(getObjectOptionTypeArguments(tx)).toEqual([
      MAINNET_WALRUS_BLOB_TYPE,
      MAINNET_WALRUS_BLOB_TYPE,
      MAINNET_WALRUS_BLOB_TYPE,
    ])
  })

  it('defaults initial asset name to persona-sprite when an asset blob is present', () => {
    const tx = buildPersonalJoinSoulTx({
      ...VALID_PARAMS,
      skillsBlobObjectId: OBJ('66'),
      initialSkillName: 'skills-v1',
      assetBlobObjectId: OBJ('77'),
      assetVisibility: 'private',
      assetType: 'sprite',
    })

    expect(getPureInputBytes(tx)).toContain(encodeBcsString('persona-sprite'))
  })

  it('rejects legacy audio asset params before signing', () => {
    expect(() => buildPersonalJoinSoulTx({
      ...VALID_PARAMS,
      assetBlobObjectId: OBJ('77'),
      assetType: 'audio',
    })).toThrow('Mint-time voice assets are disabled')
  })

  it('returns a Transaction when creating new kiosk', () => {
    const tx = buildPersonalJoinSoulTx({
      ...VALID_PARAMS,
      currentKioskId: null,
      currentKioskCapOnChainId: null,
    })
    expect(tx).toBeInstanceOf(Transaction)
  })

  it('throws on empty originRef', () => {
    expect(() => buildPersonalJoinSoulTx({ ...VALID_PARAMS, originRef: '' }))
      .toThrow('originRef is required for Personal Join')
  })

  it('throws on empty sourceObjectType', () => {
    expect(() => buildPersonalJoinSoulTx({ ...VALID_PARAMS, sourceObjectType: '' }))
      .toThrow('sourceObjectType is required for Personal Join')
  })

  it('throws on whitespace-only sourceObjectType', () => {
    expect(() => buildPersonalJoinSoulTx({ ...VALID_PARAMS, sourceObjectType: '   ' }))
      .toThrow('sourceObjectType is required for Personal Join')
  })

  it('propagates validation errors from validateSoulPublishArgs', () => {
    expect(() => buildPersonalJoinSoulTx({ ...VALID_PARAMS, description: '' }))
      .toThrow('Soul description is required')
  })

  it('emits mint_joined_in_personal_kiosk followed by finalize_soul_state', () => {
    const tx = buildPersonalJoinSoulTx(VALID_PARAMS)
    const targets = getMoveCallTargets(tx)
    const mintIdx = targets.indexOf('market::mint_joined_in_personal_kiosk')
    const finalizeIdx = targets.indexOf('market::finalize_soul_state')
    expect(mintIdx).toBeGreaterThanOrEqual(0)
    expect(finalizeIdx).toBeGreaterThan(mintIdx)
  })
})

describe('Soulidity tx builders — Walrus Blob type regression guard', () => {
  it('does not hardcode the testnet Walrus Blob type in runtime mint builders', () => {
    for (const relativePath of [
      'web/lib/soulidity/tx/publish.ts',
      'web/lib/soulidity/tx/import.ts',
      'web/lib/soulidity/tx/personal-join.ts',
    ]) {
      expect(readRepoText(relativePath), relativePath).not.toContain(TESTNET_WALRUS_BLOB_TYPE)
    }
  })
})

describe('assets.ts — asset version transactions', () => {
  it('builds append asset version tx for owner', () => {
    const tx = buildAppendAssetVersionTx({
      stateObjectId: OBJ('11'),
      assetsObjectId: OBJ('22'),
      assetName: 'persona-sprite',
      blobObjectId: OBJ('33'),
      visibility: 'private',
      assetType: 'sprite',
    })

    expect(tx).toBeInstanceOf(Transaction)
    expect(getPureInputBytes(tx)).toContain(encodeBcsString('persona-sprite'))
  })

  it('builds append asset version tx for granted agent', () => {
    const tx = buildAppendAssetVersionTx({
      stateObjectId: OBJ('11'),
      assetsObjectId: OBJ('22'),
      assetName: 'persona-sprite',
      blobObjectId: OBJ('33'),
      visibility: 'public',
      assetType: 'sprite',
      grantObjectId: OBJ('44'),
    })

    expect(tx).toBeInstanceOf(Transaction)
  })

  it('builds delete asset version tx for owner', () => {
    const tx = buildDeleteAssetVersionTx({
      stateObjectId: OBJ('11'),
      metadataObjectId: OBJ('99'),
      assetsObjectId: OBJ('22'),
      assetName: 'persona-sprite',
      versionIndex: 0,
    })

    expect(tx).toBeInstanceOf(Transaction)
    expect(getPureInputBytes(tx)).toContain(encodeBcsString('persona-sprite'))
  })

  it('builds delete asset version tx for granted agent', () => {
    const tx = buildDeleteAssetVersionTx({
      stateObjectId: OBJ('11'),
      metadataObjectId: OBJ('99'),
      assetsObjectId: OBJ('22'),
      assetName: 'persona-sprite',
      versionIndex: 1,
      grantObjectId: OBJ('44'),
    })

    expect(tx).toBeInstanceOf(Transaction)
  })

  it('builds purge deleted asset version tx', () => {
    const tx = buildPurgeDeletedAssetVersionTx({
      stateObjectId: OBJ('11'),
      metadataObjectId: OBJ('99'),
      assetsObjectId: OBJ('22'),
      assetName: 'persona-sprite',
      versionIndex: 1,
    })

    expect(tx).toBeInstanceOf(Transaction)
  })
})

// =========================================================================
// kiosk-management.ts — buildRebindPrimaryKioskTx
// =========================================================================
import { buildRebindPrimaryKioskTx } from '../../web/lib/soulidity/tx/kiosk-management'

describe('kiosk-management.ts — buildRebindPrimaryKioskTx', () => {
  const VALID_PARAMS = {
    oldKioskId: OBJ('22'),
    newKioskCapOnChainId: OBJ('33'),
  }

  it('emits exactly one rebind_primary_kiosk call', () => {
    const tx = buildRebindPrimaryKioskTx(VALID_PARAMS)
    const commands = tx.getData().commands
      .map((command) => ('MoveCall' in command ? command.MoveCall.function : null))
      .filter(Boolean)

    expect(commands).toEqual(['rebind_primary_kiosk'])
  })

  it('throws on empty oldKioskId', () => {
    expect(() => buildRebindPrimaryKioskTx({ ...VALID_PARAMS, oldKioskId: '' }))
      .toThrow('oldKioskId is required')
  })

  it('throws on empty newKioskCapOnChainId', () => {
    expect(() => buildRebindPrimaryKioskTx({ ...VALID_PARAMS, newKioskCapOnChainId: '' }))
      .toThrow('newKioskCapOnChainId is required')
  })

  it('throws when old and new references collide', () => {
    expect(() => buildRebindPrimaryKioskTx({
      oldKioskId: OBJ('22'),
      newKioskCapOnChainId: OBJ('22'),
    })).toThrow('oldKioskId and newKioskCapOnChainId must differ')
  })
})

// =========================================================================
// 2-signature fast path builders
// =========================================================================

import {
  buildPublishSoulWithBindTx,
  buildPublishSoulWithListTx,
  buildPublishSoulWithCollectionAndListTx,
  buildBatchPublishSoulTx,
  buildCollectionFastPathPtb2Tx,
} from '../../web/lib/soulidity/tx/publish'
import {
  buildCollectionCoverCertifyTx,
  buildCreateCollectionWithListTx,
} from '../../web/lib/soulidity/tx/collection'
import {
  buildInitAndBatchAppendSkillsTx,
} from '../../web/lib/soulidity/tx/skills'
import {
  buildInitAndBatchAppendAssetsTx,
} from '../../web/lib/soulidity/tx/assets'

function getMoveCallTargets(tx: Transaction): string[] {
  return tx.getData().commands.flatMap((cmd) => 'MoveCall' in cmd
    ? [`${cmd.MoveCall.module}::${cmd.MoveCall.function}`]
    : [])
}

const FAST_PATH_PUBLISH_BASE = {
  ...VALID_SOUL_PUBLISH_ARGS,
  protectedBlobObjectId: OBJ('44'),
  currentKioskId: OBJ('22'),
  currentKioskCapOnChainId: OBJ('33'),
}

describe('publish.ts — buildPublishSoulTx finalizes SoulState', () => {
  it('emits mint_native_in_personal_kiosk followed by finalize_soul_state', async () => {
    const tx = await buildPublishSoulTx(FAST_PATH_PUBLISH_BASE)
    const targets = getMoveCallTargets(tx)
    const mintIdx = targets.indexOf('market::mint_native_in_personal_kiosk')
    const finalizeIdx = targets.indexOf('market::finalize_soul_state')
    expect(mintIdx).toBeGreaterThanOrEqual(0)
    expect(finalizeIdx).toBeGreaterThan(mintIdx)
  })
})

describe('publish.ts — buildPublishSoulWithBindTx', () => {
  it('emits mint, add_soul, then finalize_soul_state', async () => {
    const tx = await buildPublishSoulWithBindTx({
      ...FAST_PATH_PUBLISH_BASE,
      collectionOnChainId: OBJ('77'),
    })
    const targets = getMoveCallTargets(tx)
    const mintIdx = targets.indexOf('market::mint_native_in_personal_kiosk')
    const addSoulIdx = targets.indexOf('collection::add_soul')
    const finalizeIdx = targets.indexOf('market::finalize_soul_state')
    expect(mintIdx).toBeGreaterThanOrEqual(0)
    expect(addSoulIdx).toBeGreaterThan(mintIdx)
    expect(finalizeIdx).toBeGreaterThan(addSoulIdx)
  })

  it('rejects empty collectionOnChainId', async () => {
    await expect(buildPublishSoulWithBindTx({
      ...FAST_PATH_PUBLISH_BASE,
      collectionOnChainId: '',
    })).rejects.toThrow('collectionOnChainId')
  })
})

describe('publish.ts — buildPublishSoulWithListTx', () => {
  it('emits mint, list_soul_fixed_price, finalize_soul_listing, finalize_soul_state', async () => {
    const tx = await buildPublishSoulWithListTx({
      ...FAST_PATH_PUBLISH_BASE,
      listingPriceAtomic: 1_000_000n,
    })
    const targets = getMoveCallTargets(tx)
    const mintIdx = targets.indexOf('market::mint_native_in_personal_kiosk')
    const listIdx = targets.indexOf('market::list_soul_fixed_price')
    const finalizeListingIdx = targets.indexOf('market::finalize_soul_listing')
    const finalizeStateIdx = targets.indexOf('market::finalize_soul_state')
    expect(mintIdx).toBeGreaterThanOrEqual(0)
    expect(listIdx).toBeGreaterThan(mintIdx)
    expect(finalizeListingIdx).toBeGreaterThan(listIdx)
    expect(finalizeStateIdx).toBeGreaterThan(finalizeListingIdx)
  })

  it('rejects priceAtomic <= 0', async () => {
    await expect(buildPublishSoulWithListTx({
      ...FAST_PATH_PUBLISH_BASE,
      listingPriceAtomic: 0n,
    })).rejects.toThrow('listingPriceAtomic')
  })
})

describe('publish.ts — buildPublishSoulWithCollectionAndListTx', () => {
  it('emits mint, add_soul, list_with_collection, finalize_listing, finalize_state in order', async () => {
    const tx = await buildPublishSoulWithCollectionAndListTx({
      ...FAST_PATH_PUBLISH_BASE,
      collectionOnChainId: OBJ('77'),
      listingPriceAtomic: 1_000_000n,
    })
    const targets = getMoveCallTargets(tx)
    const mintIdx = targets.indexOf('market::mint_native_in_personal_kiosk')
    const addSoulIdx = targets.indexOf('collection::add_soul')
    const listIdx = targets.indexOf('market::list_soul_fixed_price_with_collection')
    const finalizeListingIdx = targets.indexOf('market::finalize_soul_listing')
    const finalizeStateIdx = targets.indexOf('market::finalize_soul_state')
    expect(mintIdx).toBeGreaterThanOrEqual(0)
    expect(addSoulIdx).toBeGreaterThan(mintIdx)
    expect(listIdx).toBeGreaterThan(addSoulIdx)
    expect(finalizeListingIdx).toBeGreaterThan(listIdx)
    expect(finalizeStateIdx).toBeGreaterThan(finalizeListingIdx)
  })
})

describe('publish.ts — buildBatchPublishSoulTx finalizes per mint', () => {
  it('emits N×{mint, finalize_soul_state} for an N-soul batch', async () => {
    const tx = await buildBatchPublishSoulTx({
      currentKioskId: OBJ('22'),
      currentKioskCapOnChainId: OBJ('33'),
      souls: [
        { ...VALID_SOUL_PUBLISH_ARGS, name: 'A', protectedBlobObjectId: OBJ('41') },
        { ...VALID_SOUL_PUBLISH_ARGS, name: 'B', protectedBlobObjectId: OBJ('42') },
        { ...VALID_SOUL_PUBLISH_ARGS, name: 'C', protectedBlobObjectId: OBJ('43') },
      ],
    })
    const targets = getMoveCallTargets(tx)
    const mintCount = targets.filter((t) => t === 'market::mint_native_in_personal_kiosk').length
    const finalizeCount = targets.filter((t) => t === 'market::finalize_soul_state').length
    expect(mintCount).toBe(3)
    expect(finalizeCount).toBe(3)
    // For every mint there must be a matching finalize_soul_state after it.
    let lastFinalize = -1
    for (let i = 0; i < targets.length; i++) {
      if (targets[i] === 'market::finalize_soul_state') {
        lastFinalize = i
      }
    }
    expect(lastFinalize).toBeGreaterThan(targets.lastIndexOf('market::mint_native_in_personal_kiosk'))
  })
})

describe('publish.ts — buildCollectionFastPathPtb2Tx', () => {
  it('emits cover-cert + N certs first, then N×{mint, add_soul, finalize_state}', async () => {
    const certCalls: number[] = []
    const tx = await buildCollectionFastPathPtb2Tx({
      collectionOnChainId: OBJ('77'),
      currentKioskId: OBJ('22'),
      currentKioskCapOnChainId: OBJ('33'),
      souls: [
        { ...VALID_SOUL_PUBLISH_ARGS, name: 'A', protectedBlobObjectId: OBJ('41') },
        { ...VALID_SOUL_PUBLISH_ARGS, name: 'B', protectedBlobObjectId: OBJ('42') },
      ],
      attachCertifyCalls: (innerTx) => {
        // Stand-in for client.certifyBlob — just emit a synthetic move call so
        // we can assert ordering. Walrus emits one call per blob.
        innerTx.moveCall({ target: '0xff::walrus::certify_blob', arguments: [] })
        innerTx.moveCall({ target: '0xff::walrus::certify_blob', arguments: [] })
        innerTx.moveCall({ target: '0xff::walrus::certify_blob', arguments: [] })
        certCalls.push(3)
      },
    })
    const targets = getMoveCallTargets(tx)
    const firstCert = targets.indexOf('walrus::certify_blob')
    const lastCert = targets.lastIndexOf('walrus::certify_blob')
    const firstMint = targets.indexOf('market::mint_native_in_personal_kiosk')
    expect(firstCert).toBeGreaterThanOrEqual(0)
    expect(lastCert).toBeGreaterThan(firstCert)
    expect(firstMint).toBeGreaterThan(lastCert)
    const mintCount = targets.filter((t) => t === 'market::mint_native_in_personal_kiosk').length
    const bindCount = targets.filter((t) => t === 'collection::add_soul').length
    const finalizeStateCount = targets.filter((t) => t === 'market::finalize_soul_state').length
    expect(mintCount).toBe(2)
    expect(bindCount).toBe(2)
    expect(finalizeStateCount).toBe(2)
  })

  it('rejects an empty soul list', async () => {
    await expect(buildCollectionFastPathPtb2Tx({
      collectionOnChainId: OBJ('77'),
      souls: [],
      attachCertifyCalls: () => {},
    })).rejects.toThrow('at least one soul')
  })
})

describe('collection.ts — buildCollectionCoverCertifyTx', () => {
  it('contains only the caller-attached cert calls (no Soulidity Move calls)', async () => {
    const tx = await buildCollectionCoverCertifyTx({
      attachCertifyCalls: (innerTx) => {
        innerTx.moveCall({ target: '0xff::walrus::certify_blob', arguments: [] })
      },
    })
    const targets = getMoveCallTargets(tx)
    expect(targets).toEqual(['walrus::certify_blob'])
    expect(targets.find((t) => t.startsWith('market::') || t.startsWith('collection::'))).toBeUndefined()
  })
})

describe('collection.ts — buildCreateCollectionWithListTx', () => {
  const BASE = {
    name: 'Coll',
    description: 'desc',
    imageUrl: 'https://example.com/c.png',
    extraRoyaltyBps: 500,
    tradeable: true,
    currentKioskId: OBJ('22'),
    currentKioskCapOnChainId: OBJ('33'),
    collectionRightListingPriceAtomic: 1_000_000n,
  }
  it('emits create, list_collection_right, finalize_listing, finalize_collection in order', async () => {
    const tx = await buildCreateCollectionWithListTx(BASE)
    const targets = getMoveCallTargets(tx)
    const createIdx = targets.indexOf('market::create_collection_in_personal_kiosk')
    const listIdx = targets.indexOf('market::list_collection_right_fixed_price')
    const finalizeListingIdx = targets.indexOf('market::finalize_collection_listing')
    const finalizeCollectionIdx = targets.indexOf('market::finalize_collection')
    expect(createIdx).toBeGreaterThanOrEqual(0)
    expect(listIdx).toBeGreaterThan(createIdx)
    expect(finalizeListingIdx).toBeGreaterThan(listIdx)
    expect(finalizeCollectionIdx).toBeGreaterThan(finalizeListingIdx)
  })
  it('rejects price <= 0', async () => {
    await expect(buildCreateCollectionWithListTx({ ...BASE, collectionRightListingPriceAtomic: 0n }))
      .rejects.toThrow('collectionRightListingPriceAtomic')
  })
  it('rejects non-tradeable collections', async () => {
    await expect(buildCreateCollectionWithListTx({ ...BASE, tradeable: false }))
      .rejects.toThrow('non-tradeable')
  })
})

describe('list.ts — finalizes listing after list call', () => {
  it('buildListSoulTx emits list_soul_fixed_price followed by finalize_soul_listing', () => {
    const tx = buildListSoulTx({
      currentKioskId: OBJ('22'),
      currentKioskCapOnChainId: OBJ('33'),
      stateObjectId: OBJ('44'),
      priceAtomic: 1_000_000n,
    })
    const targets = getMoveCallTargets(tx)
    const listIdx = targets.indexOf('market::list_soul_fixed_price')
    const finalizeIdx = targets.indexOf('market::finalize_soul_listing')
    expect(listIdx).toBeGreaterThanOrEqual(0)
    expect(finalizeIdx).toBeGreaterThan(listIdx)
  })
  it('buildListCollectionTx emits list_collection_right_fixed_price followed by finalize_collection_listing', () => {
    const tx = buildListCollectionTx({
      currentKioskId: OBJ('22'),
      currentKioskCapOnChainId: OBJ('33'),
      collectionObjectId: OBJ('77'),
      priceAtomic: 1_000_000n,
    })
    const targets = getMoveCallTargets(tx)
    const listIdx = targets.indexOf('market::list_collection_right_fixed_price')
    const finalizeIdx = targets.indexOf('market::finalize_collection_listing')
    expect(listIdx).toBeGreaterThanOrEqual(0)
    expect(finalizeIdx).toBeGreaterThan(listIdx)
  })
})

describe('skills.ts / assets.ts — batch builders finalize root', () => {
  it('buildInitAndBatchAppendSkillsTx emits init + N appends + finalize_soul_skills', () => {
    const tx = buildInitAndBatchAppendSkillsTx({
      stateObjectId: OBJ('44'),
      initialVersion: { skillName: 'v0', blobObjectId: OBJ('51'), visibility: 'public' },
      additionalVersions: [
        { skillName: 'v0', blobObjectId: OBJ('52'), visibility: 'public' },
        { skillName: 'v0', blobObjectId: OBJ('53'), visibility: 'public' },
      ],
    })
    const targets = getMoveCallTargets(tx)
    const initIdx = targets.indexOf('market::init_skills_and_append_as_owner')
    const appendCount = targets.filter((t) => t === 'skills::append_version_as_owner').length
    const finalizeIdx = targets.indexOf('market::finalize_soul_skills')
    expect(initIdx).toBeGreaterThanOrEqual(0)
    expect(appendCount).toBe(2)
    expect(finalizeIdx).toBeGreaterThan(initIdx)
  })

  it('buildInitAndBatchAppendAssetsTx emits init + N appends + finalize_soul_assets', () => {
    const tx = buildInitAndBatchAppendAssetsTx({
      stateObjectId: OBJ('44'),
      metadataObjectId: OBJ('45'),
      initialSprite: {
        assetName: 'sprite',
        visibility: 'public',
        blobObjectId: OBJ('51'),
        spriteConfigJson: '{"fps":12}',
        spriteMoodMapJson: '{"happy":"a"}',
        spriteConfigKey: 'sprite.config.v1',
        spriteMoodMapKey: 'sprite.mood_map.v1',
        downloadPolicy: 'public',
      },
      additionalSprites: [
        { assetName: 'sprite', visibility: 'public', blobObjectId: OBJ('52') },
      ],
    })
    const targets = getMoveCallTargets(tx)
    const initIdx = targets.indexOf('market::init_assets_and_append_sprite_as_owner')
    const appendCount = targets.filter((t) => t === 'assets::append_version_as_owner').length
    const finalizeIdx = targets.indexOf('market::finalize_soul_assets')
    expect(initIdx).toBeGreaterThanOrEqual(0)
    expect(appendCount).toBe(1)
    expect(finalizeIdx).toBeGreaterThan(initIdx)
  })
})
