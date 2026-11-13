#!/usr/bin/env bash
# Case matrix for check-doc-sizes.sh in a throwaway tree.
DIR="$(cd "$(dirname "$0")" && pwd)"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
mkdir -p "$work/scripts" "$work/repo/.claude/rules" "$work/repo/context/pages/services" "$work/repo/context/pages/roadmap"
cp "$DIR/check-doc-sizes.sh" "$work/scripts/"
chars() { head -c "$1" /dev/zero | tr '\0' 'x' > "$2"; }
run() { out=$(sh "$work/scripts/check-doc-sizes.sh" "$work/repo" 2>&1); rc=$?; }
want() { [ "$rc" = "$1" ] || { echo "FAIL want exit $1 got $rc :: $2"; echo "$out" | sed 's/^/    /'; fail=1; }; }

run; want 2 "an empty tree is an error, not a pass"

chars 5000 "$work/repo/CLAUDE.md"; chars 11000 "$work/repo/context/pages/services/a.md"; chars 90000 "$work/repo/context/pages/roadmap/list.md"
run; want 0 "files under their ceilings pass, and a roadmap tracker is not measured"

chars 6500 "$work/repo/.claude/rules/llm.md"
run; want 1 "a rules file over its ceiling fails"
printf '%s' "$out" | grep -q '^.claude/rules/llm.md: 6500 characters; a rules file may have 6000$' || { echo "FAIL the line names the file, its size and the ceiling :: $out"; fail=1; }

echo "6500 .claude/rules/llm.md" > "$work/scripts/doc-size-baseline.txt"
run; want 0 "a listed debt that did not grow passes"

chars 6600 "$work/repo/.claude/rules/llm.md"
run; want 1 "a listed debt that grew fails"
printf '%s' "$out" | grep -q 'it was 6500 when it was listed' || { echo "FAIL the line says the debt grew :: $out"; fail=1; }

chars 5900 "$work/repo/.claude/rules/llm.md"
run; want 0 "a debt that was paid passes while still listed"

[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
