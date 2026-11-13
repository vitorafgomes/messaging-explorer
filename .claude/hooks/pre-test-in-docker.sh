#!/bin/sh
# PreToolUse hook (Bash): tests run in the project's container, never on this machine.
#
# A command that starts a unit or web test run directly (dotnet test, npm test, ng test, vitest,
# the Electron tests) is denied, and the reason names the same command routed through
# in-docker.sh. A command already routed through in-docker.sh passes. So does a dotnet test that
# names the integration project: it starts brokers in Docker, which the container does not have.
# Each part of a compound command is judged on its own, so `cd web-app && npm test` is caught too.
#
# Fails open: bad JSON or a missing jq exits 0 with no output, like every other hook here;
# session-start.sh is the one that says so out loud.

jq -c '
  "^\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*(?:(?:time|command|exec|nohup|rtk\\s+proxy)\\s+)*" as $lead
  | ("(?:dotnet\\s+test\\b|npm\\s+(?:run\\s+)?test(?:[:\\s]|$)|(?:npx\\s+)?ng\\s+test\\b|(?:npx\\s+)?vitest\\b)") as $runner
  | (.tool_input.command // "") as $cmd
  | [$cmd | splits("[;&|\\n]+")]
  | map(select(test($lead + $runner; "i") and (test("in-docker\\.sh") | not) and (test("dotnet\\s+test\\b.*IntegrationTests") | not)))
  | if length > 0 then {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: ("Tests run in the container, not on this machine. Run it as: scripts/in-docker.sh " + (.[0] | sub("^\\s+"; "") | sub("\\s+$"; "")))
      }
    } else empty end
' 2>/dev/null

exit 0
