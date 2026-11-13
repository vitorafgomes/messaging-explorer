#!/bin/sh
# PostToolUse hook (Edit|Write): a note when a file that judges changes was itself edited.
#
# A project file, the solution file, Directory.Build.props, Directory.Packages.props, .editorconfig,
# global.json, the Angular and TypeScript configuration and the CI workflows
# decide whether a change builds and passes. Editing one is allowed and never asks, but the reply
# must say why the task needed it, so a rule loosened to let a diff through is seen.
#
# Fails open: bad JSON or a missing jq exits 0 with no output.

jq -c '
  (.tool_input.file_path // "")
  | select(test("(^|[\\\\/])([^\\\\/]+\\.csproj|ServiceBusExplorer\\.slnx|Directory\\.(Build|Packages)\\.props|\\.editorconfig|global\\.json|angular\\.json|tsconfig[^\\\\/]*\\.json|\\.github[\\\\/]workflows[\\\\/][^\\\\/]+)$"; "i"))
  | {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "Build rules edited: this file judges changes and is not part of one. Say in your reply why the task needed this edit (a new package, a reviewed version change), and never loosen a rule to make a diff pass."
      }
    }
' 2>/dev/null

exit 0
