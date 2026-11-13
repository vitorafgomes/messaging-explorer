#!/bin/sh
# check-diagnostics.sh: rebuild with every analyzer reporting, list what is left and fail on it.
#
#   tools/checks/check-diagnostics.sh [TARGET] [THRESHOLD] [CONFIGURATION]
#
#   TARGET         .csproj, .sln or .slnx to rebuild, ServiceBusExplorer.slnx by default; a single project is much faster.
#                  A lone "-" reads a build log from standard input and builds nothing.
#   THRESHOLD      info, warning or error: the mildest severity that fails the check, info by default.
#   CONFIGURATION  build configuration, Debug by default.
#
# Test projects write no documentation file, and without one the compiler never reports an unused using;
# an info-level finding never breaks a build either. The rebuild turns both on so nothing hides.

set -uf

target=${1:-ServiceBusExplorer.slnx}
threshold=${2:-info}
configuration=${3:-Debug}

say() { printf 'check-diagnostics: %s\n' "$*"; }
complain() { say "$@" >&2; }

case $threshold in
  info | warning | error) ;;
  *) complain "THRESHOLD is info, warning or error, not '$threshold'"; exit 2 ;;
esac

scratch=$(mktemp -d "${TMPDIR:-/tmp}/check-diagnostics.XXXXXX") || exit 2
trap 'rm -rf "$scratch"' EXIT
trap 'exit 2' INT TERM
log=$scratch/build.log
found=$scratch/found

capture_log() {
  if [ "$target" = - ]; then
    cat >"$log"
    return 0
  fi
  if ! command -v dotnet >/dev/null 2>&1; then
    complain 'the dotnet CLI is not on PATH'
    exit 2
  fi
  say "rebuilding $target ($configuration) with the documentation file and code-style analysis on; this is slow"
  MSBUILDDISABLENODEREUSE=1 dotnet build "$target" --no-incremental --verbosity detailed \
    --configuration "$configuration" --nologo \
    -p:UseSharedCompilation=false -p:EnforceCodeStyleInBuild=true \
    -p:GenerateDocumentationFile=true -p:NoWarn=CS1591 >"$log" 2>&1
}

records() {
  LC_ALL=C sed -n -E \
    -e 's/^(.*[[:space:]/\\])?([^[:space:]/\\]+)[[:space:]]*\(([0-9]+),[0-9]+\):[[:space:]]+((error|warning|message|info)[[:space:]]*)?([A-Z][A-Z]+[0-9]{3,}).*$/\6 \5 \2 \3/p' \
    -e t \
    -e 's/^(.*[[:space:]/\\])?([^[:space:]/\\]+)[[:space:]]+:[[:space:]]+(error|warning|message|info)[[:space:]]+([A-Z][A-Z]+[0-9]{3,}):.*$/\4 \3 \2 -/p' \
    "$log" |
    LC_ALL=C sed -E 's/^([^ ]+) (message|info|) /\1 info /'
}

first_sighting_only() {
  awk '!seen[$1 " " $3 " " $4]++'
}

worst_of() {
  if grep -q "^$1 error " "$found"; then
    echo error
  elif grep -q "^$1 warning " "$found"; then
    echo warning
  else
    echo info
  fi
}

report_by_code() {
  cut -d' ' -f1 "$found" | LC_ALL=C sort -u | while read -r code; do
    seen=$(grep -c "^$code " "$found")
    set -- $(grep "^$code " "$found" | head -n 1)
    if [ "$4" = - ]; then where="$3, no line"; else where="$3:$4"; fi
    printf '  %s %s, %s occurrence(s), first in %s\n' "$code" "$(worst_of "$code")" "$seen" "$where"
  done
}

at_or_above_threshold() {
  case $threshold in
    error) grep -c '^[^ ]* error ' "$found" ;;
    warning) grep -c -E '^[^ ]* (error|warning) ' "$found" ;;
    *) grep -c . "$found" ;;
  esac
}

capture_log
build_status=$?

records | first_sighting_only >"$found"

if [ -s "$found" ]; then
  say "$(grep -c . "$found") distinct diagnostic(s), by code:"
  report_by_code
  over=$(at_or_above_threshold)
  if [ "$over" -gt 0 ]; then
    say "$over of them at $threshold or above, so the check fails"
    exit 1
  fi
else
  say 'the build log holds no compiler or analyzer diagnostic at any severity'
fi

if [ "$build_status" -ne 0 ]; then
  complain "dotnet build exited with $build_status and left nothing at $threshold or above to explain it; the end of its log:"
  tail -n 20 "$log" >&2
  exit 1
fi

exit 0
