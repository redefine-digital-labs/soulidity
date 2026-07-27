import type { Metadata } from 'next'
import Link from 'next/link'

const pageTitle = 'Desktop Companion'
const pageDescription =
  'How the Soulidity desktop app pairs with the web app — sprite grant flow, protected sprite IPC, mint deep-link callback, install and upgrade.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: '/resources/desktop-companion' },
  openGraph: {
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
    url: '/resources/desktop-companion',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
  },
}

export default function DesktopCompanionPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Desktop Companion</h1>
        <p className="text-sm text-muted">
          The Soulidity desktop app renders Souls you own (or hold an asset-scope grant for) as live personas — animated sprite, voice, memory-aware chat. This guide covers the web ↔ desktop bridge, sprite grant flow, the protected-sprite IPC, the post-mint deep-link callback, and install / upgrade.
        </p>
      </div>

      {/* Tab strip */}
      <div className="flex overflow-x-auto border-b-[1.5px] border-border" style={{ scrollbarWidth: 'none' }}>
        <button className="bg-transparent border-none px-5 py-2.5 text-sm font-bold text-foreground border-b-[2.5px] border-purple -mb-[1.5px] cursor-pointer">
          📄 Documentation
        </button>
        <Link href="/resources/stats" className="bg-transparent border-none px-5 py-2.5 text-sm font-semibold text-muted cursor-pointer hover:text-foreground transition">
          📊 Protocol Stats
        </Link>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Architecture overview</h2>
        <p className="text-sm text-muted">
          The desktop app is an Electron shell. The renderer process loads a thin React UI that talks to a local backend running in the main process. The main process owns the Sui RPC client, the Walrus blob client, the Seal session keys, and the local cache. For protected persona sprites, the main process decrypts locally and returns an explicit byte payload to the renderer so the renderer can populate the local persona cache; the bytes remain on the user&apos;s machine and are not sent back to Soulidity servers.
        </p>
        <ul className="text-sm text-muted space-y-2">
          <li><strong className="text-foreground">Web app</strong> handles login, mint, market, grants, paid access — anything that requires a wallet signature happens in the browser.</li>
          <li><strong className="text-foreground">Desktop app</strong> renders the persona and runs the chat agent. It links to the web account, stores its desktop token and agent key locally, and authorizes itself as a grant agent when protected content requires it.</li>
          <li>Both apps share the same Sui mainnet state. The DB mirror behind the web app is non-authoritative — desktop fetches live chain state when issuing Seal approvals.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Sprite & audio grant flow</h2>
        <p className="text-sm text-muted">
          When the desktop app first opens a Soul whose sprite or audio is not public, it walks the user through a single grant TX that authorizes the desktop wallet to decrypt those blobs.
        </p>
        <ol className="text-sm text-muted space-y-1.5 ml-5 list-decimal">
          <li>Desktop reads the Soul state and asks: do I already hold a <code>SoulGrant</code> for this Soul with at least <code>SCOPE_ASSETS</code> (bit <code>8</code>)?</li>
          <li>If not, it prompts the user (the Soul owner) to sign <code>grant::issue_to_grantee</code> with the desktop wallet address as grantee. Default expiry is <code>null</code> (no TTL) — termination is by explicit revoke.</li>
          <li>After confirmation, the desktop app records the grant in its local cache and fetches the active sprite + audio versions.</li>
          <li>If you later add a sprite/audio version, <strong className="text-foreground">auto-grant on append</strong> tops up any agent (including this desktop agent) whose existing scopes don&apos;t cover the new content. See <Link href="/resources/agent-integration" className="text-action-label hover:text-foreground transition">Agent Integration</Link>.</li>
        </ol>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Protected-sprite IPC</h2>
        <p className="text-sm text-muted">
          For persona sprites bound under non-public read modes, the renderer fetches a Soul access payload, then asks the main process to decrypt that payload:
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// Renderer → main
ipcRenderer.invoke('soul:decrypt-protected-sprite', {
  access: privateAccessPayload,
})
// → { bytes: Uint8Array, fileName: 'sprite.png', mimeType: 'image/png' }

ipcRenderer.invoke('soul:cache-persona', {
  catalogId,
  sourceType: 'soul',
  sourceRef: soulId,
  version,
  spriteBytes: decrypted.bytes,
  configJson,
})`}</code>
        </pre>
        <p className="text-sm text-muted">
          The main process validates the access payload, pulls the encrypted blob from Walrus, decrypts it locally, and returns the decrypted bytes to the renderer. The renderer immediately hands those bytes back to <code>soul:cache-persona</code>; the main process writes the sprite and config into the desktop cache under the app&apos;s local user-data directory. The plaintext cache is local to the machine and is not uploaded to Soulidity servers.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Mint completion callback</h2>
        <p className="text-sm text-muted">
          After a Mint By Web hand-off finishes minting, the web app can notify the desktop app through the registered custom protocol:
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`soulidity://mint-completed?token=mh_...`}</code>
        </pre>
        <p className="text-sm text-muted">
          The desktop app registers <code>soulidity://</code> via <code>app.setAsDefaultProtocolClient</code>. The current handler accepts <code>mint-completed</code> to clear the local extract draft and bring the main window forward. It does not currently implement a <code>soulidity://open?soulId=...</code> purchase or mint handoff route.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Install &amp; upgrade</h2>
        <ul className="text-sm text-muted space-y-2">
          <li><strong className="text-foreground">Install.</strong> Download the latest release from the <Link href="/download" className="text-action-label hover:text-foreground transition">download page</Link>. macOS and Windows builds are signed; Linux is a tarball.</li>
          <li><strong className="text-foreground">Channel.</strong> The web app ships fresh on every release. The desktop app fetches its update manifest from Vercel Blob with ISR caching (the web app does not redeploy when desktop releases) — set the channel (<code>stable</code> / <code>beta</code>) in the desktop settings.</li>
          <li><strong className="text-foreground">Auto-update.</strong> On launch, the app checks the manifest, downloads the delta if newer, and prompts to restart. Manual download from the same release page always works as a fallback.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Troubleshooting</h2>
        <ul className="text-sm text-muted space-y-2">
          <li><strong className="text-foreground">Sprite shows as placeholder.</strong> The desktop wallet doesn&apos;t hold an asset-scope grant — open the Soul detail in the web app and authorize.</li>
          <li><strong className="text-foreground">Sprite went blank after I bought the Soul.</strong> Ownership rotated and the old auto-grant was invalidated. The desktop app should detect this and prompt for a fresh grant; if not, retry from the persona settings.</li>
          <li><strong className="text-foreground">Open-in-desktop button did nothing.</strong> The protocol handler isn&apos;t registered. Reinstall the desktop app or copy the Soul ID manually into the desktop pairing screen.</li>
          <li><strong className="text-foreground">Decryption errors.</strong> Open <em>View → Toggle Developer Tools → Main Process</em> for the raw IPC error code. The four error classes are <code>NOT_GRANTED</code>, <code>WALRUS_FETCH_FAILED</code>, <code>SEAL_DENIED</code>, <code>TIMEOUT</code>.</li>
        </ul>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-action-label hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/agent-integration" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: Agent Integration →
        </Link>
      </div>
    </div>
  )
}
