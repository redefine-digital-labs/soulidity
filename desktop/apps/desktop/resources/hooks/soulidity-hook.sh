#!/bin/sh
# Soulidity Desktop hook bridge

set -eu

SOCKET="/tmp/soulidity-$(id -u).sock"
SOURCE=""
EVENT=""
BLOCKING_TIMEOUT="${SOULIDITY_BLOCKING_TIMEOUT:-86400}"

while [ $# -gt 0 ]; do
  case "$1" in
    --source)
      SOURCE="${2:-}"
      shift 2
      ;;
    --event)
      EVENT="${2:-}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

[ -S "$SOCKET" ] || exit 0

INPUT="$(cat 2>/dev/null || true)"
if [ -z "$INPUT" ]; then
  INPUT='{}'
fi

TTY_PATH="$(tty 2>/dev/null || true)"

build_payload_with_node() {
  printf '%s' "$INPUT" | \
    SOULIDITY_SOURCE="$SOURCE" \
    SOULIDITY_EVENT="$EVENT" \
    SOULIDITY_TTY="$TTY_PATH" \
    SOULIDITY_PPID="$PPID" \
    SOULIDITY_TASK_ID="${SOULIDITY_TASK_ID:-}" \
    node -e '
let raw = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { raw += chunk })
process.stdin.on("end", () => {
  let payload
  try {
    payload = JSON.parse(raw || "{}")
  } catch {
    payload = {}
  }

  const source = process.env.SOULIDITY_SOURCE || ""
  const event = process.env.SOULIDITY_EVENT || ""
  const tty = process.env.SOULIDITY_TTY || ""
  const ppid = Number(process.env.SOULIDITY_PPID || "0")
  const taskId = process.env.SOULIDITY_TASK_ID || ""

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    payload = {}
  }

  if (!payload._source && source) payload._source = source
  if (!payload.hook_event_name && event) payload.hook_event_name = event
  if (!payload._ppid && Number.isFinite(ppid) && ppid > 0) payload._ppid = ppid
  if (!payload._tty && tty) payload._tty = tty
  if (!payload._soulidity_task_id && taskId) payload._soulidity_task_id = taskId

  process.stdout.write(JSON.stringify(payload))
})
'
}

build_payload_fallback() {
  payload="$INPUT"
  if [ -z "$payload" ]; then
    payload='{}'
  fi
  payload="${payload%\}}"
  if [ "$payload" = "$INPUT" ]; then
    payload='{"_source":"'"$SOURCE"'","hook_event_name":"'"$EVENT"'"}'
  else
    payload="$payload"
    if printf '%s' "$INPUT" | grep -q '"_source"'; then :; else
      payload="$payload,\"_source\":\"$SOURCE\""
    fi
    if [ -n "$EVENT" ] && ! printf '%s' "$INPUT" | grep -q '"hook_event_name"'; then
      payload="$payload,\"hook_event_name\":\"$EVENT\""
    fi
    if [ -n "$TTY_PATH" ] && ! printf '%s' "$INPUT" | grep -q '"_tty"'; then
      payload="$payload,\"_tty\":\"$TTY_PATH\""
    fi
    if ! printf '%s' "$INPUT" | grep -q '"_ppid"'; then
      payload="$payload,\"_ppid\":$PPID"
    fi
    if [ -n "${SOULIDITY_TASK_ID:-}" ] && ! printf '%s' "$INPUT" | grep -q '"_soulidity_task_id"'; then
      payload="$payload,\"_soulidity_task_id\":\"${SOULIDITY_TASK_ID}\""
    fi
    payload="$payload}"
  fi
  printf '%s' "$payload"
}

if command -v node >/dev/null 2>&1; then
  PAYLOAD="$(build_payload_with_node)"
else
  PAYLOAD="$(build_payload_fallback)"
fi

if printf '%s' "$PAYLOAD" | grep -q '"PermissionRequest"'; then
  printf '%s' "$PAYLOAD" | nc -U -w "$BLOCKING_TIMEOUT" "$SOCKET" 2>/dev/null || true
  exit 0
fi

if printf '%s' "$PAYLOAD" | grep -q '"Notification"' && printf '%s' "$PAYLOAD" | grep -q '"question"'; then
  printf '%s' "$PAYLOAD" | nc -U -w "$BLOCKING_TIMEOUT" "$SOCKET" 2>/dev/null || true
  exit 0
fi

printf '%s' "$PAYLOAD" | nc -U -w 5 "$SOCKET" >/dev/null 2>&1 || true
