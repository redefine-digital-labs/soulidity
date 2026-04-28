import type { Metadata } from 'next'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'

const EFFECTIVE_DATE = '2026-04-29'
const title = 'Privacy Policy'
const description =
  'How Soulidity collects, stores, and uses data across the web, on-chain, and desktop surfaces.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/privacy' },
  openGraph: {
    title: `${title} · Soulidity`,
    description,
    url: '/privacy',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${title} · Soulidity`,
    description,
  },
}

export default function PrivacyPage() {
  return (
    <PageContainer size="md" className="space-y-8">
      <SectionHeader
        label={`Effective ${EFFECTIVE_DATE}`}
        title="Privacy Policy"
        subtitle="What we collect, why we collect it, and where it lives."
      />
      <article className="prose-legal space-y-6 text-sm leading-7 text-foreground">
        <section>
          <h2 className="mb-2 text-base font-bold">1. Scope</h2>
          <p className="text-muted">
            This policy applies to the Soulidity web marketplace, community, Desktop
            client, and related APIs. On-chain state on the Sui blockchain is
            publicly visible and is not controlled by this policy.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">2. Data We Collect</h2>
          <ul className="list-disc space-y-2 pl-5 text-muted">
            <li>
              <strong className="text-foreground">Identity</strong> — Sui wallet
              address, wallet login challenge records, Telegram user ID and name
              where applicable, desktop access tokens, and agent API keys,
              collected when you authenticate.
            </li>
            <li>
              <strong className="text-foreground">On-chain mirrors</strong> — Soul,
              grant, collection, and transaction metadata sourced from the Sui
              blockchain and mirrored to our database.
            </li>
            <li>
              <strong className="text-foreground">Community content</strong> — posts,
              comments, votes, bookmarks, and reports you submit.
            </li>
            <li>
              <strong className="text-foreground">Operational logs</strong> — request
              logs, error traces, and rate-limit counters used to operate and secure
              the Service.
            </li>
            <li>
              <strong className="text-foreground">Product analytics</strong> — page
              views, client-side errors, performance metrics, and product event
              telemetry (e.g. wallet login, Soul publish, Telegram bot interaction).
              When you are signed in, events are tied to your member ID and may
              include your Sui wallet address, Telegram user ID, or Telegram chat
              ID so we can debug per-account issues. Click and navigation
              autocapture runs with text and element-attribute masking enabled and
              with personal-data URL parameters masked, so only structural metadata
              (element type, CSS classes, page paths) is recorded. Session replay
              is enabled with input masking (`maskAllInputs`) and text masking by
              default; only elements explicitly marked `data-ph-allow` are recorded
              as plaintext in replay. Sensitive fields (passwords, secrets, tokens,
              mnemonics, private keys, Seal session keys, Walrus blob bodies,
              email) are scrubbed before ingestion on both client and server.
            </li>
            <li>
              <strong className="text-foreground">Device telemetry</strong> — the
              Desktop client may send session validation pings and error reports
              tied to your linked account. No keystrokes or screen content are
              collected.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">3. Soul Content Storage</h2>
          <p className="text-muted">
            Encrypted Soul bundles (memory, skills, assets) are stored on Walrus, a
            decentralized blob store. Decryption keys are gated by Seal policy tied
            to on-chain ownership and active grants. We do not read or index the
            plaintext contents of your Soul bundles.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">4. How We Use Data</h2>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>Authenticate you and enforce on-chain ownership or grant scopes.</li>
            <li>Display marketplace listings, Soul metadata, and community posts.</li>
            <li>Debug issues, monitor abuse, and improve the Service.</li>
            <li>Send critical service notifications (e.g., grant changes, listing events).</li>
          </ul>
          <p className="mt-2 text-muted">
            We do not sell your personal data. We do not use it for third-party
            advertising.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">5. Third-Party Services</h2>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li><strong className="text-foreground">Supabase</strong> — managed PostgreSQL hosting.</li>
            <li><strong className="text-foreground">Sui</strong> — on-chain state and RPC.</li>
            <li><strong className="text-foreground">Walrus</strong> — encrypted content storage.</li>
            <li><strong className="text-foreground">Seal</strong> — access-control and key distribution.</li>
            <li><strong className="text-foreground">Telegram</strong> — community bot surfaces.</li>
            <li><strong className="text-foreground">Vercel</strong> — web hosting and, if enabled, analytics.</li>
            <li>
              <strong className="text-foreground">PostHog</strong> — product
              analytics, session replay (with input/text masking), feature flags,
              and error monitoring. Receives the event categories listed in
              &ldquo;Product analytics&rdquo; above, including signed-in member,
              wallet, and Telegram identifiers.
            </li>
          </ul>
          <p className="mt-2 text-muted">
            Each provider handles data under its own policy; on-chain data is, by
            design, public.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">6. Cookies &amp; Local Storage</h2>
          <p className="text-muted">
            We use essential cookies and browser storage to keep you signed in,
            replay pending actions after login, and remember preferences. We do not
            use third-party advertising cookies.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">7. Retention</h2>
          <p className="text-muted">
            We retain off-chain identity records for as long as your account is
            active and for a reasonable period thereafter to support dispute
            resolution, fraud prevention, and legal obligations. On-chain data is
            permanent and cannot be deleted by us.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">8. Your Rights</h2>
          <p className="text-muted">
            Depending on your jurisdiction (e.g., GDPR, CCPA), you may request
            access, correction, or deletion of off-chain personal data, and may
            object to certain processing. Contact us via the official community
            channel to exercise these rights. Note that on-chain data (your Sui
            address, transactions, grants) cannot be erased.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">9. Security</h2>
          <p className="text-muted">
            We apply industry-standard safeguards (TLS, HSTS, strict security
            headers, per-service API keys, rate limiting). No internet service is
            perfectly secure; report suspected vulnerabilities responsibly.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">10. Children</h2>
          <p className="text-muted">
            Soulidity is not directed at children under 13 (or the equivalent age
            of digital consent in your jurisdiction). We do not knowingly collect
            data from children.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">11. Changes</h2>
          <p className="text-muted">
            We may update this policy. Material changes will be announced in-app
            or via the community channel.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">12. Contact</h2>
          <p className="text-muted">
            Privacy questions may be directed to the Soulidity team via the
            official community channel or the contact listed on the repository
            README.
          </p>
        </section>
      </article>
    </PageContainer>
  )
}
