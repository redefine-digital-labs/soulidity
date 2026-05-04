import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockClient = {
  rawItem: {
    findUnique: ReturnType<typeof vi.fn>
  }
  $disconnect: ReturnType<typeof vi.fn>
}

const createdClients: MockClient[] = []
const queuedClients: MockClient[] = []
const adapterOptions: Array<{ connectionString: string }> = []

function createClient(): MockClient {
  return {
    rawItem: {
      findUnique: vi.fn(),
    },
    $disconnect: vi.fn(async () => {}),
  }
}

class MockPrismaClient {
  constructor() {
    const client = queuedClients.shift() ?? createClient()
    createdClients.push(client)
    return client
  }
}

class MockPrismaPg {
  constructor(options: { connectionString: string }) {
    adapterOptions.push(options)
    return options
  }
}

vi.mock('../../src/db/prisma-client.js', () => ({
  PrismaClient: MockPrismaClient,
}))

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: MockPrismaPg,
}))

function makeClosedConnectionError(): Error & {
  code: string
  meta: {
    driverAdapterError: {
      cause: {
        code: string
      }
      message: string
    }
  }
} {
  const error = new Error('Server has closed the connection.') as Error & {
    code: string
    meta: {
      driverAdapterError: {
        cause: {
          code: string
        }
        message: string
      }
    }
  }

  error.code = 'P1017'
  error.meta = {
    driverAdapterError: {
      cause: {
        code: 'ConnectionClosed',
      },
      message: 'ConnectionClosed',
    },
  }

  return error
}

describe('createPrisma', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    createdClients.length = 0
    queuedClients.length = 0
    adapterOptions.length = 0
    process.env.DATABASE_URL = 'postgresql://example'
  })

  it('recreates PrismaClient once when the pool connection was closed', async () => {
    const firstClient = createClient()
    firstClient.rawItem.findUnique.mockRejectedValueOnce(makeClosedConnectionError())

    const secondClient = createClient()
    secondClient.rawItem.findUnique.mockResolvedValueOnce({ id: 'raw-1' })

    queuedClients.push(firstClient, secondClient)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createPrisma } = await import('../../src/db/database.js')
    const prisma = createPrisma()

    await expect(prisma.rawItem.findUnique({ where: { id: 'raw-1' } })).resolves.toEqual({ id: 'raw-1' })

    expect(createdClients).toHaveLength(2)
    expect(firstClient.rawItem.findUnique).toHaveBeenCalledTimes(1)
    expect(firstClient.$disconnect).toHaveBeenCalledTimes(1)
    expect(secondClient.rawItem.findUnique).toHaveBeenCalledTimes(1)
    expect(adapterOptions).toHaveLength(2)
    expect(warnSpy).toHaveBeenCalledWith('[db]', 'Prisma connection closed; recreated PrismaClient.')
  })

  it('reconnects but does not retry write operations on transient connection errors', async () => {
    const firstClient = createClient() as MockClient & { rawItem: { create: ReturnType<typeof vi.fn> } }
    firstClient.rawItem.create = vi.fn().mockRejectedValueOnce(makeClosedConnectionError())

    const secondClient = createClient()
    queuedClients.push(firstClient, secondClient)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createPrisma } = await import('../../src/db/database.js')
    const prisma = createPrisma()

    await expect((prisma.rawItem as any).create({ data: {} })).rejects.toThrow()

    expect(createdClients).toHaveLength(2)
    expect(firstClient.rawItem.create).toHaveBeenCalledTimes(1)
    expect(firstClient.$disconnect).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('[db]', 'Prisma connection closed; recreated PrismaClient.')
  })

  it('does not retry non-connection Prisma errors', async () => {
    const firstClient = createClient()
    const error = Object.assign(new Error('boom'), { code: 'P2002' })
    firstClient.rawItem.findUnique.mockRejectedValueOnce(error)
    queuedClients.push(firstClient)

    const { createPrisma } = await import('../../src/db/database.js')
    const prisma = createPrisma()

    await expect(prisma.rawItem.findUnique({ where: { id: 'raw-1' } })).rejects.toBe(error)

    expect(createdClients).toHaveLength(1)
    expect(firstClient.$disconnect).not.toHaveBeenCalled()
  })
})
