#!/usr/bin/env bash
# Case matrix for stop-review-gate.sh: WARN = must emit the gate 6 block, QUIET = must emit nothing.
HOOK="${1:-$(dirname "$0")/stop-review-gate.sh}"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
edit() { printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"%s"}}]}}' "$1"; }
edit_src=$(edit /repo/src/ServiceBusExplorer.Core/Providers/ProviderFactory.cs)
edit_web=$(edit /repo/web-app/src/app/core/services/api.service.ts)
edit_electron=$(edit /repo/web-app/electron/main.js)
edit_test=$(edit /repo/src/ServiceBusExplorer.Core.Tests/Providers/RabbitMQSessionTests.cs)
edit_spec=$(edit /repo/web-app/src/app/core/services/queue.service.spec.ts)
edit_doc=$(edit /repo/vault/log.md)
review='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"explorer-reviewer"}}]}}'
workflow='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Workflow","input":{"name":"explorer-review","args":{"module":"ServiceBusExplorer.Core"}}}]}}'
check() {
  want=$1; name=$2; dir=$3; extra=${4:-}
  got=$(printf '{"transcript_path":"%s"%s}' "$dir/session.jsonl" "$extra" | sh "$HOOK" | grep -c '"decision": "block"')
  [ "$got" = "1" ] && actual=WARN || actual=QUIET
  if [ "$actual" != "$want" ]; then echo "FAIL want=$want got=$actual :: $name"; fail=1; fi
}
# Real layout: <project>/<session>.jsonl with subagents under <project>/<session>/subagents/.
# (a) src edit only inside a subagent transcript, no reviewer
a=$work/a; mkdir -p $a/session/subagents
echo "$edit_doc" > $a/session.jsonl; echo "$edit_src" > $a/session/subagents/agent-1.jsonl
check WARN "subagent edited src, no reviewer" $a
# (b) same, plus a reviewer dispatch in the main transcript
b=$work/b; mkdir -p $b/session/subagents
printf '%s\n%s\n' "$edit_doc" "$review" > $b/session.jsonl; echo "$edit_src" > $b/session/subagents/agent-1.jsonl
check QUIET "subagent edited src, reviewer dispatched by main" $b
# (c) no production edit anywhere: docs, a .NET test and a spec only
c=$work/c; mkdir -p $c/session/subagents
printf '%s\n%s\n' "$edit_doc" "$edit_test" > $c/session.jsonl; echo "$edit_spec" > $c/session/subagents/agent-1.jsonl
check QUIET "only docs, a test project file and a spec" $c
# (d) reviewer only inside a subagent transcript does not count
d=$work/d; mkdir -p $d/session/subagents
echo "$edit_src" > $d/session.jsonl; printf '%s\n' "$review" > $d/session/subagents/agent-1.jsonl
check WARN "main edited src, reviewer only in a subagent" $d
# (e) main edited src, no subagents directory
e=$work/e; mkdir -p $e
echo "$edit_src" > $e/session.jsonl
check WARN "main edited src, no subagents dir" $e
# (f) main edited src, reviewed through the explorer-review Workflow
f=$work/f; mkdir -p $f
printf '%s\n%s\n' "$edit_src" "$workflow" > $f/session.jsonl
check QUIET "main edited src, explorer-review workflow ran" $f
# (g) same as (e) but on the continuation after a block: stop_hook_active passes, no loop
check QUIET "main edited src, stop_hook_active set" $e ',"stop_hook_active":true'
# (h) an Angular source edit counts
h=$work/h; mkdir -p $h
echo "$edit_web" > $h/session.jsonl
check WARN "main edited web-app/src ts" $h
# (i) an Electron main-process edit counts
i=$work/i; mkdir -p $i
echo "$edit_electron" > $i/session.jsonl
check WARN "main edited web-app/electron js" $i
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
