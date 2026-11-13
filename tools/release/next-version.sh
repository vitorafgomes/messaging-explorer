#!/usr/bin/env bash
# Usage: tools/release/next-version.sh [--notes] release | prerelease <channel> | test
#
# Prints the next version from the latest vX.Y.Z tag reachable from HEAD and the conventional-commit subjects
# since it: a breaking change ('!' after the type, or a BREAKING CHANGE footer) bumps the major version, or the
# minor while the major is 0; any feat bumps the minor; anything else bumps the patch.
#   release            X.Y.Z
#   prerelease <ch>    X.Y.Z-<ch>.N, N one above the highest existing vX.Y.Z-<ch>.* tag
#   test               X.Y.Z-test.<UTC yyyymmddHHMM>.g<short sha>, above the last release even with no new commit
# With --notes it prints the subjects since the tag grouped into features, fixes and other, instead of the version.
set -euo pipefail

usage() {
  echo "Usage: next-version.sh [--notes] release | prerelease <channel> | test" >&2
  exit 2
}

notes=false
if [ "${1:-}" = --notes ]; then notes=true; shift; fi
mode=${1:-}
case "$mode" in
  release | test) [ $# -eq 1 ] || usage ;;
  prerelease) [ $# -eq 2 ] && [[ $2 =~ ^[a-z][a-z0-9]*$ ]] && [ "$2" != test ] || usage ;;
  *) usage ;;
esac

if base=$(git describe --tags --abbrev=0 --match 'v[0-9]*' --exclude '*-*' 2>/dev/null); then
  range="$base..HEAD"
else
  base=v0.0.0
  range=HEAD
fi
if ! [[ $base =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "The latest tag $base is not shaped v<major>.<minor>.<patch>." >&2
  exit 1
fi
major=${BASH_REMATCH[1]}
minor=${BASH_REMATCH[2]}
patch=${BASH_REMATCH[3]}

breaking=false
feats=()
fixes=()
others=()
while IFS= read -r -d $'\x1e' record; do
  record=${record#$'\n'}
  subject=${record%%$'\x1f'*}
  body=${record#*$'\x1f'}
  [ -n "$subject" ] || continue
  if [[ $subject =~ ^[a-z]+(\([^\)]*\))?!: ]] || grep -qE '^BREAKING[ -]CHANGE:' <<<"$body"; then
    breaking=true
  fi
  if [[ $subject =~ ^feat(\([^\)]*\))?!?: ]]; then
    feats+=("$subject")
  elif [[ $subject =~ ^fix(\([^\)]*\))?!?: ]]; then
    fixes+=("$subject")
  else
    others+=("$subject")
  fi
done < <(git log --no-merges --format='%s%x1f%b%x1e' "$range")

count=$((${#feats[@]} + ${#fixes[@]} + ${#others[@]}))
if [ "$count" -eq 0 ] && { [ "$mode" != test ] || $notes; }; then
  echo "Nothing has been committed since $base, so there is no next version to release." >&2
  exit 1
fi

if $notes; then
  group() {
    local title=$1
    shift
    [ $# -gt 0 ] || return 0
    printf '### %s\n\n' "$title"
    printf -- '- %s\n' "$@"
    printf '\n'
  }
  group Features "${feats[@]}"
  group Fixes "${fixes[@]}"
  group Other "${others[@]}"
  exit 0
fi

if $breaking && [ "$major" -gt 0 ]; then
  next="$((major + 1)).0.0"
elif $breaking; then
  echo "A breaking change while the major version is 0 bumps the minor version." >&2
  next="$major.$((minor + 1)).0"
elif [ ${#feats[@]} -gt 0 ]; then
  next="$major.$((minor + 1)).0"
else
  next="$major.$minor.$((patch + 1))"
fi

case "$mode" in
  release) version=$next ;;
  prerelease)
    highest=0
    while IFS= read -r tag; do
      n=${tag##*.}
      if [[ $n =~ ^[0-9]+$ ]] && [ "$((10#$n))" -gt "$highest" ]; then highest=$((10#$n)); fi
    done < <(git tag --list "v$next-$2.*")
    version="$next-$2.$((highest + 1))"
    ;;
  test) version="$next-test.$(date -u +%Y%m%d%H%M).g$(git rev-parse --short HEAD)" ;;
esac

if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
  echo "The tag v$version already exists." >&2
  exit 1
fi
echo "$version"
