import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  desktopPrimaryNavItems,
  type DesktopRouteId,
  readDesktopHashPath,
  resolveDesktopRoute,
  toDesktopHref,
} from './app/routes'
import {
  completeDesktopDeviceAuthorizationFromDeepLink,
  restoreDesktopAuthSession,
  startDesktopDeviceAuthorization,
  type PendingDesktopAuthSession,
} from './lib/auth'
import {
  clearPersistedAuthSession,
  getDesktopWebBaseUrl,
  getCurrentDeepLinks,
  isTauriRuntime,
  loadPersistedAuthSession,
  onDeepLinkOpen,
  openExternalUrl,
  pollDesktopDeviceSessionTransport,
  savePersistedAuthSession,
  startDesktopDeviceSessionTransport,
} from './lib/auth-runtime'
import {
  fetchDesktopCatalogPageFromApi,
  fetchDesktopPersonaManifestFromApi,
  filterDesktopCatalogItems,
  loadDesktopCatalogCacheFromStorage,
  loadDesktopPersonaManifest,
  refreshDesktopCatalog,
  saveDesktopCatalogCacheToStorage,
} from './lib/catalog'
import { installDesktopPersona, loadDesktopInstalledPersonas } from './lib/persona-runtime'
import type { AuthSessionRecord, InstalledPersonaRecord } from './lib/persistence'
import type { DesktopCatalogItem, DesktopPersonaManifest } from '../../web/lib/types/desktop.ts'
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
      'Auth now launches browser-based device binding, listens for the Soulidity deep-link callback, and restores the last confirmed desktop account session on restart.',
    checklist: [
      'Launch the existing web confirmation page from the desktop shell.',
      'Resolve the returning deep link back into a confirmed account session.',
      'Persist the confirmed desktop session locally for restart recovery.',
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

const DESKTOP_CATALOG_PAGE_SIZE = 24

function mergeCatalogItem(
  existingItems: DesktopCatalogItem[],
  manifest: DesktopPersonaManifest,
) {
  const nextItem: DesktopCatalogItem = {
    id: manifest.id,
    sourceType: manifest.sourceType,
    sourceRef: manifest.sourceRef,
    title: manifest.title,
    description: manifest.description,
    coverImage: manifest.coverImage,
    thumbnail: manifest.thumbnail,
    updatedAt: manifest.updatedAt,
  }

  return existingItems.some((item) => item.id === nextItem.id)
    ? existingItems.map((item) => (item.id === nextItem.id ? nextItem : item))
    : [...existingItems, nextItem]
}

function formatDesktopTimestamp(value: string | null) {
  if (!value) {
    return 'Not synced yet'
  }

  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString()
}

export default function App() {
  const [currentPath, setCurrentPath] = useState(readCurrentPath)
  const [shellStatus, setShellStatus] = useState<DesktopShellStatus | null>(null)
  const [authPendingSession, setAuthPendingSession] = useState<PendingDesktopAuthSession | null>(null)
  const [authSession, setAuthSession] = useState<AuthSessionRecord | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [catalogItems, setCatalogItems] = useState<DesktopCatalogItem[]>([])
  const [catalogSource, setCatalogSource] = useState<'network' | 'cache' | null>(null)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null)
  const [catalogSyncedAt, setCatalogSyncedAt] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [personaManifest, setPersonaManifest] = useState<DesktopPersonaManifest | null>(null)
  const [personaBusy, setPersonaBusy] = useState(false)
  const [personaError, setPersonaError] = useState<string | null>(null)
  const [personaNotice, setPersonaNotice] = useState<string | null>(null)
  const [installedPersonas, setInstalledPersonas] = useState<InstalledPersonaRecord[]>([])
  const [installBusyId, setInstallBusyId] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [installNotice, setInstallNotice] = useState<string | null>(null)
  const authPendingSessionRef = useRef<PendingDesktopAuthSession | null>(null)
  const deferredSearchQuery = useDeferredValue(searchQuery)

  useEffect(() => {
    authPendingSessionRef.current = authPendingSession
  }, [authPendingSession])

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

  useEffect(() => {
    let cancelled = false

    void loadPersistedAuthSession()
      .then((storedSession) => {
        if (cancelled) {
          return
        }

        const restoredSession = restoreDesktopAuthSession(storedSession)
        if (!restoredSession && storedSession) {
          void clearPersistedAuthSession()
        }

        setAuthSession(restoredSession)
        if (restoredSession) {
          setAuthNotice(`Restored local desktop session for ${restoredSession.accountId}.`)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAuthError(error instanceof Error ? error.message : 'Failed to load desktop auth session')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null

    const handleDeepLinkUrls = async (urls: string[]) => {
      for (const url of urls) {
        try {
          setAuthBusy(true)
          setAuthError(null)

          const session = await completeDesktopDeviceAuthorizationFromDeepLink(url, {
            pendingSession: authPendingSessionRef.current,
            pollSession: pollDesktopDeviceSessionTransport,
            saveSession: savePersistedAuthSession,
          })

          if (cancelled) {
            return
          }

          if (authPendingSessionRef.current?.deviceCode === session.deviceCode) {
            setAuthPendingSession(null)
          }

          setAuthSession(session)
          setAuthNotice(`Connected desktop session for ${session.accountId}.`)
        } catch (error) {
          if (!cancelled) {
            setAuthError(error instanceof Error ? error.message : 'Failed to complete desktop auth session')
          }
        } finally {
          if (!cancelled) {
            setAuthBusy(false)
          }
        }
      }
    }

    void getCurrentDeepLinks()
      .then((urls) => {
        if (!cancelled && urls.length > 0) {
          void handleDeepLinkUrls(urls)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAuthError(error instanceof Error ? error.message : 'Failed to read desktop deep links')
        }
      })

    void onDeepLinkOpen((urls) => {
      void handleDeepLinkUrls(urls)
    }).then((stopListening) => {
      unlisten = stopListening
    }).catch((error) => {
      if (!cancelled) {
        setAuthError(error instanceof Error ? error.message : 'Failed to subscribe to deep links')
      }
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  const route = useMemo(() => resolveDesktopRoute(currentPath), [currentPath])
  const isPersonaRoute = route.definition.id === 'persona'
  const isAuthRoute = route.definition.id === 'auth'
  const isSearchRoute = route.definition.id === 'search'
  const isCatalogRoute = route.definition.id === 'explore' || route.definition.id === 'search' || isPersonaRoute
  const resolvedPersonaItem = useMemo(
    () => (
      isPersonaRoute
        ? catalogItems.find((item) => item.id === route.params.id || item.sourceRef === route.params.id) ?? null
        : null
    ),
    [catalogItems, isPersonaRoute, route.params.id],
  )
  const visibleCatalogItems = useMemo(
    () => (isSearchRoute ? filterDesktopCatalogItems(catalogItems, deferredSearchQuery) : catalogItems),
    [catalogItems, deferredSearchQuery, isSearchRoute],
  )
  const installedPersonasById = useMemo(
    () => new Map(installedPersonas.map((record) => [record.personaId, record])),
    [installedPersonas],
  )
  const panel: RoutePanel = isPersonaRoute
    ? {
        eyebrow: personaManifest?.sourceType === 'soul' ? 'Curated Soul Detail' : 'Starter Persona Detail',
        summary: personaManifest
          ? `Inspect the live manifest for "${personaManifest.title}", review bundle metadata, and install starter assets without leaving the desktop flow.`
          : `Resolve manifest detail and install readiness for "${resolvedPersonaItem?.title ?? route.params.id}" from the shared desktop catalog contract.`,
        checklist: [
          'Use the same detail API for starter and curated soul manifests.',
          'Only surface anonymous install actions for starter personas.',
          'Keep cached manifest detail available when the catalog goes offline.',
        ],
        links: [
          {
            label: 'Back To Explore',
            to: '/explore',
            caption: 'Return to the mixed starter + curated soul feed.',
          },
          {
            label: 'Open Search',
            to: '/search',
            caption: 'Filter the same catalog from the dedicated search workspace.',
          },
        ],
      }
    : routePanels[route.definition.id as Exclude<DesktopRouteId, 'persona'>]

  useEffect(() => {
    let cancelled = false

    void loadDesktopInstalledPersonas()
      .then((records) => {
        if (!cancelled) {
          setInstalledPersonas(records)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setInstallError(error instanceof Error ? error.message : 'Failed to load installed personas')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleRefreshCatalog(reason: 'initial' | 'manual' = 'manual') {
    try {
      setCatalogBusy(true)
      setCatalogError(null)
      if (reason === 'manual') {
        setCatalogNotice(null)
      }

      const result = await refreshDesktopCatalog({
        now: () => new Date(),
        page: 1,
        pageSize: DESKTOP_CATALOG_PAGE_SIZE,
        fetchCatalogPage: () => fetchDesktopCatalogPageFromApi(1, DESKTOP_CATALOG_PAGE_SIZE),
        loadCache: () => loadDesktopCatalogCacheFromStorage(),
        saveCache: (cache) => saveDesktopCatalogCacheToStorage(cache),
      })

      setCatalogItems(result.items)
      setCatalogSource(result.source)
      setCatalogSyncedAt(result.syncedAt)
      setCatalogNotice(
        result.warning
        ?? (reason === 'manual' ? `Catalog refreshed at ${formatDesktopTimestamp(result.syncedAt)}.` : null),
      )
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'Failed to refresh desktop catalog')
    } finally {
      setCatalogBusy(false)
    }
  }

  useEffect(() => {
    void handleRefreshCatalog('initial')
  }, [])

  useEffect(() => {
    if (!isPersonaRoute) {
      setPersonaManifest(null)
      setPersonaBusy(false)
      setPersonaError(null)
      setPersonaNotice(null)
      return
    }

    let cancelled = false
    const personaId = resolvedPersonaItem?.id ?? route.params.id

    void loadDesktopPersonaManifest({
      personaId,
      fetchManifest: () => fetchDesktopPersonaManifestFromApi(personaId),
      loadCache: () => loadDesktopCatalogCacheFromStorage(),
      saveCache: (cache) => saveDesktopCatalogCacheToStorage(cache),
    })
      .then((result) => {
        if (cancelled) {
          return
        }

        setPersonaManifest(result.manifest)
        setCatalogItems((currentItems) => mergeCatalogItem(currentItems, result.manifest))
        setPersonaNotice(result.warning)
        setPersonaError(null)
      })
      .catch((error) => {
        if (!cancelled) {
          setPersonaError(error instanceof Error ? error.message : 'Failed to load persona detail')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPersonaBusy(false)
        }
      })

    setPersonaBusy(true)
    setPersonaError(null)
    setPersonaNotice(null)

    return () => {
      cancelled = true
    }
  }, [isPersonaRoute, resolvedPersonaItem?.id, route.params.id])

  async function handleInstallStarterPersona(manifest: DesktopPersonaManifest) {
    try {
      setInstallBusyId(manifest.id)
      setInstallError(null)
      setInstallNotice(null)

      const installedRecord = await installDesktopPersona(manifest)
      setInstalledPersonas((currentRecords) => [
        ...currentRecords.filter((record) => record.personaId !== installedRecord.personaId),
        installedRecord,
      ])
      setInstallNotice(`${manifest.title} is now installed for this desktop session.`)
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : 'Failed to install starter persona')
    } finally {
      setInstallBusyId(null)
    }
  }

  async function handleInstallFromCatalogItem(item: DesktopCatalogItem) {
    if (item.sourceType !== 'starter') {
      setInstallError('Anonymous install is only available for starter personas right now.')
      return
    }

    try {
      setInstallBusyId(item.id)
      setInstallError(null)
      setInstallNotice(null)

      const result = await loadDesktopPersonaManifest({
        personaId: item.id,
        fetchManifest: () => fetchDesktopPersonaManifestFromApi(item.id),
        loadCache: () => loadDesktopCatalogCacheFromStorage(),
        saveCache: (cache) => saveDesktopCatalogCacheToStorage(cache),
      })

      setPersonaManifest((currentManifest) => (
        currentManifest?.id === result.manifest.id ? result.manifest : currentManifest
      ))
      setCatalogItems((currentItems) => mergeCatalogItem(currentItems, result.manifest))
      if (result.warning) {
        setPersonaNotice(result.warning)
      }

      await handleInstallStarterPersona(result.manifest)
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : 'Failed to install starter persona')
    } finally {
      setInstallBusyId(null)
    }
  }

  const runtimeLabel = shellStatus ? 'Tauri shell connected' : 'Browser preview'
  const runtimeDetail = shellStatus
    ? `${shellStatus.phase} • ${shellStatus.routes} routes wired`
    : 'Vite-only preview for route verification'

  async function handleStartDesktopAuth() {
    try {
      setAuthBusy(true)
      setAuthError(null)
      setAuthNotice(null)

      const pendingSession = await startDesktopDeviceAuthorization({
        openBrowser: openExternalUrl,
        startSession: startDesktopDeviceSessionTransport,
        webBaseUrl: getDesktopWebBaseUrl(),
      })

      setAuthPendingSession(pendingSession)
      setAuthNotice(`Browser handoff opened for ${pendingSession.userCode}.`)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Failed to start desktop auth flow')
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleReopenConfirmation() {
    if (!authPendingSession) {
      return
    }

    try {
      setAuthBusy(true)
      setAuthError(null)
      await openExternalUrl(authPendingSession.confirmationUrl)
      setAuthNotice(`Re-opened browser confirmation for ${authPendingSession.userCode}.`)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Failed to re-open browser confirmation')
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleClearDesktopAuth() {
    try {
      setAuthBusy(true)
      setAuthError(null)
      await clearPersistedAuthSession()
      setAuthPendingSession(null)
      setAuthSession(null)
      setAuthNotice('Cleared the local desktop auth session.')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Failed to clear desktop auth session')
    } finally {
      setAuthBusy(false)
    }
  }

  const personaInstalledRecord = personaManifest ? installedPersonasById.get(personaManifest.id) ?? null : null
  const catalogStatusLabel = catalogSource === 'cache' ? 'Offline cache' : 'Live catalog'
  const catalogStatusDetail = catalogSyncedAt
    ? `${catalogStatusLabel} • ${formatDesktopTimestamp(catalogSyncedAt)}`
    : `${catalogStatusLabel} • waiting for first sync`
  const catalogResultCountLabel = isSearchRoute
    ? `${visibleCatalogItems.length} matching personas`
    : `${catalogItems.length} public personas`

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
          {isAuthRoute ? (
            <>
              <article className="desktop-card">
                <header>
                  <span>Device Sign-In</span>
                  <strong>Start browser sign-in</strong>
                </header>
                <p className="desktop-card__body">
                  Launch the existing web confirmation page, wait for the `soulidity://auth/device`
                  callback, then keep the confirmed desktop account session on local storage for the
                  next restart.
                </p>

                <div className="desktop-auth-actions">
                  <button
                    className="desktop-button desktop-button--primary"
                    disabled={authBusy}
                    onClick={() => {
                      void handleStartDesktopAuth()
                    }}
                    type="button"
                  >
                    {authBusy ? 'Working...' : 'Start browser sign-in'}
                  </button>

                  <button
                    className="desktop-button"
                    disabled={!authPendingSession || authBusy}
                    onClick={() => {
                      void handleReopenConfirmation()
                    }}
                    type="button"
                  >
                    Re-open confirmation
                  </button>

                  <button
                    className="desktop-button"
                    disabled={(!authSession && !authPendingSession) || authBusy}
                    onClick={() => {
                      void handleClearDesktopAuth()
                    }}
                    type="button"
                  >
                    Clear local session
                  </button>
                </div>

                {authPendingSession ? (
                  <div className="desktop-auth-status">
                    <span>Pending Browser Session</span>
                    <strong>{authPendingSession.userCode}</strong>
                    <p>
                      Waiting for browser confirmation until {authPendingSession.expiresAt}.
                    </p>
                  </div>
                ) : null}

                {authNotice ? (
                  <p className="desktop-feedback desktop-feedback--notice">{authNotice}</p>
                ) : null}

                {authError ? (
                  <p className="desktop-feedback desktop-feedback--error">{authError}</p>
                ) : null}
              </article>

              <article className="desktop-card">
                <header>
                  <span>Local Session</span>
                  <strong>What the desktop will restore</strong>
                </header>

                {authSession ? (
                  <dl className="desktop-session-grid">
                    <div>
                      <dt>Account</dt>
                      <dd>{authSession.accountId}</dd>
                    </div>
                    <div>
                      <dt>Device code</dt>
                      <dd>{authSession.deviceCode}</dd>
                    </div>
                    <div>
                      <dt>User code</dt>
                      <dd>{authSession.userCode ?? 'Not retained'}</dd>
                    </div>
                    <div>
                      <dt>Confirmed at</dt>
                      <dd>{authSession.confirmedAt}</dd>
                    </div>
                    <div>
                      <dt>Expires at</dt>
                      <dd>{authSession.expiresAt ?? 'No expiry provided'}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="desktop-card__body">
                    No confirmed desktop account session is stored locally yet. Once the deep link
                    returns, this panel becomes the restart-safe source of truth.
                  </p>
                )}
              </article>
            </>
          ) : isCatalogRoute ? (
            <>
              <article className="desktop-card desktop-card--catalog">
                <header>
                  <span>{isSearchRoute ? 'Search Catalog' : isPersonaRoute ? 'Persona Surface' : 'Explore Catalog'}</span>
                  <strong>
                    {isSearchRoute
                      ? 'Starter + curated soul search'
                      : isPersonaRoute
                        ? 'Shared desktop manifest detail'
                        : 'Public desktop catalog'}
                  </strong>
                </header>

                <div className="desktop-toolbar">
                  {isSearchRoute ? (
                    <label className="desktop-search-field">
                      <span>Query</span>
                      <input
                        onChange={(event) => {
                          setSearchQuery(event.target.value)
                        }}
                        placeholder="Search starter, curated, or title..."
                        type="search"
                        value={searchQuery}
                      />
                    </label>
                  ) : (
                    <p className="desktop-card__body">
                      {isPersonaRoute
                        ? 'Detail stays on the same manifest contract as the explore and search lists.'
                        : 'Anonymous browsing now hydrates from `/api/desktop/catalog*` and keeps the latest successful sync for offline fallback.'}
                    </p>
                  )}

                  <button
                    className="desktop-button desktop-button--primary"
                    disabled={catalogBusy}
                    onClick={() => {
                      void handleRefreshCatalog('manual')
                    }}
                    type="button"
                  >
                    {catalogBusy ? 'Refreshing...' : 'Refresh catalog'}
                  </button>
                </div>

                {!isPersonaRoute && catalogNotice ? (
                  <p className="desktop-feedback desktop-feedback--notice">{catalogNotice}</p>
                ) : null}

                {!isPersonaRoute && catalogError ? (
                  <p className="desktop-feedback desktop-feedback--error">{catalogError}</p>
                ) : null}

                {isPersonaRoute ? (
                  personaBusy ? (
                    <p className="desktop-card__body">
                      Loading persona detail from the shared desktop manifest API...
                    </p>
                  ) : personaManifest ? (
                    <div className="desktop-persona-layout">
                      <div
                        aria-label={`${personaManifest.title} artwork`}
                        className="desktop-persona-art"
                        style={{ backgroundImage: `url(${personaManifest.coverImage})` }}
                      />
                      <div className="desktop-persona-copy">
                        <div className="desktop-catalog-card__meta">
                          <span className={`desktop-catalog-pill desktop-catalog-pill--${personaManifest.sourceType}`}>
                            {personaManifest.sourceType === 'starter' ? 'Starter' : 'Curated Soul'}
                          </span>
                          <span>{personaManifest.version}</span>
                        </div>
                        <h3>{personaManifest.title}</h3>
                        <p className="desktop-card__body">
                          {personaManifest.description ?? 'No manifest description is available for this persona yet.'}
                        </p>
                        <dl className="desktop-persona-stats">
                          <div>
                            <dt>Catalog id</dt>
                            <dd>{personaManifest.id}</dd>
                          </div>
                          <div>
                            <dt>Updated</dt>
                            <dd>{formatDesktopTimestamp(personaManifest.updatedAt)}</dd>
                          </div>
                          <div>
                            <dt>Source ref</dt>
                            <dd>{personaManifest.sourceRef}</dd>
                          </div>
                          <div>
                            <dt>Files</dt>
                            <dd>{personaManifest.files.length}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  ) : (
                    <p className="desktop-card__body">
                      No cached or live manifest was found for this persona route yet.
                    </p>
                  )
                ) : visibleCatalogItems.length > 0 ? (
                  <div className="desktop-catalog-grid">
                    {visibleCatalogItems.map((item) => {
                      const installedRecord = installedPersonasById.get(item.id)
                      const isInstallBusy = installBusyId === item.id

                      return (
                        <article
                          className="desktop-catalog-card"
                          key={item.id}
                        >
                          <a
                            aria-label={`Open ${item.title}`}
                            className="desktop-catalog-card__media"
                            href={toDesktopHref(`/persona/${item.id}`)}
                            style={{ backgroundImage: `url(${item.thumbnail})` }}
                          />
                          <div className="desktop-catalog-card__body">
                            <div className="desktop-catalog-card__meta">
                              <span className={`desktop-catalog-pill desktop-catalog-pill--${item.sourceType}`}>
                                {item.sourceType === 'starter' ? 'Starter' : 'Curated Soul'}
                              </span>
                              <span>{formatDesktopTimestamp(item.updatedAt)}</span>
                            </div>
                            <h3>{item.title}</h3>
                            <p className="desktop-card__body">
                              {item.description ?? 'Preview this persona from the shared desktop catalog.'}
                            </p>
                            <div className="desktop-catalog-card__actions">
                              <a
                                className="desktop-button"
                                href={toDesktopHref(`/persona/${item.id}`)}
                              >
                                View detail
                              </a>
                              {item.sourceType === 'starter' ? (
                                <button
                                  className="desktop-button desktop-button--primary"
                                  disabled={Boolean(installedRecord) || isInstallBusy}
                                  onClick={() => {
                                    void handleInstallFromCatalogItem(item)
                                  }}
                                  type="button"
                                >
                                  {installedRecord ? 'Installed' : isInstallBusy ? 'Installing...' : 'Install starter'}
                                </button>
                              ) : (
                                <button
                                  className="desktop-button"
                                  disabled
                                  type="button"
                                >
                                  Curated soul preview
                                </button>
                              )}
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <div className="desktop-empty-state">
                    <strong>No personas match this view yet.</strong>
                    <p>
                      {isSearchRoute
                        ? 'Try a broader search term or refresh the catalog.'
                        : 'Refresh the catalog to pull the latest starter and curated soul entries.'}
                    </p>
                  </div>
                )}

                {personaNotice ? (
                  <p className="desktop-feedback desktop-feedback--notice">{personaNotice}</p>
                ) : null}

                {personaError ? (
                  <p className="desktop-feedback desktop-feedback--error">{personaError}</p>
                ) : null}
              </article>

              <article className="desktop-card">
                <header>
                  <span>{isPersonaRoute ? 'Install Status' : 'Catalog Status'}</span>
                  <strong>
                    {isPersonaRoute
                      ? 'Starter download and manifest metadata'
                      : 'Live sync, offline fallback, and local install results'}
                  </strong>
                </header>

                {isPersonaRoute && personaManifest ? (
                  <>
                    <p className="desktop-card__body">
                      {personaManifest.sourceType === 'starter'
                        ? 'Starter personas can be installed anonymously from the detail view or directly from catalog cards.'
                        : 'Curated souls stay browse-only for anonymous users in phase one.'}
                    </p>
                    <div className="desktop-auth-actions">
                      <button
                        className="desktop-button desktop-button--primary"
                        disabled={
                          personaManifest.sourceType !== 'starter'
                          || Boolean(personaInstalledRecord)
                          || installBusyId === personaManifest.id
                        }
                        onClick={() => {
                          void handleInstallStarterPersona(personaManifest)
                        }}
                        type="button"
                      >
                        {personaInstalledRecord
                          ? 'Starter installed'
                          : installBusyId === personaManifest.id
                            ? 'Installing...'
                            : personaManifest.sourceType === 'starter'
                              ? 'Install starter'
                              : 'Curated soul preview'}
                      </button>
                      <button
                        className="desktop-button"
                        disabled={catalogBusy}
                        onClick={() => {
                          void handleRefreshCatalog('manual')
                        }}
                        type="button"
                      >
                        {catalogBusy ? 'Refreshing...' : 'Refresh catalog'}
                      </button>
                    </div>

                    <dl className="desktop-session-grid">
                      <div>
                        <dt>Checksum</dt>
                        <dd>{personaManifest.checksum}</dd>
                      </div>
                      <div>
                        <dt>Files</dt>
                        <dd>{personaManifest.files.map((file) => file.path).join(', ')}</dd>
                      </div>
                      <div>
                        <dt>Installed</dt>
                        <dd>{personaInstalledRecord ? formatDesktopTimestamp(personaInstalledRecord.installedAt) : 'Not yet'}</dd>
                      </div>
                      <div>
                        <dt>Bundle path</dt>
                        <dd>{personaInstalledRecord?.bundlePath ?? 'Created after install'}</dd>
                      </div>
                    </dl>

                    {installNotice ? (
                      <p className="desktop-feedback desktop-feedback--notice">{installNotice}</p>
                    ) : null}

                    {installError ? (
                      <p className="desktop-feedback desktop-feedback--error">{installError}</p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <dl className="desktop-session-grid">
                      <div>
                        <dt>Catalog</dt>
                        <dd>{catalogStatusDetail}</dd>
                      </div>
                      <div>
                        <dt>Results</dt>
                        <dd>{catalogResultCountLabel}</dd>
                      </div>
                      <div>
                        <dt>Installed starters</dt>
                        <dd>{installedPersonas.length}</dd>
                      </div>
                      <div>
                        <dt>Offline ready</dt>
                        <dd>{catalogSource === 'cache' ? 'Using cache now' : 'Cache warmed on each successful refresh'}</dd>
                      </div>
                    </dl>

                    {installNotice ? (
                      <p className="desktop-feedback desktop-feedback--notice">{installNotice}</p>
                    ) : null}

                    {installError ? (
                      <p className="desktop-feedback desktop-feedback--error">{installError}</p>
                    ) : null}

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
                  </>
                )}
              </article>
            </>
          ) : (
            <>
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
            </>
          )}
        </section>
      </main>
    </div>
  )
}
