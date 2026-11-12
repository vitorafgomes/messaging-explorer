#!/bin/sh
# SessionStart hook: prove the hook runtime works, loudly.
#
# Every other hook fails open, so a missing jq is indistinguishable from a hook with nothing to
# say. This one runs the Rule E guard on a must-ask command and warns when the answer is not
# "ask". It depends on nothing but sh.

cat >/dev/null 2>&1

DIR="$(dirname "$0")"
GUARD="${PRE_GIT_GUARD:-$DIR/pre-git-guard.sh}"

if ! command -v jq >/dev/null 2>&1; then
  printf '%s' '{"systemMessage":"Messaging Explorer hooks are DEAD on this machine: jq is not on PATH. The Rule E git guard, the Rule B reminder, the oracle note and the gate 6 Stop check are all silent. Install jq and restart."}'
  exit 0
fi

OUT=$(printf '%s' '{"tool_input":{"command":"git commit -m x"}}' | sh "$GUARD" 2>/dev/null)
case "$OUT" in
  *permissionDecision*) ;;
  *) printf '%s' '{"systemMessage":"Messaging Explorer hooks are DEAD on this machine: pre-git-guard.sh did not answer on a must-ask command. Run bash .claude/hooks/pre-git-guard.test.sh and fix before trusting any gate."}' ;;
esac

exit 0
