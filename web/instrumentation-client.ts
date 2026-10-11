import posthog from 'posthog-js'
import {
  buildPostHogClientConfig,
  isPostHogSessionReplayEnabled,
} from './lib/observability/posthog-client-config'

const token = process.env.NEXT_PUBLIC_POSTHOG_KEY
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || '/ingest'
const sessionReplayEnabled = isPostHogSessionReplayEnabled(
  process.env.NEXT_PUBLIC_POSTHOG_SESSION_REPLAY,
)

if (token) {
  posthog.init(token, buildPostHogClientConfig({
    apiHost: host,
    sessionReplayEnabled,
  }))
}
