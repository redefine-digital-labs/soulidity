import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const prismaShimSourcePath = resolve(repoRoot, 'src/db/prisma-client.ts')
const prismaShimRuntimeImport = pathToFileURL(resolve(repoRoot, 'src/db/prisma-client.js')).href

describe('root prisma generated client runtime import', () => {
  it('provides PrismaClient and Prisma runtime helpers through the root shim for the root runtime', async () => {
    expect(existsSync(prismaShimSourcePath)).toBe(true)

    const imported = await import(prismaShimRuntimeImport)
    expect(typeof imported.PrismaClient).toBe('function')
    expect(imported.PrismaRuntime).toBeTruthy()
    expect(() => execFileSync(
      process.execPath,
      ['--import', 'tsx', '--eval', "await import('./src/db/database.ts')"],
      {
        cwd: repoRoot,
        stdio: 'pipe',
      },
    )).not.toThrow()
  })
})
