#!/usr/bin/env bash
# Fails when a private name appears in the tracked files (--tree) or in the text on stdin (--stdin).
# The names are never stored in this repository: they come from PRIVATE_NAMES (one per line or
# comma separated) or from PRIVATE_NAMES_FILE (default ~/.config/messaging-explorer/private-names).
# A name matches in any case and with one separator between its letters (Name, NA_ME, na-me).
# The report names the file and line only, never the matched text, because CI logs are public.
# --require turns "no names configured" into a failure, so CI cannot pass by missing its secret.
set -uo pipefail

mode=tree
require=0
for arg in "$@"; do
  case "$arg" in
    --tree) mode=tree ;;
    --stdin) mode=stdin ;;
    --require) require=1 ;;
    *) echo "usage: check-private-names.sh [--tree | --stdin] [--require]" >&2; exit 2 ;;
  esac
done

names="${PRIVATE_NAMES:-}"
file="${PRIVATE_NAMES_FILE:-$HOME/.config/messaging-explorer/private-names}"
if [ -z "$names" ] && [ -r "$file" ]; then
  names=$(cat "$file")
fi

pattern=""
while IFS= read -r name; do
  name=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
  [ -z "$name" ] && continue
  part=$(printf '%s' "$name" | sed 's/./&[^[:alnum:]]?/g')
  part=${part%'[^[:alnum:]]?'}
  pattern="${pattern:+$pattern|}$part"
done < <(printf '%s\n' "$names" | tr ',' '\n')

if [ -z "$pattern" ]; then
  if [ "$require" = 1 ]; then
    echo "check-private-names: no names configured" >&2
    exit 1
  fi
  echo "check-private-names: no names configured, skipped"
  exit 0
fi

if [ "$mode" = tree ]; then
  hits=$(git grep -I -n -i -E -e "$pattern" -- . 2>/dev/null | cut -d: -f1,2)
  if [ -n "$hits" ]; then
    while IFS= read -r hit; do echo "check-private-names: private name in $hit" >&2; done <<<"$hits"
    exit 1
  fi
  echo "check-private-names: tracked files clean"
else
  hits=$(grep -n -i -E -e "$pattern" | cut -d: -f1)
  if [ -n "$hits" ]; then
    while IFS= read -r line; do echo "check-private-names: private name on line $line of the text" >&2; done <<<"$hits"
    exit 1
  fi
  echo "check-private-names: text clean"
fi
exit 0
