#!/bin/sh
# PostToolUse hook (Edit|Write): one-line Rule B reminder on production edits.
#   backend: src/**/*.cs outside the *.Tests projects
#   web:     web-app/src/**/*.ts that is not a spec, and web-app/electron/*.js
#
# Fails open: bad JSON or a missing jq exits 0 with no output.

jq -c '
  (.tool_input.file_path // "") as $path
  | if ($path | test("(^|[\\\\/])src[\\\\/].+\\.cs$"; "i"))
       and ($path | test("\\.Tests[\\\\/]"; "i") | not)
       and ($path | test("(^|[\\\\/])web-app[\\\\/]"; "i") | not)
    then {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "Rule B: test this edit now (xUnit + Moq, in src/ServiceBusExplorer.Core.Tests or src/ServiceBusExplorer.Api.Tests). Then the gates: dotnet build ServiceBusExplorer.slnx at 0 warnings (read the summary line; the build does not fail on a warning by itself), and the test surface from explorer-pipeline SKILL.md gate 4: a Core edit is NOT covered by one test project. Rule A: a new endpoint sits behind the X-Api-Key middleware. Rule G: a secret is masked in every response and never logged. Rule H: a bulk operation completes a message only after its send, and reports a possible duplicate."
      }
    }
    elif (($path | test("(^|[\\\\/])web-app[\\\\/]src[\\\\/].+\\.ts$"; "i")) and ($path | test("\\.spec\\.ts$"; "i") | not))
         or ($path | test("(^|[\\\\/])web-app[\\\\/]electron[\\\\/].+\\.js$"; "i"))
    then {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "Rule B (web): a spec for this edit now (*.spec.ts beside the file). Then in web-app/: npm test -- --watch=false (ng test; every spec file green, never plain npx vitest, which runs without the Angular compiler and fails on signal inputs and templateUrl) and npm run build at 0 errors. Rule A: every HTTP call goes through ApiService so it carries X-Api-Key; the API secret never reaches a log."
      }
    }
    else empty
    end
' 2>/dev/null

exit 0
