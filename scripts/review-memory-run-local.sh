#!/usr/bin/env bash

set -euo pipefail

MEM9_REF="${MEM9_REF:-main}"
CONTROL_DSN="${REVIEW_MEMORY_CONTROL_DSN:-postgres://postgres:postgres@127.0.0.1:15432/mnemo_control?sslmode=disable}"
PORT="${REVIEW_MEMORY_PORT:-8080}"
CACHE_DIR="${REVIEW_MEMORY_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/clawnews-review-memory}"
SRC_DIR="${CACHE_DIR}/mem9-${MEM9_REF}"
BIN_PATH="${CACHE_DIR}/mnemo-server-${MEM9_REF}"

mkdir -p "${CACHE_DIR}"

if [[ ! -x "${BIN_PATH}" ]]; then
  rm -rf "${SRC_DIR}"
  mkdir -p "${SRC_DIR}"
  curl -fsSL "https://codeload.github.com/mem9-ai/mem9/tar.gz/refs/heads/${MEM9_REF}" \
    | tar -xz -C "${SRC_DIR}" --strip-components=1
  (
    cd "${SRC_DIR}/server"
    go build -o "${BIN_PATH}" ./cmd/mnemo-server
  )
fi

exec env \
  MNEMO_DSN="${CONTROL_DSN}" \
  MNEMO_DB_BACKEND=postgres \
  MNEMO_PORT="${PORT}" \
  MNEMO_INGEST_MODE=raw \
  MNEMO_TIDB_ZERO_ENABLED=false \
  MNEMO_ENCRYPT_TYPE=plain \
  MNEMO_RATE_LIMIT="${MNEMO_RATE_LIMIT:-5000}" \
  MNEMO_RATE_BURST="${MNEMO_RATE_BURST:-5000}" \
  "${BIN_PATH}"
