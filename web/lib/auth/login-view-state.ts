export type LoginPageState = 'loading' | 'redirecting' | 'unregistered' | 'ready'

export function getLoginPageState(params: {
  ready: boolean
  loading: boolean
  authenticated: boolean
  hasUser: boolean
}): LoginPageState {
  if (!params.ready || params.loading) {
    return 'loading'
  }

  if (params.authenticated && params.hasUser) {
    return 'redirecting'
  }

  if (params.authenticated) {
    return 'unregistered'
  }

  return 'ready'
}
