#!/bin/sh
# Self-test for token-usage.sh: a two-file fixture with a response stored twice.
SCRIPT="$(dirname "$0")/token-usage.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FAILED=0
check() { printf '%s\n' "$OUT" | grep -qE "$2" || { echo "FAIL: $1"; echo "$OUT"; FAILED=1; }; }

line() { printf '{"message":{"id":"%s","usage":{"input_tokens":%s,"cache_creation_input_tokens":%s,"cache_read_input_tokens":%s,"output_tokens":%s}}}\n' "$@"; }
mkdir -p "$TMP/s1/subagents"
{ line m1 10 100 1000 5; line m1 10 100 1000 5; line m2 1 0 2000 7; echo '{"type":"user","message":{"content":"hi"}}'; } > "$TMP/s1.jsonl"
{ line a1 3 30 300 2; line a1 3 30 300 2; } > "$TMP/s1/subagents/agent-x.jsonl"
echo '{"agentType":"explorer-reviewer"}' > "$TMP/s1/subagents/agent-x.meta.json"
mkdir -p "$TMP/s1/subagents/workflows/wf_1"
line w1 4 40 400 3 > "$TMP/s1/subagents/workflows/wf_1/agent-y.jsonl"
echo '{"agentType":"explorer-reviewer"}' > "$TMP/s1/subagents/workflows/wf_1/agent-y.meta.json"

OUT=$(sh "$SCRIPT" "$TMP/s1.jsonl")
check "a response stored twice is counted once"   '^main +1 +2 +11 +100 +3000 +12 +2001$'
check "an agent a workflow started joins its type" '^explorer-reviewer +2 +2 +7 +70 +700 +5 +444$'
check "the total adds every agent"                 '^TOTAL +3 +4 +18 +170 +3700 +17$'
check "the documents are totalled by when they load" '^  every session +[0-9]+ +[0-9]+ +[0-9]+$'

OUT=$(sh "$SCRIPT" docs)
check "docs lists the root instructions"            '^  CLAUDE.md +[0-9]+ +[0-9]+$'
check "docs lists each agent file"                  '^  \.claude/agents/explorer-reviewer\.md +[0-9]+ +[0-9]+$'
check "docs leaves the eval fixtures out"           '^every session:$'
printf '%s\n' "$OUT" | grep -q '/evals/' && { echo "FAIL: an eval fixture is listed"; FAILED=1; }

OUT=$(sh "$SCRIPT" "$TMP/missing.jsonl" 2>&1); [ $? -eq 2 ] || { echo "FAIL: a missing transcript exits 2"; FAILED=1; }

[ $FAILED -eq 0 ] && echo "token-usage.test.sh: all passed"
exit $FAILED
