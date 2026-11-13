#!/usr/bin/env bash
# Case matrix for post-edit-test-reminder.sh: CS = the backend reminder, WEB = the web reminder, QUIET = nothing.
HOOK="${1:-$(dirname "$0")/post-edit-test-reminder.sh}"
fail=0
check() {
  want=$1; path=$2
  out=$(printf '{"tool_input":{"file_path":"%s"}}' "$path" | sh "$HOOK")
  if printf '%s' "$out" | grep -q '"Edited web code'; then actual=WEB
  elif printf '%s' "$out" | grep -q '"Edited code'; then actual=CS
  else actual=QUIET; fi
  if [ "$actual" != "$want" ]; then echo "FAIL want=$want got=$actual :: $path"; fail=1; fi
}
for p in "/repo/src/ServiceBusExplorer.Core/ProviderFactory.cs" "/repo/src/ServiceBusExplorer.Api/Program.cs"; do check CS "$p"; done
for p in "/repo/web-app/src/app/core/api.service.ts" "/repo/web-app/electron/main.js"; do check WEB "$p"; done
for p in "/repo/src/ServiceBusExplorer.Core.Tests/ProviderFactoryTests.cs" "/repo/web-app/src/app/core/api.service.spec.ts" \
         "/repo/web-app/electron/main.test.js" "/repo/web-app/src/app/app.component.html" "/repo/vault/log.md" \
         "/repo/docs/app.js" ""; do check QUIET "$p"; done
out=$(printf '{"tool_input":{"file_path":"/repo/src/ServiceBusExplorer.Api/Program.cs"}}' | sh "$HOOK")
for needle in "in-docker.sh" "0 warnings" "never a fast path"; do
  printf '%s' "$out" | grep -q "$needle" || { echo "FAIL backend reminder lacks: $needle"; fail=1; }
done
len=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext | length')
[ "$len" -lt 340 ] || { echo "FAIL the reminder is $len chars; it fires on every edit"; fail=1; }
out=$(printf 'not json' | sh "$HOOK"); rc=$?
if [ -n "$out" ] || [ "$rc" != "0" ]; then echo "FAIL bad input must be silent and exit 0"; fail=1; fi
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
