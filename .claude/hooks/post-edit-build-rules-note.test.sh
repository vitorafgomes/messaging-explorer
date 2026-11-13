#!/usr/bin/env bash
# Case matrix for post-edit-build-rules-note.sh: NOTE = must emit the note, QUIET = must emit nothing.
HOOK="${1:-$(dirname "$0")/post-edit-build-rules-note.sh}"
fail=0
check() {
  want=$1; path=$2
  got=$(printf '{"tool_input":{"file_path":"%s"}}' "$path" | sh "$HOOK" | grep -c "Build rules edited")
  [ "$got" = "1" ] && actual=NOTE || actual=QUIET
  if [ "$actual" != "$want" ]; then echo "FAIL want=$want got=$actual :: $path"; fail=1; fi
}
for p in "/repo/src/ServiceBusExplorer.Api/ServiceBusExplorer.Api.csproj" "/repo/ServiceBusExplorer.slnx" "/repo/web-app/angular.json" \
         "/repo/web-app/tsconfig.app.json" "/repo/.github/workflows/ci.yml" \
         "/repo/Directory.Build.props" "/repo/Directory.Packages.props" "/repo/.editorconfig" "/repo/global.json"; do check NOTE "$p"; done
for p in "/repo/src/ServiceBusExplorer.Api/Program.cs" "/repo/web-app/src/app/app.component.ts" "/repo/vault/log.md" \
         "/repo/web-app/package.json" "/repo/.github/PULL_REQUEST_TEMPLATE.md" ""; do check QUIET "$p"; done
out=$(printf 'not json' | sh "$HOOK"; echo "rc=$?")
[ "$out" = "rc=0" ] || { echo "FAIL bad input must be silent and exit 0 :: $out"; fail=1; }
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
