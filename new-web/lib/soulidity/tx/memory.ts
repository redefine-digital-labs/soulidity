import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'

const SUI_CLOCK_OBJECT_ID = '0x6'

export function buildAppendMemoryAsOwnerTx(params: {
  memoryOnChainId: string
  stateOnChainId: string
  contentBlobObjectId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::memory::append_as_owner`,
    arguments: [
      tx.object(params.memoryOnChainId),
      tx.object(params.stateOnChainId),
      tx.object(params.contentBlobObjectId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })

  return tx
}

export function buildAppendMemoryAsGrantedAgentTx(params: {
  memoryOnChainId: string
  stateOnChainId: string
  grantOnChainId: string
  contentBlobObjectId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::memory::append_as_granted_agent`,
    arguments: [
      tx.object(params.memoryOnChainId),
      tx.object(params.stateOnChainId),
      tx.object(params.grantOnChainId),
      tx.object(params.contentBlobObjectId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })

  return tx
}
