import { describe, expect, it } from 'vitest'

import {
  createPassGrantSingleFlight,
  getDisplayedAgentGrant,
  getPassGrantSuccessMessage,
} from '../../web/lib/souls/pass-grant-ui.ts'

describe('pass grant UI helpers', () => {
  it('clears the displayed grant immediately after a successful revoke override', () => {
    expect(getDisplayedAgentGrant('0xgranted', null)).toBeNull()
  })

  it('prefers a local grant override after a successful grant', () => {
    expect(getDisplayedAgentGrant('0xold', '0xnew')).toBe('0xnew')
  })

  it('shows a revoke-specific success message', () => {
    expect(getPassGrantSuccessMessage('revoke-success')).toBe(
      'Agent access revoked. Refresh to confirm the updated state.',
    )
  })

  it('drops concurrent grant actions until the in-flight action settles', async () => {
    const runExclusive = createPassGrantSingleFlight()
    let resolveFirst: (() => void) | null = null
    const calls: string[] = []

    const first = runExclusive(async () => {
      calls.push('first')
      await new Promise<void>((resolve) => {
        resolveFirst = resolve
      })
    })
    const second = runExclusive(async () => {
      calls.push('second')
    })

    await expect(second).resolves.toBeUndefined()
    expect(calls).toEqual(['first'])

    resolveFirst?.()
    await first

    await runExclusive(async () => {
      calls.push('third')
    })

    expect(calls).toEqual(['first', 'third'])
  })
})
