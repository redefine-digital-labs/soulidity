import { describe, expect, it } from 'vitest'

import { proxy } from '../../new-web/proxy.ts'

const gatedClientRoutes = [
  '/create',
  '/create/content',
  '/import',
  '/import/upload',
  '/my-souls',
  '/profile',
  '/wrap-link',
  '/wrap-link/personal',
  '/wrap-link/collection/configure',
  '/souls/soul-1/sell',
  '/souls/soul-1/sell/authorize',
]

describe('new-web proxy auth behavior', () => {
  it('does not redirect unauthenticated client-gated pages back to the homepage', () => {
    for (const pathname of gatedClientRoutes) {
      const response = proxy({
        nextUrl: new URL(`https://example.com${pathname}`),
        cookies: {
          get: () => undefined,
        },
      } as never)

      expect(response.status, pathname).not.toBeGreaterThanOrEqual(300)
      expect(response.headers.get('location'), pathname).toBeNull()
    }
  })
})
