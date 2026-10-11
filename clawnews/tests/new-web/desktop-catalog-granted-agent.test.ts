import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const mockedRequireDesktopIdentity = vi.hoisted(() => vi.fn())
const mockedFindDesktopPersonaManifestById = vi.hoisted(() => vi.fn())
const mockedGetMemberSuiWalletAddresses = vi.hoisted(() => vi.fn())
const mockedResolveContentAccessPayload = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  member: { findFirst: vi.fn() },
  soulAsset: { findUnique: vi.fn() },
  soulContentVersionRecord: { findFirst: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))

vi.mock('@/lib/desktop/auth', async () => {
  const actual = await vi.importActual<typeof import('../../web/lib/desktop/auth')>('@/lib/desktop/auth')
  return {
    ...actual,
    requireDesktopIdentity: mockedRequireDesktopIdentity,
  }
})
vi.mock('@web/lib/desktop/auth', async () => {
  const actual = await vi.importActual<typeof import('../../web/lib/desktop/auth')>('@web/lib/desktop/auth')
  return {
    ...actual,
    requireDesktopIdentity: mockedRequireDesktopIdentity,
  }
})

vi.mock('@/lib/desktop/repository', () => ({
  findDesktopPersonaManifestById: mockedFindDesktopPersonaManifestById,
}))
vi.mock('@web/lib/desktop/repository', () => ({
  findDesktopPersonaManifestById: mockedFindDesktopPersonaManifestById,
}))

vi.mock('@/lib/auth/sui-wallet', () => ({
  getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses,
}))
vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses,
}))

vi.mock('@/lib/soulidity/access', async () => {
  const actual = await vi.importActual<typeof import('../../web/lib/soulidity/access')>('@/lib/soulidity/access')
  return {
    ...actual,
    resolveContentAccessPayload: mockedResolveContentAccessPayload,
  }
})
vi.mock('@web/lib/soulidity/access', async () => {
  const actual = await vi.importActual<typeof import('../../web/lib/soulidity/access')>('@web/lib/soulidity/access')
  return {
    ...actual,
    resolveContentAccessPayload: mockedResolveContentAccessPayload,
  }
})

vi.mock('@soulidity/sdk', async () => {
  const actual = await vi.importActual<typeof import('@soulidity/sdk')>('@soulidity/sdk')
  return {
    ...actual,
    getRequiredSoulidityEnv: () => '0xpkg',
    downloadPolicyFromU8: () => 'owner_only' as const,
    toProjectionNumber: () => 0,
    KIND_SPRITE: 3,
  }
})

// ── Fixtures ─────────────────────────────────────────────────────────────

const ACCOUNT_ID = 'account-1'
const HUMAN_MEMBER_ID = '11111111-1111-4111-8111-111111111111'
const HUMAN_WALLET = '0x' + 'a'.repeat(64)
const PET_AGENT_ADDRESS = '0x' + 'b'.repeat(64)
const SOUL_ON_CHAIN_ID = '0xsoul-1'
const STATE_ON_CHAIN_ID = '0xstate-1'
const CONTENT_ON_CHAIN_ID = '0xcontent-1'
const SPRITE_ASSET_NAME = 'persona-sprite'
const SPRITE_VERSION_INDEX = 0
const CATALOG_ID = `soul:${SOUL_ON_CHAIN_ID}`

const PROTECTED_MANIFEST = {
  id: CATALOG_ID,
  sourceType: 'soul' as const,
  sourceRef: SOUL_ON_CHAIN_ID,
  sprite: {
    assetName: SPRITE_ASSET_NAME,
    versionIndex: SPRITE_VERSION_INDEX,
    fileName: 'sprite.png',
    configFileName: 'sprite-config.json',
    downloadPolicy: 'owner_only' as const,
    config: null,
    publicUrl: null,
    privateAccess: null,
    contentOnChainId: CONTENT_ON_CHAIN_ID,
    error: null,
  },
}

const VERSION_ROW = {
  id: 'version-1',
  soulOnChainId: SOUL_ON_CHAIN_ID,
  contentOnChainId: CONTENT_ON_CHAIN_ID,
  kind: 3,
  kindName: 'sprite',
  name: SPRITE_ASSET_NAME,
  versionIndex: SPRITE_VERSION_INDEX,
  blobObjectId: '0xblob',
  blobId: 'blob-1',
  readModeMask: 2,
  opMask: 1,
  grantScopeMask: 8,
  isPublic: false,
  sealEncrypted: true,
  downloadPolicy: 1,
  sealSidecar: { documentId: '0xdocid' },
  deletedAt: null,
  purgedAt: null,
  createdAtMs: 0n,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

function resetMocks() {
  vi.resetAllMocks()
}

beforeEach(resetMocks)

function buildRequest(query: string = '', headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/desktop/catalog/${encodeURIComponent(CATALOG_ID)}${query}`, {
    method: 'GET',
    headers,
  })
}

function asParams() {
  return { params: Promise.resolve({ id: CATALOG_ID }) }
}

describe('GET /api/desktop/catalog/[id] — desktop bearer (granted-agent) viewer selection', () => {
  it('uses the desktop pet agent address as the viewer (not the human owner wallet)', async () => {
    // First findDesktopPersonaManifestById call (publicOnly: true) returns null
    // (held Soul). Second call inside resolveAuthenticatedHeldSoulManifest
    // returns the manifest. Both share the same mock to keep logic tight.
    mockedFindDesktopPersonaManifestById.mockImplementation((id: string, opts?: { publicOnly?: boolean }) => {
      if (opts?.publicOnly) return Promise.resolve(null)
      return Promise.resolve(PROTECTED_MANIFEST)
    })
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: ACCOUNT_ID,
      desktopPet: {
        id: 'pet-1',
        accountId: ACCOUNT_ID,
        agentAddress: PET_AGENT_ADDRESS,
        agentMemberId: 'agent-member',
      },
    })
    mockedPrisma.member.findFirst.mockResolvedValue({ id: HUMAN_MEMBER_ID })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([HUMAN_WALLET])
    mockedPrisma.soulAsset.findUnique
      // ownership check inside resolveAuthenticatedHeldSoulManifest
      .mockResolvedValueOnce({ currentOwnerMemberId: HUMAN_MEMBER_ID })
      // detailed soul lookup near the end of GET
      .mockResolvedValueOnce({
        onChainId: SOUL_ON_CHAIN_ID,
        stateOnChainId: STATE_ON_CHAIN_ID,
        contentOnChainId: CONTENT_ON_CHAIN_ID,
        paidAccessListOnChainId: null,
      })
    mockedPrisma.soulContentVersionRecord.findFirst.mockResolvedValue(VERSION_ROW)

    mockedResolveContentAccessPayload.mockResolvedValue({
      visibility: 'sealed',
      slot: { kind: 3, kindName: 'sprite', name: SPRITE_ASSET_NAME, versionIndex: SPRITE_VERSION_INDEX, readModeMask: 2, opMask: 1, grantScopeMask: 8, isPublic: false, sealEncrypted: true, downloadPolicy: 'owner_only', deletedAt: null, purgedAt: null },
      artifact: { walrusBlobUrl: null, walrusBlobId: 'blob-1', blobObjectId: '0xblob' },
      accessPolicy: {
        packageId: '0xpkg',
        stateObjectId: STATE_ON_CHAIN_ID,
        contentObjectId: CONTENT_ON_CHAIN_ID,
        kind: 3,
        name: SPRITE_ASSET_NAME,
        versionIndex: SPRITE_VERSION_INDEX,
        moduleName: 'content',
        functionName: 'seal_approve_content_granted_agent',
        soulGrantObjectId: '0xgrant',
        paidAccessListOnChainId: null,
        documentIdHex: '0xdocid',
      },
      seal: { keyServers: [], threshold: 1 },
      sealSidecar: VERSION_ROW.sealSidecar,
      viewerAddress: PET_AGENT_ADDRESS,
      accessKind: 'granted-agent',
      sessionTtlMin: 30,
    })

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      buildRequest('', { authorization: 'Bearer dtk_xxx' }),
      asParams(),
    )
    expect(response.status).toBe(200)

    const access = mockedResolveContentAccessPayload.mock.calls[0]?.[0] as {
      viewerAddresses: string[]
    }
    // Critical assertion: the viewer is the pet agent address, NOT the bound
    // human wallet. Without this, granted-agent access would never resolve
    // for desktop bearer callers.
    expect(access.viewerAddresses).toEqual([PET_AGENT_ADDRESS])
  })

  it('rejects a `viewer` query param that does not equal the pet agent address', async () => {
    mockedFindDesktopPersonaManifestById.mockImplementation((id: string, opts?: { publicOnly?: boolean }) => {
      if (opts?.publicOnly) return Promise.resolve(null)
      return Promise.resolve(PROTECTED_MANIFEST)
    })
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: ACCOUNT_ID,
      desktopPet: {
        id: 'pet-1',
        accountId: ACCOUNT_ID,
        agentAddress: PET_AGENT_ADDRESS,
        agentMemberId: 'agent-member',
      },
    })
    mockedPrisma.member.findFirst.mockResolvedValue({ id: HUMAN_MEMBER_ID })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([HUMAN_WALLET])
    mockedPrisma.soulAsset.findUnique
      .mockResolvedValueOnce({ currentOwnerMemberId: HUMAN_MEMBER_ID })

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      buildRequest(`?viewer=${encodeURIComponent(HUMAN_WALLET)}`, { authorization: 'Bearer dtk_xxx' }),
      asParams(),
    )
    expect(response.status).toBe(403)
    expect(mockedResolveContentAccessPayload).not.toHaveBeenCalled()
  })

  it('accepts the matching `viewer` query param on the desktop bearer path (no-op)', async () => {
    mockedFindDesktopPersonaManifestById.mockImplementation((id: string, opts?: { publicOnly?: boolean }) => {
      if (opts?.publicOnly) return Promise.resolve(null)
      return Promise.resolve(PROTECTED_MANIFEST)
    })
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: ACCOUNT_ID,
      desktopPet: {
        id: 'pet-1',
        accountId: ACCOUNT_ID,
        agentAddress: PET_AGENT_ADDRESS,
        agentMemberId: 'agent-member',
      },
    })
    mockedPrisma.member.findFirst.mockResolvedValue({ id: HUMAN_MEMBER_ID })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([HUMAN_WALLET])
    mockedPrisma.soulAsset.findUnique
      .mockResolvedValueOnce({ currentOwnerMemberId: HUMAN_MEMBER_ID })
      .mockResolvedValueOnce({
        onChainId: SOUL_ON_CHAIN_ID,
        stateOnChainId: STATE_ON_CHAIN_ID,
        contentOnChainId: CONTENT_ON_CHAIN_ID,
        paidAccessListOnChainId: null,
      })
    mockedPrisma.soulContentVersionRecord.findFirst.mockResolvedValue(VERSION_ROW)
    mockedResolveContentAccessPayload.mockResolvedValue({
      visibility: 'sealed',
      slot: { kind: 3, kindName: 'sprite', name: SPRITE_ASSET_NAME, versionIndex: SPRITE_VERSION_INDEX, readModeMask: 2, opMask: 1, grantScopeMask: 8, isPublic: false, sealEncrypted: true, downloadPolicy: 'owner_only', deletedAt: null, purgedAt: null },
      artifact: { walrusBlobUrl: null, walrusBlobId: 'blob-1', blobObjectId: '0xblob' },
      accessPolicy: {
        packageId: '0xpkg', stateObjectId: STATE_ON_CHAIN_ID, contentObjectId: CONTENT_ON_CHAIN_ID,
        kind: 3, name: SPRITE_ASSET_NAME, versionIndex: SPRITE_VERSION_INDEX,
        moduleName: 'content', functionName: 'seal_approve_content_granted_agent',
        soulGrantObjectId: '0xgrant', paidAccessListOnChainId: null, documentIdHex: '0xdocid',
      },
      seal: { keyServers: [], threshold: 1 },
      sealSidecar: VERSION_ROW.sealSidecar,
      viewerAddress: PET_AGENT_ADDRESS,
      accessKind: 'granted-agent',
      sessionTtlMin: 30,
    })

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      buildRequest(`?viewer=${encodeURIComponent(PET_AGENT_ADDRESS)}`, { authorization: 'Bearer dtk_xxx' }),
      asParams(),
    )
    expect(response.status).toBe(200)
  })
})
