# Paired Move CI

The public repositories are
[Animacraft](https://github.com/redefine-digital-labs/animacraft) and
[Soulidity](https://github.com/redefine-digital-labs/soulidity).
CI is unsigned and read-only: no wallet secret, funding, chain transaction or
production deployment belongs in these checks.

## Exact source selection

Each workflow accepts a required exact peer commit for manual dispatch.
Push/PR runs use the configured peer revision. The peer must be a40-character
lowercase hexadecimal commit; branch fallback is forbidden. Checkout HEAD is
read back and compared before executing peer scripts. Token permissions remain
contents:read, and checkout does not persist credentials.

Cross-product JS tests use the verified peer checkout as well. Soulidity installs
the peer's locked dependencies to exercise actual producer/reader Seal SDK
interoperability. Only the external _paired directory is excluded from host
Vitest discovery; all host and cross-product tests remain enabled. For a local
paired run, set ANIMACRAFT_WORKSPACE or SOULIDITY_WORKSPACE to the intended peer
root. No developer-specific absolute path is a CI fallback.

## Compiler and complete graph

Both workflows pin Sui mainnet-v1.80.1, executable version
sui1.80.1-671ba71e69c7. The Linux archive SHA256 is
97f9aed10e0c2fe3204ce4639ac992e1449b17c14f22f30e9f903ead54ac7336.
Verify the archive before extracting/executing it. The quick Seal certificate
gate authenticates the executable against that archive.

Animacraft scripts/native-soul-test-graph.mjs --check release-gates runs one
immutable paired graph: eight package suites, unfiltered joint acceptance and
production build, seven probe groups, eight forced disassemblies, seven size
checks and eight-package field checks. Preserve original/snapshot inventories,
hashes, compiler identity and before/after drift checks; no hidden retry may
convert a failed result into evidence.

## Evidence and publication

JSON/log evidence is bundled as a .tgz, including colon-named check files, then
retained even when the run fails. Missing evidence is not success. Only an actual
successful run on the exact public source pair proves remote CI; local results
cannot substitute for it.

Git-linked hosting may automatically deploy pushed branches. Account for preview
and production triggers before publishing candidate revisions; never push a
production branch merely to obtain CI evidence. Static deployment configuration
and fresh chain identifiers remain separate release gates. The single authorized
publisher is described in [single fresh release](2026-10-01-single-release-entry.md).
