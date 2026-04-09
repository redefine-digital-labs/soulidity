# Ralph Agent Instructions

You are an autonomous coding agent working on this software project.

## Your Task

1. Read the PRD at `scripts/ralph/prd.json`
2. Read the progress log at `scripts/ralph/progress.txt` and check the `## Codebase Patterns` section first if it exists
3. Follow the repository instructions in `AGENTS.md` before editing
4. Check you're on the correct branch from PRD `branchName`. If not, check it out or create it from `master` when available, otherwise from `main`
5. Pick the highest priority user story where `passes: false`
6. Implement that single user story only
7. Run the smallest sufficient quality checks needed for that story, including any checks explicitly required by the story acceptance criteria
8. If you discover reusable project knowledge, update nearby `AGENTS.md` or `CLAUDE.md` only when the learning is general and durable
9. If checks pass, commit all changes with message: `feat: [Story ID] - [Story Title]`
10. Update `scripts/ralph/prd.json` to set that story's `passes` field to `true` and record concise evidence in `notes`
11. Append a progress entry to `scripts/ralph/progress.txt`

## Progress Report Format

Append to `scripts/ralph/progress.txt`:

```text
## [Date/Time] - [Story ID]
- What was implemented
- Files changed
- Checks run and results
- Learnings for future iterations:
  - Reusable patterns
  - Gotchas
  - Useful context
---
```

If you discover a general reusable pattern, keep a `## Codebase Patterns` section at the top of `scripts/ralph/progress.txt` and add only durable, cross-story learnings there.

## Quality Requirements

- Work on one story per iteration
- Keep changes focused and minimal
- Do not commit broken code
- For UI stories, browser verification is required before marking the story complete
- Prefer repository-native checks such as `npm run typecheck`, `npm test -- <path>`, `npm --prefix web run typecheck`, or other directly relevant commands instead of broad unrelated suites

## Stop Condition

After completing one story, check whether all stories in `scripts/ralph/prd.json` have `passes: true`.

If all stories are complete, reply with:

```text
<promise>COMPLETE</promise>
```

Otherwise end normally so the next Ralph iteration can continue.
