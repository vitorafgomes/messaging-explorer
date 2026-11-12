#!/usr/bin/env bash
# Resolve every `path:line` citation in vault/pages against the working tree.
#
# A citation is src|web-app|scripts|docs|.claude|.github/<path>.<ext>:<line>[-<line>], written in full; an
# abbreviated path (`…`) or a bare continuation (`:15`) is not a citation to this script. It fails
# when the file is missing, the first line is 0 or past the end of the file, or vault/pages cannot
# be listed. It proves the line exists, never that it still describes the claim; that part is read. Pages whose frontmatter status marks them
# as a record (superseded, archived, artefact, resolved, deprecated) are skipped, and so is a path
# that names another repo (`other-repo/src/...`).
#
# Usage: scripts/check-vault-refs.sh [root]   exits 1 on any broken ref.
set -uo pipefail
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
total=0; skipped=0; broken=0
pages=$(mktemp); trap 'rm -f "$pages"' EXIT
if ! find "$root/vault/pages" -name '*.md' -print0 > "$pages"; then
  echo "Cannot list $root/vault/pages: the vault pages tree is missing or unreadable." >&2
  exit 1
fi
while IFS= read -r -d '' page; do
  if awk 'NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} NR>1' "$page" | grep -qiE '^status:[[:space:]]*["'"'"']?(superseded|archived|artefact|deprecated|resolved|snapshot|decommissioned|wont-fix)\b'; then
    skipped=$((skipped+1)); continue
  fi
  rel="${page#"$root"/}"
  while IFS=: read -r file line; do
    [ -n "$file" ] || continue
    total=$((total+1))
    target="$root/$file"
    if [ "$line" -lt 1 ]; then
      echo "$rel: $file:$line - line numbers start at 1"; broken=$((broken+1))
    elif [ ! -f "$target" ]; then
      echo "$rel: $file:$line - file missing"; broken=$((broken+1))
    else
      count=$(awk 'END{print NR}' "$target")
      if [ "$line" -gt "$count" ]; then
        echo "$rel: $file:$line - file has $count lines"; broken=$((broken+1))
      fi
    fi
  done < <(grep -oE '(^|[^A-Za-z0-9_./-])(src|web-app|scripts|docs|\.claude|\.github)/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+:[0-9]+' "$page" | sed -E 's/^[^A-Za-z0-9_.]//' | sort -u)
done < "$pages"
if [ "$broken" -gt 0 ]; then
  echo "$broken of $total vault file:line citations do not resolve." >&2
  exit 1
fi
echo "$total vault file:line citations resolve ($skipped record pages skipped)."
