import { expect, it } from 'vitest'
import { metadata } from '../../web/app/community/u/[spaceId]/layout'
it('uses a static profile shell without a SQL-resolved identity/canonical URL', () => {
  expect(metadata.title).toBe('Community profile · Soulidity')
  expect(metadata.alternates).toBeUndefined()
  expect(metadata.robots).toEqual({ index: false, follow: true })
})
