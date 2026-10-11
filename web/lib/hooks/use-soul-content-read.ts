'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useCommittedSession } from './use-committed-session'
import { useCurrentAccount, useCurrentWallet, useSignPersonalMessage, useSuiClient } from '@mysten/dapp-kit'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { ChainSoulContentVersion, ChainSoulDetail } from '@/lib/soulidity/soul-detail-model'
import { getBrowserContentAccessConfig } from '@/lib/soulidity/browser-content-access'
import { getBrowserContentSealConfig, openBrowserSoulContent } from '@/lib/soulidity/browser-content-open'

/** Lifecycle for the original content controls, separate from still-unconverted
 * writes. No auth/JWT, signing on mount, retained key or cached decrypted bytes. */
export function useSoulContentRead(soul: ChainSoulDetail, blocked: boolean) {
  const account = useCurrentAccount(), { currentWallet: wallet } = useCurrentWallet(), client = useSuiClient()
  const { mutateAsync: signPersonal } = useSignPersonalMessage()
  let config: ReturnType<typeof getBrowserContentAccessConfig> | undefined
  let sealConfig: ReturnType<typeof getBrowserContentSealConfig> | undefined, configError: string | null = null
  try { config = getBrowserContentAccessConfig(); sealConfig = getBrowserContentSealConfig() }
  catch (error) { configError = error instanceof Error ? error.message : 'Content read configuration is unavailable' }
  const scope = JSON.stringify([soul.originalPackageId, soul.onChainId, soul.stateOnChainId, soul.contentOnChainId,
    soul.stateVersion, soul.stateDigest, soul.currentOwnershipEpoch, soul.viewerAddress, config, sealConfig, configError])
  const session = useCommittedSession(scope, account, client, wallet)
  const privacyKey = session.generation
  const blockedRef = useRef(blocked)
  useLayoutEffect(() => { blockedRef.current = blocked }, [blocked])
  const active = useRef<AbortController | null>(null), urls = useRef(new Set<string>())
  const [view, setView] = useState<{ generation: number; pending: boolean; error: string | null } | null>(null)
  useLayoutEffect(() => {
    return () => {
      active.current?.abort(); active.current = null
      for (const url of urls.current) URL.revokeObjectURL(url)
      urls.current.clear()
    }
  }, [session])

  const run = useCallback(async (version: ChainSoulContentVersion, download: boolean) => {
    const lease = session.capture()
    const matches = () => lease?.matches() === true
    if (!matches()) throw new Error('Content wallet session changed')
    if (active.current || blockedRef.current) throw new Error('Another content action is pending')
    const controller = new AbortController(); active.current = controller
    const guard = () => { controller.signal.throwIfAborted(); if (!matches()) throw new Error('Content wallet session changed') }
    setView({ generation: privacyKey, pending: true, error: null })
    let bytes: Uint8Array | undefined
    try {
      if (configError || !config || !sealConfig) throw new Error(configError ?? 'Content read configuration is unavailable')
      if (!account || !wallet) throw new Error('Connect a Sui wallet before opening encrypted content')
      if (version.soulOnChainId !== soul.onChainId || version.contentOnChainId !== soul.contentOnChainId) throw new Error('Content version belongs to another Soul')
      const result = await openBrowserSoulContent({ request: { soulId: soul.onChainId, stateId: soul.stateOnChainId,
        contentId: soul.contentOnChainId, kind: version.kind, name: version.name, versionIndex: version.versionIndex,
        viewerAddress: account.address, config }, sealConfig, client: (client as unknown as { grpc: SuiGrpcClient }).grpc,
        sealClient: client as never, signal: controller.signal,
        getAddress: () => matches() && !controller.signal.aborted ? account.address : null,
        signPersonalMessage: async message => {
          guard(); const result = await signPersonal({ message, account }); guard(); return result.signature
        } })
      bytes = result.bytes; guard()
      if (download) {
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: result.mimeType || 'application/octet-stream' }))
        urls.current.add(url)
        const anchor = document.createElement('a'); anchor.href = url
        anchor.download = result.fileName.replace(/[\\/\x00-\x1f\x7f]/g, '_') || 'soul-content.bin'
        try { guard(); document.body.appendChild(anchor); anchor.click() }
        finally {
          anchor.remove()
          setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url) }, 1000)
        }
        return undefined
      }
      const transferred = bytes; bytes = undefined; return transferred
    } catch (error) {
      if (matches() && !controller.signal.aborted) setView({ generation: privacyKey, pending: false,
        error: error instanceof Error ? error.message : 'Failed to open content' })
      throw error
    } finally {
      bytes?.fill(0)
      if (active.current === controller) active.current = null
      if (matches()) setView(previous => previous?.generation === privacyKey ? { ...previous, pending: false } : previous)
    }
  }, [session, account, wallet, client, privacyKey, signPersonal, configError, soul.onChainId, soul.contentOnChainId, soul.stateOnChainId])

  const visible = view?.generation === privacyKey ? view : null
  return { privacyKey, pending: visible?.pending ?? false, error: visible?.error ?? null,
    decryptContentVersion: (version: ChainSoulContentVersion) => run(version, false) as Promise<Uint8Array>,
    openContentVersion: async (version: ChainSoulContentVersion) => { await run(version, true) } }
}
