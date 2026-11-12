#!/bin/sh
# SessionEnd hook: append one JSON line per session to .claude/metrics/sessions.jsonl (gitignored).
#
# The next harness audit becomes a jq query over this file instead of a transcript grep: how many
# production edits, test edits, reviewer dispatches, review workflows, pipeline invocations, agents
# and tool calls the session made, and whether it ended with a production edit no review followed.
# Counts come from the main transcript and the session's subagent transcripts, like the stop gate.
#
# Fails open: any missing input, jq or transcript exits 0 having written nothing.
# METRICS_DIR overrides the output directory (the self-test uses it).

INPUT=$(cat 2>/dev/null) || exit 0
[ -n "$INPUT" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null)
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // ""' 2>/dev/null)
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] || exit 0

SUBAGENTS="${TRANSCRIPT%.jsonl}/subagents"
set -- "$TRANSCRIPT"
[ -d "$SUBAGENTS" ] && set -- "$@" "$SUBAGENTS"/*.jsonl

ROW=$(cat "$@" 2>/dev/null | jq -c -s --arg session "$SESSION" --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  def is_test: test("\\.Tests/.*\\.cs$") or test("\\.spec\\.ts$");
  def is_src: (test("/src/.*\\.cs$") or test("/web-app/src/.*\\.ts$") or test("/web-app/electron/.*\\.js$")) and (is_test | not);
  [ .[] | .message.content? | arrays | .[] | select(.type == "tool_use") ] as $calls
  | ($calls | map(select((.name == "Edit" or .name == "Write" or .name == "NotebookEdit")
      and ((.input.file_path // "") | is_src))) | length) as $src
  | ($calls | map(select((.name == "Edit" or .name == "Write")
      and ((.input.file_path // "") | is_test))) | length) as $tests
  | ($calls | map(select(.name == "Agent" and .input.subagent_type == "explorer-reviewer")) | length) as $reviewers
  | ($calls | map(select(.name == "Workflow" and .input.name == "explorer-review")) | length) as $workflows
  | ($calls | map(select(.name == "Skill" and .input.skill == "explorer-pipeline")) | length) as $pipeline
  | {
      session: (if $session == "" then null else $session end),
      endedAt: $now,
      srcEdits: $src, testEdits: $tests,
      reviewerDispatches: $reviewers, reviewWorkflows: $workflows,
      pipelineInvocations: $pipeline,
      agents: ($calls | map(select(.name == "Agent")) | length),
      toolCalls: ($calls | length),
      endedUnreviewed: ($src > 0 and $reviewers == 0 and $workflows == 0)
    }' 2>/dev/null) || exit 0
[ -n "$ROW" ] || exit 0

DIR="${METRICS_DIR:-$(dirname "$0")/../metrics}"
mkdir -p "$DIR" 2>/dev/null && printf '%s\n' "$ROW" >> "$DIR/sessions.jsonl" 2>/dev/null
exit 0
