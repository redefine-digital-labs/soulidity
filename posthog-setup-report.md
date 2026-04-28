<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of the ClawNews Node.js backend with PostHog analytics. The project already had a PostHog singleton (`src/observability/posthog.ts`) and exception capture on collectors/scheduler/main process. This integration supplements that foundation with 10 new business-critical event captures across 6 files — covering the full pipeline from content collection through LLM production to Telegram publishing, plus Telegram bot user acquisition events.

**`posthog-node` v5.30.6** was already installed. Environment variables `POSTHOG_SERVER_KEY` and `POSTHOG_INGEST_HOST` were written to `.env`.

The PostHog client (`src/observability/posthog.ts`) uses `flushAt: 1` / `flushInterval: 0` — appropriate for this cron-driven short-lived process model.

| Event | Description | File |
|---|---|---|
| `collector_run_completed` | Fired after RSS/GitHub collector batch finishes. Tracks total, inserted, filtered, skipped counts. | `src/collector/run.ts` |
| `article_produced` | Fired when the 3-agent pipeline (reporter→analyst→editor) successfully produces an article. Tracks source, editor approval, article status, tag count, company count. | `src/producer/pipeline.ts` |
| `article_production_failed` | Fired on non-retryable pipeline failure. Tracks raw item ID and error message. Exception also captured. | `src/producer/pipeline.ts` |
| `article_published` | Fired when an article is successfully sent to the Telegram channel. Tracks article ID, Telegram message ID, and channel. | `src/publisher/publish.ts` |
| `article_publish_failed` | Fired when Telegram auto-publish fails for an article. Exception also captured. | `src/publisher/publish.ts` |
| `bot_join_requested` | Fired when a Telegram user requests a group invite link via `/join`. Tracks whether user is already web-registered. | `src/bot/handlers.ts` |
| `bot_user_joined_group` | Fired when a new member joins the Telegram group (chat_member event). Top of community acquisition funnel. | `src/bot/handlers.ts` |
| `bot_item_marked` | Fired when an admin marks a group message as content via `/mark`. | `src/bot/handlers.ts` |
| `dedup_completed` | Fired after dedup run. Tracks total items, kept, duplicates removed. | `src/producer/dedup.ts` |
| `x_collection_completed` | Fired after a successful X/Twitter collection run. Tracks total, inserted, filtered, pendingReview. | `src/collector/x.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://us.posthog.com/project/401153/dashboard/1519882
- **Articles Published (Daily)**: https://us.posthog.com/project/401153/insights/oYY4h2g7
- **Pipeline Funnel: Collect → Produce → Publish**: https://us.posthog.com/project/401153/insights/WjZtKZ1F
- **Article Production: Draft vs Rejected**: https://us.posthog.com/project/401153/insights/QkOyNlKd
- **Telegram Bot User Acquisition**: https://us.posthog.com/project/401153/insights/m9SVAJWP
- **Cron Job Health: Success vs Failure**: https://us.posthog.com/project/401153/insights/1vL2ySf0

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-javascript_node/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
