import { describe, expect, it } from 'vitest'

import {
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
})
