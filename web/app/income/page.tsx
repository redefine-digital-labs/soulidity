'use client'
import React, { useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { createConfiguredIncomeEntryController } from '../../lib/soulidity/configured-income-entry'
import { IncomeEntryWorkbench } from '../../components/commerce/income-entry-workbench'

export default function IncomePage() {
  const account = useCurrentAccount(), address = account?.address
  const viewerAddress = address && isValidSuiAddress(address) ? normalizeSuiAddress(address) : null
  const [controller] = useState(() => { try { return createConfiguredIncomeEntryController() } catch { return null } })
  return <main className="mx-auto max-w-4xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">协议收益与提款准备</h1>
    <p>核对选定 Config 的协议账本。作者、卖方直接收款和 Maker／Pack 的 Product 收益不属于这笔协议余额。</p>
    <a href="/income/recovery">恢复已保存的原提款</a>
    <a href="/income/maker">查看 Maker／Pack Product 收益</a>
    {controller ? <IncomeEntryWorkbench controller={controller} viewerAddress={viewerAddress}/> : <p role="alert">收益来源服务不可用，提款准备关闭。仍可打开原提款恢复页查询和下载原件。</p>}
  </main>
}
