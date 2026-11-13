#!/bin/sh
# Token use of one Claude Code session, per agent, read from its transcript files.
#
#   tools/dev/token-usage.sh [transcript.jsonl]   the session, then the documents by group
#   tools/dev/token-usage.sh docs                 every Markdown document a model reads, by file
#
# With no argument it takes the newest transcript Claude Code keeps for this checkout.
# The session part prints one row for the main session and one per agent type it started.
# The document part covers what Claude Code loads here. Sizes are characters, with tokens estimated as characters / 4. Reads only.
#
# A response is stored once per content block, each copy carrying the same usage, so rows are
# counted once per message id.

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
command -v jq >/dev/null 2>&1 || { echo "token-usage: jq is required" >&2; exit 2; }

# One line per document: when it is loaded, its path, its size in characters.
documents() {
  (
    cd "$ROOT" || exit 0
    emit() { [ -f "$2" ] && printf '%s\t%s\t%s\n' "$1" "$2" "$(wc -c < "$2")"; }
    for f in CLAUDE.md AGENTS.md; do emit "1 every session" "$f"; done
    for f in .claude/agents/*.md .claude/skills/*/SKILL.md; do
      [ -f "$f" ] && printf '%s\t%s\t%s\n' "1 every session" "$f (description)" "$(grep '^description:' "$f" | wc -c)"
    done
    emit "2 every task" context/index.md
    for f in .claude/agents/*.md; do emit "3 each run of the agent" "$f"; done
    find .claude/skills .claude/commands -name '*.md' -not -path '*/evals/*' 2>/dev/null | sort | while read -r f; do
      emit "4 when the skill or command is used" "$f"
    done
    for f in context/CLAUDE.md context/wiki-config.md context/wiki-schema.md; do emit "5 when the task needs it" "$f"; done
  )
}

if [ "$1" = "docs" ]; then
  documents | sort -t "$(printf '\t')" -k1,1 -k3,3nr | awk -F '\t' '
    $1 != group { if (group != "") printf "  %-66s %8d %8d\n\n", "total", sum, sum / 4
                  group = $1; sum = 0; print substr(group, 3) ":" }
    { printf "  %-66s %8d %8d\n", $2, $3, $3 / 4; sum += $3 }
    END { printf "  %-66s %8d %8d\n", "total", sum, sum / 4 }'
  exit 0
fi

TRANSCRIPT=$1
if [ -z "$TRANSCRIPT" ]; then
  DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/$(printf '%s' "$ROOT" | tr '/.' '--')"
  TRANSCRIPT=$(ls -t "$DIR"/*.jsonl 2>/dev/null | head -n 1)
fi
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] || { echo "token-usage: no transcript found" >&2; exit 2; }

rows() {
  jq -r --arg agent "$1" 'select(.message.usage != null and .message.id != null)
    | [.message.id, $agent, (.message.usage.input_tokens // 0),
       (.message.usage.cache_creation_input_tokens // 0),
       (.message.usage.cache_read_input_tokens // 0),
       (.message.usage.output_tokens // 0)] | @tsv' "$2" 2>/dev/null
}

echo "Session: $(basename "$TRANSCRIPT" .jsonl)"
echo
{
  rows main "$TRANSCRIPT"
  for sub in "${TRANSCRIPT%.jsonl}"/subagents/*.jsonl "${TRANSCRIPT%.jsonl}"/subagents/workflows/*/*.jsonl; do
    [ -f "$sub" ] || continue
    type=$(jq -r '.agentType // "unknown"' "${sub%.jsonl}.meta.json" 2>/dev/null)
    rows "${type:-unknown}:$(basename "$sub" .jsonl)" "$sub"
  done
} | awk -F '\t' '
  seen[$1]++ { next }
  {
    split($2, who, ":"); a = who[1]
    if (!(($2) in run)) { run[$2] = 1; runs[a]++ }
    req[a]++; inp[a] += $3; cw[a] += $4; cr[a] += $5; out[a] += $6
    ctx = $3 + $4 + $5; if (ctx > peak[a]) peak[a] = ctx
  }
  END {
    printf "%-22s %5s %8s %12s %12s %14s %10s %12s\n", "agent", "runs", "requests", "input", "cache-write", "cache-read", "output", "peak-context"
    for (a in req) {
      printf "%-22s %5d %8d %12d %12d %14d %10d %12d\n", a, runs[a], req[a], inp[a], cw[a], cr[a], out[a], peak[a] | "sort -k5,5nr"
      R += runs[a]; Q += req[a]; I += inp[a]; W += cw[a]; C += cr[a]; O += out[a]
    }
    close("sort -k5,5nr")
    printf "%-22s %5d %8d %12d %12d %14d %10d\n", "TOTAL", R, Q, I, W, C, O
  }'

echo
echo "Documents a model reads, by when they load (files, characters, tokens as characters / 4):"
documents | awk -F '\t' '{ n[$1]++; c[$1] += $3 } END { for (g in n) printf "%s\t%d\t%d\t%d\n", g, n[g], c[g], c[g] / 4 }' \
  | sort | awk -F '\t' '{ printf "  %-40s %5d %9d %9d\n", substr($1, 3), $2, $3, $4 }'
echo "Run with the argument docs for the list by file."
