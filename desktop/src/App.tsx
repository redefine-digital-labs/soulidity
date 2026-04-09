import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  desktopPrimaryNavItems,
  type DesktopRouteId,
  readDesktopHashPath,
  resolveDesktopRoute,
  toDesktopHref,
} from './app/routes'
import './styles.css'

interface DesktopShellStatus {
  runtime: string
  phase: string
  routes: number
}

interface RoutePanelLink {
  label: string
  to: string
  caption: string
}

interface RoutePanel {
  eyebrow: string
  summary: string
  checklist: string[]
  links: RoutePanelLink[]
}

const routePanels: Record<Exclude<DesktopRouteId, 'persona'>, RoutePanel> = {
  home: {
    eyebrow: 'Phase One Desktop Shell',
    summary:
      'Anchor the first-run desktop surface with a stable command center before auth, downloads, and local library behaviors arrive.',
    checklist: [
      'Pin the global navigation and route contract for all phase-one surfaces.',
      'Keep the runtime message honest: browser preview stays separate from the future Tauri shell handshake.',
      'Expose one curated detail drill-in so later install flows have a stable URL target.',
    ],
    links: [
      {
        label: 'Open Explore',
        to: '/explore',
        caption: 'Inspect the public catalog landing shell.',
      },
      {
        label: 'Open Persona Detail',
        to: '/persona/aurora-starter',
        caption: 'Verify a detail route is already wired for a starter persona.',
      },
    ],
  },
  explore: {
    eyebrow: 'Catalog Surface',
    summary:
      'Explore is reserved for the mixed starter + curated soul feed. This shell just establishes layout hierarchy and navigation.',
    checklist: [
      'Keep hero space ready for anonymous desktop catalog cards.',
      'Reserve a compact side rail for filters and refresh actions.',
      'Use the same route contract later when desktop cache and offline fallback arrive.',
    ],
    links: [
      {
        label: 'Inspect Search',
        to: '/search',
        caption: 'Move into the explicit search workspace placeholder.',
      },
      {
        label: 'Jump To Persona',
        to: '/persona/aurora-starter',
        caption: 'Open a prewired detail placeholder from the catalog shell.',
      },
    ],
  },
  search: {
    eyebrow: 'Retrieval Workspace',
    summary:
      'Search will become the high-signal lookup surface for starter and curated souls, with install intent flowing out of the results list.',
    checklist: [
      'Keep room for query state, filters, and offline cache hints.',
      'Preserve the same top-level rail so route changes stay lightweight.',
      'Leave result list density decisions for the install/download story.',
    ],
    links: [
      {
        label: 'View Library',
        to: '/library',
        caption: 'Check the installed-persona workspace placeholder.',
      },
      {
        label: 'Return Home',
        to: '/',
        caption: 'Go back to the desktop shell landing page.',
      },
    ],
  },
  library: {
    eyebrow: 'Local Library',
    summary:
      'Library is where installed personas and active local state will appear after the persistence layer and download jobs land.',
    checklist: [
      'Reserve a clear installed-state list area.',
      'Keep room for current active persona and disk usage summaries.',
      'Avoid faking install state before the local persistence contract exists.',
    ],
    links: [
      {
        label: 'Open Settings',
        to: '/settings',
        caption: 'Inspect the preferences and sync placeholder.',
      },
      {
        label: 'Open Auth',
        to: '/auth',
        caption: 'Review the device-login shell from the desktop side.',
      },
    ],
  },
  settings: {
    eyebrow: 'Preferences + Sync',
    summary:
      'Settings will eventually host account sync, desktop preferences, and the active persona controls without leaking local install detail into the web API.',
    checklist: [
      'Keep account sync separate from install bookkeeping.',
      'Reserve a stable slot for desktop preference toggles.',
      'Leave the account status placeholder visible until auth wiring lands.',
    ],
    links: [
      {
        label: 'Open Auth',
        to: '/auth',
        caption: 'Validate the login handoff route placeholder.',
      },
      {
        label: 'Back To Library',
        to: '/library',
        caption: 'Return to the future installed-persona view.',
      },
    ],
  },
  auth: {
    eyebrow: 'Browser Login Handoff',
    summary:
      'Auth is reserved for browser-triggered device binding, deep-link return, and session recovery. This story only lays down the route and shell.',
    checklist: [
      'Keep the browser handoff copy explicit and desktop-focused.',
      'Leave room for device code polling state.',
      'Preserve a neutral shell until the deep-link/session stories arrive.',
    ],
    links: [
      {
        label: 'Return Home',
        to: '/',
        caption: 'Go back to the shell overview.',
      },
      {
        label: 'Preview Persona Detail',
        to: '/persona/aurora-starter',
        caption: 'Confirm direct route rendering still works from auth context.',
      },
    ],
  },
}

function isTauriRuntime() {
  if (typeof window === 'undefined') {
    return false
  }

  return '__TAURI_INTERNALS__' in (window as Window & { __TAURI_INTERNALS__?: unknown })
}

function readCurrentPath() {
  if (typeof window === 'undefined') {
    return '/'
  }

  return readDesktopHashPath(window.location.hash)
}

function ensureInitialHash() {
  if (typeof window === 'undefined') {
    return
  }

  if (!window.location.hash) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`)
  }
}

export default function App() {
  const [currentPath, setCurrentPath] = useState(readCurrentPath)
  const [shellStatus, setShellStatus] = useState<DesktopShellStatus | null>(null)

  useEffect(() => {
    ensureInitialHash()

    const handleHashChange = () => {
      setCurrentPath(readCurrentPath())
    }

    handleHashChange()
    window.addEventListener('hashchange', handleHashChange)

    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  useEffect(() => {
    if (!isTauriRuntime()) {
      setShellStatus(null)
      return
    }

    let cancelled = false

    void invoke<DesktopShellStatus>('desktop_shell_status')
      .then((status) => {
        if (!cancelled) {
          setShellStatus(status)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShellStatus(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const route = useMemo(() => resolveDesktopRoute(currentPath), [currentPath])
  const isPersonaRoute = route.definition.id === 'persona'
  const panel: RoutePanel = isPersonaRoute
    ? {
        eyebrow: 'Persona Drill-In',
        summary: `Persona detail is ready to host manifest, download state, and install actions for "${route.params.id}".`,
        checklist: [
          'Keep the detail route stable so catalog and library can deep-link into it.',
          'Reserve the action rail for download, checksum, and activate behaviors.',
          'Leave local file state empty until the persistence story lands.',
        ],
        links: [
          {
            label: 'Back To Explore',
            to: '/explore',
            caption: 'Return to the public catalog surface.',
          },
          {
            label: 'Open Library',
            to: '/library',
            caption: 'Move into the installed-persona workspace placeholder.',
          },
        ],
      }
    : routePanels[route.definition.id as Exclude<DesktopRouteId, 'persona'>]

  const runtimeLabel = shellStatus ? 'Tauri shell connected' : 'Browser preview'
  const runtimeDetail = shellStatus
    ? `${shellStatus.phase} • ${shellStatus.routes} routes wired`
    : 'Vite-only preview for route verification'

  return (
    <div className="desktop-shell">
      <aside className="desktop-rail">
        <div className="desktop-brand">
          <span className="desktop-brand__badge">Soulidity</span>
          <h1>Desktop One</h1>
          <p>Phase-one shell for browsing, auth, library, and persona routes.</p>
        </div>

        <nav
          aria-label="Primary"
          className="desktop-nav"
        >
          {desktopPrimaryNavItems.map((item) => {
            const isActive = item.id === route.definition.id
            return (
              <a
                key={item.id}
                className={`desktop-nav__item${isActive ? ' is-active' : ''}`}
                href={toDesktopHref(item.to)}
              >
                <span>{item.id}</span>
                <strong>{item.to === '/' ? 'Overview' : item.to.slice(1)}</strong>
              </a>
            )
          })}
        </nav>

        <div className="desktop-runtime">
          <span>{runtimeLabel}</span>
          <strong>{runtimeDetail}</strong>
        </div>
      </aside>

      <main className="desktop-main">
        <section className="desktop-hero">
          <div>
            <p className="desktop-eyebrow">{panel.eyebrow}</p>
            <h2>{route.definition.title}</h2>
            <p className="desktop-summary">{panel.summary}</p>
          </div>

          <div className="desktop-route-meta">
            <div>
              <span>Route</span>
              <strong>{route.pathname}</strong>
            </div>
            <div>
              <span>Preview</span>
              <strong>Hash-routed desktop shell</strong>
            </div>
            <div>
              <span>Next focus</span>
              <strong>Auth, install, persistence</strong>
            </div>
          </div>
        </section>

        <section className="desktop-grid">
          <article className="desktop-card">
            <header>
              <span>Checklist</span>
              <strong>What this placeholder locks in</strong>
            </header>
            <ul>
              {panel.checklist.map((item: string) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="desktop-card">
            <header>
              <span>Quick links</span>
              <strong>Route transitions to verify now</strong>
            </header>
            <div className="desktop-link-grid">
              {panel.links.map((link: RoutePanelLink) => (
                <a
                  key={link.label}
                  className="desktop-link-card"
                  href={toDesktopHref(link.to)}
                >
                  <strong>{link.label}</strong>
                  <p>{link.caption}</p>
                </a>
              ))}
            </div>
          </article>
        </section>
      </main>
    </div>
  )
}
