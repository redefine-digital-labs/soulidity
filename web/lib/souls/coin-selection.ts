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

const MAX_COIN_SELECTION_PAGES = 10

function toCoinBalance(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
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
  },
): Promise<string[] | null> {
  if (params.requiredAmount <= 0n) {
    return []
  }

  const selected: string[] = []
  let runningTotal = 0n
  let sawPositiveBalanceCoin = false
  let sawAnyCoin = false
  let cursor: string | null | undefined = undefined

  for (let pageCount = 0; pageCount < MAX_COIN_SELECTION_PAGES; pageCount += 1) {
    const page = await client.getCoins({
      owner: params.owner,
      coinType: params.coinType,
      ...(cursor ? { cursor } : {}),
    })

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

    if (!page.hasNextPage || !page.nextCursor) {
      break
    }

    cursor = page.nextCursor
  }

  return sawPositiveBalanceCoin || sawAnyCoin ? null : []
}
