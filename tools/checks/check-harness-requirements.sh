#!/usr/bin/env bash
# Fails when a harness document no longer states a requirement it carries. A rewrite of these
# documents may reword a sentence; it may not drop what the sentence asks. Each row below names the
# document and one phrase of it; the match ignores case, Markdown emphasis, code marks and line wraps.
#
# Usage: tools/checks/check-harness-requirements.sh [repo root]   exits 1 on any missing phrase.
set -uo pipefail
root="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"

requirements=$(cat <<'ROWS'
AGENTS.md|git belongs to the owner. no commit, push, pull request, release, publish or merge unless the owner asks for that action
AGENTS.md|never a push to main
AGENTS.md|never carry a line that credits an ai tool
AGENTS.md|documentation lives in context/, in english, with no emojis
AGENTS.md|a change ships with its test. the test fails without the change
AGENTS.md|secrets are masked and never logged
AGENTS.md|operations are at-least-once, and the ui says so
AGENTS.md|x-api-key, compared in fixed time
AGENTS.md|unit and web tests run in the project's container, never directly on the machine
CLAUDE.md|use the explorer-pipeline skill first, for every code task
CLAUDE.md|read the page the rules file names for the change before the source
.claude/skills/explorer-pipeline/SKILL.md|the test fails on one targeted mutation
.claude/skills/explorer-pipeline/SKILL.md|the test is green before and after
.claude/skills/explorer-pipeline/SKILL.md|with a count per project and 0 skipped
.claude/skills/explorer-pipeline/SKILL.md|tools/checks/check-diagnostics.sh <touched .csproj>, clean
.claude/skills/explorer-pipeline/SKILL.md|it blocks like a confirmed one until you have
.claude/skills/explorer-pipeline/SKILL.md|a third means the change is not understood: stop and hand the rest to the owner
.claude/agents/explorer-implementer.md|you run no git commit, no git push and no other command that writes history
.claude/agents/explorer-implementer.md|git checkout erases uncommitted work
.claude/agents/explorer-reviewer.md|a row with no proof is a p1 finding
.claude/agents/explorer-reviewer.md|a finding you could not locate is located: false, never refuted
.claude/skills/explorer-pipeline/reference/records.md|review: applied n, rejected m
ROWS
)

normalized() { tr -d '*`' < "$1" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' '; }

fail=0; rows=0
while IFS='|' read -r doc phrase; do
  [ -z "$doc" ] && continue
  rows=$((rows+1))
  if [ ! -f "$root/$doc" ]; then echo "MISSING-FILE  $doc"; fail=1; continue; fi
  normalized "$root/$doc" | grep -qF -- "$phrase" || { echo "MISSING  $doc: $phrase"; fail=1; }
done <<< "$requirements"
[ "$fail" = 0 ] && echo "$rows harness requirements still stated."
exit $fail
