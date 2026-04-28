<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of your project. The ClawNews backend (`posthog-node`) was already comprehensively instrumented across all major pipeline stages. The wizard verified and confirmed every tracked event, updated environment variables with canonical values, and built an "Analytics basics" dashboard with five insights covering the full pipeline lifecycle.

**No new instrumentation was required** — the existing code in `src/observability/posthog.ts` provides a singleton client with PII scrubbing, and all cron jobs, collectors, the AI pipeline, the publisher, and the Telegram bot already call `captureBackendEvent` / `captureBackendException` at the right boundaries. `posthog-node` v5.30.6 is installed. `POSTHOG_SERVER_KEY` and `POSTHOG_INGEST_HOST` were updated in `.env`.

| Event | Description | File |
|---|---|---|
| `article_produced` | AI pipeline (reporter → analyst → editor) successfully produced an article | `src/producer/pipeline.ts` |
| `article_production_failed` | AI pipeline failed to produce an article (non-retryable) | `src/producer/pipeline.ts` |
| `article_published` | Article published to the Telegram channel | `src/publisher/publish.ts` |
| `article_publish_failed` | Article failed to publish to Telegram | `src/publisher/publish.ts` |
| `collector_run_completed` | RSS/GitHub collector batch finished (total/inserted/skipped/filtered) | `src/collector/run.ts` |
| `x_collection_completed` | X/Twitter collector batch finished (total/inserted/filtered/pendingReview) | `src/collector/x.ts` |
| `dedup_completed` | Deduplication run finished (total/kept/duplicates) | `src/producer/dedup.ts` |
| `bot_join_requested` | Telegram user requested a group invite link via /join | `src/bot/handlers.ts` |
| `bot_item_marked` | Admin marked a message as raw content via /mark | `src/bot/handlers.ts` |
| `bot_user_joined_group` | User joined the Telegram community group | `src/bot/handlers.ts` |
| `cron_run_started` | Cron job started (all 6 scheduled jobs) | `src/scheduler.ts` |
| `cron_run_completed` | Cron job completed successfully with elapsed time | `src/scheduler.ts` |
| `cron_run_failed` | Cron job threw an unhandled error | `src/scheduler.ts` |

Exception capture is also wired globally in `src/main.ts` for `uncaughtException` and `unhandledRejection`, plus inline at every error boundary throughout the pipeline.

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://us.posthog.com/project/401153/dashboard/1522019
- **Article Production — Daily**: https://us.posthog.com/project/401153/insights/9vbRKDoH
- **Article Pipeline Funnel — Produced → Published**: https://us.posthog.com/project/401153/insights/C23Vrsxt
- **Cron Job Failures — Daily**: https://us.posthog.com/project/401153/insights/iiizQGRm
- **Community Growth — New Members**: https://us.posthog.com/project/401153/insights/VqJP8Ypd
- **Collector Throughput — Items Collected vs Inserted**: https://us.posthog.com/project/401153/insights/xE8rNIU2

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-javascript_node/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
