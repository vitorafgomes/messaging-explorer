#!/bin/sh
# PostToolUse hook (Edit|Write): note when a held-out oracle was edited.
#
# The files that decide what the build and the tests check (the CI workflows, the Angular
# workspace file, the TypeScript configs, and the .NET strictness files once they exist) grade a change; they
# are not part of it. Editing them never asks, but the agent must say in its reply why the task
# required it, so a rule bent to pass a diff is visible.
#
# Fails open: bad JSON or a missing jq exits 0 with no output.

jq -c '
  (.tool_input.file_path // "") as $path
  | if ($path | test("(^|[\\\\/])(Directory\\.Build\\.props|Directory\\.Packages\\.props|\\.editorconfig|global\\.json|\\.github[\\\\/]workflows[\\\\/][^\\\\/]+|web-app[\\\\/]angular\\.json|web-app[\\\\/]tsconfig[^\\\\/]*\\.json)$"; "i"))
    then {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "Held-out oracle edited: .github/workflows/**, web-app/angular.json, web-app/tsconfig*.json, Directory.Build.props, Directory.Packages.props, .editorconfig and global.json grade the change, they are not part of it. State in your reply why this task required editing this file (a new build target, a reviewed package bump) and never weaken a rule or narrow what the tests cover to make a diff pass."
      }
    }
    else empty
    end
' 2>/dev/null

exit 0
