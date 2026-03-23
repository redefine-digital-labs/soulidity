export type PassGrantUiState =
  | 'idle'
  | 'inputting'
  | 'pending'
  | 'grant-success'
  | 'revoke-success'
  | 'error'

export function getDisplayedAgentGrant(
  serverAgentGrant: string | null,
  overrideAgentGrant: string | null | undefined,
): string | null {
  return overrideAgentGrant === undefined ? serverAgentGrant : overrideAgentGrant
}

export function getPassGrantSuccessMessage(state: PassGrantUiState): string | null {
  if (state === 'grant-success') {
    return 'Agent granted. Refresh to see updated address.'
  }
  if (state === 'revoke-success') {
    return 'Agent access revoked. Refresh to confirm the updated state.'
  }
  return null
}

export function createPassGrantSingleFlight() {
  let inFlight = false

  return async function runExclusive<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (inFlight) {
      return undefined
    }

    inFlight = true
    try {
      return await action()
    } finally {
      inFlight = false
    }
  }
}
