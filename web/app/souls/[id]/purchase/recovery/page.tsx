'use client'

import React,{use} from 'react'
import {isValidSuiAddress,normalizeSuiAddress} from '@mysten/sui/utils'
import {OriginalSoulEnhancementRecovery} from '@/components/commerce/original-soul-enhancement-recovery'
import {NativePaidServiceRecovery} from '@/components/commerce/native-paid-service-recovery'
import {NativeSaleCancellationRecovery} from '@/components/commerce/native-sale-cancellation-recovery'
import {PurchaseRecoveryImport} from '@/components/commerce/purchase-recovery-import'
import {NativePublicReadPaidOriginalRecoveryV2} from '@/components/commerce/native-public-read-paid-original-recovery'

export default function PurchaseRecoveryPage({params}:{params:Promise<{id:string}>}){
 const {id}=use(params),soulId=typeof id==='string'&&isValidSuiAddress(id)?normalizeSuiAddress(id):null
 if(!soulId||/^0x0+$/.test(soulId))return <main className="p-6"><h1>恢复原购买查询</h1><p role="alert">Soul 身份无效；无法导入或查询原购买。</p></main>
 const nativeReleaseJson=process.env.NEXT_PUBLIC_SOULIDITY_NATIVE_WORKBENCH_TARGET_JSON
 const publicReadReleaseJson=process.env.NEXT_PUBLIC_SOULIDITY_NATIVE_PUBLIC_READ_V2_TARGET_JSON
 return <main className="mx-auto max-w-3xl space-y-4 p-6"><h1 className="text-2xl font-semibold">恢复原购买查询</h1>
  <p className="break-all">本页 Soul：{soulId}</p><NativePublicReadPaidOriginalRecoveryV2 soulId={soulId} publicReadReleaseJson={publicReadReleaseJson}/><PurchaseRecoveryImport soulId={soulId} publicReadReleaseJson={publicReadReleaseJson} nativeReleaseJson={nativeReleaseJson}/><OriginalSoulEnhancementRecovery soulId={soulId}/>
  <NativePaidServiceRecovery soulId={soulId}/>
  <NativeSaleCancellationRecovery soulId={soulId} releaseJson={nativeReleaseJson}/>
 </main>
}
