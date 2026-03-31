export interface CoinBalanceLike {
  coinObjectId: string
  balance: string | number | bigint
}

export interface CoinPageLike {
  data: CoinBalanceLike[]
  hasNextPage?: boolean
  nextCursor?: string | null
}

export interface CoinPageLoaderLike {
  getCoins(params: {
    owner: string
    coinType: string
    cursor?: string | null
  }): Promise<CoinPageLike>
}

const DEFAULT_MAX_COIN_PAGES = 20

export class CoinPaginationExhaustedError extends Error {
  constructor(readonly maxPages: number) {
    super(`Coin pagination exceeded the ${maxPages}-page limit before collecting enough balance`)
    this.name = 'CoinPaginationExhaustedError'
  }
}

function toCoinBalance(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    const truncated = Math.trunc(value)
    if (!Number.isSafeInteger(truncated)) {
      throw new Error('Coin balance number is outside the safe integer range')
    }
    return BigInt(truncated)
  }
  if (typeof value === 'string' && value.trim().length > 0) return BigInt(value.trim())
  return 0n
}

export function selectCoinObjectIdsForAmount(
  coins: CoinBalanceLike[],
  requiredAmount: bigint,
): string[] | null {
  if (requiredAmount <= 0n) {
    return []
  }

  const selected: string[] = []
  let runningTotal = 0n

  for (const coin of coins) {
    if (!coin.coinObjectId) continue

    const balance = toCoinBalance(coin.balance)
    if (balance <= 0n) continue

    selected.push(coin.coinObjectId)
    runningTotal += balance

    if (runningTotal >= requiredAmount) {
      return selected
    }
  }

  return null
}

export async function selectCoinObjectIdsForAmountAcrossPages(
  client: CoinPageLoaderLike,
  params: {
    owner: string
    coinType: string
    requiredAmount: bigint
    maxPages?: number
  },
): Promise<string[] | null> {
  if (params.requiredAmount <= 0n) {
    return []
  }

  const maxPages =
    typeof params.maxPages === 'number' && Number.isFinite(params.maxPages) && params.maxPages > 0
      ? Math.trunc(params.maxPages)
      : DEFAULT_MAX_COIN_PAGES
  const selected: string[] = []
  let runningTotal = 0n
  let sawPositiveBalanceCoin = false
  let sawAnyCoin = false
  let cursor: string | null | undefined = undefined
  const seenCursors = new Set<string>()
  let pagesFetched = 0

  while (true) {
    const page = await client.getCoins({
      owner: params.owner,
      coinType: params.coinType,
      ...(cursor ? { cursor } : {}),
    })
    pagesFetched += 1

    for (const coin of page.data) {
      if (!coin.coinObjectId) continue
      sawAnyCoin = true

      const balance = toCoinBalance(coin.balance)
      if (balance <= 0n) continue

      sawPositiveBalanceCoin = true
      selected.push(coin.coinObjectId)
      runningTotal += balance

      if (runningTotal >= params.requiredAmount) {
        return selected
      }
    }

    if (!page.hasNextPage) {
      break
    }
    if (pagesFetched >= maxPages) {
      throw new CoinPaginationExhaustedError(maxPages)
    }

    if (!page.nextCursor) {
      throw new Error('Coin pagination reported additional pages without a cursor')
    }
    if (seenCursors.has(page.nextCursor)) {
      throw new Error('Coin pagination cursor repeated before pagination completed')
    }

    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  }

  return sawPositiveBalanceCoin || sawAnyCoin ? null : []
}
