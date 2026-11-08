'use client'
import {Suspense} from 'react'
import {NativePublicReadWorkbenchV2} from '@/components/souls/native-public-read-workbench-v2'
/** Explicit new-format release entry; configuration is not deployment approval. */
export default function SoulContentReadPage(props:{params:Promise<{id:string}>}){
 const release=process.env.NEXT_PUBLIC_SOULIDITY_NATIVE_PUBLIC_READ_V2_TARGET_JSON
 return release?<Suspense fallback={<p role="status">Opening content library…</p>}><NativePublicReadWorkbenchV2 {...props} releaseJson={release} paidEconomicsJson={process.env.NEXT_PUBLIC_SOULIDITY_NATIVE_ECONOMICS_TARGET_JSON}/></Suspense>:<p>Content reading is unavailable for this release.</p>
}
