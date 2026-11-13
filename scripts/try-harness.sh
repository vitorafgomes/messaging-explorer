#!/usr/bin/env bash
# Tries the harness for real: copies the repo to a throwaway folder, opens short Claude Code
# sessions in it, and checks what they did against something a session cannot argue with: the log
# of instruction files that loaded, or the text a hook returned.
#
#   scripts/try-harness.sh [folder for the copy]     default: a new folder under ~/.cache
#
# Prints PASS or FAIL per check and exits 1 on any FAIL. It needs claude, jq, rsync and Docker, and
# it spends tokens: six short sessions on Sonnet. Nothing in this repository is changed; the copy
# is deleted at the end unless a folder was given.

set -u
# What this repo checks: a file of one part, its rules file, a rules file that must stay out, a
# unit test run, and the reviewing agent.
PART_FILE=src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs
PART_RULES=.claude/rules/core.md
OTHER_RULES=.claude/rules/web-app.md
LANGUAGE_RULES=.claude/rules/dotnet-skills.md
UNIT_TEST="dotnet test src/ServiceBusExplorer.Core.Tests -v q"
REVIEWER=explorer-reviewer

ROOT=$(cd "$(dirname "$0")/.." && pwd)
for tool in claude jq rsync docker; do command -v "$tool" >/dev/null || { echo "try-harness: $tool is required" >&2; exit 2; }; done
# Under the home folder, not /tmp: Docker Desktop shares only the folders it is told to, and
# scripts/in-docker.sh mounts the copy.
mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}"
TRIAL=${1:-$(mktemp -d "${XDG_CACHE_HOME:-$HOME/.cache}/try-harness.XXXXXX")}; KEEP=${1:+yes}
rsync -a --delete --exclude bin --exclude obj --exclude node_modules --exclude .git --exclude dist --exclude release "$ROOT/" "$TRIAL/" || exit 2
cd "$TRIAL" || exit 2
mkdir -p .claude/metrics; LOG=.claude/metrics/instructions.jsonl
jq '.hooks.InstructionsLoaded = [{"hooks":[{"type":"command","command":"jq -c \"{file: (.file_path // .path // .), reason: (.load_reason // .reason // null), agent: (.agent_type // null)}\" >> \"$CLAUDE_PROJECT_DIR/.claude/metrics/instructions.jsonl\""}]}]' \
  .claude/settings.json > .claude/settings.trial && mv .claude/settings.trial .claude/settings.json
git init -q -b main . && git -c user.name=trial -c user.email=trial@example.invalid -c commit.gpgsign=false commit -qam trial --allow-empty >/dev/null 2>&1; git add -A >/dev/null 2>&1

failed=0; cost=0
ask() { : > "$LOG"; claude -p "$2" --model sonnet --allowedTools "$1" --output-format json 2>/dev/null > .claude/metrics/last.json
        RESULT=$(jq -r '.result // ""' .claude/metrics/last.json); cost=$(jq -n --argjson a "$cost" --slurpfile b .claude/metrics/last.json '$a + ($b[0].total_cost_usd // 0)'); }
check() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; failed=1; fi; }
loaded() { jq -r '"\(.file) \(.reason) \(.agent // "-")"' "$LOG" 2>/dev/null; }

ask Read 'Answer with the single word READY. Do not call any tool.'
check "the root instructions load at the start, with AGENTS.md imported" 'loaded | grep -q "/CLAUDE.md session_start" && loaded | grep -q "/AGENTS.md include"'
check "no rules file loads before a file is opened"                       '! loaded | grep -q "/.claude/rules/"'

ask Read "Read lines 1-3 of $PART_FILE with the Read tool, then answer with the single word DONE."
check "opening a file of a part loads the rules of that part"             'loaded | grep -q "/$PART_RULES path_glob_match"'
check "opening a file loads the guide of its language"                    'loaded | grep -q "/$LANGUAGE_RULES path_glob_match"'
check "the rules of other parts stay out"                                 '! loaded | grep -q "/$OTHER_RULES"'

ask Bash "Use the Bash tool to run exactly this command, once: $UNIT_TEST   Then report word for word what the tool returned. Run no other command."
check "a unit test run outside the container is denied, with the command to use" 'printf "%s" "$RESULT" | grep -q "in-docker.sh"'

ask Bash "Run this exact command with the Bash tool, once, and wait for it: scripts/in-docker.sh $UNIT_TEST   Then repeat, word for word, the last line of its output that starts with Passed! or Failed!"
check "the same test run through the container is allowed and passes"   'printf "%s" "$RESULT" | grep -q "Passed!  - Failed:     0"'

ask Agent,Read "Dispatch the $REVIEWER agent with exactly this task and report its answer word for word: \"Do three things. A: read lines 1-3 of $PART_FILE with Read. B: run the Bash command \`ls\` once and report exactly what the tool returned, including any error. C: run the Bash command \`git rev-parse --is-inside-work-tree\` and report what it returned.\""
check "the rules of a part reach a subagent that opens its files"        'loaded | grep -q "/$PART_RULES path_glob_match $REVIEWER"'
check "the shell of a reviewing agent is denied anything but reading git" 'printf "%s" "$RESULT" | grep -q "This agent only reads"'
check "the reviewing agent can still read git"                           'printf "%s" "$RESULT" | grep -qi "true"'

ask Bash 'Run the Bash command `ls .claude` once and report what it returned in one line.'
check "the session itself is not bound by the rule for reviewing agents" 'printf "%s" "$RESULT" | grep -q "settings.json"'

echo "Tokens spent: about \$$(jq -n --argjson c "$cost" '$c * 100 | round / 100')"
cd / && [ -z "$KEEP" ] && rm -rf "$TRIAL"
exit $failed
