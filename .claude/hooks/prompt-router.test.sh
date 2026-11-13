#!/usr/bin/env bash
# Case matrix for prompt-router.sh: the router answers on every prompt with the pipeline pointer, and
# stays silent (exit 0) when jq is missing.
HOOK="${1:-$(dirname "$0")/prompt-router.sh}"
fail=0
out=$(printf '{"prompt":"fix the seat limit"}' | sh "$HOOK"); rc=$?
[ "$rc" = "0" ] || { echo "FAIL exit $rc on a normal prompt"; fail=1; }
printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "UserPromptSubmit"' >/dev/null || { echo "FAIL output is not the UserPromptSubmit shape"; fail=1; }
for needle in "explorer-pipeline" "fast path" "message operation" "skill"; do
  printf '%s' "$out" | grep -q "$needle" || { echo "FAIL router lacks: $needle"; fail=1; }
done
# Injected on every prompt, so it stays short: one line, under 320 characters of context.
len=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext | length')
[ "$len" -lt 320 ] || { echo "FAIL router context is $len chars; it is a router, not a rulebook"; fail=1; }
# Bad input is drained, the router still answers.
out=$(printf 'not json' | sh "$HOOK"); rc=$?
[ "$rc" = "0" ] && printf '%s' "$out" | grep -q "explorer-pipeline" || { echo "FAIL bad input must still route (exit $rc)"; fail=1; }
# Without jq on PATH: silent, exit 0.
out=$(printf '{}' | PATH=/nonexistent /bin/sh "$HOOK" 2>/dev/null); rc=$?
if [ -n "$out" ] || [ "$rc" != "0" ]; then echo "FAIL missing jq must be silent and exit 0 (got rc=$rc)"; fail=1; fi
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
