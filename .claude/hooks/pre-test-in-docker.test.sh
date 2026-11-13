#!/usr/bin/env bash
# Case matrix for pre-test-in-docker.sh: DENY = must refuse and name in-docker.sh, PASS = must emit nothing.
HOOK="${1:-$(dirname "$0")/pre-test-in-docker.sh}"
fail=0
check() {
  want=$1; cmd=$2
  out=$(jq -nc --arg c "$cmd" '{tool_input:{command:$c}}' | sh "$HOOK")
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then actual=DENY; else actual=PASS; fi
  [ "$actual" = "$want" ] || { echo "FAIL want=$want got=$actual :: $cmd"; fail=1; }
}
while IFS= read -r c; do [ -n "$c" ] && check DENY "$c"; done <<'CASES'
dotnet test
dotnet test src/ServiceBusExplorer.Core.Tests --no-build
DOTNET_NOLOGO=1 dotnet test src/ServiceBusExplorer.Api.Tests
cd web-app && npm test -- --watch=false
npm test
npm run test
npm run test:electron
ng test
npx ng test
npx vitest run
dotnet build ServiceBusExplorer.slnx && dotnet test src/ServiceBusExplorer.Api.Tests
rtk proxy dotnet test src/ServiceBusExplorer.Core.Tests
tools/checks/in-docker.sh dotnet build ServiceBusExplorer.slnx; dotnet test
CASES
while IFS= read -r c; do [ -n "$c" ] && check PASS "$c"; done <<'CASES'
tools/checks/in-docker.sh dotnet test src/ServiceBusExplorer.Core.Tests
cd web-app && ../tools/checks/in-docker.sh npm test -- --watch=false
dotnet test src/ServiceBusExplorer.IntegrationTests
dotnet test src/ServiceBusExplorer.IntegrationTests --filter "FullyQualifiedName~Peek"
dotnet build ServiceBusExplorer.slnx
npm run build
npm ci
git status
grep -rn "dotnet test" docs
echo "run npm test in the container"
bash tools/checks/check-hidden-text.test.sh
CASES
reason=$(jq -nc '{tool_input:{command:"cd web-app && npm test -- --watch=false"}}' | sh "$HOOK" | jq -r '.hookSpecificOutput.permissionDecisionReason')
[ "$reason" = "Tests run in the container, not on this machine. Run it as: tools/checks/in-docker.sh npm test -- --watch=false" ] || { echo "FAIL the reason must name the command to run instead :: $reason"; fail=1; }
out=$(printf 'not json' | sh "$HOOK"; echo "rc=$?"); [ "$out" = "rc=0" ] || { echo "FAIL bad input must be silent and exit 0 :: $out"; fail=1; }
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
