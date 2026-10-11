import { PrismaClient } from '@db/prisma-client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

function makePrisma() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter })
}

function getPrismaClient() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = makePrisma()
  }
  return globalForPrisma.prisma
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient()
    const value = Reflect.get(client as object, property, receiver)

    if (typeof value === 'function') {
      return value.bind(client)
    }

    return value
  },
}) as PrismaClient
