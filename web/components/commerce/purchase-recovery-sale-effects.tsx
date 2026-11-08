'use client'
import React from 'react'
import type {reconcileNativeSaleEffects} from '../../lib/soulidity/commerce/native-sale-effects'
type Inventory=ReturnType<typeof reconcileNativeSaleEffects>
const names:Record<string,string>={money:'资金支付',listingExit:'原挂牌退出',custody:'原托管交接',cleanup:'原模块与授权清理'}
/** Authenticated original object-effect inventory only; no success promotion. */
export function PurchaseRecoverySaleEffects({inventory}:{inventory:Inventory}){
 const unexplained=[...new Set([...inventory.unclaimedEffectIds,...inventory.unexplainedConsensusIds,...inventory.accumulatorEffectIds])]
 return <article aria-label="原成交对象变动核对" className="space-y-1 break-all text-sm">
  <p>{inventory.status==='OBJECT_EFFECTS_ACCOUNTED'?'本次核验已解释原交易的对象变动。':inventory.status==='INCOMPLETE_SUBPROOFS'?'原对象变动仍缺少部分领域证明。':'原交易仍有未解释的对象变动。'}</p>
  <p>已核对对象数：{inventory.claimedEffects.length} · 待核对对象数：{unexplained.length}</p>
  {inventory.missingSubproofs.length>0&&<p>尚缺证明：{inventory.missingSubproofs.map(n=>names[n]??n).join('、')}</p>}
  {unexplained.length>0&&<details><summary>查看待核对对象</summary>{unexplained.map(id=><p key={id}>{id}</p>)}</details>}
  <p>对象变动核对不证明原模块语义、支持的权利、源码资格、当前权限或实际内容交付，也不表示完整购买完成。</p>
 </article>
}
