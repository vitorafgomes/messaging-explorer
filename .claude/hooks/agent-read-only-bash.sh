#!/bin/sh
# PreToolUse hook (Bash): for the reviewing agents, the shell is for reading git and for nothing
# else. It is registered in settings.json like every other hook and acts only when the call comes
# from explorer-reviewer or explorer-optimizer (the agent_type field of the hook input). A hook listed
# in an agent file's own frontmatter did not fire when it was tried here.
#
# Every part of the command must be a git command that only reads (diff, status, log, show,
# merge-base, rev-parse, ls-files, blame, grep). Anything else is denied, and so is any part that
# redirects output into a file. The agents read files with Read, Grep and Glob.
#
# Fails closed on a command it cannot parse, open on a missing jq or bad JSON (exit 0, no output),
# like the other hooks; session-start.sh reports a missing jq.

jq -c '
  select((.agent_type // "") | test("^explorer-(reviewer|optimizer)$"))
  | (.tool_input.command // "") as $cmd
  | [$cmd | splits("[;&|\\n]+") | select(test("\\S"))]
  | map(select((test("^\\s*git\\s+(?:--no-pager\\s+)?(?:diff|status|log|show|merge-base|rev-parse|ls-files|blame|grep)\\b") | not) or test(">")))
  | if length > 0 or ($cmd | test("\\S") | not) then {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "This agent only reads. The shell is for git diff, status, log, show, merge-base, rev-parse, ls-files, blame and grep; read files with Read, Grep and Glob."
      }
    } else empty end
' 2>/dev/null

exit 0
