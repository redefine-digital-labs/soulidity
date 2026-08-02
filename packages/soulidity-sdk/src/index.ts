/**
 * @soulidity/sdk — client-safe Soulidity protocol surface.
 *
 * Single source of truth for kind/op/read-mode constants, content document IDs,
 * deployment manifest, transaction builders, on-chain queries, event extractors,
 * and shared type definitions. Consumed by both the Next.js web app and the
 * Electron desktop app.
 *
 * Server-only logic (Prisma mirrors, auth, Seal key servers, access resolution)
 * lives in `web/lib/soulidity/{access,server,agent-server,repository,mirror}`
 * — those files import from this SDK but are NOT re-exported here.
 */

// ── Protocol constants ───────────────────────────────────────────────────
export * from './kinds'
export * from './grant-scopes'

// ── Type surface ─────────────────────────────────────────────────────────
export * from './types'

// ── Document IDs / Seal envelope ─────────────────────────────────────────
export * from './content-document-id'

// ── Deployment / env / kiosk resolution ──────────────────────────────────
export * from './deployment'
export * from './env'
export * from './kiosk'
export * from './personal-kiosk'

// ── Sui + Walrus runtime helpers ─────────────────────────────────────────
export * from './sui-client'
export * from './sui-grpc-compat'
export * from './sui-network'
export * from './tx-result'
export * from './walrus'
export * from './walrus-blob'
export * from './walrus-quote'

// ── On-chain queries + event extractors ──────────────────────────────────
export * from './queries'
export * from './events'

// ── Marketplace + listing helpers ────────────────────────────────────────
export * from './listing-price'
export * from './market-config-cache'
export * from './market-errors'

// ── Content / persona / metadata ─────────────────────────────────────────
export * from './content-schema'
export * from './content-templates'
export * from './content-version-pagination'
export * from './metadata'
export * from './persona'
export * from './persona-sprite'

// ── Misc utilities ───────────────────────────────────────────────────────
export * from './client-session'
export * from './animacraft-recipe'
export * from './coin-selection'
export * from './collection-bind-preflight'
export * from './format'
export * from './legacy-mint-bridge'
export * from './object-inputs'
export * from './projection-scalars'
export * from './request'
export * from './serialization'
export * from './tags'
export * from './upload-validation'

// ── Transaction builders (PTB factories) ─────────────────────────────────
export * from './tx/buy'
export * from './tx/animacraft'
export * from './tx/collection'
export * from './tx/content'
export * from './tx/delist'
export * from './tx/grant'
export * from './tx/import'
export * from './tx/kiosk-management'
export * from './tx/list'
export * from './tx/mint-helpers'
export * from './tx/paid-access'
export * from './tx/personal-join'
export * from './tx/publish'
export * from './tx/shared'
export * from './tx/update-collection-price'
export * from './tx/update-price'
