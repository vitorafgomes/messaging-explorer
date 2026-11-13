#!/bin/sh
# PostToolUse hook (Edit|Write): one short reminder after an edit to src/**/*.cs or to the web
# app's TypeScript, naming the test that edit owes and the checks before a report.
#
# It fires on every such edit, so it is kept to two sentences; the pipeline skill has the detail.
#
# Fails open: bad JSON or a missing jq exits 0 with no output.

jq -c '
  (.tool_input.file_path // "") as $path
  | if ($path | test("(^|[\\\\/])src[\\\\/].+\\.cs$"; "i")) and ($path | test("Tests[\\\\/]") | not)
    then "Edited code: write or run its test now (xUnit), through tools/checks/in-docker.sh. Before you report: build with 0 warnings on the summary line, and both unit projects when the core changed. A change to the API surface, a secret or a message operation is never a fast path."
    elif ($path | test("(^|[\\\\/])web-app[\\\\/](src|electron)[\\\\/].+\\.(ts|mts|js)$"; "i") and ($path | test("\\.(spec|test)\\.(ts|mts|js)$"; "i") | not))
    then "Edited web code: write or run its spec now. Before you report, in web-app/: the tests through tools/checks/in-docker.sh npm test -- --watch=false, and npm run build. An HTTP call goes through ApiService."
    else empty
    end
  | { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: . } }
' 2>/dev/null

exit 0
