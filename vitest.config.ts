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
      'react/jsx-dev-runtime': requireExistingAliasTarget('./web/node_modules/react/jsx-dev-runtime.js'),
      'react/jsx-runtime': requireExistingAliasTarget('./web/node_modules/react/jsx-runtime.js'),
      'react-dom/client': requireExistingAliasTarget('./web/node_modules/react-dom/client.js'),
      'react-dom': requireExistingAliasTarget('./web/node_modules/react-dom/index.js'),
      react: requireExistingAliasTarget('./web/node_modules/react/index.js'),
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
