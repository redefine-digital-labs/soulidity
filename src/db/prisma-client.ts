import * as prismaClientModule from '../../generated/prisma/client'

type PrismaClientModule = typeof import('../../generated/prisma/client')
type PrismaClientNamespace = PrismaClientModule & { default?: PrismaClientModule }

function resolveRuntimeExports(module: PrismaClientNamespace): PrismaClientModule {
  if (Object.prototype.hasOwnProperty.call(module, 'PrismaClient')) {
    return module
  }

  if (module.default?.PrismaClient) {
    return module.default
  }

  throw new Error('Failed to resolve Prisma generated client runtime exports')
}

function resolvePrismaNamespace(module: PrismaClientNamespace) {
  if (Object.prototype.hasOwnProperty.call(module, 'Prisma')) {
    return module.Prisma
  }

  if (module.default?.Prisma) {
    return module.default.Prisma
  }

  throw new Error('Failed to resolve Prisma generated client namespace exports')
}

const runtimeExports = resolveRuntimeExports(prismaClientModule as PrismaClientNamespace)
const PrismaRuntime = resolvePrismaNamespace(prismaClientModule as PrismaClientNamespace)

const PrismaClientCtor = runtimeExports.PrismaClient

export { PrismaClientCtor as PrismaClient }
export { PrismaRuntime }
export type PrismaClient = InstanceType<typeof PrismaClientCtor>
export type { Prisma } from '../../generated/prisma/client'
