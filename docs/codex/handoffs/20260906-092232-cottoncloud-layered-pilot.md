# Soulidity Phase Handoff: cottoncloud-layered-pilot

## Snapshot

- Created: 2026-09-06T09:22:32+03:00
- Phase: cottoncloud-layered-pilot
- Status: complete
- Goal: Build real Krita layered pilot and import into Animacraft; full asset library continues afterward
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (11 status entries)
- Handoff: `docs/codex/handoffs/20260906-092232-cottoncloud-layered-pilot.md`

## Outcome

13 transparent PNG assets, layered KRA and v5 Maker ZIP produced; actual Creator import renders 7 styles. Full library remains in progress.

## Scope and non-goals

### In scope

- Original adult pink-haired character, approved expression v4

### Intentionally not done

- No chain publication, deployment, commit or competitor asset reuse

## Durable decisions

- User authorized ImageGen -> Krita -> Animacraft production workflow

## Changed paths and assets

### Changed paths

- output/cottoncloud-maker/production

### Image and binary assets

- output/cottoncloud-maker/production/cottoncloud-pilot.kra
- output/cottoncloud-maker/production/Cottoncloud-Maker.zip

### Relevant commits

- No additional commit references recorded.

## Verification

- Krita export: all 13 PNGs RGBA alpha 0..255: PASS
- build-maker.mjs: draft/schema validation and archive roundtrip: PASS
- Actual localhost Creator ZIP import, 7 rendered styles: PASS

## Risks and recovery

### Risks or blockers

- Player and expanded library QA outstanding; overall goal active
- Temporary Krita session_runner active; stop via job.json at completion

### Recovery or rollback points

- Original references and unrelated dirty source files preserved

### Working-tree evidence

```text
 M .gitignore
 M CONTEXT.md
 M README.md
?? .pnpm-store/
?? AGENTS.md
?? clawnews/
?? docs/
?? live-portrait.html
?? output/
?? releases/
?? scripts/
```

## Exact next action

Verify Player expression switching, then expand hairstyles, outfits, accessories and backgrounds and QA combinations.
