#!/usr/bin/env bash
# Resolve every `path#anchor` citation in context/pages against the working tree.
#
# A citation is src|web-app|scripts|docs|.claude|.github/<path>.<ext>#<anchor>, written in full, in
# backticks or in a quoted frontmatter entry. The anchor is a name or a piece of text that occurs in
# the file: a member, a type, a test title, a key. Citations by line number (`path:12`) are refused,
# because every edit above the line moves them. The script fails when the file is missing, the anchor
# does not occur in it, a line-number citation is found, or context/pages cannot be listed. It proves
# the anchor exists, never that the page still describes it truly; that part is read. Pages whose
# frontmatter status marks them as a record are skipped, and so is a path that names another repo
# or a package (`other-repo/src/...`, `node_modules/...`).
#
# Usage: scripts/check-context-refs.sh [root]   exits 1 on any broken citation.
set -uo pipefail
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
total=0; skipped=0; broken=0
pages=$(mktemp); trap 'rm -f "$pages"' EXIT
if ! find "$root/context/pages" -name '*.md' -print0 > "$pages"; then
  echo "Cannot list $root/context/pages: the context pages tree is missing or unreadable." >&2
  exit 1
fi
prefix='(^|[^A-Za-z0-9_./@-])'
roots='(src|web-app|scripts|docs|\.claude|\.github)/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+'
while IFS= read -r -d '' page; do
  if awk 'NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} NR>1' "$page" | grep -qiE '^status:[[:space:]]*["'"'"']?(superseded|archived|artefact|deprecated|resolved|snapshot|decommissioned|wont-fix)\b'; then
    skipped=$((skipped+1)); continue
  fi
  rel="${page#"$root"/}"
  while IFS= read -r cite; do
    [ -n "$cite" ] || continue
    echo "$rel: $cite - cite by name, not by line (path#Member)"; broken=$((broken+1))
  done < <(grep -oE "$prefix$roots:[0-9]+" "$page" | sed -E 's/^[^A-Za-z0-9_.]//' | sort -u)
  while IFS= read -r cite; do
    [ -n "$cite" ] || continue
    total=$((total+1))
    file="${cite%%#*}"; anchor="${cite#*#}"
    if [ ! -f "$root/$file" ]; then
      echo "$rel: $cite - file missing"; broken=$((broken+1))
    elif ! grep -qF -- "$anchor" "$root/$file"; then
      echo "$rel: $cite - not found in the file"; broken=$((broken+1))
    fi
  done < <(grep -oE "$prefix$roots#[^\`\"]+" "$page" | sed -E 's/^[^A-Za-z0-9_.]//' | sort -u)
done < "$pages"
if [ "$broken" -gt 0 ]; then
  echo "$broken context citations do not resolve ($total by name checked)." >&2
  exit 1
fi
echo "$total context citations resolve ($skipped record pages skipped)."
