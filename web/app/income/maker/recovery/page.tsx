'use client'
import React, { useMemo, useState } from 'react'
import { useCurrentAccount, useCurrentWallet, useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import { useCommittedSession } from '../../../../lib/hooks/use-committed-session'
import type { MakerProductIncomeWalletSigner } from '../../../../lib/soulidity/maker-product-income-execution'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { createConfiguredMakerProductIncomeController } from '../../../../lib/soulidity/configured-maker-product-income'
import { MakerProductIncomeRecoveryWorkbench } from '../../../../components/commerce/maker-product-income-recovery'

export default function MakerProductIncomeRecoveryPage() {
  const account = useCurrentAccount(), address = account?.address
  const viewerAddress = address && isValidSuiAddress(address) ? normalizeSuiAddress(address) : null
  const { currentWallet } = useCurrentWallet(), client = useSuiClient(), { mutateAsync: signTransaction } = useSignTransaction()
  const session = useCommittedSession('maker-product-income-wallet', account, client, currentWallet)
  const wallet = useMemo<MakerProductIncomeWalletSigner | null>(() => {
    if (!account || !currentWallet || !viewerAddress) return null
    return {
      getActorAddress: () => session.matches() ? viewerAddress : null,
      async sign(transaction) {
        const lease = session.capture()
        if (!lease?.matches()) throw Error('Maker Product 钱包会话已变更。')
        // The executor verifies and saves a returned signature before checking dispatch authority again.
        return signTransaction({ transaction, account, chain: 'sui:mainnet' })
      },
    }
  }, [account, currentWallet, viewerAddress, session, signTransaction])
  const [controller] = useState(() => { try { return createConfiguredMakerProductIncomeController() } catch { return null } })
  return <main className="mx-auto max-w-4xl space-y-5 p-6"><h1 className="text-2xl font-semibold">恢复 Maker／Pack Product 原提款</h1>
    <p>保留原 schema、Product、Control、资金域和交易字节。未查到原结果不授予重新准备权限。</p>
    {controller ? <MakerProductIncomeRecoveryWorkbench controller={controller} viewerAddress={viewerAddress} wallet={wallet}/> : <p role="alert">Product 原查询服务不可用，请保留原文件。</p>}
  </main>
}
