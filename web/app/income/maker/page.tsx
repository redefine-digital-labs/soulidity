'use client'
import React, { useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { createConfiguredMakerProductIncomeController } from '../../../lib/soulidity/configured-maker-product-income'
import { MakerProductIncomeWorkbench } from '../../../components/commerce/maker-product-income-workbench'

export default function MakerProductIncomePage() {
  const account = useCurrentAccount(), address = account?.address
  const viewerAddress = address && isValidSuiAddress(address) ? normalizeSuiAddress(address) : null
  const [controller] = useState(() => { try { return createConfiguredMakerProductIncomeController() } catch { return null } })
  return <main className="mx-auto max-w-4xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">Maker／Pack Product 收益</h1>
    <p>选择 Product 和当前 Control，核对其独立收益账本。creator、收款人及协议 Admin 不代替当前 Control 权限。</p>
    <a href="/income/maker/recovery">恢复 Product 原提款</a> · <a href="/income">查看协议 Config 收益</a>
    {controller ? <MakerProductIncomeWorkbench controller={controller} viewerAddress={viewerAddress}/> : <p role="alert">Maker 收益服务不可用，准备关闭。仍可打开恢复页查询和下载 Product 原件。</p>}
  </main>
}
