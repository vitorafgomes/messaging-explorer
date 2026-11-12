#!/usr/bin/env bash
# Case matrix for session-start.sh: WARN = must emit the named dead-hooks message, QUIET = must emit nothing.
HOOK="${1:-$(dirname "$0")/session-start.sh}"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
check() {
  want=$1; name=$2; expect=$3; shift 3
  got=$(printf '{}' | env "$@" sh "$HOOK" | grep -c "$expect")
  [ "$got" = "1" ] && actual=WARN || actual=QUIET
  if [ "$actual" != "$want" ]; then echo "FAIL want=$want got=$actual :: $name"; fail=1; fi
}
# (a) the real guard, jq present
check QUIET "real guard answers" systemMessage PATH="$PATH"
# (b) a guard that never answers
printf '#!/bin/sh\nexit 0\n' > "$work/mute.sh"
check WARN "mute guard" "did not answer" PRE_GIT_GUARD="$work/mute.sh"
# (c) jq missing: PATH holds only a directory with sh and no jq
mkdir -p "$work/bin"; ln -s "$(command -v sh)" "$work/bin/sh"; ln -s "$(command -v dirname)" "$work/bin/dirname"
check WARN "jq missing" "jq is not on PATH" PATH="$work/bin"
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
