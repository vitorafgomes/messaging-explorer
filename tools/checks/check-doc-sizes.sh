#!/bin/sh
# Keeps the documents a model reads from growing back.
#
#   tools/checks/check-doc-sizes.sh [repo root]
#
# Each kind of document has a ceiling in characters. A file over its ceiling fails the check,
# unless it is listed in doc-size-baseline.txt beside this script with the size it had when it
# was listed: then it fails only if it grew. The baseline is the list of debts; it only gets
# shorter. A line of it reads: <characters> <path>.
#
# Prints one line per failure and exits 1 on any, 0 on none, 2 when it finds nothing to check.

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=${1:-$(cd "$HERE/../.." && pwd)}
BASELINE="$HERE/doc-size-baseline.txt"
cd "$ROOT" || exit 2

# ceiling <characters> <what it is> <files...>
found=0; failed=0
ceiling() {
  limit=$1; kind=$2; shift 2
  for f in "$@"; do
    [ -f "$f" ] || continue
    found=$((found + 1)); size=$(wc -m < "$f")
    [ "$size" -le "$limit" ] && continue
    allowed=$(awk -v p="$f" '$2 == p { print $1 }' "$BASELINE" 2>/dev/null)
    if [ -z "$allowed" ]; then
      echo "$f: $size characters; a $kind may have $limit"; failed=$((failed + 1))
    elif [ "$size" -gt "$allowed" ]; then
      echo "$f: $size characters; it was $allowed when it was listed as a debt, and a $kind may have $limit"; failed=$((failed + 1))
    fi
  done
}

ceiling  6000 "file loaded in every session" CLAUDE.md AGENTS.md
ceiling  6000 "rules file"                   .claude/rules/*.md
ceiling  6000 "agent file"                   .claude/agents/*.md
ceiling  8000 "skill file of this repo"      .claude/skills/explorer-pipeline/SKILL.md
ceiling  4500 "pipeline lane or reference"   .claude/skills/explorer-pipeline/feature.md .claude/skills/explorer-pipeline/bugfix.md .claude/skills/explorer-pipeline/refactor.md .claude/skills/explorer-pipeline/diagnose.md .claude/skills/explorer-pipeline/reference/*.md
ceiling 12000 "context page"                 $(find context/pages -name '*.md' -not -path 'context/pages/roadmap/*' -not -path 'context/pages/history/*' 2>/dev/null)

[ "$found" -gt 0 ] || { echo "check-doc-sizes: no document found under $ROOT" >&2; exit 2; }
[ "$failed" -eq 0 ] && echo "$found documents within their ceilings (or no larger than their listed debt)."
[ "$failed" -eq 0 ]
