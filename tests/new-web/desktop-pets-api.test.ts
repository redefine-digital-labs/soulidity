import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedRequireMutationIdentity = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  desktopPet: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  member: {
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}))

function resetMocks() {
  vi.resetAllMocks()
  mockedPrisma.$transaction.mockImplementation(
    (fn: (tx: typeof mockedPrisma) => Promise<unknown>) => fn(mockedPrisma),
  )
}

vi.mock('@/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))

vi.mock('@/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
  requireMutationIdentity: mockedRequireMutationIdentity,
}))
vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
  requireMutationIdentity: mockedRequireMutationIdentity,
}))

const ACCOUNT_ID = 'account-1'
const OTHER_ACCOUNT_ID = 'account-2'
const PET_ID = '11111111-1111-4111-8111-111111111111'
const AGENT_MEMBER_ID = '22222222-2222-4222-8222-222222222222'
const HUMAN_MEMBER_ID = '33333333-3333-4333-8333-333333333333'

const HUMAN_IDENTITY = {
  accountId: ACCOUNT_ID,
  memberId: HUMAN_MEMBER_ID,
  kind: 'human' as const,
}

const AGENT_IDENTITY = {
  accountId: ACCOUNT_ID,
  memberId: AGENT_MEMBER_ID,
  kind: 'agent' as const,
}

function buildPetRow(overrides: Partial<{
  id: string
  label: string
  agentAddress: string
  lastSeenAt: Date | null
  createdAt: Date
  updatedAt: Date
  agentStatus: string | null
  apiKeyHash: string | null
}> = {}) {
  return {
    id: overrides.id ?? PET_ID,
    label: overrides.label ?? 'Desktop pet',
    agentAddress: overrides.agentAddress ?? '0xagent',
    lastSeenAt: 'lastSeenAt' in overrides ? overrides.lastSeenAt! : new Date('2026-05-07T00:00:00Z'),
    createdAt: overrides.createdAt ?? new Date('2026-05-01T00:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-05-06T00:00:00Z'),
    agentMember: {
      agentStatus: 'agentStatus' in overrides ? overrides.agentStatus! : 'active',
      apiKeyHash: 'apiKeyHash' in overrides ? overrides.apiKeyHash! : 'hash-abc',
    },
  }
}

function jsonRequest(method: string, body?: unknown) {
  return new Request(`http://localhost/api/account/pets/${PET_ID}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

// ── GET /api/account/pets ────────────────────────────────────────────────

describe('GET /api/account/pets', () => {
  beforeEach(resetMocks)

  it('returns this account\'s pets and never leaks the apiKeyHash', async () => {
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findMany.mockResolvedValue([
      buildPetRow({ apiKeyHash: 'secret-hash', agentStatus: 'active' }),
    ])

    const { GET } = await import('../../web/app/api/account/pets/route')
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockedPrisma.desktopPet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: ACCOUNT_ID },
        orderBy: { updatedAt: 'desc' },
      }),
    )
    expect(body.pets).toHaveLength(1)
    const [pet] = body.pets
    expect(pet.id).toBe(PET_ID)
    expect(pet.label).toBe('Desktop pet')
    expect(pet.agentStatus).toBe('active')
    expect(pet.hasActiveApiKey).toBe(true)
    expect(pet).not.toHaveProperty('apiKeyHash')
    // The serialized payload itself must not contain the hash anywhere.
    expect(JSON.stringify(body)).not.toContain('secret-hash')
  })

  it('returns hasActiveApiKey=false when the bound member was rotated externally', async () => {
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findMany.mockResolvedValue([
      buildPetRow({ agentStatus: 'active', apiKeyHash: null }),
    ])

    const { GET } = await import('../../web/app/api/account/pets/route')
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.pets[0].hasActiveApiKey).toBe(false)
  })

  it('scopes findMany by accountId so other accounts\' pets are not returned', async () => {
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findMany.mockImplementation(async ({ where }: { where: { accountId: string } }) => {
      // Simulate the DB filtering to only this account's rows.
      if (where.accountId === ACCOUNT_ID) {
        return [buildPetRow()]
      }
      return [buildPetRow({ id: 'pet-other' })]
    })

    const { GET } = await import('../../web/app/api/account/pets/route')
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.pets).toHaveLength(1)
    expect(body.pets[0].id).toBe(PET_ID)
    // Confirm the DB call carried our account, not an arbitrary one.
    expect(mockedPrisma.desktopPet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: ACCOUNT_ID } }),
    )
  })

  it('returns 401 when no identity is resolved', async () => {
    mockedRequireIdentity.mockResolvedValue({
      error: Response.json({ error: 'Sign in' }, { status: 401 }),
    })

    const { GET } = await import('../../web/app/api/account/pets/route')
    const response = await GET()

    expect(response.status).toBe(401)
    expect(mockedPrisma.desktopPet.findMany).not.toHaveBeenCalled()
  })

  it('returns 403 for an agent identity (route is human-only)', async () => {
    mockedRequireIdentity.mockResolvedValue({ identity: AGENT_IDENTITY })

    const { GET } = await import('../../web/app/api/account/pets/route')
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toMatch(/human/i)
    expect(mockedPrisma.desktopPet.findMany).not.toHaveBeenCalled()
  })
})

// ── PATCH /api/account/pets/[id] ─────────────────────────────────────────

describe('PATCH /api/account/pets/[id]', () => {
  beforeEach(resetMocks)

  it('renames the pet and returns the canonical shape', async () => {
    mockedRequireMutationIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.update.mockResolvedValue(
      buildPetRow({ label: 'Renamed pet' }),
    )

    const { PATCH } = await import('../../web/app/api/account/pets/[id]/route')
    const request = jsonRequest('PATCH', { label: 'Renamed pet' })
    const response = await PATCH(request as never, { params: Promise.resolve({ id: PET_ID }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.pet.label).toBe('Renamed pet')
    expect(body.pet).not.toHaveProperty('apiKeyHash')

    expect(mockedPrisma.desktopPet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PET_ID, accountId: ACCOUNT_ID },
        data: { label: 'Renamed pet' },
      }),
    )
  })

  it('rejects empty / missing labels with 400', async () => {
    mockedRequireMutationIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })

    const { PATCH } = await import('../../web/app/api/account/pets/[id]/route')

    const emptyResponse = await PATCH(
      jsonRequest('PATCH', { label: '   ' }) as never,
      { params: Promise.resolve({ id: PET_ID }) },
    )
    expect(emptyResponse.status).toBe(400)

    const missingResponse = await PATCH(
      jsonRequest('PATCH', {}) as never,
      { params: Promise.resolve({ id: PET_ID }) },
    )
    expect(missingResponse.status).toBe(400)

    expect(mockedPrisma.desktopPet.update).not.toHaveBeenCalled()
  })

  it('rejects oversized labels (>64 chars) with 400', async () => {
    mockedRequireMutationIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })

    const { PATCH } = await import('../../web/app/api/account/pets/[id]/route')
    const longLabel = 'x'.repeat(65)
    const response = await PATCH(
      jsonRequest('PATCH', { label: longLabel }) as never,
      { params: Promise.resolve({ id: PET_ID }) },
    )

    expect(response.status).toBe(400)
    expect(mockedPrisma.desktopPet.update).not.toHaveBeenCalled()
  })

  it('returns 404 when the pet id does not exist (P2025)', async () => {
    mockedRequireMutationIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    const error = Object.assign(new Error('No record'), { code: 'P2025' })
    mockedPrisma.desktopPet.update.mockRejectedValue(error)

    const { PATCH } = await import('../../web/app/api/account/pets/[id]/route')
    const response = await PATCH(
      jsonRequest('PATCH', { label: 'New label' }) as never,
      { params: Promise.resolve({ id: PET_ID }) },
    )

    expect(response.status).toBe(404)
  })

  it('returns 404 when the pet belongs to a different account (P2025 because the where clause excludes it)', async () => {
    mockedRequireMutationIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    // The route always passes `accountId: identity.accountId` in the where,
    // so a row owned by another account presents to Prisma as "not found".
    const error = Object.assign(new Error('No record'), { code: 'P2025' })
    mockedPrisma.desktopPet.update.mockImplementation(async ({ where }: { where: { id: string; accountId: string } }) => {
      if (where.accountId !== ACCOUNT_ID) {
        // Defensive — the route should never pass a foreign accountId.
        throw new Error('cross-account update attempted')
      }
      throw error
    })

    const { PATCH } = await import('../../web/app/api/account/pets/[id]/route')
    const response = await PATCH(
      jsonRequest('PATCH', { label: 'New label' }) as never,
      { params: Promise.resolve({ id: PET_ID }) },
    )

    expect(response.status).toBe(404)
    expect(mockedPrisma.desktopPet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PET_ID, accountId: ACCOUNT_ID },
      }),
    )
  })

  it('returns 401 when the session is missing', async () => {
    mockedRequireMutationIdentity.mockResolvedValue({
      error: Response.json({ error: 'Sign in' }, { status: 401 }),
    })

    const { PATCH } = await import('../../web/app/api/account/pets/[id]/route')
    const response = await PATCH(
      jsonRequest('PATCH', { label: 'Anything' }) as never,
      { params: Promise.resolve({ id: PET_ID }) },
    )

    expect(response.status).toBe(401)
    expect(mockedPrisma.desktopPet.update).not.toHaveBeenCalled()
  })

  it('returns 403 for an agent identity', async () => {
    mockedRequireMutationIdentity.mockResolvedValue({ identity: AGENT_IDENTITY })

    const { PATCH } = await import('../../web/app/api/account/pets/[id]/route')
    const response = await PATCH(
      jsonRequest('PATCH', { label: 'Anything' }) as never,
      { params: Promise.resolve({ id: PET_ID }) },
    )

    expect(response.status).toBe(403)
    expect(mockedPrisma.desktopPet.update).not.toHaveBeenCalled()
  })
})

// ── DELETE /api/account/pets/[id] ────────────────────────────────────────

describe('DELETE /api/account/pets/[id]', () => {
  beforeEach(resetMocks)

  it('removes the pet, disables the agent member, and clears every key/rotation field', async () => {
    mockedRequireMutationIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      accountId: ACCOUNT_ID,
      agentMemberId: AGENT_MEMBER_ID,
    })
    mockedPrisma.desktopPet.delete.mockResolvedValue({ id: PET_ID })
    mockedPrisma.member.update.mockResolvedValue({ id: AGENT_MEMBER_ID })

    const { DELETE } = await import('../../web/app/api/account/pets/[id]/route')
    const response = await DELETE(
      jsonRequest('DELETE') as never,
      { params: Promise.resolve({ id: PET_ID }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true })

    expect(mockedPrisma.desktopPet.findUnique).toHaveBeenCalledWith({
      where: { id: PET_ID },
      select: { accountId: true, agentMemberId: true },
    })
    expect(mockedPrisma.desktopPet.delete).toHaveBeenCalledWith({
      where: { id: PET_ID, accountId: ACCOUNT_ID },
    })
    expect(mockedPrisma.member.update).toHaveBeenCalledWith({
      where: { id: AGENT_MEMBER_ID },
      data: {
        agentStatus: 'disabled',
        apiKey: null,
        apiKeyHash: null,
        apiKeyRotationId: null,
        pendingApiKeyHash: null,
        pendingApiKeyRotationId: null,
        pendingApiKeyRotationExpiresAt: null,
      },
    })
  })

  it('returns 404 when the pet does not exist', async () => {
    mockedRequireMutationIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(null)

    const { DELETE } = await import('../../web/app/api/account/pets/[id]/route')
    const response = await DELETE(
      jsonRequest('DELETE') as never,
      { params: Promise.resolve({ id: PET_ID }) },
    )

    expect(response.status).toBe(404)
    expect(mockedPrisma.desktopPet.delete).not.toHaveBeenCalled()
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
  })

  it('returns 404 when the pet belongs to a different account (cross-account isolation)', async () => {
    mockedRequireMutationIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      accountId: OTHER_ACCOUNT_ID,
      agentMemberId: AGENT_MEMBER_ID,
    })

    const { DELETE } = await import('../../web/app/api/account/pets/[id]/route')
    const response = await DELETE(
      jsonRequest('DELETE') as never,
      { params: Promise.resolve({ id: PET_ID }) },
    )

    expect(response.status).toBe(404)
    // Crucially: nothing was deleted, no foreign member was disabled.
    expect(mockedPrisma.desktopPet.delete).not.toHaveBeenCalled()
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
  })

  it('returns 401 without a session', async () => {
    mockedRequireMutationIdentity.mockResolvedValue({
      error: Response.json({ error: 'Sign in' }, { status: 401 }),
    })

    const { DELETE } = await import('../../web/app/api/account/pets/[id]/route')
    const response = await DELETE(
      jsonRequest('DELETE') as never,
      { params: Promise.resolve({ id: PET_ID }) },
    )

    expect(response.status).toBe(401)
    expect(mockedPrisma.desktopPet.findUnique).not.toHaveBeenCalled()
    expect(mockedPrisma.desktopPet.delete).not.toHaveBeenCalled()
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
  })

  it('returns 403 for an agent identity', async () => {
    mockedRequireMutationIdentity.mockResolvedValue({ identity: AGENT_IDENTITY })

    const { DELETE } = await import('../../web/app/api/account/pets/[id]/route')
    const response = await DELETE(
      jsonRequest('DELETE') as never,
      { params: Promise.resolve({ id: PET_ID }) },
    )

    expect(response.status).toBe(403)
    expect(mockedPrisma.desktopPet.findUnique).not.toHaveBeenCalled()
  })
})
