# Animacraft Maker handoff — task spec

## Goal

Allow a user who has prepared and certified a free Animacraft OC package to continue into Soulidity with the rendered cover, required Living Content, Maker provenance, and recipe hash already assembled for the canonical Soul mint.

## Scope

- Recognize `/import?source=animacraft&maker=…&profile=…&image=…`.
- Require an HTTPS profile and image URL, a valid Sui Maker id, and `animacraft.oc-package.v1`.
- Bound remote profile and image reads before creating browser Files.
- Populate name, description, tags, cover, `soul.md`, `memory.md`, optional `skills.zip`, and an Animacraft-specific origin reference.
- Continue through the existing reviewed Import Soul mapping, preview, upload, and mint flow.
- Preserve Local File import as a fallback when the remote handoff is unavailable.

## Acceptance

- Direct handoff reaches `/import/map` without asking the user to re-upload files.
- Invalid ids, insecure URLs, oversized payloads, malformed JSON, unsupported schemas, or missing required Living Content fail closed with a user-visible fallback message.
- Existing Local File import remains functional.
- Typecheck/build and relevant import tests pass.

## Boundary

This is the free-Maker transitional handoff. Paid Maker authorization must remain disabled until Soulidity consumes Animacraft's non-droppable authorization in the same PTB.
