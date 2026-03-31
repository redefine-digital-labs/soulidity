import { Transaction } from '@mysten/sui/transactions'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { OnChainVerificationError } from '@web/lib/souls/on-chain-verification'
import { suiClient } from '@web/lib/sui'

const DEV_INSPECT_SENDER = `0x${'1'.padStart(64, '0')}`

export interface SoulPurchaseQuote {
  platformFeeAtomic: bigint
  priceAtomic: bigint
  creatorRoyaltyAtomic: bigint
  totalAtomic: bigint
}

function bytesToBigInt(bytes: number[]): bigint {
  if (bytes.length > 8) {
    throw new OnChainVerificationError('Quote result exceeded the supported u64 range on chain')
  }

  let value = 0n
  for (let index = 0; index < bytes.length; index += 1) {
    value |= BigInt(bytes[index] ?? 0) << (8n * BigInt(index))
  }
  return value
}

function readU64ReturnValue(value: unknown, fieldName: string): bigint {
  if (!Array.isArray(value) || value.length < 2) {
    throw new OnChainVerificationError(`${fieldName} is missing from the dev inspect result`)
  }

  const [rawBytes, typeTag] = value
  if (!Array.isArray(rawBytes) || !rawBytes.every((item) => typeof item === 'number')) {
    throw new OnChainVerificationError(`${fieldName} bytes are malformed in the dev inspect result`)
  }
  if (typeof typeTag !== 'string' || typeTag !== 'u64') {
    throw new OnChainVerificationError(`${fieldName} type is malformed in the dev inspect result`)
  }

  return bytesToBigInt(rawBytes)
}

export async function getSoulPurchaseQuote(params: {
  listingObjectId: string
}): Promise<SoulPurchaseQuote> {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  const marketConfigId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID')

  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::quote_fixed_price`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(params.listingObjectId),
    ],
  })

  return parseQuoteDevInspectResult(tx)
}

async function parseQuoteDevInspectResult(tx: Transaction): Promise<SoulPurchaseQuote> {
  const result = await suiClient.devInspectTransactionBlock({
    sender: DEV_INSPECT_SENDER,
    transactionBlock: tx,
  })

  if (result.error) {
    throw new OnChainVerificationError(`Unable to inspect purchase quote on chain: ${result.error}`)
  }

  const returnValues = result.results?.[0]?.returnValues
  if (!returnValues || returnValues.length !== 4) {
    throw new OnChainVerificationError('Purchase quote return values are missing on chain')
  }

  return {
    platformFeeAtomic: readU64ReturnValue(returnValues[0], 'quote platform fee'),
    priceAtomic: readU64ReturnValue(returnValues[1], 'quote listing price'),
    creatorRoyaltyAtomic: readU64ReturnValue(returnValues[2], 'quote creator royalty'),
    totalAtomic: readU64ReturnValue(returnValues[3], 'quote total'),
  }
}
