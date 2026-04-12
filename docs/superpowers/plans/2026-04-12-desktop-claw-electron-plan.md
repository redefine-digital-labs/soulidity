# Desktop Companion — Desktop-Claw Electron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-switch the desktop companion route to Electron by forking Desktop-Claw, delivering a Phase 1 companion shell first and staging Soul marketplace integration as Phase 2.

**Architecture:** `desktop/` becomes a Desktop-Claw-based pnpm workspace with `apps/desktop + packages/backend + packages/shared`. Phase 1 only ships the local companion shell: file-based CLI status protocol, transparent overlay sprite rendering, agent wallet, settings wiring, and Soulidity branding. Phase 2 layers Soul marketplace download, `metadata_ref` parsing, `SoulAssets` / `ContentAccessList`, and account binding onto that shell.

**Tech Stack:** Electron, React, electron-vite, pnpm workspace, Node `fs.watch`, Canvas API, `@mysten/sui`, `keytar`

**Spec:** `docs/superpowers/specs/2026-04-10-desktop-companion-design.md`

**Supersedes:** `docs/plans/2026-04-09-soulidity-tauri-desktop-integration-plan.md`, `docs/superpowers/plans/2026-04-10-desktop-companion-plan.md`, `docs/superpowers/plans/2026-04-12-desktop-companion-phase2-plan.md`, `docs/superpowers/specs/admin-ralph-soulidity-tauri-desktop-integration-design-20260410-212706.md`

---

## Phase Split

### Phase 1 — Companion Shell

- Fork Desktop-Claw into `desktop/` and keep its Electron workspace layout.
- Add `~/.soulidity/agent-status.json` watcher plus Claude Code / Codex hook adapters.
- Replace the default floating CSS ball with sprite-sheet rendering.
- Keep Desktop-Claw's existing 4-state internal emotion system, but drive it from a new 6-state CLI protocol.
- Generate one agent Ed25519 keypair per device and expose the Sui address in settings.
- Rename the app, icons, protocol, and default persona to Soulidity.

### Phase 2 — Soul Integration

- Parse `metadata_ref` persona metadata from Soul records.
- Download sprite assets from public blobs or protected Soul asset access APIs.
- Bind the desktop agent address to the signed-in web account.
- Gate protected downloads through `SoulAssets` / `ContentAccessList`.

Phase 1 is the active build target. Phase 2 stays in this plan only to define the next integration boundary and prevent reintroducing deleted Tauri docs.

## Locked Decisions

- [ ] **Step 1: Lock the desktop base**

Use Desktop-Claw as the only desktop base. Do not continue any Tauri implementation branch in parallel. If `desktop/` contains stale local artifacts from prior Tauri experiments, replace them during the Desktop-Claw fork instead of adapting them.

- [ ] **Step 2: Lock the status model**

Create `packages/shared/src/types/cli-status.ts` with the canonical protocol:

```ts
export type CliAgentStatus =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'needs-attention'
  | 'completed'
  | 'error'
```

Keep Desktop-Claw's existing internal emotion enum unchanged for Phase 1. The mapping is fixed:

```ts
idle -> idle
thinking -> busy
working -> busy
completed -> done
needs-attention -> night
error -> night
```

The overlay sprite renderer may consume raw `CliAgentStatus` directly. Backend memory/emotion services stay on the 4-state model in Phase 1.

- [ ] **Step 3: Lock watcher behavior**

Implement `apps/desktop/src/main/status-watcher.ts` in the Electron main process with these rules:

- watch `~/.soulidity/`
- create the directory if missing
- read `agent-status.json` once on startup
- debounce file events before parse
- ignore malformed intermediate writes
- aggregate by most recent non-ended session
- broadcast `agent-status-changed` to every window that needs it, not just the floating window

- [ ] **Step 4: Lock wallet behavior**

Implement `apps/desktop/src/main/agent-wallet.ts` in the Electron main process with these rules:

- dependency placement is fixed: add `@mysten/sui` and `keytar` in `apps/desktop/package.json`
- generate the keypair with the Sui SDK, not manual hashing helpers
- derive the address with `keypair.toSuiAddress()` / `publicKey.toSuiAddress()` semantics
- do not describe or implement `SHA-256(0x00 || publicKey)`; Sui address derivation follows SDK `blake2b(scheme_flag || public_key)` behavior
- store only public metadata in app data
- store the private key in OS keychain via `keytar`

Public metadata file:

```json
{
  "address": "0x...",
  "publicKey": "hex...",
  "createdAt": 1710000000000
}
```

- [ ] **Step 5: Lock package scope**

Put all desktop-only dependencies in `apps/desktop/package.json`. Do not put wallet or watcher dependencies in `packages/backend` for Phase 1.

## Phase 1 Implementation

### Task 1: Fork and rebrand Desktop-Claw

**Files:**
- Replace: `desktop/**` with Desktop-Claw workspace
- Modify: `desktop/package.json`
- Modify: `desktop/apps/desktop/package.json`
- Modify: `desktop/apps/desktop/electron.vite.config.ts`
- Modify: `desktop/apps/desktop/resources/**`

- [ ] **Step 1: Fork Desktop-Claw into `desktop/`**

`desktop/` becomes the Desktop-Claw monorepo root. Existing Tauri-shaped leftovers in that path are not reused.

- [ ] **Step 2: Apply Soulidity branding**

Rename package metadata, `productName`, app ID, icons, deep-link protocol, data-directory labels, and bundled persona copy to Soulidity.

- [ ] **Step 3: Verify the workspace starts**

Run the Desktop-Claw workspace install/dev flow and confirm the overlay and settings windows boot.

### Task 2: Add the shared CLI status protocol

**Files:**
- Create: `desktop/packages/shared/src/types/cli-status.ts`
- Modify: `desktop/packages/shared/src/types/emotion.ts`
- Modify: `desktop/apps/desktop/src/preload/index.ts`

- [ ] **Step 1: Add `CliAgentStatus`, `AgentSession`, and `AgentStatusFile`**

Match the protocol defined in the canonical spec.

- [ ] **Step 2: Expose preload subscription**

Add `onAgentStatusChanged` and one-shot `getCurrentAgentStatus` preload APIs so renderer windows can subscribe without accessing Node APIs directly.

### Task 3: Implement Electron main-process status watching

**Files:**
- Create: `desktop/apps/desktop/src/main/status-watcher.ts`
- Modify: `desktop/apps/desktop/src/main/index.ts`

- [ ] **Step 1: Implement startup read + watch loop**

Use `fs.watch` over `~/.soulidity/`, read the current file at boot, debounce updates, and recover cleanly from partial writes.

- [ ] **Step 2: Register lifecycle in `main/index.ts`**

Start the watcher during app boot and close it on quit.

- [ ] **Step 3: Broadcast to all interested windows**

The floating companion window and any panel/settings surface that needs current status must receive the same event.

### Task 4: Add hook adapters

**Files:**
- Create: `desktop/apps/desktop/resources/hooks/soulidity-claude-hook.js`
- Create: `desktop/apps/desktop/resources/hooks/soulidity-codex-hook.js`

- [ ] **Step 1: Claude Code adapter**

Read hook JSON from stdin, update both aggregate and per-session files under `~/.soulidity/`, detect attention tools, and atomically write changes.

- [ ] **Step 2: Codex adapter**

Read notify payload from argv/stdin contract chosen by the implementation, map `agent-turn-complete` to `completed`, preserve optional forwarding to an existing user notify command.

### Task 5: Replace the floating ball with sprite rendering

**Files:**
- Create: `desktop/apps/desktop/src/renderer/components/FloatingBall/SpriteRenderer.tsx`
- Modify: `desktop/apps/desktop/src/renderer/components/FloatingBall/index.tsx`
- Create: `desktop/apps/desktop/src/renderer/hooks/useCliStatus.ts`
- Modify: `desktop/apps/desktop/src/renderer/hooks/useClawEmotion.ts`
- Create: `desktop/apps/desktop/resources/default-persona/sprite-config.json`
- Create: `desktop/apps/desktop/resources/default-persona/sheet.png`

- [ ] **Step 1: Implement raw CLI status subscription**

`useCliStatus()` listens to preload events and returns the latest `CliAgentStatus`.

- [ ] **Step 2: Implement sprite playback**

Render sprite-sheet animations with Canvas and `requestAnimationFrame`.

- [ ] **Step 3: Bridge 6-state CLI status into 4-state emotion**

Use the locked mapping above. Do not expand backend emotion state in Phase 1.

- [ ] **Step 4: Bundle a default persona**

Ship a placeholder Soulidity sprite-sheet asset set with at least the 6 named states.

### Task 6: Add the agent wallet

**Files:**
- Create: `desktop/apps/desktop/src/main/agent-wallet.ts`
- Modify: `desktop/apps/desktop/src/main/index.ts`
- Modify: `desktop/apps/desktop/src/preload/index.ts`
- Create: `desktop/apps/desktop/src/renderer/components/AgentWallet/index.tsx`
- Modify: `desktop/apps/desktop/src/renderer/components/SettingsPanel/index.tsx`

- [ ] **Step 1: Generate or load one device wallet**

On first use, create the keypair, persist only public metadata to app data, and save the private key in OS keychain via `keytar`.

- [ ] **Step 2: Expose wallet IPC**

Add `generateAgentKeypair`, `loadAgentKeypair`, and `copyAgentAddress`-grade APIs as needed by the settings UI.

- [ ] **Step 3: Show wallet information in settings**

Display the address, public key, and the “generated locally on first launch” explanation.

## Phase 2 Integration Boundary

Phase 2 builds on the Electron shell above. It adds, without revisiting the desktop runtime choice:

- `metadata_ref` parsing and persona config loading
- marketplace/library download surfaces
- account binding endpoint for the desktop agent address
- protected asset access through `SoulAssets` / `ContentAccessList`

No new Tauri-specific execution plan should be created for those items.

## Verification

- [ ] `rg -n "Tauri|desktop-companion-phase1|soulidity-tauri-desktop-integration" docs`
Expected: only historical mentions intentionally retained in this plan/spec, not active execution docs.

- [ ] Review `docs/superpowers/specs/2026-04-10-desktop-companion-design.md`
Expected: Electron/Desktop-Claw is the canonical desktop runtime, Phase 1/Phase 2 boundaries are explicit, wallet storage no longer claims plaintext JSON private keys.

- [ ] Review this plan
Expected: no unresolved “或 / 如需要 / 保持映射 / choose one” style decisions remain.
