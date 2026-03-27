import { Transaction } from '@mysten/sui/transactions'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { OnChainVerificationError } from '@web/lib/souls/on-chain-verification'
import { suiClient } from '@web/lib/sui'

const DEV_INSPECT_SENDER = `0x${'1'.padStart(64, '0')}`

export interface SoulPurchaseQuote {
  marketplaceFeeSui: bigint
  priceSui: bigint
  royaltyFeeSui: bigint
  totalSui: bigint
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
  sellerKioskId: string
  soulObjectId: string
}): Promise<SoulPurchaseQuote> {
  const adapterPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID')
  const marketplaceId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_CPU_MARKETPLACE_ID')
  const transferPolicyId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID')

  const tx = new Transaction()
  tx.moveCall({
    target: `${adapterPackageId}::market::quote_purchase`,
    arguments: [
      tx.object(params.sellerKioskId),
      tx.object(marketplaceId),
      tx.object(transferPolicyId),
      tx.object(params.soulObjectId),
    ],
  })

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
    marketplaceFeeSui: readU64ReturnValue(returnValues[0], 'quote marketplace fee'),
    priceSui: readU64ReturnValue(returnValues[1], 'quote listing price'),
    royaltyFeeSui: readU64ReturnValue(returnValues[2], 'quote royalty fee'),
    totalSui: readU64ReturnValue(returnValues[3], 'quote total'),
  }
}
