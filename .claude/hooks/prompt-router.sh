#!/bin/sh
# UserPromptSubmit hook: inject the pipeline router + skill-selection announcement on every prompt.
#
# Injected on every prompt, so every character is paid for on every message: it is a pointer to
# the skill, not a copy of it. The last sentence is there because skill matching is otherwise
# silent, and a skill that never fires looks the same as one that does not exist.
#
# Fails open: any error exits 0 having written nothing, so a broken hook can never block a prompt.

cat >/dev/null 2>&1   # drain stdin so the caller never sees EPIPE

command -v jq >/dev/null 2>&1 || exit 0

jq -nc '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: "Explorer: for a code task (fix, feature, refactor, diagnosis), use the explorer-pipeline skill before the first edit; a one-line edit takes its fast path, and a change to the API surface, a secret or a message operation never does. Say which installed skills apply and which you use."
  }
}' 2>/dev/null

exit 0
