import { describe, expect, it } from 'vitest'

import { getLoginPageState } from '../../web/lib/auth/login-view-state.ts'

describe('getLoginPageState', () => {
  it('keeps showing loading while auth state is unresolved', () => {
    expect(
      getLoginPageState({ ready: false, loading: false, authenticated: false, hasUser: false }),
    ).toBe('loading')
  })

  it('returns redirecting for authenticated users with a local account', () => {
    expect(
      getLoginPageState({ ready: true, loading: false, authenticated: true, hasUser: true }),
    ).toBe('redirecting')
  })

  it('returns unregistered when auth exists but no local user is present', () => {
    expect(
      getLoginPageState({ ready: true, loading: false, authenticated: true, hasUser: false }),
    ).toBe('unregistered')
  })

  it('returns ready for anonymous visitors', () => {
    expect(
      getLoginPageState({ ready: true, loading: false, authenticated: false, hasUser: false }),
    ).toBe('ready')
  })

  it('stays in loading while the local auth user fetch is still in flight', () => {
    expect(
      getLoginPageState({ ready: true, loading: true, authenticated: false, hasUser: false }),
    ).toBe('loading')
  })
})
