import type { Metadata } from 'next'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'

const EFFECTIVE_DATE = '2026-04-21'
const title = 'Terms of Service'
const description =
  'Terms governing access to Soulidity, the on-chain Soul marketplace and community.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/terms' },
  openGraph: {
    title: `${title} · Soulidity`,
    description,
    url: '/terms',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${title} · Soulidity`,
    description,
  },
}

export default function TermsPage() {
  return (
    <PageContainer size="md" className="space-y-8">
      <SectionHeader
        label={`Effective ${EFFECTIVE_DATE}`}
        title="Terms of Service"
        subtitle="Please read these Terms carefully before using Soulidity."
      />
      <article className="prose-legal space-y-6 text-sm leading-7 text-foreground">
        <section>
          <h2 className="mb-2 text-base font-bold">1. Acceptance</h2>
          <p className="text-muted">
            By accessing or using Soulidity (“we”, “us”, the “Service”), including the
            web marketplace, community, and Desktop client, you agree to these Terms of
            Service. If you do not agree, do not use the Service.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">2. Eligibility &amp; Accounts</h2>
          <p className="text-muted">
            You must be of legal age to form a binding contract in your jurisdiction.
            Identity is resolved via Privy, Telegram, or a Sui wallet challenge. You
            are responsible for safeguarding your wallet keys, session tokens, and
            any agent API keys issued to you.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">3. On-Chain Transactions</h2>
          <p className="text-muted">
            Soul minting, listing, purchase, grant issuance, and ownership transfer
            occur on the Sui blockchain. We do not hold custody of your assets. All
            on-chain transactions are final, irreversible, and subject to network
            fees and Move module behavior. USDC settlement amounts are denominated
            on-chain in atomic units and are the authoritative source of pricing.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">4. Soul Content &amp; License</h2>
          <p className="text-muted">
            Creators retain ownership of the intellectual property embedded in a
            Soul. By minting a Soul, you grant buyers, grantees, and agents a
            non-exclusive license to access the Soul’s content (memory, skills,
            assets) within the scope authorized on-chain. Encrypted Soul bundles are
            stored on Walrus; decryption is gated by Seal policy tied to on-chain
            ownership or active grants.
          </p>
          <p className="mt-2 text-muted">
            You represent that you have all rights necessary to upload and license
            Soul content. You may not mint Souls that infringe third-party rights,
            violate applicable law, or contain illegal, harmful, or prohibited
            material.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">5. Grants &amp; Access</h2>
          <p className="text-muted">
            Soul owners may issue scoped grants (seal, memory, skills) to other
            addresses or agents, with optional expiry. Grants auto-invalidate upon
            ownership transfer. Access APIs verify on-chain owner or active grant
            state before issuing Seal session parameters. You are responsible for
            the scopes and recipients you authorize.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">6. Fees &amp; Royalties</h2>
          <p className="text-muted">
            On each sale, Soulidity splits the USDC settlement among the platform
            fee, the creator royalty, and, where applicable, the collection royalty.
            Exact fee and royalty percentages are defined on-chain at listing time
            and displayed prior to checkout.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">7. Community Content</h2>
          <p className="text-muted">
            Community posts, comments, and training logs must follow the community
            guidelines. We may remove content and suspend accounts that violate
            these Terms, infringe third-party rights, or harm the community.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">8. Desktop Client</h2>
          <p className="text-muted">
            The Soulidity Desktop client runs locally on your machine and
            may interact with the Service via authenticated sessions. You are
            responsible for securing your local device. Desktop releases are
            distributed via our official download page; do not install builds from
            untrusted sources.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">9. Prohibited Conduct</h2>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>Reverse-engineering, attacking, or disrupting the Service or Move modules.</li>
            <li>Market manipulation, wash trading, or fraudulent listings.</li>
            <li>Uploading malware, illegal content, or personally identifiable information of third parties without consent.</li>
            <li>Circumventing access control, grant scopes, or fee logic.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">10. Disclaimer of Warranties</h2>
          <p className="text-muted">
            The Service is provided “AS IS” and “AS AVAILABLE”, without warranties
            of any kind. We do not warrant that Sui, Walrus, Seal, Privy, or other
            third-party infrastructure will be uninterrupted, secure, or error-free.
            Digital assets are volatile; use at your own risk.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">11. Limitation of Liability</h2>
          <p className="text-muted">
            To the maximum extent permitted by law, Soulidity and its contributors
            shall not be liable for indirect, incidental, consequential, or
            punitive damages, or for lost profits, lost data, or on-chain losses
            arising from your use of the Service.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">12. Changes</h2>
          <p className="text-muted">
            We may update these Terms from time to time. Material changes will be
            announced in-app or via the community channel. Continued use after an
            update constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">13. Contact</h2>
          <p className="text-muted">
            Questions about these Terms may be directed to the Soulidity team via
            the official community channel or the contact listed on the repository
            README.
          </p>
        </section>
      </article>
    </PageContainer>
  )
}
