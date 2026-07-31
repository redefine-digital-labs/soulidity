# Animacraft Composable Assets v6 integration

## Scope

This is a stacked, gated Soulidity integration for Animacraft's additive
Composable Assets v6 protocol. It does not replace the commerce-rights v5
Genesis mint path and it does not enable Mainnet behavior.

The exact Animacraft commit must be pinned in `move/soulidity/Move.toml` before
this branch can be reviewed or deployed.

## Immutable and mutable truths

Soulidity keeps the existing `Soul` and `SoulState` layouts stable:

- `Soul.image_url`, v5 provenance, Recipe and Complete output remain the
  immutable Genesis representation.
- `GenesisAppearanceV6` is frozen and binds the exact Maker Root, profile,
  canonical Loadout, Slot schema, extensions and transfer-safety result used
  when the Soul entered v6.
- `SoulAppearanceStateV6` is a companion object with a strictly increasing
  current revision.
- Historical revisions are emitted by Soulidity and authorized by one-shot
  Animacraft records; the shared Soul state does not grow without bound.

v6 does not introduce a mutable Current Appearance PNG, Seal object or Walrus
Blob binding. The immutable Maker and Item Product manifests already bind the
source assets, and the shared Renderer derives the visual from the committed
Loadout. The existing v5 Complete output remains the finished image and
provenance record.

There are no human-body anchors. A profile is compatible only through the
Maker-local canvas, Renderer, Layer Track, slot, mask and rule contract.

## Item origin and safety

Soulidity accepts three visible Item origins:

- `Official`: published through the current Maker authority.
- `Certified`: third-party content with Maker certification.
- `Open`: third-party content without Maker endorsement.

Every origin still requires an Animacraft protocol validation attestation.
`Open` means unendorsed, not unvalidated. Soulidity must preserve the origin
badge and exact Item definition version in every Loadout authorization.

## One-way package dependency

The dependency remains:

```text
Soulidity -> Animacraft
```

Animacraft never imports Soulidity. A Wardrobe PTB uses a Soulidity-only owner
proof whose exact type is governance-bound in Animacraft. Animacraft validates
the Item rights and returns a non-copyable, non-storable, non-droppable
appearance authorization; Soulidity consumes it immediately.

## Appearance update invariant

One successful Wardrobe transaction must bind:

- network and exact package TypeOrigins;
- Soul, SoulState and appearance companion IDs;
- Soul owner and ownership epoch;
- MakerRootV5 and v6 profile IDs;
- expected and target revision;
- full Item definition/version set;
- entitlement or instance authority set;
- canonical Loadout hash, Slot schema and generic extensions commitment;
- the Animacraft authorizer and one-shot client nonce.

The Soul must not be listed, and the target revision must equal current + 1.
Any mismatch aborts the entire PTB, including equip-lock changes.

## Transfer rules

- Embedded and Soul-bound content is transfer-safe.
- Account-licensed and independently owned content does not follow a sold
  Soul.
- A Soul containing non-transfer-safe content cannot be listed; the owner must
  first restore a complete free fallback or another transfer-safe loadout.
- A listed Soul cannot change appearance.
- An equipped owned Item cannot be listed or transferred.
- Legacy Soul listing functions reject Souls with a v6 companion; the v6
  listing snapshots the exact appearance revision, ownership epoch and
  Loadout hash.
- Current Item products never participate automatically in Soul secondary
  royalties.

## Explicitly out of scope

Rental, consumables, durability, enhancement, game statistics and bundle sale
have no v6 state machine, fee event or UI. Only generic schema and extension
commitments are retained for a future reviewed module.

## Production gate

There are no undocumented environment switches in this integration. The
actual Animacraft `CompositionProtocolConfigV6.enabled` flag and web runtime
`compositionV6ReleaseEnabled` gate both default to false, and every v6 write
also requires the existing Commerce v5 protocol to remain enabled. Maker-local
third-party policy and Item access modes are immutable product policy, not
deployment gates.

Production activation requires the exact Animacraft dependency pin,
cross-package Move tests, web tests, testnet transactions, recovery evidence,
an independent security review and one explicit reviewed gate change.
