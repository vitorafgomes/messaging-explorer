#!/bin/sh
# SessionStart hook: keep the graphify code graph of this checkout fresh without delaying the session.
#
# Fresh means the graph was built by this hook from the current HEAD and no source file changed
# since. A missing or stale graph is rebuilt in the background, detached, one rebuild per checkout
# at a time, and the session is told in one line whether the graph can be trusted yet. Without
# graphify on PATH, or outside a git checkout, it says nothing: graphify is optional here.

cat >/dev/null 2>&1

GRAPHIFY="${GRAPHIFY_BIN:-graphify}"
command -v "$GRAPHIFY" >/dev/null 2>&1 || exit 0
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
HEAD=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null) || exit 0
SHORT=$(printf '%.7s' "$HEAD")
OUT="$ROOT/graphify-out"
GRAPH="$OUT/graph.json"
STAMP="$OUT/.session-head"
LOCK="$OUT/.session-rebuild.lock"
LOG="${GRAPHIFY_SESSION_LOG:-${HOME}/.cache/graphify-session.log}"

say() {
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$1"
}

newer_source() {
  (cd "$ROOT" && find src web-app/src web-app/electron \
    \( -name node_modules -o -name bin -o -name obj \) -prune -o \
    -type f \( -name '*.cs' -o -name '*.ts' -o -name '*.js' \) -newer "$GRAPH" -print 2>/dev/null | head -n 1)
}

if [ ! -f "$GRAPH" ]; then
  reason="no graph in this checkout yet"
elif [ "$(cat "$STAMP" 2>/dev/null)" != "$HEAD" ]; then
  reason="not built from HEAD $SHORT"
elif [ -n "$(newer_source)" ]; then
  reason="source files changed since the build"
else
  say "graphify: graphify-out/graph.json is current with HEAD $SHORT and the working tree; ask it (explain, affected) before reading files."
  exit 0
fi

mkdir -p "$OUT" 2>/dev/null
if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
  rmdir "$LOCK" 2>/dev/null
fi
if ! mkdir "$LOCK" 2>/dev/null; then
  # Only an existing lock means a rebuild runs; a checkout it cannot write to gets no claim of one.
  [ -d "$LOCK" ] && say "graphify: another session is rebuilding the code graph; until it ends, its answers reflect the previous build."
  exit 0
fi

if [ -f "$GRAPH" ]; then
  message="graphify: the code graph is being rebuilt in the background ($reason), about 15 seconds; until then its answers reflect the previous build."
else
  message="graphify: the code graph is being built in the background ($reason), about 15 seconds; graphify commands fail until it ends."
fi

mkdir -p "$(dirname "$LOG")" 2>/dev/null
# The log keeps the last rebuilds only: past 1 MB it starts again, the previous one kept as .old.
if [ -n "$(find "$LOG" -size +1024k 2>/dev/null)" ]; then
  mv -f "$LOG" "$LOG.old" 2>/dev/null
fi
DETACH=""
command -v setsid >/dev/null 2>&1 && DETACH="setsid"
# The job runs in its own session with every stream closed, so the hook returns at once and no
# output of graphify reaches the session. The stamp is written only after a build that succeeded.
$DETACH nohup sh -c '
  trap "rmdir \"$4\" 2>/dev/null" EXIT
  cd "$1" || exit 1
  printf "[%s] %s: rebuilding the graph at %s\n" "$(date)" "$1" "$3"
  "$2" update . && printf "%s\n" "$3" > "$5"
' sh "$ROOT" "$GRAPHIFY" "$HEAD" "$LOCK" "$STAMP" </dev/null >>"$LOG" 2>&1 &

say "$message"
exit 0
