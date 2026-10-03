# Static browser routing increment

Scope: NO_BACKEND_SPEC / NO_BACKEND_PLAN step 3. This is the route composition
layer, not a deployed no-backend product. The approved follow-on converts only
the `/download`, `/desktop/link`, and `/integrations/animacraft` server entrances
to client behavior. No package scripts, provider authority, APIs, wallet policies
or live configuration are changed.

## Composition and acceptance

`index.html → main.tsx → NavigationProvider → original AppProviders/AppShell →
original nested layouts → original page`.

- Enumerate route modules, never object IDs. All existing `app/**/page.tsx`
  paths must map once. Static siblings beat dynamic segments; malformed URLs
  and unmatched paths use the existing NotFound component.
- History push/replace, native history changes, popstate, query/hash and cold
  path matching must work. Preserve wizard providers across sibling pages;
  remount ID-specific pages when their path changes. Scroll only after lazy
  content commits; respect `scroll: false`. Browser back/forward retain native
  history behavior. Error-page reset performs a real reload, which can recover
  a failed chunk import rather than reusing React's rejected lazy cache.
- Next navigation imports resolve only to documented browser navigation
  semantics. Links retain native external/download/modifier behavior. Images
  use their original URL, never an owned image-optimizer service.
- Root HTML/theme/CSS and original providers/shell are composed once. Four
  metadata-only DB layouts keep their original default renderer; a changed
  renderer fails the metadata split rather than losing a provider.
- Async server pages, server-only imports and private environment reads block
  the static build. No Prisma stub, fake API, empty replacement page, credential
  injection or swallowed server dependency is permitted.

## Build and remaining boundary

From repository root, use the existing local Vite dependency:

```sh
node node_modules/vite/bin/vite.js --config web/vite.config.ts
node node_modules/vite/bin/vite.js build --config web/vite.config.ts --outDir /tmp/soulidity-spa-review
```

The three formerly async entrances now have explicit client implementations:
desktop pairing preserves the first `link` field and uses history replacement;
Animacraft passes the same five handoff fields to its original client and rejects
duplicates; Download retains the original UI and metadata with public artifact
discovery, cancellation, timeout, visible failure and retry. The configured
fallback is labeled as such, never as a newly verified/latest release.

Public manifest discovery requires `NEXT_PUBLIC_DESKTOP_MANIFEST_URL` at static
build time and browser-compatible CORS. The existing explicit public
`NEXT_PUBLIC_DESKTOP_MAC_ARM64_URL` / `NEXT_PUBLIC_DESKTOP_VERSION` fallback is
retained. The old private `DESKTOP_MANIFEST_URL` is not exposed or read; parent
cutover owns cleanup of its old `.env.example` / release-script references.

Other original page hooks still need the parent no-backend data
cutover; successful routing is not proof those APIs have been replaced.
In particular, account/pets still calls `/api/account/pets`, its pairing dialog
still calls `/api/desktop/device/complete`, and the original Animacraft receiver
still uses authenticated receive requests. None is removed or faked here.
The completed static host must rewrite document navigations to index.html,
including arbitrary future IDs. Vite dev/preview supplies this history fallback;
no production rewrite/deployment is changed by this increment.

## Verification

```sh
node node_modules/vitest/vitest.mjs run tests/new-web/spa-routing.test.tsx tests/new-web/spa-host-fallback.test.ts tests/new-web/spa-client-entries.test.tsx tests/new-web/animacraft-completion-callback.test.ts tests/new-web/animacraft-integration-i18n.test.ts tests/new-web/animacraft-native-client-abort.test.ts
web/node_modules/.bin/tsc --ignoreConfig --noEmit --target es2022 --module esnext --moduleResolution bundler --jsx react-jsx --esModuleInterop --skipLibCheck --types node web/spa/routes.ts web/spa/history.ts web/spa/navigation.tsx web/spa/link.tsx web/spa/image.tsx web/spa/router.tsx web/spa/build-boundary.ts web/vite.config.ts
```

Current increment: 57 tests pass and the isolated routing source type check passes.
Tests mount real router components in a DOM, enumerate all 70 original pages,
and start the actual Vite configuration on an ephemeral HTTP port to verify
deep-link document fallback and original entry transformation. These are not
full-product browser/E2E tests: the original wallet/data flows and production
host rewrite remain outside this routing increment's verification.

The full Vite build passes after the three explicit client conversions, with
the server-only guard retained and all original page modules included. The
remaining use-client directive/sourcemap and large-chunk warnings are build
warnings, not proof that runtime business API dependencies have been removed.

Rollback: remove this SPA-only entry/config and its tests, and reverse only the
three approved page conversions and their new adjacent helpers. The existing
Next root entry and deployment remain untouched during this bounded increment.
