#!/usr/bin/env bash
# Case matrix for post-edit-rule-b.sh: CS = the backend reminder, WEB = the web reminder, QUIET = nothing.
HOOK="${1:-$(dirname "$0")/post-edit-rule-b.sh}"
fail=0
check() {
  want=$1; path=$2
  out=$(printf '{"tool_input":{"file_path":"%s"}}' "$path" | sh "$HOOK")
  if printf '%s' "$out" | grep -q '"Rule B (web)'; then actual=WEB
  elif printf '%s' "$out" | grep -q '"Rule B:'; then actual=CS
  else actual=QUIET; fi
  if [ "$actual" != "$want" ]; then echo "FAIL want=$want got=$actual :: $path"; fail=1; fi
}
for p in "/repo/src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs" \
         'src\\ServiceBusExplorer.Api\\Program.cs'; do check CS "$p"; done
for p in "/repo/web-app/src/app/core/services/api.service.ts" "/repo/web-app/electron/main.js" \
         "/repo/web-app/electron/preload.js"; do check WEB "$p"; done
for p in "/repo/web-app/src/app/core/services/api.service.spec.ts" \
         "/repo/src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderTests.cs" \
         "/repo/src/ServiceBusExplorer.Api.Tests/CorsTests.cs" \
         "/repo/web-app/src/app/app.html" "/repo/web-app/scripts/generate-icons.js" \
         "/repo/context/log.md" "/repo/.claude/hooks/post-edit-rule-b.sh" "/repo/web-app/angular.json" ""; do check QUIET "$p"; done
# The backend reminder names the gates it exists for.
out=$(printf '{"tool_input":{"file_path":"/repo/src/ServiceBusExplorer.Api/Program.cs"}}' | sh "$HOOK")
for needle in "0 warnings" "gate 4" "Rule A" "Rule G" "Rule H"; do
  printf '%s' "$out" | grep -q "$needle" || { echo "FAIL backend reminder lacks: $needle"; fail=1; }
done
printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "PostToolUse"' >/dev/null || { echo "FAIL output is not the PostToolUse shape"; fail=1; }
# The web reminder names the right runner, the trap this repo has: plain vitest lacks the Angular compiler.
out=$(printf '{"tool_input":{"file_path":"/repo/web-app/src/app/app.ts"}}' | sh "$HOOK")
printf '%s' "$out" | grep -q "npm test -- --watch=false" || { echo "FAIL web reminder lacks: npm test -- --watch=false"; fail=1; }
# Bad input fails open: nothing written, exit 0.
out=$(printf 'not json' | sh "$HOOK"); rc=$?
if [ -n "$out" ] || [ "$rc" != "0" ]; then echo "FAIL bad input must be silent and exit 0"; fail=1; fi
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
