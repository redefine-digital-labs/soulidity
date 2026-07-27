'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSuiClient } from '@mysten/dapp-kit'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Button, buttonStyles } from '@/components/ui/button'
import { useLogin } from '@/lib/hooks/use-login'
import { useAnimacraftMint } from '@/lib/hooks/use-animacraft-mint'
import {
  assertAnimacraftWalrusPatchUrl,
  fetchAnimacraftOcPackage,
  getAnimacraftIntegrationConfig,
  parseAnimacraftMakerObject,
  type AnimacraftMakerState,
  type ParsedAnimacraftHandoff,
} from '@/lib/animacraft/handoff'
import { cn } from '@/lib/utils/cn'

interface AnimacraftHandoff {
  makerId: string
  profileUrl: string
  imageUrl: string
  profileBlobId: string
  imageBlobId: string
  recipeHash: string
  walletHint: string
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

function short(value: string): string {
  if (!value) return 'Not supplied'
  return value.length > 22 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value
}

function sameAddress(left: string, right: string): boolean {
  if (!left || !right) return true
  return left.toLowerCase().replace(/^0x0*/, '0x') === right.toLowerCase().replace(/^0x0*/, '0x')
}

export function AnimacraftIntegrationClient({ handoff }: { handoff: AnimacraftHandoff }) {
  const { user, loading } = useAuth()
  const login = useLogin()
  const suiClient = useSuiClient()
  const integrationConfig = useMemo(() => getAnimacraftIntegrationConfig(), [])
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ParsedAnimacraftHandoff | null>(null)
  const [maker, setMaker] = useState<AnimacraftMakerState | null>(null)
  const mintFlow = useAnimacraftMint()
  const connectedAddress = user?.primarySuiAddress ?? ''
  const walletMismatch = Boolean(
    connectedAddress
    && handoff.walletHint
    && !sameAddress(connectedAddress, handoff.walletHint),
  )
  const hasHandoff = Boolean(
    handoff.makerId
    && handoff.profileUrl
    && handoff.imageUrl
    && handoff.profileBlobId
    && handoff.imageBlobId
    && handoff.recipeHash,
  )

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(async () => {
      if (cancelled) return
      if (!hasHandoff) {
        setLoadState('error')
        setLoadError('The Animacraft handoff is incomplete. Return to Animacraft and certify the OC files again.')
        return
      }
      setLoadState('loading')
      setLoadError(null)
      try {
        const profileUrl = assertAnimacraftWalrusPatchUrl(
          handoff.profileUrl,
          handoff.profileBlobId,
          'Animacraft profile',
        )
        assertAnimacraftWalrusPatchUrl(
          handoff.imageUrl,
          handoff.imageBlobId,
          'Animacraft image',
        )
        const [nextProfile, makerResponse] = await Promise.all([
          fetchAnimacraftOcPackage(profileUrl, handoff.makerId),
          suiClient.getObject({
            id: handoff.makerId,
            options: { showContent: true, showType: true },
          }),
        ])
        if (cancelled) return
        const nextMaker = parseAnimacraftMakerObject(makerResponse, handoff.makerId)
        setProfile(nextProfile)
        setMaker(nextMaker)
        setLoadState('ready')
      } catch (nextError) {
        if (cancelled) return
        setProfile(null)
        setMaker(null)
        setLoadState('error')
        setLoadError(nextError instanceof Error ? nextError.message : 'Animacraft handoff validation failed')
      }
    })
    return () => {
      cancelled = true
    }
  }, [
    handoff.imageBlobId,
    handoff.imageUrl,
    handoff.makerId,
    handoff.profileBlobId,
    handoff.profileUrl,
    hasHandoff,
    suiClient,
  ])

  const mintBusy = ['preflight', 'uploading', 'signing', 'syncing'].includes(mintFlow.status)
  const canMint = mintFlow.hasRecovery
    ? Boolean(integrationConfig.ready && user && !walletMismatch && !mintBusy)
    : Boolean(
        integrationConfig.ready
        && user
        && !walletMismatch
        && loadState === 'ready'
        && profile
        && maker
        && maker.mintingEnabled
        && maker.published
        && !maker.archived
        && !mintBusy,
      )
  const mintLabel = (() => {
    if (mintFlow.status === 'preflight') return 'Checking Maker and recipe...'
    if (mintFlow.status === 'uploading') return 'Registering Living Content...'
    if (mintFlow.status === 'signing') return 'Minting canonical Soul...'
    if (mintFlow.status === 'syncing') return 'Syncing My Souls...'
    if (mintFlow.hasRecovery) return 'Resume Soulidity sync'
    if (!integrationConfig.ready) return 'Package upgrade required'
    if (maker?.mintFeeEnabled) {
      return `Mint for ${formatAtomicAmountForDisplay(maker.mintPriceAtomic.toString())}`
    }
    return 'Mint canonical Soul'
  })()

  return (
    <PageContainer size="md" className="space-y-6">
      <SectionHeader
        label="Animacraft handoff"
        title={profile?.name ? `Continue ${profile.name} as one Soul` : 'Continue as one Soul'}
        subtitle="Animacraft supplies the Maker recipe and artwork. Soulidity owns the finished Soul, Living Content, social identity, and marketplace lifecycle."
        action={(
          <a
            href="https://animacraft.soulidity.ai/#make"
            className={buttonStyles({ variant: 'outline' })}
          >
            Back to Animacraft
          </a>
        )}
      />

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid gap-px bg-border sm:grid-cols-2">
          {[
            ['Maker', short(handoff.makerId)],
            ['Recipe hash', short(handoff.recipeHash)],
            ['Character profile', loadState === 'ready' ? 'Walrus verified' : loadState],
            ['Rendered image', handoff.imageUrl ? 'Walrus reference received' : 'Missing'],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 bg-card px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{label}</div>
              <div className="mt-1 break-all font-mono text-xs text-foreground">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section
        className={cn(
          'border-l-4 px-4 py-3 text-sm leading-relaxed',
          walletMismatch
            ? 'border-gold bg-gold/10 text-foreground'
            : user
              ? 'border-teal bg-teal/10 text-foreground'
              : 'border-purple bg-purple/10 text-muted',
        )}
      >
        {loading ? (
          'Checking the Soulidity wallet session...'
        ) : walletMismatch ? (
          <>The signed-in Soulidity wallet does not match the Animacraft wallet hint. The URL hint never grants authority; reconnect the wallet that prepared this character.</>
        ) : user ? (
          <>Wallet session verified for <span className="font-mono text-xs text-tech-text">{short(connectedAddress)}</span>.</>
        ) : (
          'Connect and sign with the same Sui wallet used in Animacraft. A query-string wallet address is context only, never authentication.'
        )}
      </section>

      {!user && !loading && (
        <Button variant="primary" onClick={login}>Connect Sui wallet</Button>
      )}

      <section className="border-t border-border pt-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">Canonical mint</h2>
            <p className="mt-1 max-w-[58ch] text-sm leading-relaxed text-muted">
              {maker
                ? `${maker.mintFeeEnabled ? 'Paid' : 'Free'} Maker mint. Secondary Maker royalty is ${(maker.royaltyBps / 100).toFixed(0)}%. Living Content is registered on Walrus before the single Soul mint.`
                : 'The profile and on-chain Maker must pass validation before minting.'}
            </p>
            {!integrationConfig.ready && (
              <p className="mt-2 text-xs text-value-text">
                Activation pending: {integrationConfig.missing.join(', ')}.
              </p>
            )}
            {loadError && <p className="mt-2 text-xs text-danger">{loadError}</p>}
            {mintFlow.error && <p className="mt-2 text-xs text-danger">{mintFlow.error}</p>}
            {mintFlow.hasRecovery && mintFlow.status !== 'done' && (
              <p className="mt-2 text-xs text-tech-text">
                The Soul already exists on-chain. Continue only the recoverable Soulidity index sync; no second mint will be signed.
              </p>
            )}
          </div>
          {mintFlow.result ? (
            <Link
              href={`/souls/${encodeURIComponent(mintFlow.result.soulOnChainId)}`}
              className={buttonStyles({ variant: 'teal' })}
            >
              Open Soul
            </Link>
          ) : (
            <Button
              variant="primary"
              disabled={!canMint}
              onClick={() => {
                if (mintFlow.hasRecovery) {
                  void mintFlow.resume()
                  return
                }
                if (!profile || !maker) return
                void mintFlow.mint({
                  config: integrationConfig,
                  handoff: profile,
                  maker,
                  profileJsonBlobId: handoff.profileBlobId,
                  imageBlobId: handoff.imageBlobId,
                  imageUrl: handoff.imageUrl,
                  recipeHashHex: handoff.recipeHash,
                })
              }}
            >
              {mintLabel}
            </Button>
          )}
        </div>
      </section>

      <section className="border-t border-border pt-5">
        <h2 className="text-base font-bold text-foreground">Soulidity account</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Link href="/my-souls?source=animacraft" className={buttonStyles({ variant: 'outline', full: true })}>My Souls</Link>
          <Link href="/profile?source=animacraft" className={buttonStyles({ variant: 'outline', full: true })}>Social profile</Link>
          <Link href="/community?source=animacraft" className={buttonStyles({ variant: 'outline', full: true })}>Community</Link>
          <Link href="/market?source=animacraft" className={buttonStyles({ variant: 'outline', full: true })}>Market</Link>
        </div>
      </section>
    </PageContainer>
  )
}
