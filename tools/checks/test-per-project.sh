#!/usr/bin/env bash
# Run every unit test project (src/*.Tests) one at a time and fail when any project fails, skips a test,
# or runs nothing at all. A solution-wide `dotnet test` reports one green total, which has hidden a
# project that did not compile and a suite that was skipped entirely; the pipeline asks for
# `N passed` per project and a Skipped count of 0, and this script is that gate in one command.
#
# ServiceBusExplorer.IntegrationTests is not one of them: it starts brokers through Testcontainers,
# needs the Docker daemon the container does not have, and runs on the machine when broker code changes.
#
# Usage: tools/checks/test-per-project.sh [extra dotnet test args, e.g. --configuration Release --no-build]
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
export MSBUILDDISABLENODEREUSE=1
fail=0
projects=0
while IFS= read -r -d '' project; do
  projects=$((projects+1))
  name=$(basename "$project" .csproj)
  out=$(dotnet test "$project" "$@" 2>&1); rc=$?
  summary=$(printf '%s\n' "$out" | grep -E '^(Passed|Failed)!.*Total:' | tail -n 1)
  if [ -z "$summary" ]; then
    printf '%s\n' "$out" | tail -n 20
    echo "DID-NOT-RUN  $name (exit $rc, no test summary line)"; fail=1; continue
  fi
  passed=$(printf '%s' "$summary" | sed -E 's/.*Passed:[[:space:]]*([0-9]+).*/\1/')
  failed=$(printf '%s' "$summary" | sed -E 's/.*Failed:[[:space:]]*([0-9]+).*/\1/')
  skipped=$(printf '%s' "$summary" | sed -E 's/.*Skipped:[[:space:]]*([0-9]+).*/\1/')
  for n in "$passed" "$failed" "$skipped"; do
    [[ "$n" =~ ^[0-9]+$ ]] || { echo "PARSE-ERROR   $name: unexpected summary line: $summary"; fail=1; continue 2; }
  done
  verdict=PASS
  if [ "$rc" != "0" ] || [ "$failed" != "0" ]; then verdict=FAIL; fail=1; printf '%s\n' "$out" | grep -E '^\s+(Failed|Error Message|Stack Trace|at )|\[FAIL\]' | head -n 60; fi
  if [ "$skipped" != "0" ]; then verdict=FAIL; fail=1; echo "  a skipped test reports green while executing nothing"; fi
  if [ "$passed" = "0" ]; then verdict=DID-NOT-RUN; fail=1; fi
  printf '%-12s %s  passed=%s failed=%s skipped=%s\n' "$verdict" "$name" "$passed" "$failed" "$skipped"
done < <(find "$root/src" -name '*.Tests.csproj' -not -path '*/obj/*' -not -path '*/bin/*' -print0 2>/dev/null | sort -z)
if [ "$projects" = "0" ]; then echo "DID-NOT-RUN  no test project found under $root/src"; fail=1; fi
exit $fail
