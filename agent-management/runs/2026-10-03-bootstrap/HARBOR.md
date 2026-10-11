# HARBOR / SOL-L007 — CI baseline

- Session: harbor_baseline; read-only API execution 2026-10-03 12:40–12:42 UTC.
- No source edits, builds, tests, deployments or messages. Cost unknown.

| Repository | Default HEAD | Protected | Verified coverage |
| --- | --- | --- | --- |
| soulidity | 3a1f223ef3f8 | false | TS/unit/integration, SDK/desktop/web types, lint, paired eight-package Move gates |
| animacraft | 592699af0eb8 | true | Repository hygiene includes Web production build and paired eight-package Move gates |
| infinite-flow-engine | 8399544b0f48 | false | API returns 0 workflows/runs; local documented Move/SDK commands exist |
| soul-expedition | 39e54642bd06 | false | API returns 0 workflows/runs; existing Web test/build/lint commands |
| soul-paper-theater | 2daebef1f74d | false | API returns 0 workflows/runs; existing Web test/build/lint commands |
| infinite-stellar | 75fe712e4d23 | false | Dynamic Dependabot only; recent failure is github_actions update, not product test |
| soul-habitat | 53b249fb0fc8 | false | Documentation runs ruby scripts/check_docs.rb; not simulation acceptance |

Evidence: [Soulidity successful head](https://github.com/redefine-digital-labs/soulidity/actions/runs/37116966506), [earlier TS failure](https://github.com/redefine-digital-labs/soulidity/actions/runs/37114316497); [Animacraft successful head](https://github.com/redefine-digital-labs/animacraft/actions/runs/37120964860), [earlier production-build failure](https://github.com/redefine-digital-labs/animacraft/actions/runs/37117505976); [Stellar dependency update failure](https://github.com/redefine-digital-labs/infinite-stellar/actions/runs/36326869257), [earlier npm/yarn update success](https://github.com/redefine-digital-labs/infinite-stellar/actions/runs/34039994750); [Habitat docs success](https://github.com/redefine-digital-labs/soul-habitat/actions/runs/31285702029).

Desktop Release exists but API returned 0 runs. Protected is only the branch API flag, not a ruleset audit. No Actions does not exclude external CI.

Ready-to-spec recommendations, not applied changes:

1. Engine + two templates: wire existing tests and pin tools; verify PR/push runs, independent failure demonstration, no publication.
2. Stellar: add product validate:web pipeline, separately diagnose Dependabot configuration; separate status names.
3. Seven repos: inspect rulesets then define required checks only after jobs exist; ensure path filters cannot leave unrelated PRs pending; define bypass responsibility. No protection changes made.

Runtime deployment, SLO, monitoring and recovery remain unverified. PLAN-007 as a whole remains open. Independent review pending SENTINEL.
