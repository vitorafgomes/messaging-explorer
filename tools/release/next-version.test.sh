#!/usr/bin/env bash
# Case matrix for next-version.sh, run in throwaway repositories: each case builds a history of tags and commit
# messages, then checks the printed version, the notes, the exit code and the sentence on stderr.
SCRIPT="$(cd "$(dirname "$0")" && pwd)/next-version.sh"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
g() { git -C "$work/repo" -c user.name=t -c user.email=t@t -c commit.gpgsign=false -c tag.gpgsign=false -c core.hooksPath=/dev/null "$@"; }
repo() { rm -rf "$work/repo"; git init -q -b main "$work/repo"; }
commit() { g commit -q --allow-empty -m "$1"; }
tag() { g tag "$1"; }
run() { out=$(cd "$work/repo" && bash "$SCRIPT" "$@" 2>"$work/err"); rc=$?; err=$(cat "$work/err"); }
want() { name=$1; expected=$2; shift 2; run "$@"
  if [ "$rc" != 0 ] || [ "$out" != "$expected" ]; then echo "FAIL want '$expected' got '$out' (rc=$rc, $err) :: $name"; fail=1; fi; }
want_match() { name=$1; pattern=$2; shift 2; run "$@"
  if [ "$rc" != 0 ] || ! [[ $out =~ $pattern ]]; then echo "FAIL want /$pattern/ got '$out' (rc=$rc, $err) :: $name"; fail=1; fi; }
want_fail() { name=$1; sentence=$2; shift 2; run "$@"
  if [ "$rc" = 0 ]; then echo "FAIL want a non-zero exit, got '$out' :: $name"; fail=1; fi
  if ! printf '%s' "$err" | grep -qF "$sentence"; then echo "FAIL stderr lacks '$sentence': '$err' :: $name"; fail=1; fi; }
stderr_has() { if ! printf '%s' "$err" | grep -qF "$1"; then echo "FAIL stderr lacks '$1': '$err' :: $2"; fail=1; fi; }

repo; commit "chore: start"; tag v1.2.3; commit "fix(ui): a crash"; commit "docs: a page"
want "only fixes and other bump the patch" 1.2.4 release
repo; commit "chore: start"; tag v1.2.3; commit "fix: a crash"; commit "feat(github): a read"
want "a feat bumps the minor and resets the patch" 1.3.0 release
repo; commit "chore: start"; tag v1.2.3; commit "feat: a read"; commit "refactor(core)!: a renamed option"
want "a '!' after the type bumps the major" 2.0.0 release
repo; commit "chore: start"; tag v1.2.3; commit "fix: a crash"; g commit -q --allow-empty -m "fix: the option" -m "BREAKING CHANGE: the option is renamed"
want "a BREAKING CHANGE footer bumps the major" 2.0.0 release
repo; commit "chore: start"; tag v1.2.3; g commit -q --allow-empty -m "fix: the option" -m "The words BREAKING CHANGE: inside a sentence are not a footer"
want "BREAKING CHANGE in the middle of a line is not a footer" 1.2.4 release
repo; commit "chore: start"; tag v0.2.0; commit "feat!: a new contract"
want "a breaking change while the major is 0 bumps the minor" 0.3.0 release
stderr_has "A breaking change while the major version is 0 bumps the minor version." "the major-0 rule is stated"
repo; commit "chore: start"; tag v0.2.0; commit "fix: a crash"; tag v0.2.1-beta.1; commit "feat: a read"; tag v0.3.0-test.1
want "prerelease tags are not the base" 0.3.0 release
repo; commit "chore: start"; tag v0.1.0; g switch -q -c side; commit "feat: elsewhere"; tag v9.0.0; g switch -q main; commit "fix: here"
want "a tag on another branch is not the base" 0.1.1 release
repo; commit "chore: start"; tag v1.0.0; commit "Merge pull request #1 from x/y"; commit "A subject with no type (#2)"
want "a subject with no type is other and bumps the patch" 1.0.1 release
repo; commit "feat: first"; commit "fix: second"
want "no tag yet starts from 0.0.0" 0.1.0 release
repo; commit "chore: start"; tag v1.2.3
want_fail "nothing since the tag fails with a sentence" "Nothing has been committed since v1.2.3" release
want_fail "nothing since the tag fails a prerelease too" "Nothing has been committed since v1.2.3" prerelease beta
repo; commit "chore: start"; tag v1.2.3; commit "feat: a read"
want "the first prerelease of a version is .1" 1.3.0-beta.1 prerelease beta
tag v1.3.0-beta.1; tag v1.3.0-beta.9; tag v1.3.0-beta.10; tag v1.3.0-rc.40; tag v1.4.0-beta.70
want "the next prerelease is one above the highest of that version and channel, compared as numbers" 1.3.0-beta.11 prerelease beta
want "another channel counts on its own" 1.3.0-rc.41 prerelease rc
repo; commit "chore: start"; tag v1.2.3; commit "feat: a read"; sha=$(g rev-parse --short HEAD)
before=$(date -u +%Y%m%d%H%M)
want_match "test mode is the next version, a UTC minute stamp and the short sha" "^1\.3\.0-test\.[0-9]{12}\.g$sha$" test
after=$(date -u +%Y%m%d%H%M); stamp=${out#1.3.0-test.}; stamp=${stamp%%.*}
if [ "$stamp" != "$before" ] && [ "$stamp" != "$after" ]; then echo "FAIL the stamp $stamp is not the UTC minute $before"; fail=1; fi
repo; commit "chore: start"; tag v1.2.3
want_match "test mode with nothing since the release is still above it" "^1\.2\.4-test\.[0-9]{12}\.g[0-9a-f]+$" test
repo; commit "chore: start"; tag v1.2.3; commit "fix: a"; g switch -q -c side; commit "chore: x"; tag v1.2.4; g switch -q main
want_fail "a computed version tagged on another branch fails" "The tag v1.2.4 already exists." release
repo; commit "chore: start"; tag v1.2.3; commit "feat(github): a read"; commit "fix: a crash"; commit "docs: a page"; commit "A subject with no type (#2)"; commit "feat!: a contract"
run --notes release
expected=$'### Features\n\n- feat!: a contract\n- feat(github): a read\n\n### Fixes\n\n- fix: a crash\n\n### Other\n\n- A subject with no type (#2)\n- docs: a page'
if [ "$rc" != 0 ] || [ "$out" != "$expected" ]; then echo "FAIL the notes group features, fixes and other :: got"; echo "$out" | sed 's/^/    /'; fail=1; fi
repo; commit "chore: start"; tag v1.2.3; commit "docs: a page"
run --notes release
if [ "$out" != $'### Other\n\n- docs: a page' ]; then echo "FAIL an empty group is left out :: got '$out'"; fail=1; fi
want_fail "an unknown mode prints the usage" "Usage: next-version.sh" publish
want_fail "a prerelease needs a channel" "Usage: next-version.sh" prerelease
want_fail "the channel test belongs to test mode" "Usage: next-version.sh" prerelease test
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
