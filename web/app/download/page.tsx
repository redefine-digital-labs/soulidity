import type { Metadata } from 'next'
import Link from 'next/link'
import { buttonStyles } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'

const downloadTitle = 'Download Soulidity Desktop'
const downloadDescription =
  'The Soulidity Desktop Companion: a floating AI partner that links your Souls, agents, and CLI hooks into one local control surface.'

export const metadata: Metadata = {
  title: downloadTitle,
  description: downloadDescription,
  alternates: { canonical: '/download' },
  openGraph: {
    title: `${downloadTitle} · Soulidity`,
    description: downloadDescription,
    url: '/download',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${downloadTitle} · Soulidity`,
    description: downloadDescription,
  },
}

export const revalidate = 300

interface DesktopManifest {
  manifestVersion: number
  version: string
  publishedAt?: string
  mac?: {
    arm64?: {
      url: string
      fileName?: string
      sizeBytes?: number
    }
  }
}

interface DesktopRelease {
  version: string
  macArm64Url: string
  source: 'manifest' | 'env' | 'none'
}

async function loadDesktopRelease(): Promise<DesktopRelease> {
  const manifestUrl = process.env.DESKTOP_MANIFEST_URL?.trim()
  if (manifestUrl) {
    try {
      const res = await fetch(manifestUrl, {
        next: { revalidate: 300, tags: ['desktop-manifest'] },
      })
      if (res.ok) {
        const data = (await res.json()) as DesktopManifest
        const url = data.mac?.arm64?.url?.trim()
        const version = data.version?.trim()
        if (url && version) {
          return { version, macArm64Url: url, source: 'manifest' }
        }
      }
    } catch {
      // fall through to env fallback
    }
  }

  const envUrl = process.env.NEXT_PUBLIC_DESKTOP_MAC_ARM64_URL?.trim() ?? ''
  const envVersion = process.env.NEXT_PUBLIC_DESKTOP_VERSION?.trim() ?? ''
  if (envUrl) {
    return { version: envVersion || '0.0.4', macArm64Url: envUrl, source: 'env' }
  }
  return { version: envVersion || '0.0.0', macArm64Url: '', source: 'none' }
}

const features = [
  {
    icon: '◎',
    title: 'Link Souls to your wallet',
    desc: 'Browse your Soul catalog, swap active persona, and sync grants right from the menubar.',
  },
  {
    icon: '⌨',
    title: 'CLI agent bridge',
    desc: 'Approve or deny tool permissions for Claude Code, Codex, Gemini, and more from a single UI. No more modal whack-a-mole.',
  },
  {
    icon: '⎙',
    title: 'Local-first persona',
    desc: 'Soul bundles decrypt to your device. Access control stays on-chain; the data stays yours.',
  },
]

const requirements = [
  { label: 'macOS', value: '13 Ventura or later' },
  { label: 'Architecture', value: 'Apple Silicon (M-series)' },
  { label: 'Disk space', value: '~80 MB installed' },
  { label: 'Account', value: 'Privy-linked Soulidity account' },
]

export default async function DownloadPage() {
  const release = await loadDesktopRelease()
  const hasBuild = release.macArm64Url.length > 0

  return (
    <div className="relative z-10 overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[-10%] top-[-8%] h-[420px] w-[420px] rounded-full bg-purple/20 blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[8%] left-[-10%] h-[340px] w-[340px] rounded-full bg-teal/[0.12] blur-[120px]"
      />

      <section className="mx-auto flex min-h-[calc(100vh-56px)] max-w-[960px] flex-col px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20 lg:px-8">
        <p className="mb-5 text-[11px] font-bold uppercase tracking-[0.24em] text-teal">
          Desktop Companion · v{release.version}
        </p>

        <h1 className="max-w-[760px] text-[clamp(32px,5vw,56px)] font-extrabold leading-[1.08] tracking-[-0.03em] text-foreground">
          Bring your Souls{' '}
          <span className="bg-[linear-gradient(90deg,var(--purple),var(--teal))] bg-clip-text text-transparent">
            off the browser
          </span>
        </h1>

        <p className="mt-5 max-w-[620px] text-base leading-[1.65] text-muted sm:text-lg">
          Soulidity Desktop is a small floating partner for your menubar. Link it once, then manage
          Soul access, review CLI agent permissions, and preview persona bundles without leaving
          your editor.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
          {hasBuild ? (
            <a
              href={release.macArm64Url}
              download
              className={buttonStyles({ variant: 'landing', size: 'lg' })}
            >
              ⇣ Download for macOS (Apple Silicon)
            </a>
          ) : (
            <button
              type="button"
              disabled
              className={cn(
                buttonStyles({ variant: 'landing', size: 'lg' }),
                'opacity-50 pointer-events-none',
              )}
            >
              Build coming soon
            </button>
          )}
          <Link
            href="/desktop/link"
            className={buttonStyles({ variant: 'outline', size: 'lg' })}
          >
            Already installed → Link device
          </Link>
        </div>

        {hasBuild ? (
          <p className="mt-3 text-xs text-muted">
            Direct link:{' '}
            <a href={release.macArm64Url} className="break-all text-purple hover:underline">
              {release.macArm64Url}
            </a>
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted">
            The hosted build URL is not configured yet. Publish a Desktop release or set{' '}
            <code className="rounded bg-card2 px-1.5 py-0.5 font-mono text-[11px] text-teal">
              DESKTOP_MANIFEST_URL
            </code>{' '}
            in Vercel.
          </p>
        )}

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card rounded-xl p-5">
              <div className="mb-3 text-[24px] text-purple">{f.icon}</div>
              <div className="mb-2 text-sm font-bold text-foreground">{f.title}</div>
              <p className="text-xs leading-[1.5] text-muted">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <div className="card rounded-xl p-6">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.1em] text-purple">
              System requirements
            </p>
            <dl className="space-y-3">
              {requirements.map((r) => (
                <div key={r.label} className="flex items-start justify-between gap-4">
                  <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                    {r.label}
                  </dt>
                  <dd className="text-right text-sm text-foreground">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="card rounded-xl p-6">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.1em] text-gold">
              First launch on macOS
            </p>
            <ol className="space-y-3 text-[13px] leading-[1.6] text-muted">
              <li>
                <span className="mr-2 text-gold">1.</span>
                Open the downloaded <span className="font-mono text-foreground">.dmg</span> and drag{' '}
                <span className="font-mono text-foreground">Soulidity Desktop.app</span> into{' '}
                <span className="font-mono text-foreground">/Applications</span>.
              </li>
              <li>
                <span className="mr-2 text-gold">2.</span>
                This build is not yet code-signed. Right-click the app icon → <em>Open</em> the
                first time to bypass Gatekeeper.
              </li>
              <li>
                <span className="mr-2 text-gold">3.</span>
                If macOS still refuses, run in Terminal:
                <pre className="mt-2 overflow-x-auto rounded-lg bg-card2 p-3 font-mono text-[11px] text-teal">
                  xattr -cr &quot;/Applications/Soulidity Desktop.app&quot;
                </pre>
              </li>
              <li>
                <span className="mr-2 text-gold">4.</span>
                Launch the app, then visit{' '}
                <Link href="/desktop/link" className="text-purple hover:underline">
                  /desktop/link
                </Link>{' '}
                to bind your account.
              </li>
            </ol>
          </div>
        </div>

        <div className="mt-12 rounded-xl border border-border bg-card2/30 p-5">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-teal">
            Windows &amp; Linux
          </p>
          <p className="text-[13px] leading-[1.6] text-muted">
            Windows and Linux builds are not published yet. Star the repo or follow announcements
            for availability.
          </p>
        </div>
      </section>
    </div>
  )
}
