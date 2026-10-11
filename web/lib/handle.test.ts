import { describe, expect, it } from 'vitest'

import { resolveHandleSeed, slugifyHandle } from './handle'

describe('resolveHandleSeed', () => {
  it('prefers displayName over tgName and email', () => {
    expect(resolveHandleSeed({
      displayName: 'Ithinco',
      tgName: 'tg_ithinco',
      email: 'mailbox@example.com',
    })).toBe('Ithinco')
  })

  it('falls back from tgName to email local-part', () => {
    expect(resolveHandleSeed({
      displayName: null,
      tgName: 'tg_ithinco',
      email: 'mailbox@example.com',
    })).toBe('tg_ithinco')

    expect(resolveHandleSeed({
      displayName: null,
      tgName: null,
      email: 'mailbox@example.com',
    })).toBe('mailbox')
  })
})

describe('slugifyHandle', () => {
  it('produces a deterministic lowercased handle with an id-derived suffix', () => {
    expect(slugifyHandle('Ithinco', '063f9df5-60d3-4cec-a9dd-bb74afa5dd5b')).toBe('ithinco_5b')
  })
})
