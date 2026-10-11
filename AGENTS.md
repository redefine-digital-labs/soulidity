## Imported Claude Cowork project instructions

## Soulidity phase and memory workflow

- For multi-step implementation, release, audit, migration, image-heavy, or multi-agent work, load and follow `$manage-soulidity-phases`.
- Treat one Codex task as one bounded phase or objective. At the start of substantial project work, read `docs/codex/PROJECT_MEMORY.md`, then `docs/codex/CURRENT.md`, then only the single handoff path named there when one is present. Pure status checks and session scans remain read-only.
- For genuinely long phases, use the user's standing request to create a `/goal` with the outcome, constraints, and acceptance checks. Do not replace an unfinished goal or mark it complete early.
- Create a durable handoff before the phase ends, the objective materially changes, repeated images enlarge context, or the next work needs five or more new subagents or nested agents. Use `python3 scripts/codex/phase_handoff.py` and recommend a new task seeded with the generated path.
- Put durable project memory in code, tests, repository docs, and intentional Git commits. Never rely on chat history as the only copy. Do not commit, push, or open a PR unless the user requested it.
- Save images as project files and refer to paths; do not repeatedly upload or inline the same bytes.
- If the objective is unchanged but active context becomes large, checkpoint durable facts in `CURRENT.md` and use `/compact`; `/compact` reduces active context, not the on-disk rollout archive.
- Give subagents no history or only the smallest useful recent slice. Never full-fork a long or image-heavy task. Use separate worktrees for concurrent writes.
- Do not reawaken a completed subagent from a long or image-heavy task; a follow-up can materialize another large rollout. Start a fresh bounded subagent with no inherited turns when a new independent review is genuinely needed.
- `python3 scripts/codex/session_archive.py scan` is safe and read-only. Any archive, source removal, or restore requires explicit user approval and must pass the script's verification gates.

## Confirmed Agile + DevOps loop

Use `agent-management/OPERATING_MODEL.md` section 8 for Plan → Code → Build → Test → Release → Deploy → Operate → Monitor. Reuse the existing task and bug records; record stage, evidence and exit criteria separately from status. Preserve current product roadmap, active owners and authorization boundaries. Process documentation is not evidence of deployed automation or completed product behavior.

## Required product and engineering handbook

- Read `agent-management/PRODUCT_ENGINEERING_HANDBOOK_CN.md` sections 1–4, 9 and 12 when first joining Soulidity work, then the specialty sections relevant to the task. On later tasks, reuse the known version and read applicable updates rather than loading the entire handbook every time.
- Distinguish management science, product/Agile, DevOps, financial engineering/DeFi, common contract security, Ethereum/EVM, and Sui Move. Sui is the current engineering focus; EVM and financial-product sections apply when the task actually involves them and do not create a new roadmap commitment.
- Record handbook version, applicable sections, evidence and remaining checks on the existing Delivery/DEV/BUG record. For funds, permissions, contracts, upgrades or migrations, use `agent-management/templates/product-engineering-review.md` inline or as an attachment; do not create a competing task board.
- Distinguish multisig, timelocks, upgrade-policy restrictions, permanent immutability, asset locks and emergency pauses. Verify all effective authority paths and recovery/exit limits; documentation is not proof a control is deployed or an audit passed.
- Preserve existing owners, product behavior, milestones, CURRENT continuation pointer and explicit authorization. This handbook does not authorize commits, deployments, signatures, spending, external messages or irreversible privilege changes.
