import { suiClient } from '@web/lib/sui'
import { ensureTransactionSucceeded } from '@web/lib/souls/on-chain-verification'

export async function getSuccessfulTransactionBlock(txDigest: string) {
  const transaction = await suiClient.getTransactionBlock({
    digest: txDigest,
    options: {
      showEffects: true,
      showEvents: true,
      showInput: true,
      showObjectChanges: true,
    },
  })

  ensureTransactionSucceeded(transaction)
  return transaction
}
