# Soulidity Phase Handoff: animacraft-expansion-pack-v8-production-wallet-acceptance

## Snapshot

- Created: 2026-08-12T20:40:02+08:00
- Phase: animacraft-expansion-pack-v8-production-wallet-acceptance
- Status: paused
- Goal: Finish real-browser wallet claim, Pass readback, v8 Style render/export, and immutable acceptance evidence for the already-live FREE Expansion Pack v8 pilot
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity/tmp/animacraft-drop-legacy`
- Branch: `codex/expansion-pack-v8-wallet-activation`
- Commit: local acceptance-evidence HEAD `9da8afb66546e8c8268f9d18399600570aa7da44`; promoted Web bundle source `99da8d3468998f4105aa1950b97746c6875785f7`
- Working tree: clean except intentionally preserved untracked `scripts/expansion-pack-v8-parent-migration.mjs`; parent Soulidity tree remains independently dirty and must not be cleaned
- Handoff: `docs/codex/handoffs/20260812-204002-animacraft-expansion-pack-v8-production-wallet-acceptance.md`

## Outcome

Expansion Pack v8 is fully published on Sui Mainnet and Walrus, the v8-only production gate is live at animacraft.soulidity.ai, production smoke and strict Mainnet readback pass, and post-claim evidence validation is implemented; only the real controlled-browser wallet claim/render acceptance remains.

## Scope and non-goals

### In scope

- Sui Mainnet v7 corrective callable, finalized PAUSED parent Root/Authority, FREE v8 Release/AdminCap/Treasury lifecycle
- Walrus nondeletable certified Quilt, manifest, PNG patch and byte/hash readback
- v8-only runtime gate, Vercel Preview/candidate/promotion, production smoke and rollback
- Browser wallet claim, Pass ownership, Pack enablement, Style render/export and screenshots

### Intentionally not done

- Do not enable canonical Soul, Commerce v5 product actions, Composition v6, Physical v7, Complete bridge, physical bridge, or paid/Seal Pack behavior

## Durable decisions

- Only expansionPackV8ReleaseEnabled is true; all unrelated product and bridge gates remain false
- Production deployment dpl_GDrUED8AwUfFsRRsSJ9Wzdi6zfW3 is promoted; rollback target is dpl_7NwkGiWLh75AbZoaWH2FvjRqbqTY
- Do not replace the requested website wallet claim with CLI signing or inject a private key into the browser

## Changed paths and assets

### Changed paths

- tmp/animacraft-drop-legacy
- docs/codex/assets/animacraft-expansion-pack-v8-wallet-test-activation

### Image and binary assets

- docs/codex/assets/animacraft-expansion-pack-v8-wallet-test-activation/pack-ceremony-receipt.json
- docs/codex/assets/animacraft-expansion-pack-v8-wallet-test-activation/pack-mainnet-readback.json
- docs/codex/assets/animacraft-expansion-pack-v8-wallet-test-activation/web-production-deploy-lock.json
- docs/codex/assets/animacraft-expansion-pack-v8-wallet-test-activation/browser-wallet-provider-observation.json

### Relevant commits

- 99da8d3468998f4105aa1950b97746c6875785f7
- 0e5c2ea
- 9da8afb66546e8c8268f9d18399600570aa7da44

## Verification

- npm run check: PASS (1078 passed, 1 skipped, Vite build PASS)
- npm run move:test: PASS (Animacraft 122/122, Physical v7 42/42)
- npm run preflight:v8-mainnet -- --json: PASS with live Release/Authority/Walrus readback
- node scripts/production-smoke.mjs --url=https://animacraft.soulidity.ai --json: PASS
- node --test test/mainnet-preflight-v8.test.js: PASS 28/28

## Risks and recovery

### Risks or blockers

- Current controllable browser set contains only Codex In-app Browser; it loaded production but chain-derived deep-link controls timed out. Running Chrome has no ChatGPT browser-control extension, so no Wallet Standard provider can be safely controlled for the required website claim.
- The live FREE claim is irreversible and creates a permanent wallet-bound Pass; no claim transaction has yet been signed or broadcast.

### Recovery or rollback points

- Production rollback: vercel rollback dpl_7NwkGiWLh75AbZoaWH2FvjRqbqTY --scope soulidity-ai --yes
- Resume browser at https://animacraft.soulidity.ai/maker/0x1329648b7ead8bc16dc7e209416922b2af25c68884def660534d6be541379390#template and use Release 0x8c2af3a0c7eb4bfe88bf5ed9e7b56cb407edae12f672a3331a09e41d046e071b

### Nested working-tree evidence

```text
?? scripts/expansion-pack-v8-parent-migration.mjs
```

The parent Soulidity repository still contains unrelated tracked and untracked work. It was not cleaned or folded into the Animacraft commits.

## Exact next action

Install or enable the ChatGPT browser-control extension in a Chrome/Edge profile that also has an unlocked Sui/Slush Wallet on Mainnet, then resume at the recorded Maker URL, approve the FREE Unlock Pack transaction, verify the created Pass and Quiet Orbit render/export, fill postClaim evidence, and run the strict post-claim preflight.
