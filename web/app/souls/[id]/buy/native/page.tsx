'use client'

import React, { use } from 'react'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { NativeSaleCheckout } from '@/components/commerce/native-sale-checkout'
import { resolveNativeSaleCheckout } from '@/lib/soulidity/native-sale-checkout-config'

const emptySearch = Promise.resolve({} as { offer?: string | string[] })

export default function NativeSoulBuyPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams?: Promise<{ offer?: string | string[] }>
}) {
  const { id } = use(params)
  const soulId = isValidSuiAddress(id) ? normalizeSuiAddress(id) : null
  const { offer } = use(searchParams ?? emptySearch)
  const initialOffer = typeof offer === 'string' && isValidSuiAddress(offer) && !/^0x0+$/.test(offer) ? normalizeSuiAddress(offer) : ''
  if (!soulId || /^0x0+$/.test(soulId)) return <p role="alert">Soul 身份无效。</p>
  const nativeReleaseJson = process.env.NEXT_PUBLIC_SOULIDITY_NATIVE_WORKBENCH_TARGET_JSON
  const release = resolveNativeSaleCheckout(nativeReleaseJson,
    process.env.NEXT_PUBLIC_SOULIDITY_NATIVE_ECONOMICS_TARGET_JSON)
  return <NativeSaleCheckout key={soulId + initialOffer} soulId={soulId} release={release} initialOffer={initialOffer} nativeReleaseJson={nativeReleaseJson} />
}
