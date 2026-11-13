#!/usr/bin/env bash
# Case matrix for post-edit-oracle-note.sh: NOTE = must emit the oracle note, QUIET = must emit nothing.
HOOK="${1:-$(dirname "$0")/post-edit-oracle-note.sh}"
fail=0
check() {
  want=$1; path=$2
  got=$(printf '{"tool_input":{"file_path":"%s"}}' "$path" | sh "$HOOK" | grep -c "Held-out oracle")
  [ "$got" = "1" ] && actual=NOTE || actual=QUIET
  if [ "$actual" != "$want" ]; then echo "FAIL want=$want got=$actual :: $path"; fail=1; fi
}
for p in "/repo/Directory.Build.props" "Directory.Packages.props" "/repo/.editorconfig" "/repo/global.json" \
         "/repo/.github/workflows/ci.yml" "/repo/web-app/angular.json" "/repo/web-app/tsconfig.json" \
         "/repo/web-app/tsconfig.spec.json"; do check NOTE "$p"; done
for p in "/repo/src/ServiceBusExplorer.Api/Program.cs" "/repo/src/ServiceBusExplorer.Api.Tests/CorsTests.cs" \
         "/repo/context/pages/services/api.md" "/repo/web-app/package.json" "/repo/.github/PULL_REQUEST_TEMPLATE.md" \
         "/repo/web-app/src/angular.json.bak" "/repo/config.json" ""; do check QUIET "$p"; done
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
