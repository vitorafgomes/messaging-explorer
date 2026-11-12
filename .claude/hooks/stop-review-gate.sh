#!/bin/sh
# Stop hook: block the turn from ending when this session edited production code and never
# dispatched explorer-reviewer (gate 6), either as an Agent dispatch or through the explorer-review
# Workflow.
#
# Production code is src/**/*.cs outside the *.Tests projects, web-app/src/**/*.ts that is not a
# spec, and web-app/electron/*.js.
#
# Blocks once. Claude Code sets stop_hook_active on the continuation and that stop passes, so the
# agent either dispatches the reviewer or says in its reply why every edit was a fast-path one. No
# loop is possible.
#
# Keyed on what THIS session edited, read from the transcript and from the transcripts of the
# subagents it spawned (<session>/subagents/*.jsonl beside <session>.jsonl) - not on working-tree
# dirtiness, which would nag about a parallel session's files. The reviewer dispatch is looked for
# in the main transcript only, because the manager is the one that dispatches it.
#
# Fails open: any missing input, jq, or transcript exits 0 with no output.

INPUT=$(cat 2>/dev/null) || exit 0
[ -n "$INPUT" ] || exit 0

command -v jq >/dev/null 2>&1 || exit 0
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$ACTIVE" = "true" ] && exit 0
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null)

[ -n "$TRANSCRIPT" ] || exit 0
[ -f "$TRANSCRIPT" ] || exit 0

SUBAGENTS="${TRANSCRIPT%.jsonl}/subagents"
set -- "$TRANSCRIPT"
[ -d "$SUBAGENTS" ] && set -- "$@" "$SUBAGENTS"/*.jsonl

cat "$@" 2>/dev/null \
  | grep -E '"name":"(Edit|Write|NotebookEdit)"' \
  | grep -oE '"file_path":"[^"]*"' \
  | grep -E '/src/[^"]*\.cs"|/web-app/src/[^"]*\.ts"|/web-app/electron/[^"]*\.js"' \
  | grep -vE '\.Tests/|\.spec\.ts"' \
  | grep -q . || exit 0

grep -qE '"subagent_type"[[:space:]]*:[[:space:]]*"explorer-reviewer"' "$TRANSCRIPT" 2>/dev/null && exit 0
grep -qE '"name"[[:space:]]*:[[:space:]]*"explorer-review"' "$TRANSCRIPT" 2>/dev/null && exit 0

jq -n '{
  decision: "block",
  reason: "Gate 6: this session edited production code (src/**/*.cs, web-app/src/**/*.ts or web-app/electron/*.js) but never dispatched explorer-reviewer. Run the explorer-review Workflow (or dispatch explorer-reviewer) for the affected project now, or, if every edit was a fast-path one (single line, no logic/signature/DI/route impact), say so explicitly in your reply and stop again. See .claude/skills/explorer-pipeline/SKILL.md."
}' 2>/dev/null

exit 0
