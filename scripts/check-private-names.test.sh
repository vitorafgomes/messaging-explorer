#!/usr/bin/env bash
# Case matrix for check-private-names.sh with made-up names: exit code, what it reports, and that it never prints a name.
SCRIPT="$(cd "$(dirname "${1:-$0}")" && pwd)/check-private-names.sh"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
unset PRIVATE_NAMES
export PRIVATE_NAMES_FILE="$work/none"
cd "$work" && git init -q repo && cd repo
git config user.email t@example.invalid && git config user.name t
leaks() { grep -qi -E 'alpha.?name|beta.?co' <<<"$1"; }

# (a) a clean tree: exit 0
printf 'nothing to see\n' > a.txt && git add a.txt
out=$(PRIVATE_NAMES='alphaname,beta co' bash "$SCRIPT" --tree 2>&1); rc=$?
[ $rc = 0 ] || { echo "FAIL (a) rc=$rc out=$out"; fail=1; }

# (b) a name in a tracked file, in another case: exit 1, the file and line named, the name never printed
printf 'line one\nsee AlphaName here\n' > b.md && git add b.md
out=$(PRIVATE_NAMES='alphaname,beta co' bash "$SCRIPT" --tree 2>&1); rc=$?
[ $rc = 1 ] && grep -q 'b.md:2' <<<"$out" && ! leaks "$out" || { echo "FAIL (b) rc=$rc out=$out"; fail=1; }
git rm -q -f b.md

# (c) a separator inside the name is still the name: underscore, dash, space, dot
for v in 'alpha_name' 'Alpha-Name' 'ALPHA NAME' 'alpha.name' 'xBetaCo_backend'; do
  printf '%s\n' "$v" > c.cs && git add c.cs
  out=$(PRIVATE_NAMES='alphaname,beta co' bash "$SCRIPT" --tree 2>&1); rc=$?
  [ $rc = 1 ] && grep -q 'c.cs:1' <<<"$out" && ! leaks "$out" || { echo "FAIL (c) '$v' rc=$rc out=$out"; fail=1; }
  git rm -q -f c.cs
done

# (d) an untracked file is not part of the tree: exit 0
printf 'alphaname\n' > untracked.txt
out=$(PRIVATE_NAMES='alphaname' bash "$SCRIPT" --tree 2>&1); rc=$?
[ $rc = 0 ] || { echo "FAIL (d) rc=$rc out=$out"; fail=1; }
rm untracked.txt

# (e) text on stdin (a PR title, a commit message): exit 1, the line named, the name never printed
out=$(printf 'title\nfix for Beta_Co\n' | PRIVATE_NAMES='alphaname,beta co' bash "$SCRIPT" --stdin 2>&1); rc=$?
[ $rc = 1 ] && grep -q 'line 2' <<<"$out" && ! leaks "$out" || { echo "FAIL (e) rc=$rc out=$out"; fail=1; }
out=$(printf 'a clean message\n' | PRIVATE_NAMES='alphaname' bash "$SCRIPT" --stdin 2>&1); rc=$?
[ $rc = 0 ] || { echo "FAIL (e2) rc=$rc out=$out"; fail=1; }

# (f) the names come from a file when the variable is not set; one per line, blank lines ignored
printf 'alphaname\n\n' > "$work/names"
printf 'ALPHANAME\n' > f.txt && git add f.txt
out=$(PRIVATE_NAMES_FILE="$work/names" bash "$SCRIPT" --tree 2>&1); rc=$?
[ $rc = 1 ] && grep -q 'f.txt:1' <<<"$out" || { echo "FAIL (f) rc=$rc out=$out"; fail=1; }
git rm -q -f f.txt

# (g) no names configured: skipped with exit 0, but exit 1 under --require, so CI cannot pass by forgetting the secret
out=$(bash "$SCRIPT" --tree 2>&1); rc=$?
[ $rc = 0 ] && grep -q 'skipped' <<<"$out" || { echo "FAIL (g) rc=$rc out=$out"; fail=1; }
out=$(bash "$SCRIPT" --tree --require 2>&1); rc=$?
[ $rc = 1 ] && grep -q 'no names configured' <<<"$out" || { echo "FAIL (g2) rc=$rc out=$out"; fail=1; }

# (h) a word that only shares letters with a name is not a match
printf 'alpha names are fine\n' > h.txt && git add h.txt
out=$(PRIVATE_NAMES='alphanamex' bash "$SCRIPT" --tree 2>&1); rc=$?
[ $rc = 0 ] || { echo "FAIL (h) rc=$rc out=$out"; fail=1; }
git rm -q -f h.txt

# (i) an unknown argument: exit 2
out=$(bash "$SCRIPT" --bogus 2>&1); rc=$?
[ $rc = 2 ] || { echo "FAIL (i) rc=$rc out=$out"; fail=1; }

[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
