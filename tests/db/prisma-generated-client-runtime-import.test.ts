import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const rootGeneratedClientSourcePath = resolve(repoRoot, 'generated/prisma/client.ts')
const rootGeneratedClientRuntimeImport = pathToFileURL(resolve(repoRoot, 'generated/prisma/client.js')).href

describe('root prisma generated client runtime import', () => {
  it('provides a root-generated Prisma client for the root runtime', async () => {
    expect(existsSync(rootGeneratedClientSourcePath)).toBe(true)

    const imported = await import(rootGeneratedClientRuntimeImport)
    expect(typeof imported.PrismaClient).toBe('function')

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
