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
    alias: [
      { find: /^@\//, replacement: `${fileURLToPath(new URL('./web/', import.meta.url))}/` },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      { find: '@db', replacement: fileURLToPath(new URL('./src/db', import.meta.url)) },
      { find: '@bot', replacement: fileURLToPath(new URL('./src/bot', import.meta.url)) },
      { find: '@shared', replacement: fileURLToPath(new URL('./src/shared', import.meta.url)) },
      { find: '@web', replacement: fileURLToPath(new URL('./web', import.meta.url)) },
      { find: '@lib', replacement: fileURLToPath(new URL('./web/lib', import.meta.url)) },
      { find: '@soulidity/shared', replacement: fileURLToPath(new URL('./desktop/packages/shared/src/index.ts', import.meta.url)) },
      { find: 'react/jsx-dev-runtime', replacement: requireExistingAliasTarget('./web/node_modules/react/jsx-dev-runtime.js') },
      { find: 'react/jsx-runtime', replacement: requireExistingAliasTarget('./web/node_modules/react/jsx-runtime.js') },
      { find: 'react-dom/client', replacement: requireExistingAliasTarget('./web/node_modules/react-dom/client.js') },
      { find: 'react-dom', replacement: requireExistingAliasTarget('./web/node_modules/react-dom/index.js') },
      { find: 'react', replacement: requireExistingAliasTarget('./web/node_modules/react/index.js') },
      { find: 'server-only', replacement: requireExistingAliasTarget('./tests/mocks/server-only.ts') },
      { find: 'jose', replacement: requireExistingAliasTarget('./web/node_modules/jose/dist/webapi/index.js') },
      { find: '@mysten/dapp-kit', replacement: requireExistingAliasTarget('./web/node_modules/@mysten/dapp-kit/src/index.ts') },
      // These pin the workspace tests to the web package's bundled ESM entrypoints. Revisit them
      // when upgrading `@mysten/sui`, because the dist layout is an external package contract.
      { find: '@mysten/sui/transactions', replacement: requireExistingAliasTarget('./web/node_modules/@mysten/sui/dist/transactions/index.mjs') },
      { find: '@mysten/sui/bcs', replacement: requireExistingAliasTarget('./web/node_modules/@mysten/sui/dist/bcs/index.mjs') },
    ],
  },
  test: {
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.worktrees/**',
      // Playwright specs live alongside vitest files but use the Electron
      // driver from @playwright/test; they are invoked via `playwright test`
      // from the desktop workspace instead.
      'desktop/apps/desktop/e2e/**',
      // The desktop workspace keeps local/ignored Vitest scratch specs under
      // desktop/**. Root `npm test` should cover tracked root/web tests only;
      // desktop package validation is invoked from the desktop workspace.
      'desktop/**/*.test.ts',
    ],
  },
})
