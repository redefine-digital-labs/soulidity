import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

function requireExistingAliasTarget(relativePath: string) {
  const resolved = fileURLToPath(new URL(relativePath, import.meta.url))
  if (!existsSync(resolved)) {
    throw new Error(`Vitest alias target is missing: ${relativePath}`)
  }
  return resolved
}

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@bot': fileURLToPath(new URL('./src/bot', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@web': fileURLToPath(new URL('./web', import.meta.url)),
      // These pin the workspace tests to the web package's bundled ESM entrypoints. Revisit them
      // when upgrading `@mysten/sui`, because the dist layout is an external package contract.
      '@mysten/sui/transactions': requireExistingAliasTarget('./web/node_modules/@mysten/sui/dist/transactions/index.mjs'),
      '@mysten/sui/bcs': requireExistingAliasTarget('./web/node_modules/@mysten/sui/dist/bcs/index.mjs'),
    },
  },
  test: {
    environment: 'node',
  },
})
