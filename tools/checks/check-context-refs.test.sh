#!/usr/bin/env bash
# Case matrix for check-context-refs.sh on a fixture tree: exit code and the lines it reports.
SCRIPT="${1:-$(dirname "$0")/check-context-refs.sh}"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
mkdir -p "$work/context/pages/services" "$work/context/pages/decisions" "$work/src/Api" "$work/web-app/src/app"
printf 'public class Program\n{\n    public static void Main() { }\n}\n' > "$work/src/Api/Program.cs"
printf "it('opens a queue', () => {});\n" > "$work/web-app/src/app/x.spec.ts"

# (a) anchors that occur in their files resolve, in backticks and in quoted frontmatter: exit 0, counted
printf -- '---\nstatus: active\nenforced_by:\n  - "src/Api/Program.cs#Main"\n---\nSee `src/Api/Program.cs#Program` and `web-app/src/app/x.spec.ts#opens a queue`.\n' > "$work/context/pages/services/a.md"
out=$(bash "$SCRIPT" "$work"); rc=$?
[ $rc = 0 ] && [[ "$out" == 3\ context* ]] || { echo "FAIL (a) rc=$rc out=$out"; fail=1; }

# (b) an anchor the file does not contain, and a missing file: exit 1, both named
printf -- '---\nstatus: active\n---\n`src/Api/Program.cs#Gone` and `src/Api/Missing.cs#Main`.\n' > "$work/context/pages/services/b.md"
out=$(bash "$SCRIPT" "$work" 2>&1); rc=$?
[ $rc = 1 ] && grep -q 'src/Api/Program.cs#Gone - not found in the file' <<<"$out" && grep -q 'src/Api/Missing.cs#Main - file missing' <<<"$out" || { echo "FAIL (b) rc=$rc out=$out"; fail=1; }
rm "$work/context/pages/services/b.md"

# (c) a citation by line number is refused: exit 1, named, with the rule
printf -- '---\nstatus: active\n---\n`src/Api/Program.cs:3`.\n' > "$work/context/pages/services/c.md"
out=$(bash "$SCRIPT" "$work" 2>&1); rc=$?
[ $rc = 1 ] && grep -q 'src/Api/Program.cs:3 - cite by name' <<<"$out" || { echo "FAIL (c) rc=$rc out=$out"; fail=1; }
rm "$work/context/pages/services/c.md"

# (d) a record page is skipped even with broken refs; a status line in the body is not frontmatter
printf -- '---\nstatus: superseded\n---\n`src/Api/Program.cs#Gone` and `src/Api/Program.cs:9`.\n' > "$work/context/pages/decisions/d.md"
printf -- '---\nstatus: active\n---\nstatus: resolved\n`src/Api/Program.cs#Main`.\n' > "$work/context/pages/decisions/d2.md"
out=$(bash "$SCRIPT" "$work"); rc=$?
[ $rc = 0 ] && [[ "$out" == 4\ context*"(1 record pages skipped)"* ]] || { echo "FAIL (d) rc=$rc out=$out"; fail=1; }

# (e) a path inside another repo or package is not this tree's and is ignored
printf -- '---\nstatus: active\n---\n`other-repo/src/app/x.ts#Nope`, `web-app/node_modules/@angular/build/src/builders/schema.json:19` and `src/Api/Program.cs#Main`.\n' > "$work/context/pages/services/e.md"
out=$(bash "$SCRIPT" "$work"); rc=$?
[ $rc = 0 ] && [[ "$out" == 5\ context* ]] || { echo "FAIL (e) rc=$rc out=$out"; fail=1; }

# (f) no context/pages tree: exit 1 with a sentence, never "0 citations resolve"
mkdir -p "$work/empty"
out=$(bash "$SCRIPT" "$work/empty" 2>&1); rc=$?
[ $rc = 1 ] && grep -q 'context pages tree is missing or unreadable' <<<"$out" || { echo "FAIL (f) rc=$rc out=$out"; fail=1; }

[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
