'use client'

import React, { use } from 'react'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { NativeSaleCheckout } from '@/components/commerce/native-sale-checkout'
import { resolveNativeSaleCheckout } from '@/lib/soulidity/native-sale-checkout-config'

export default function NativeSoulBuyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const soulId = isValidSuiAddress(id) ? normalizeSuiAddress(id) : null
  if (!soulId || /^0x0+$/.test(soulId)) return <p role="alert">Soul 身份无效。</p>
  const release = resolveNativeSaleCheckout(process.env.NEXT_PUBLIC_SOULIDITY_NATIVE_WORKBENCH_TARGET_JSON,
    process.env.NEXT_PUBLIC_SOULIDITY_NATIVE_ECONOMICS_TARGET_JSON)
  return <NativeSaleCheckout soulId={soulId} release={release} />
}
