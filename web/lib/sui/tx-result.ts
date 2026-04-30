type SuiTxStatus = {
  status?: string
  error?: string
}

type SuiTxEffects = {
  status?: SuiTxStatus
  [key: string]: unknown
}

export type SuiTxResult = {
  digest: string
  effects?: SuiTxEffects
  [key: string]: unknown
}

export type SuiTxResultWithEffects = SuiTxResult & {
  effects: SuiTxEffects
}

type SuiTxWaitClient = {
  waitForTransaction: (args: {
    digest: string
    options: {
      showEffects: true
      showEvents: true
      showObjectChanges: true
      showInput: true
    }
  }) => Promise<unknown>
}

export class SuiTxExecutionError extends Error {
  readonly digest: string
  readonly status?: string
  readonly executionError?: string
  readonly txResult: SuiTxResultWithEffects

  constructor(label: string, result: SuiTxResultWithEffects) {
    const txStatus = result.effects.status
    const detail = [
      txStatus?.status ? `status=${txStatus.status}` : null,
      txStatus?.error ? `error=${txStatus.error}` : null,
    ].filter(Boolean).join(', ')

    super(`${label} ${result.digest} did not succeed${detail ? ` (${detail})` : ''}`)
    this.name = 'SuiTxExecutionError'
    this.digest = result.digest
    this.status = txStatus?.status
    this.executionError = txStatus?.error
    this.txResult = result
  }
}

export function normalizeSuiTxResult(result: unknown): SuiTxResult {
  if (!result || typeof result !== 'object') {
    throw new Error('Wallet transaction execution did not return a transaction result')
  }

  const candidate = result as { digest?: unknown }
  if (typeof candidate.digest !== 'string' || candidate.digest.length === 0) {
    throw new Error('Wallet transaction execution did not return a transaction digest')
  }

  return result as SuiTxResult
}

function hasSuiTxEffects(result: SuiTxResult): result is SuiTxResultWithEffects {
  return !!result.effects && typeof result.effects === 'object'
}

export async function resolveSuiTxResultWithEffects(
  client: SuiTxWaitClient,
  result: unknown,
): Promise<SuiTxResultWithEffects> {
  const normalized = normalizeSuiTxResult(result)
  if (hasSuiTxEffects(normalized)) {
    return normalized
  }

  const resolved = normalizeSuiTxResult(await client.waitForTransaction({
    digest: normalized.digest,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
      showInput: true,
    },
  }))

  if (!hasSuiTxEffects(resolved)) {
    throw new Error(`Wallet transaction execution did not return effects for transaction ${normalized.digest}`)
  }

  return resolved
}

export function assertSuiTxSucceeded(
  result: unknown,
  label: string,
): SuiTxResultWithEffects {
  const normalized = normalizeSuiTxResult(result)
  if (!hasSuiTxEffects(normalized)) {
    throw new Error(`Wallet transaction execution did not return effects for transaction ${normalized.digest}`)
  }
  if (normalized.effects.status?.status !== 'success') {
    throw new SuiTxExecutionError(label, normalized)
  }
  return normalized
}

export function getSuiTxErrorProperties(error: unknown): Record<string, unknown> {
  if (!(error instanceof SuiTxExecutionError)) {
    return {}
  }

  return {
    txDigest: error.digest,
    txStatus: error.status,
    txExecutionError: error.executionError,
  }
}
