# Soulidity Phase Handoff: soulidity-animacraft-growth-strategy

## Snapshot

- Created: 2026-08-12T16:57:44+08:00
- Phase: soulidity-animacraft-growth-strategy
- Status: complete
- Goal: Produce an evidence-calibrated, executable Soulidity × Animacraft growth strategy.
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/20260812-soulidity-animacraft-growth-strategy.md`

## Outcome

Created the growth strategy, aligned it with current protocol and activation boundaries, added it to the v3 document map, and completed technical, strategy, and external-evidence red-team reviews.

## Scope and non-goals

### In scope

- Picrew/Neka/OC/NFT/UGC evidence synthesis
- Part assetization and current protocol boundary
- North-star metric, experiments, monetization, 90/180/365 roadmap, risk controls

### Intentionally not done

- No production config, chain, deployment, contract, commit, push, or PR changes

## Durable decisions

- Use MRC (Monthly Reused Characters) rather than mint or wallet counts as the growth north star.
- Treat Part assetization as a strategic umbrella; current implementation is component structuring, Item productization, selected Style assetization, and Pack rights.
- Keep v8 FREE activation, canonical Soul, retired v6, undeployed v7, Scene, Agent, and DeFi claims separated by evidence gates.

## Changed paths and assets

### Changed paths

- docs/v3/SOULIDITY_ANIMACRAFT_GROWTH_STRATEGY_CN.md
- docs/v3/README.md

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- Technical boundary red-team review incorporated: PASS
- Strategy dependency and metric red-team review incorporated: PASS
- External evidence and legal-boundary red-team review incorporated: PASS
- Markdown fences and local links validated: PASS

## Risks and recovery

### Risks or blockers

- docs/codex/CURRENT.md tracks a separate live v8 activation phase and was intentionally not overwritten.
- External market figures are operator self-reports or adjacent benchmarks where labeled; they are not Soulidity adoption forecasts.

### Recovery or rollback points

- Remove the two untracked docs paths only if the user explicitly rejects the strategy; no production state was changed.

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
?? scripts/
```

## Exact next action

Use section 15 to assign the 14-day deliverables without overwriting the separate active v8 activation phase in docs/codex/CURRENT.md.
