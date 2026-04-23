import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedListDesktopCatalogItems = vi.hoisted(() => vi.fn())
const mockedFindDesktopPersonaManifestById = vi.hoisted(() => vi.fn())
const mockedRequireDesktopIdentity = vi.hoisted(() => vi.fn())
const mockedGetMemberSuiWalletAddresses = vi.hoisted(() => vi.fn())
const mockedResolveSoulAssetVersionAccessPayload = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  member: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/desktop/repository', () => ({
  listDesktopCatalogItems: mockedListDesktopCatalogItems,
  findDesktopPersonaManifestById: mockedFindDesktopPersonaManifestById,
}))
vi.mock('@/lib/desktop/auth', () => ({
  requireDesktopIdentity: mockedRequireDesktopIdentity,
}))
vi.mock('@/lib/auth/sui-wallet', () => ({
  getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses,
}))
vi.mock('@/lib/soulidity/asset-version-access', () => {
  class MockAssetAccessDeniedError extends Error {
    constructor(message: string, readonly status = 403) {
      super(message)
      this.name = 'AssetAccessDeniedError'
    }
  }

  return {
    AssetAccessDeniedError: MockAssetAccessDeniedError,
    resolveSoulAssetVersionAccessPayload: mockedResolveSoulAssetVersionAccessPayload,
  }
})
vi.mock('@/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

function makeSoulManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'soul:0xsoul-1',
    sourceType: 'soul',
    sourceRef: '0xsoul-1',
    title: 'Ghost Fox',
    description: 'Listed soul',
    coverImage: 'cover.png',
    thumbnail: 'thumb.png',
    listingStatus: 'listed',
    listedPriceAtomic: '1250000',
    spriteDownloadPolicy: 'public',
    version: '2026-04-20T00:00:00.000Z',
    checksum: 'desktop-soul:0xsoul-1:2026-04-20T00:00:00.000Z',
    files: [],
    sprite: {
      downloadPolicy: 'public',
      publicUrl: 'https://walrus.test/blob/sprite',
      config: { src: 'persona-sprite.png' },
      assetName: 'persona-sprite',
      versionIndex: null,
      fileName: 'persona-sprite.png',
      configFileName: 'persona-sprite-config.json',
      metadataOnChainId: '0xmetadata-1',
    },
    updatedAt: '2026-04-20T00:00:00.000Z',
    ...overrides,
  }
}

describe('GET /api/desktop/catalog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('returns paginated catalog items with defaults', async () => {
    mockedListDesktopCatalogItems.mockResolvedValue({ items: [], total: 0 })

    const { GET } = await import('../../web/app/api/desktop/catalog/route')
    const request = new Request('http://localhost/api/desktop/catalog')
    const nextRequest = Object.assign(request, {
      nextUrl: new URL('http://localhost/api/desktop/catalog'),
    })
    const response = await GET(nextRequest as never)
    const body = await response.json()

    expect(body).toMatchObject({ items: [], total: 0, page: 1, pageSize: 12 })
  })
})

describe('GET /api/desktop/catalog/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('returns 404 when manifest is missing', async () => {
    mockedFindDesktopPersonaManifestById.mockResolvedValue(null)

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      new Request('http://localhost/api/desktop/catalog/soul:0xsoul-1'),
      { params: Promise.resolve({ id: 'soul:0xsoul-1' }) },
    )

    expect(response.status).toBe(404)
  })

  it('returns public sprite manifests without auth', async () => {
    mockedFindDesktopPersonaManifestById.mockResolvedValue(makeSoulManifest())

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      new Request('http://localhost/api/desktop/catalog/soul:0xsoul-1'),
      { params: Promise.resolve({ id: 'soul:0xsoul-1' }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.sprite.downloadPolicy).toBe('public')
    expect(mockedRequireDesktopIdentity).not.toHaveBeenCalled()
    expect(mockedFindDesktopPersonaManifestById).toHaveBeenCalledWith(
      'soul:0xsoul-1',
      expect.objectContaining({ publicOnly: true }),
    )
  })

  it('returns 404 for held dynamic souls on the public catalog path', async () => {
    mockedFindDesktopPersonaManifestById.mockResolvedValue(null)

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      new Request('http://localhost/api/desktop/catalog/soul:0xsoul-held'),
      { params: Promise.resolve({ id: 'soul:0xsoul-held' }) },
    )

    expect(response.status).toBe(404)
    expect(mockedFindDesktopPersonaManifestById).toHaveBeenCalledWith(
      'soul:0xsoul-held',
      expect.objectContaining({ publicOnly: true }),
    )
    expect(mockedRequireDesktopIdentity).not.toHaveBeenCalled()
  })

  it('returns 404 for missing sprite metadata', async () => {
    mockedFindDesktopPersonaManifestById.mockResolvedValue(makeSoulManifest({
      spriteDownloadPolicy: 'missing',
      sprite: {
        downloadPolicy: 'missing',
        error: 'Soul metadata object is missing',
      },
    }))

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      new Request('http://localhost/api/desktop/catalog/soul:0xsoul-1'),
      { params: Promise.resolve({ id: 'soul:0xsoul-1' }) },
    )

    expect(response.status).toBe(404)
  })

  it('returns 422 for invalid sprite metadata', async () => {
    mockedFindDesktopPersonaManifestById.mockResolvedValue(makeSoulManifest({
      spriteDownloadPolicy: 'invalid',
      sprite: {
        downloadPolicy: 'invalid',
        error: 'protectedAssets.assetName must be persona-sprite',
      },
    }))

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      new Request('http://localhost/api/desktop/catalog/soul:0xsoul-1'),
      { params: Promise.resolve({ id: 'soul:0xsoul-1' }) },
    )

    expect(response.status).toBe(422)
  })

  it('requires desktop auth for owner-only sprite manifests', async () => {
    mockedFindDesktopPersonaManifestById.mockResolvedValue(makeSoulManifest({
      spriteDownloadPolicy: 'owner_only',
      sprite: {
        downloadPolicy: 'owner_only',
        assetName: 'persona-sprite',
        versionIndex: 1,
        config: { src: 'persona-sprite.png' },
      },
    }))
    mockedRequireDesktopIdentity.mockResolvedValue({
      error: Response.json({ error: 'Please link desktop first' }, { status: 401 }),
    })

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      new Request('http://localhost/api/desktop/catalog/soul:0xsoul-1'),
      { params: Promise.resolve({ id: 'soul:0xsoul-1' }) },
    )

    expect(response.status).toBe(401)
    expect(mockedResolveSoulAssetVersionAccessPayload).not.toHaveBeenCalled()
  })

  it('attaches private asset access for owner-only sprites', async () => {
    mockedFindDesktopPersonaManifestById.mockResolvedValue(makeSoulManifest({
      spriteDownloadPolicy: 'owner_only',
      sprite: {
        downloadPolicy: 'owner_only',
        assetName: 'persona-sprite',
        versionIndex: 1,
        config: { src: 'persona-sprite.png' },
      },
    }))
    mockedRequireDesktopIdentity.mockResolvedValue({ accountId: 'account-123' })
    mockedPrisma.member.findFirst.mockResolvedValue({ id: 'member-123' })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue(['0xwallet123'])
    mockedResolveSoulAssetVersionAccessPayload.mockResolvedValue({
      visibility: 'private',
      artifact: {
        walrusBlobUrl: 'https://walrus.test/blob/private-sprite',
        walrusBlobId: 'private-sprite',
        blobObjectId: '0xblob',
      },
      accessPolicy: {
        packageId: '0xpackage',
        stateObjectId: '0xstate',
        assetsObjectId: '0xassets',
        assetName: 'persona-sprite',
        versionIndex: 1,
        moduleName: 'assets',
        functionName: 'seal_approve_asset_read_owner',
        soulGrantObjectId: null,
        documentIdHex: '0x1234',
      },
      seal: {
        network: 'testnet',
        threshold: 2,
        verifyKeyServers: true,
        serverConfigs: [],
      },
      sealSidecar: {
        encryptedDek: 'AA==',
        iv: 'AAAAAAAAAAAAAAAA',
        cipher: 'AES-GCM-256',
        fileName: 'persona-sprite.png',
        mimeType: 'image/png',
        contentHash: '0'.repeat(64),
      },
      viewerAddress: '0xwallet123',
      accessKind: 'owner',
      sessionTtlMin: 5,
    })

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      new Request('http://localhost/api/desktop/catalog/soul:0xsoul-1'),
      { params: Promise.resolve({ id: 'soul:0xsoul-1' }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.sprite.privateAccess.visibility).toBe('private')
    expect(mockedResolveSoulAssetVersionAccessPayload).toHaveBeenCalledWith({
      soulOnChainId: '0xsoul-1',
      assetName: 'persona-sprite',
      versionIndex: 1,
      viewerAddresses: ['0xwallet123'],
    })
  })

  it('rejects protected sprite manifest when active desktop wallet is not a bound wallet', async () => {
    mockedFindDesktopPersonaManifestById.mockResolvedValue(makeSoulManifest({
      spriteDownloadPolicy: 'owner_only',
      sprite: {
        downloadPolicy: 'owner_only',
        assetName: 'persona-sprite',
        versionIndex: 1,
        config: { src: 'persona-sprite.png' },
      },
    }))
    mockedRequireDesktopIdentity.mockResolvedValue({ accountId: 'account-123' })
    mockedPrisma.member.findFirst.mockResolvedValue({ id: 'member-123' })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([
      '0x00000000000000000000000000000000000000000000000000000000000000aa',
    ])

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      new Request(
        'http://localhost/api/desktop/catalog/soul:0xsoul-1?viewer=0x00000000000000000000000000000000000000000000000000000000000000bb',
      ),
      { params: Promise.resolve({ id: 'soul:0xsoul-1' }) },
    )

    expect(response.status).toBe(403)
    expect(mockedResolveSoulAssetVersionAccessPayload).not.toHaveBeenCalled()
  })

  it('narrows viewerAddresses to the active desktop wallet when it is bound', async () => {
    mockedFindDesktopPersonaManifestById.mockResolvedValue(makeSoulManifest({
      spriteDownloadPolicy: 'owner_only',
      sprite: {
        downloadPolicy: 'owner_only',
        assetName: 'persona-sprite',
        versionIndex: 1,
        config: { src: 'persona-sprite.png' },
      },
    }))
    mockedRequireDesktopIdentity.mockResolvedValue({ accountId: 'account-123' })
    mockedPrisma.member.findFirst.mockResolvedValue({ id: 'member-123' })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([
      '0x00000000000000000000000000000000000000000000000000000000000000aa',
      '0x00000000000000000000000000000000000000000000000000000000000000bb',
    ])
    mockedResolveSoulAssetVersionAccessPayload.mockResolvedValue({
      visibility: 'private',
      artifact: {
        walrusBlobUrl: 'https://walrus.test/blob/private-sprite',
        walrusBlobId: 'private-sprite',
        blobObjectId: '0xblob',
      },
      accessPolicy: {
        packageId: '0xpackage',
        stateObjectId: '0xstate',
        assetsObjectId: '0xassets',
        assetName: 'persona-sprite',
        versionIndex: 1,
        moduleName: 'assets',
        functionName: 'seal_approve_asset_read_owner',
        soulGrantObjectId: null,
        documentIdHex: '0x1234',
      },
      seal: {
        network: 'testnet',
        threshold: 2,
        verifyKeyServers: true,
        serverConfigs: [],
      },
      sealSidecar: {
        encryptedDek: 'AA==',
        iv: 'AAAAAAAAAAAAAAAA',
        cipher: 'AES-GCM-256',
        fileName: 'persona-sprite.png',
        mimeType: 'image/png',
        contentHash: '0'.repeat(64),
      },
      viewerAddress: '0x00000000000000000000000000000000000000000000000000000000000000bb',
      accessKind: 'owner',
      sessionTtlMin: 5,
    })

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      new Request(
        'http://localhost/api/desktop/catalog/soul:0xsoul-1?viewer=0x00000000000000000000000000000000000000000000000000000000000000bb',
      ),
      { params: Promise.resolve({ id: 'soul:0xsoul-1' }) },
    )

    expect(response.status).toBe(200)
    expect(mockedResolveSoulAssetVersionAccessPayload).toHaveBeenCalledWith({
      soulOnChainId: '0xsoul-1',
      assetName: 'persona-sprite',
      versionIndex: 1,
      viewerAddresses: ['0x00000000000000000000000000000000000000000000000000000000000000bb'],
    })
  })
})
