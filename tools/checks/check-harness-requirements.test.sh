#!/usr/bin/env bash
# Case matrix for check-harness-requirements.sh against a copy of the real documents.
SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-harness-requirements.sh"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
copy() { rm -rf "$work/repo"; mkdir -p "$work/repo"; (cd "$ROOT" && tar cf - AGENTS.md CLAUDE.md .claude/agents .claude/skills/explorer-pipeline) | tar xf - -C "$work/repo"; }
run() { want=$1; name=$2; expect=${3:-}
  out=$(bash "$SCRIPT" "$work/repo" 2>&1); rc=$?
  [ "$rc" = 0 ] && actual=PASS || actual=FAIL
  [ "$actual" = "$want" ] || { echo "FAIL want=$want got=$actual :: $name"; echo "$out" | sed 's/^/    /'; fail=1; }
  [ -z "$expect" ] || printf '%s' "$out" | grep -qF -- "$expect" || { echo "FAIL output lacks '$expect' :: $name"; fail=1; }
}
copy; run PASS "the real documents state every requirement"
copy; sed -i 's/never a push to `main`/a push to `main` when needed/' "$work/repo/AGENTS.md"
run FAIL "a dropped rule is reported with its document" "MISSING  AGENTS.md: never a push to main"
copy; perl -0pi -e 's/no commit, push, pull request,\s+release, publish or merge/no commit, push, pull request,\n**release**, publish or merge/i' "$work/repo/AGENTS.md"
run PASS "a re-wrap or a bold word is not a removal"
copy; rm "$work/repo/.claude/agents/explorer-reviewer.md"
run FAIL "a deleted document is reported" "MISSING-FILE  .claude/agents/explorer-reviewer.md"
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
