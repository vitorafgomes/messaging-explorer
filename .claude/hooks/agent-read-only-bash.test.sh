#!/usr/bin/env bash
# Case matrix for agent-read-only-bash.sh: DENY = must refuse, PASS = must emit nothing.
HOOK="${1:-$(dirname "$0")/agent-read-only-bash.sh}"
fail=0
check() {
  want=$1; cmd=$2
  out=$(jq -nc --arg c "$cmd" --arg a "${AGENT-explorer-reviewer}" '{agent_type:$a, tool_input:{command:$c}}' | sh "$HOOK")
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then actual=DENY; else actual=PASS; fi
  [ "$actual" = "$want" ] || { echo "FAIL want=$want got=$actual :: $cmd"; fail=1; }
}
while IFS= read -r c; do [ -n "$c" ] && check PASS "$c"; done <<'CASES'
git diff HEAD
git status --porcelain
git log --oneline -5
git show HEAD:src/ServiceBusExplorer.Core/ProviderFactory.cs
git diff HEAD --stat && git status --porcelain
git --no-pager diff HEAD
git merge-base HEAD origin/main
git grep -n IChatGateway
CASES
while IFS= read -r c; do [ -n "$c" ] && check DENY "$c"; done <<'CASES'
rm -rf src
git checkout -- .
git commit -m x
git stash
git diff HEAD > /tmp/x.patch
git status; rm notes.md
dotnet test
cat src/ServiceBusExplorer.Core/ProviderFactory.cs
sed -i s/a/b/ file.cs
git diff HEAD && git reset --hard
curl https://example.com
CASES
AGENT=explorer-optimizer check DENY "rm -rf src"
# The rule is for the reviewing agents only: the session and the implementer are not bound by it.
AGENT=explorer-implementer check PASS "dotnet build ServiceBusExplorer.slnx"
AGENT= check PASS "ls"
out=$(printf 'not json' | sh "$HOOK"; echo "rc=$?"); [ "$out" = "rc=0" ] || { echo "FAIL bad input must exit 0 with no output :: $out"; fail=1; }
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
