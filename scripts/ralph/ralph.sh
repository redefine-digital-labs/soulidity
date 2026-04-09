#!/usr/bin/env bash
# Ralph Wiggum - long-running AI agent loop
# Usage: ./scripts/ralph/ralph.sh [--tool amp|claude|codex] [--max-iterations N|--max_iterations N|-n N|N]

set -euo pipefail

TOOL="amp"
MAX_ITERATIONS=10

usage() {
  cat <<'EOF'
Usage: ./scripts/ralph/ralph.sh [--tool amp|claude|codex] [--max-iterations N|--max_iterations N|-n N|N]

Examples:
  ./scripts/ralph/ralph.sh --tool codex 3
  ./scripts/ralph/ralph.sh --tool codex --max-iterations 3
  ./scripts/ralph/ralph.sh --tool codex --max_iterations=3
  ./scripts/ralph/ralph.sh --tool codex -n 3
EOF
}

is_positive_integer() {
  [[ "${1:-}" =~ ^[1-9][0-9]*$ ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tool)
      if [[ $# -lt 2 ]]; then
        echo "Error: --tool requires a value."
        usage
        exit 1
      fi
      TOOL="$2"
      shift 2
      ;;
    --tool=*)
      TOOL="${1#*=}"
      shift
      ;;
    --max-iterations|--max_iterations|-n)
      if [[ $# -lt 2 ]]; then
        echo "Error: $1 requires a positive integer value."
        usage
        exit 1
      fi
      if ! is_positive_integer "$2"; then
        echo "Error: Invalid max iterations '$2'. Must be a positive integer."
        usage
        exit 1
      fi
      MAX_ITERATIONS="$2"
      shift 2
      ;;
    --max-iterations=*|--max_iterations=*)
      VALUE="${1#*=}"
      if ! is_positive_integer "$VALUE"; then
        echo "Error: Invalid max iterations '$VALUE'. Must be a positive integer."
        usage
        exit 1
      fi
      MAX_ITERATIONS="$VALUE"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    -*)
      echo "Error: Unknown option '$1'."
      usage
      exit 1
      ;;
    *)
      if is_positive_integer "$1"; then
        MAX_ITERATIONS="$1"
      else
        echo "Error: Unknown argument '$1'."
        usage
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ "$TOOL" != "amp" && "$TOOL" != "claude" && "$TOOL" != "codex" ]]; then
  echo "Error: Invalid tool '$TOOL'. Must be 'amp', 'claude', or 'codex'."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"

if [[ ! -f "$PRD_FILE" ]]; then
  echo "Error: Missing $PRD_FILE"
  exit 1
fi

ensure_file_exists() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Error: Missing required file $path"
    exit 1
  fi
}

if [[ -f "$PRD_FILE" && -f "$LAST_BRANCH_FILE" ]]; then
  CURRENT_BRANCH="$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")"
  LAST_BRANCH="$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")"

  if [[ -n "$CURRENT_BRANCH" && -n "$LAST_BRANCH" && "$CURRENT_BRANCH" != "$LAST_BRANCH" ]]; then
    DATE="$(date +%Y-%m-%d)"
    FOLDER_NAME="$(echo "$LAST_BRANCH" | sed 's|^ralph/||')"
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"

    echo "Archiving previous run: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [[ -f "$PRD_FILE" ]] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [[ -f "$PROGRESS_FILE" ]] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    echo "Archived to: $ARCHIVE_FOLDER"

    {
      echo "# Ralph Progress Log"
      echo "Started: $(date)"
      echo "---"
    } > "$PROGRESS_FILE"
  fi
fi

CURRENT_BRANCH="$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")"
if [[ -n "$CURRENT_BRANCH" ]]; then
  echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
fi

if [[ ! -f "$PROGRESS_FILE" ]]; then
  {
    echo "# Ralph Progress Log"
    echo "Started: $(date)"
    echo "---"
  } > "$PROGRESS_FILE"
fi

run_tool() {
  if [[ "$TOOL" == "amp" ]]; then
    ensure_file_exists "$SCRIPT_DIR/prompt.md"
    cat "$SCRIPT_DIR/prompt.md" | amp --dangerously-allow-all 2>&1 | tee /dev/stderr
    return 0
  fi

  if [[ "$TOOL" == "claude" ]]; then
    ensure_file_exists "$SCRIPT_DIR/CLAUDE.md"
    claude --dangerously-skip-permissions --print < "$SCRIPT_DIR/CLAUDE.md" 2>&1 | tee /dev/stderr
    return 0
  fi

  ensure_file_exists "$SCRIPT_DIR/CODEX.md"
  codex exec \
    --dangerously-bypass-approvals-and-sandbox \
    -C "$REPO_ROOT" \
    < "$SCRIPT_DIR/CODEX.md" 2>&1 | tee /dev/stderr
}

is_complete_output() {
  local output="$1"
  local last_non_empty_line

  last_non_empty_line="$(printf '%s\n' "$output" | tr -d '\r' | awk 'NF { last=$0 } END { print last }')"
  [[ "$last_non_empty_line" == "<promise>COMPLETE</promise>" ]]
}

echo "Starting Ralph - Tool: $TOOL - Max iterations: $MAX_ITERATIONS"

for i in $(seq 1 "$MAX_ITERATIONS"); do
  echo ""
  echo "==============================================================="
  echo "  Ralph Iteration $i of $MAX_ITERATIONS ($TOOL)"
  echo "==============================================================="

  OUTPUT="$(run_tool)" || true

  if is_complete_output "$OUTPUT"; then
    echo ""
    echo "Ralph completed all tasks!"
    echo "Completed at iteration $i of $MAX_ITERATIONS"
    exit 0
  fi

  echo "Iteration $i complete. Continuing..."
  sleep 2
done

echo ""
echo "Ralph reached max iterations ($MAX_ITERATIONS) without completing all tasks."
echo "Check $PROGRESS_FILE for status."
exit 1
