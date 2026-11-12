#!/usr/bin/env bash
# Case matrix for session-end-metrics.sh: each case asserts fields of the appended JSON row.
HOOK="${1:-$(dirname "$0")/session-end-metrics.sh}"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
edit_src='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/repo/src/ServiceBusExplorer.Core/Providers/ProviderFactory.cs"}}]}}'
edit_web='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/repo/web-app/src/app/core/services/api.service.ts"}}]}}'
edit_test='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/repo/src/ServiceBusExplorer.Core.Tests/Providers/ProviderFactoryTests.cs"}}]}}'
edit_spec='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/repo/web-app/src/app/core/services/api.service.spec.ts"}}]}}'
review='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"explorer-reviewer"}}]}}'
workflow='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Workflow","input":{"name":"explorer-review"}}]}}'
skill='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"explorer-pipeline"}}]}}'
run() { # dir -> prints the row
  METRICS_DIR="$1/metrics" sh "$HOOK" <<<"{\"transcript_path\":\"$1/session.jsonl\",\"session_id\":\"s1\"}" >/dev/null
  cat "$1/metrics/sessions.jsonl" 2>/dev/null
}
expect() { # name row jq-filter
  got=$(printf '%s' "$2" | jq -r "$3" 2>/dev/null)
  [ "$got" = "true" ] || { echo "FAIL $1 :: $3 (row: $2)"; fail=1; }
}
# (a) src edit in a subagent, no review: unreviewed, counts land
a=$work/a; mkdir -p $a/session/subagents
printf '%s\n%s\n' "$skill" "$edit_test" > $a/session.jsonl; echo "$edit_src" > $a/session/subagents/x.jsonl
row=$(run $a)
expect "a" "$row" '.srcEdits == 1 and .testEdits == 1 and .pipelineInvocations == 1 and .endedUnreviewed == true and .session == "s1" and .toolCalls == 3'
# (b) src edit then the review workflow: reviewed
b=$work/b; mkdir -p $b
printf '%s\n%s\n' "$edit_src" "$workflow" > $b/session.jsonl
row=$(run $b)
expect "b" "$row" '.reviewWorkflows == 1 and .endedUnreviewed == false'
# (c) src edit then an Agent dispatch of the reviewer: reviewed, agents counted
c=$work/c; mkdir -p $c
printf '%s\n%s\n' "$edit_src" "$review" > $c/session.jsonl
row=$(run $c)
expect "c" "$row" '.reviewerDispatches == 1 and .agents == 1 and .endedUnreviewed == false'
# (d) no src edit: a .NET test and a spec are test edits, not production ones; one row only
d=$work/d; mkdir -p $d
printf '%s\n%s\n' "$edit_test" "$edit_spec" > $d/session.jsonl
row=$(run $d)
expect "d" "$row" '.srcEdits == 0 and .testEdits == 2 and .endedUnreviewed == false'
[ "$(wc -l < $d/metrics/sessions.jsonl)" = "1" ] || { echo "FAIL d :: expected one row"; fail=1; }
# (e) missing transcript writes nothing and exits 0
e=$work/e; mkdir -p $e
METRICS_DIR="$e/metrics" sh "$HOOK" <<<'{"transcript_path":"/nowhere.jsonl"}'; rc=$?
[ $rc = 0 ] && [ ! -e $e/metrics/sessions.jsonl ] || { echo "FAIL e :: missing transcript must be silent"; fail=1; }
# (f) an Angular source edit is a production edit
f=$work/f; mkdir -p $f
echo "$edit_web" > $f/session.jsonl
row=$(run $f)
expect "f" "$row" '.srcEdits == 1 and .testEdits == 0 and .endedUnreviewed == true'
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
