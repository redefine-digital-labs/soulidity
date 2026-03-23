type TransactionWaitClient = {
  waitForTransaction(params: { digest: string }): Promise<unknown>
}

export async function waitForTransactionBestEffort(
  client: TransactionWaitClient,
  digest: string,
): Promise<void> {
  try {
    await client.waitForTransaction({ digest })
  } catch (error) {
    console.warn('[sui] Transaction confirmation polling failed', {
      digest,
      error,
    })
  }
}
