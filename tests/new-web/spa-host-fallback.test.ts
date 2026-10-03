import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { resolve } from 'node:path'

let server: ViteDevServer, origin: string
beforeAll(async () => {
  server = await createServer({ configFile: resolve('web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Expected ephemeral HTTP port')
  origin = `http://127.0.0.1:${address.port}`
})
afterAll(async () => { await server?.close() })

it.each(['/souls/0xfuture/sell/authorize?from=bookmark', '/collections/0xfuture', '/community/u/not-built-yet', '/unknown-page'])(
  'real Vite document fallback keeps future deep URL %s', async path => {
    const response = await fetch(origin + path, { headers: { Accept: 'text/html' } })
    expect(response.status).toBe(200)
    expect(response.url).toBe(origin + path)
    const html = await response.text()
    expect(html).toContain('id="root"')
    expect(html).toContain('/spa/main.tsx')
    expect(html).toContain('/theme-bootstrap.js')
  },
)

it('transforms the actual SPA entry and preserves original provider/shell imports', async () => {
  const response = await server.transformRequest('/spa/main.tsx')
  expect(response?.code).toContain('app-providers')
  expect(response?.code).toContain('app-shell')
  expect(response?.code).toContain('/app/souls/[id]/page.tsx')
  expect(response?.code).not.toContain('import("/app/layout.tsx")')
})
