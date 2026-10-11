# Single fresh release entry

The current release is a fresh Animacraft + Soulidity deployment, not an upgrade
or migration of previously deployed assets. Preserve existing product behavior;
there is no legacy issuer or parallel compatibility release.

## Publisher and recovery

The sole executable publisher is
[Animacraft scripts/mainnet-v8-release.mjs](https://github.com/redefine-digital-labs/animacraft/blob/main/scripts/mainnet-v8-release.mjs).
Its source-CAS, exact compiler, frozen transaction bytes, write-ahead log (WAL),
output certificates and paired configuration export replace Soulidity's separate
publisher, upgrader and market-retirement commands.

Preparation can mutate release state; it is not a read-only check. Signing,
broadcasting and deploying require the applicable release authorization. An
interrupted operation must query and recover its recorded transaction before any
retry; never regenerate a payment or substitute old deployment identifiers.

## Retired entries

The old Soulidity publish/upgrade/retirement CLIs, Phase2 smoke family,
API-mirror replayer, associated aliases and live CI signing job are removed.
Historical runbooks are explicitly non-executable. Do not recreate forwarding
CLIs, secret injection, automatic funding or obsolete database deployment steps.
Ordinary product transactions and unrelated desktop/bot functionality remain.

## Acceptance boundaries

[Paired CI](2026-10-01-paired-move-ci.md) checks exact source revisions, types,
tests and the complete Move graph. It performs no wallet signing or deployment.
Local tests or a successful build are not remote CI evidence, and remote CI is
not fresh-deployment or real desktop/mobile/wallet acceptance.

Before production activation, bind the reviewed source pair, toolchain, static
artifacts and new deployment configuration. Preserve the prior verified static
artifacts and the release WAL for recovery. A failed deployment does not authorize
a second issuer, an asset migration or resubmission of an unresolved transaction.
