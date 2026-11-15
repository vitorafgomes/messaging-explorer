#!/usr/bin/env bash
# Case matrix for session-start-graph.sh. A stub stands in for graphify and records each call, so
# the matrix runs on a machine without graphify. SPAWN = the stub must be called, NONE = it must not.
HOOK="${1:-$(dirname "$0")/session-start-graph.sh}"
HOOK="$(cd "$(dirname "$HOOK")" && pwd)/$(basename "$HOOK")"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
repo="$work/repo"; calls="$work/calls"; bin="$work/bin"
mkdir -p "$repo/src" "$bin"
git -C "$repo" init -q
printf 'class A {}\n' > "$repo/src/A.cs"
git -C "$repo" add -A
git -C "$repo" -c user.email=t@t -c user.name=t commit -qm one
head=$(git -C "$repo" rev-parse HEAD)
out="$repo/graphify-out"

# The stub logs its call, writes a graph like graphify does, then does what STUB_MODE asks.
cat > "$bin/graphify" <<'STUB'
#!/bin/sh
echo called >> "$STUB_CALLS"
mkdir -p graphify-out && echo '{}' > graphify-out/graph.json
case "$STUB_MODE" in
  sleep) sleep 30 ;;
  junk) echo "junk on stdout"; echo "junk on stderr" >&2 ;;
  fail) exit 1 ;;
esac
STUB
chmod +x "$bin/graphify"

reset() { rm -rf "$out" "$calls"; }
fresh() { mkdir -p "$out"; echo '{}' > "$out/graph.json"; echo "$head" > "$out/.session-head"; touch -d '1 hour ago' "$repo/src/A.cs"; }
run() { (cd "$repo" && printf '{}' | env GRAPHIFY_BIN="$bin/graphify" STUB_CALLS="$calls" GRAPHIFY_SESSION_LOG="$work/log" "$@" sh "$HOOK"); }
called() { for _ in $(seq 1 30); do [ -s "$calls" ] && return 0; sleep 0.1; done; return 1; }
done_building() { for _ in $(seq 1 30); do [ ! -d "$out/.session-rebuild.lock" ] && return 0; sleep 0.1; done; return 1; }
expect() {
  want=$1; name=$2; text=$3; got=$4
  if [ "$want" = SPAWN ]; then called && actual=SPAWN || actual=NONE; else sleep 0.5; [ -s "$calls" ] && actual=SPAWN || actual=NONE; fi
  if [ "$actual" != "$want" ]; then echo "FAIL want=$want got=$actual :: $name"; fail=1; fi
  case "$got" in *"$text"*) ;; *) echo "FAIL output lacks '$text' :: $name :: $got"; fail=1 ;; esac
  if [ -n "$got" ] && ! printf '%s' "$got" | jq -e '.hookSpecificOutput.additionalContext' >/dev/null 2>&1; then
    echo "FAIL output is not one hook JSON object :: $name :: $got"; fail=1
  fi
  done_building
}

# (a) graphify absent: quiet, no call
reset; got=$(run GRAPHIFY_BIN="$work/none/graphify")
[ -z "$got" ] || { echo "FAIL graphify absent must be quiet :: $got"; fail=1; }
[ -s "$calls" ] && { echo "FAIL graphify absent must not run anything"; fail=1; }

# (b) outside a git checkout: quiet
got=$(cd "$work" && printf '{}' | env GRAPHIFY_BIN="$bin/graphify" STUB_CALLS="$calls" sh "$HOOK")
[ -z "$got" ] || { echo "FAIL outside a checkout must be quiet :: $got"; fail=1; }

# (c) no graph: build, and the stamp names HEAD once it ends
reset; got=$(run); expect SPAWN "no graph" "being built" "$got"
[ "$(cat "$out/.session-head" 2>/dev/null)" = "$head" ] || { echo "FAIL stamp not written after a good build"; fail=1; }

# (d) fresh: nothing runs
reset; fresh; got=$(run); expect NONE "fresh graph" "is current with HEAD" "$got"

# (e) stale by HEAD
reset; fresh; echo 0000000 > "$out/.session-head"; got=$(run); expect SPAWN "stale by HEAD" "not built from HEAD" "$got"

# (f) stale by a source file edited after the build
reset; fresh; touch "$repo/src/A.cs"; got=$(run); expect SPAWN "newer source" "source files changed" "$got"

# (g) a rebuild already running: no second one
reset; fresh; echo 0000000 > "$out/.session-head"; mkdir "$out/.session-rebuild.lock"
got=$(run); expect NONE "lock held" "another session is rebuilding" "$got"

# (h) a lock left by a killed rebuild, older than 10 minutes: taken over
reset; fresh; echo 0000000 > "$out/.session-head"; mkdir "$out/.session-rebuild.lock"; touch -d '20 minutes ago' "$out/.session-rebuild.lock"
got=$(run); expect SPAWN "stale lock" "being rebuilt" "$got"

# (i) graphify takes 30 s: the hook still returns at once
reset; start=$(date +%s); got=$(run STUB_MODE=sleep); took=$(( $(date +%s) - start ))
[ "$took" -le 2 ] || { echo "FAIL hook waited ${took}s for the rebuild"; fail=1; }
called || { echo "FAIL slow rebuild was not started"; fail=1; }
pkill -f "$bin/graphify" 2>/dev/null; rm -rf "$out/.session-rebuild.lock"

# (j) graphify writes to stdout and stderr: none of it reaches the session
reset; got=$(run STUB_MODE=junk); expect SPAWN "junk output" "being built" "$got"

# (k) a failed build leaves no stamp, so the next session tries again
reset; got=$(run STUB_MODE=fail); expect SPAWN "failed build" "being built" "$got"
[ -f "$out/.session-head" ] && { echo "FAIL stamp written after a failed build"; fail=1; }

# (l) a checkout where graphify-out cannot be written: no rebuild, and no claim that one runs
reset; fresh; echo 0000000 > "$out/.session-head"; chmod 555 "$out"
got=$(run); chmod 755 "$out"
[ -z "$got" ] || { echo "FAIL unwritable output dir must be quiet :: $got"; fail=1; }
sleep 0.5; [ -s "$calls" ] && { echo "FAIL unwritable output dir must not rebuild"; fail=1; }

# (m) a log past 1 MB is set aside before the next rebuild writes to it
reset; head -c 1100000 /dev/zero > "$work/log"; got=$(run); called; done_building
[ -f "$work/log.old" ] && [ "$(wc -c < "$work/log")" -lt 1048576 ] || { echo "FAIL a log past 1 MB was not set aside"; fail=1; }

[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
