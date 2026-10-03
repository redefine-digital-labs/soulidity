# Original Animacraft drawing core

This package contains a byte-for-byte generated snapshot of Animacraft's
`maker-v8-render-core.js`, the shared original Player/Draft renderer. The sole
authoring source is the Animacraft implementation identified by
`docs/plans/2026-09-05-composable-soul-integration.md`. `source.json` pins its exact
bytes; this package is not a separately maintained drawing implementation.

The package exports the original module directly, including
`renderResolvedMakerV8RecipePngV8`, `mapMakerV8SmartColorPixelsV8`,
`colorizeMakerV8ImageSourceV8`, and `MakerV8PlayerJourneyError`. The declaration
file describes these APIs and contains no runtime behavior. Imports use only
`@noble/hashes/sha2.js` and `@mysten/sui/utils`; no local authoring path, Player
controller, wallet, RPC, or server module enters the browser dependency graph.

Callers provide the exact canvas, original slot indices, selection identities,
author transforms/order/blend/opacity, individual slot swatches, verified asset
evidence and byte/decryption adapters. The renderer neither discovers authority
nor grants decryption permission. Empty slots are omitted without renumbering
their surviving `selectionIndex` values. No channel-wide color substitution or
asset composition policy is supplied by this package.

## Verify and update

From the Soulidity repository root, CI/deployment verifies the committed artifact
without accessing an authoring checkout:

```sh
node scripts/verify-animacraft-render-core.mjs
```

Before accepting a source update, edit and validate the original Animacraft
module and run its Player/Draft renderer regressions. Then explicitly compare it:

```sh
node scripts/verify-animacraft-render-core.mjs --source-file /path/to/animacraft/maker-v8-render-core.js
```

For an intentional difference, generate the exact module + metadata patch and
apply it using `apply_patch`; this command does not edit files itself:

```sh
node scripts/verify-animacraft-render-core.mjs --source-file /path/to/animacraft/maker-v8-render-core.js --print-update-patch
```

Pass that output unchanged to the `apply_patch` tool (or pipe it to the
`apply_patch` command). Then rerun the explicit source comparison and
`npx vitest run tests/new-web/animacraft-render-core-package.test.ts`. Review and
update `index.d.ts` only if the original API changed. Never patch drawing logic
inside this generated package; fix the original source and regenerate both
artifact and pin together. The verifier never rewrites or auto-accepts a pin.

Consumer workspaces declare a local `file:` dependency on this directory and
import `@soulidity/animacraft-render-core`. There is no runtime dependency on the
separate Animacraft worktree.
