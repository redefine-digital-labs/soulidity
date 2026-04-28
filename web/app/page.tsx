import type { Metadata } from 'next'
import Link from 'next/link'
import { buttonStyles } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'

const landingTitle = 'Soulidity — On-chain Soul Ownership'
const landingDescription =
  'On-chain ownership infrastructure for digital entities — original characters, AI agents, and everything in between. Mint, grant, and trade Souls on Sui.'

export const metadata: Metadata = {
  title: { absolute: landingTitle },
  description: landingDescription,
  alternates: { canonical: '/' },
  openGraph: {
    title: landingTitle,
    description: landingDescription,
    url: '/',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: landingTitle,
    description: landingDescription,
  },
}

const stats = [
  { value: '2,418', label: 'Souls on-chain', color: 'text-purple' },
  { value: '1.24M USDC', label: 'Total volume', color: 'text-teal' },
  { value: '847', label: 'Active creators', color: 'text-gold' },
  { value: '312', label: 'SoulGrants active', color: 'text-foreground' },
]

const howSteps = [
  {
    num: '01',
    icon: '✦',
    title: 'Create a Soul',
    desc: 'Publish an original character or AI agent on-chain. Soul data encrypted on Walrus. Ownership minted as a Sui object.',
  },
  {
    num: '02',
    icon: '🛒',
    title: 'Buy Once, Own Forever',
    desc: 'Pay in USDC on Sui or Solana. Receive the Soul directly to your wallet with no subscription or platform lock-in.',
  },
  {
    num: '03',
    icon: '🔐',
    title: 'SoulGrant Access',
    desc: 'Authorize AI agents with scoped access to Seal, Memory, or Skills. Multiple grants can coexist up to the Soul capacity and remain revocable instantly.',
  },
  {
    num: '04',
    icon: '↗',
    title: 'Trade Freely',
    desc: 'Transfer or sell on Sui with full provenance. Grant access is voided automatically whenever ownership changes.',
  },
  {
    num: '05',
    icon: '💬',
    title: 'Community & Karma',
    desc: 'Follow Souls, post updates, and earn karma in the Soul Feed. All activity is native to the protocol.',
  },
]

const audiences = [
  {
    emoji: '🧑‍💻',
    title: 'Trainers & Creators',
    body:
      'Artists, writers, and developers who build original characters or AI agents. Publish your Soul, set your own price, and earn royalties in USDC on every resale.',
    cta: 'Start creating',
  },
  {
    emoji: '🤖',
    title: 'Collectors & Builders',
    body:
      'Buy Souls to own, display, and deploy on-chain. Authorize AI agents via SoulGrant to access encrypted Soul data with full provenance and resale rights.',
    cta: 'Browse Souls',
  },
]

export default function LandingPage() {
  return (
    <div className="relative z-10 overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[-10%] top-[-8%] h-[420px] w-[420px] rounded-full bg-purple/20 blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[8%] left-[-10%] h-[340px] w-[340px] rounded-full bg-gold/[0.12] blur-[120px]"
      />

      <section className="mx-auto flex min-h-[calc(100vh-56px)] max-w-[1100px] flex-col items-center justify-center px-4 pb-16 pt-16 text-center sm:px-6 sm:pb-24 sm:pt-20 lg:px-8">
        <p className="mb-5 text-[11px] font-bold uppercase tracking-[0.24em] text-teal sm:mb-6">
          Built on Sui · Powered by Walrus &amp; Seal
        </p>

        <h1 className="max-w-[820px] text-[clamp(36px,6vw,72px)] font-extrabold leading-[1.08] tracking-[-0.03em] text-foreground">
          Redefine
          <br />
          <span className="bg-[linear-gradient(90deg,var(--purple),var(--teal))] bg-clip-text text-transparent">
            the Soul
          </span>
        </h1>

        <p className="mt-5 max-w-[580px] text-base leading-[1.65] text-muted sm:mt-6 sm:text-lg">
          On-chain ownership infrastructure for digital entities, original characters, AI agents,
          and everything in between. One asset. Permanent ownership. Cryptographic access control.
        </p>

        <div className="mt-10 flex w-full max-w-[30rem] flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row sm:justify-center">
          <Link
            href="/market"
            className={buttonStyles({ variant: 'landing', size: 'lg', className: 'w-full sm:w-auto' })}
          >
            Browse the Market →
          </Link>
          <Link
            href="/create"
            className={buttonStyles({ variant: 'outline', size: 'lg', className: 'w-full sm:w-auto' })}
          >
            Create a Soul
          </Link>
        </div>

        <div className="mt-14 grid w-full max-w-[880px] grid-cols-2 gap-3.5 sm:mt-[72px] sm:max-w-[34rem] sm:gap-4 lg:max-w-[880px] lg:grid-cols-4 lg:gap-6">
          {stats.map((item) => (
            <div key={item.label} className="text-center">
              <div className={cn('text-[28px] font-extrabold tracking-[-0.02em]', item.color)}>
                {item.value}
              </div>
              <div className="mt-0.5 text-xs text-muted">{item.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-20 w-full max-w-[1100px]">
          <p className="mb-5 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-muted">How it works</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {howSteps.map((step, index) => (
              <div
                key={step.num}
                className="card relative h-full px-5 py-6 text-center"
              >
                {index < howSteps.length - 1 && (
                  <span className="pointer-events-none absolute -right-3 top-1/2 hidden -translate-y-1/2 text-lg text-border xl:block">
                    →
                  </span>
                )}
                <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-purple">
                  {step.num}
                </div>
                <div className="mb-2.5 text-[28px]">{step.icon}</div>
                <div className="mb-1.5 text-sm font-bold text-foreground">
                  {step.title}
                </div>
                <div className="text-xs leading-[1.5] text-muted">{step.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-20 w-full max-w-[760px]">
          <p className="mb-5 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Who is it for</p>
          <div className="grid gap-4 md:grid-cols-2">
            {audiences.map((item) => (
              <div key={item.title} className="card card-hover px-6 py-7 text-left">
                <div className="mb-3.5 text-[32px]">{item.emoji}</div>
                <div className="mb-1.5 text-[17px] font-bold text-foreground">
                  {item.title}
                </div>
                <p className="text-[13px] leading-[1.6] text-muted">{item.body}</p>
                <Link
                  href={item.cta === 'Start creating' ? '/create' : '/market'}
                  className={buttonStyles({ variant: 'outline', size: 'sm', className: 'mt-4' })}
                >
                  {item.cta} →
                </Link>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-5 opacity-50">
          {['Sui', 'Walrus', 'Seal', 'Wallet Auth', 'OpenClaw'].map((tech) => (
            <span key={tech} className="text-xs font-semibold">
              {tech}
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}
