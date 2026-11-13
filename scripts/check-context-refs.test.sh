#!/usr/bin/env bash
# Case matrix for check-context-refs.sh on a fixture tree: exit code and the lines it reports.
SCRIPT="${1:-$(dirname "$0")/check-context-refs.sh}"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
mkdir -p "$work/context/pages/services" "$work/context/pages/decisions" "$work/src/Api"
printf 'line1\nline2\nline3\n' > "$work/src/Api/Program.cs"
# (a) all refs resolve, range form included: exit 0
printf -- '---\nstatus: active\n---\nSee `src/Api/Program.cs:2` and `src/Api/Program.cs:1-3`.\n' > "$work/context/pages/services/a.md"
out=$(bash "$SCRIPT" "$work"); rc=$?
[ $rc = 0 ] && [[ "$out" == 2\ context* ]] || { echo "FAIL (a) rc=$rc out=$out"; fail=1; }
# (b) one line past the end (the newline-terminated edge) and a missing file: exit 1, both named
printf -- '---\nstatus: active\n---\n`src/Api/Program.cs:4` and `src/Api/Gone.cs:1`.\n' > "$work/context/pages/services/b.md"
out=$(bash "$SCRIPT" "$work" 2>&1); rc=$?
[ $rc = 1 ] && grep -q 'Program.cs:4 - file has 3 lines' <<<"$out" && grep -q 'Gone.cs:1 - file missing' <<<"$out" || { echo "FAIL (b) rc=$rc out=$out"; fail=1; }
# (c) a record page is skipped even with broken refs; a status line in the body is not frontmatter
rm "$work/context/pages/services/b.md"
printf -- '---\nstatus: superseded\n---\n`src/Api/Gone.cs:1`.\n' > "$work/context/pages/decisions/c.md"
printf -- '---\nstatus: active\n---\nstatus: resolved\n`src/Api/Program.cs:1`.\n' > "$work/context/pages/decisions/c2.md"
out=$(bash "$SCRIPT" "$work"); rc=$?
[ $rc = 0 ] && [[ "$out" == 3\ context*"(1 record pages skipped)"* ]] || { echo "FAIL (c) rc=$rc out=$out"; fail=1; }
# (d) a citation into another repo is not this tree's and is ignored
printf -- '---\nstatus: active\n---\n`other-repo/src/app/x.ts:4` and `src/Api/Program.cs:1`.\n' > "$work/context/pages/services/d.md"
out=$(bash "$SCRIPT" "$work"); rc=$?
[ $rc = 0 ] && [[ "$out" == 4\ context* ]] || { echo "FAIL (d) rc=$rc out=$out"; fail=1; }
# (e) line 0 does not exist: exit 1, named
printf -- '---\nstatus: active\n---\n`src/Api/Program.cs:0`.\n' > "$work/context/pages/services/e.md"
out=$(bash "$SCRIPT" "$work" 2>&1); rc=$?
[ $rc = 1 ] && grep -q 'Program.cs:0 - line numbers start at 1' <<<"$out" || { echo "FAIL (e) rc=$rc out=$out"; fail=1; }
rm "$work/context/pages/services/e.md"
# (g) a web-app citation resolves as one ref against web-app/, not as a src/ ref inside it
mkdir -p "$work/web-app/src/app"; printf 'a\nb\n' > "$work/web-app/src/app/x.ts"
printf -- '---\nstatus: active\n---\n`web-app/src/app/x.ts:2` and `web-app/src/app/x.ts:3`.\n' > "$work/context/pages/services/g.md"
out=$(bash "$SCRIPT" "$work" 2>&1); rc=$?
[ $rc = 1 ] && grep -q 'web-app/src/app/x.ts:3 - file has 2 lines' <<<"$out" && ! grep -q 'file missing' <<<"$out" || { echo "FAIL (g) rc=$rc out=$out"; fail=1; }
rm "$work/context/pages/services/g.md"
# (f) no context/pages tree: exit 1 with a sentence, never "0 citations resolve"
mkdir -p "$work/empty"
out=$(bash "$SCRIPT" "$work/empty" 2>&1); rc=$?
[ $rc = 1 ] && grep -q 'context pages tree is missing or unreadable' <<<"$out" || { echo "FAIL (f) rc=$rc out=$out"; fail=1; }
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
