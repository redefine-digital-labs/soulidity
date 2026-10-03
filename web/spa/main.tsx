import '../instrumentation-client'
import { createRoot } from 'react-dom/client'
import { AppProviders } from '../components/providers/app-providers'
import { AppShell } from '../components/layout/app-shell'
import Loading from '../app/loading'
import NotFound from '../app/not-found'
import AppError from '../app/error'
import '../app/globals.css'
import { createHistoryRouter } from './history'
import { createSpaRouteRegistry, SpaRouter, type RouteLoaders } from './router'

const registry = createSpaRouteRegistry(
  import.meta.glob('../app/**/page.tsx') as RouteLoaders,
  import.meta.glob(['../app/**/layout.tsx', '!../app/layout.tsx']) as RouteLoaders,
)
const target = document.getElementById('root')
if (!target) throw new Error('SPA root element is missing')
const history = createHistoryRouter(window)
const appRoot = createRoot(target)
appRoot.render(
  <SpaRouter history={history} registry={registry} loading={<Loading />} notFound={<NotFound />}
    renderError={(error, reset) => <AppError error={error} reset={reset} />}>
    {content => <AppProviders><AppShell>{content}</AppShell></AppProviders>}
  </SpaRouter>,
)
if (import.meta.hot) import.meta.hot.dispose(() => { appRoot.unmount(); history.dispose() })
