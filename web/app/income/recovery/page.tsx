'use client'

import React from 'react'
import {useCurrentAccount} from '@mysten/dapp-kit'
import {isValidSuiAddress,normalizeSuiAddress} from '@mysten/sui/utils'
import {IncomeWithdrawalRecoveryImport} from '@/components/souls/income-withdrawal-recovery-import'
import {IncomeWithdrawalLocalRecovery} from '@/components/commerce/income-withdrawal-local-recovery'
import {IncomeWithdrawalResumeProvider} from '@/components/providers/income-withdrawal-resume-provider'

export default function IncomeRecoveryPage(){
 const account=useCurrentAccount(),address=account?.address
 const viewerAddress=address&&isValidSuiAddress(address)?normalizeSuiAddress(address):null
 return <main className="mx-auto max-w-3xl space-y-4 p-6"><h1 className="text-2xl font-semibold">恢复原提款查询</h1>
  <p>核对原交易支付与当前协议余额。当前钱包仅用于观察收款 Coin，不改变原操作人或收款人。</p>
  <a href="/income">观察当前协议收益与审阅新提款</a>
  <IncomeWithdrawalResumeProvider><IncomeWithdrawalLocalRecovery viewerAddress={viewerAddress}/></IncomeWithdrawalResumeProvider>
  <IncomeWithdrawalRecoveryImport viewerAddress={viewerAddress}/>
 </main>
}
