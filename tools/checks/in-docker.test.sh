#!/usr/bin/env bash
# Case matrix for in-docker.sh with a fake docker on PATH that records how it was called.
SCRIPT="$(cd "$(dirname "$0")" && pwd)/in-docker.sh"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$(cd "$(dirname "$0")/.." && pwd)"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
mkdir -p "$work/bin" "$work/none"
cat > "$work/bin/docker" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_LOG"
case "$1" in
  version) [ -n "$FAKE_DOWN" ] && exit 1; exit 0 ;;
  image|volume) exit 0 ;;
  run) exit "${FAKE_EXIT:-0}" ;;
esac
exit 0
FAKE
chmod +x "$work/bin/docker"
run() { : > "$work/log"; out=$(cd "${DIR:-$ROOT}" && PATH="$work/bin:$PATH" FAKE_LOG="$work/log" "$@" 2>&1); rc=$?; last=$(grep '^run ' "$work/log" | tail -1); }
has() { case "$last" in *"$2"*) ;; *) echo "FAIL $1 :: missing '$2' in: $last"; fail=1 ;; esac; }
lacks() { case "$last" in *"$2"*) echo "FAIL $1 :: found '$2' in: $last"; fail=1 ;; esac; }

run sh "$SCRIPT" dotnet test src/ServiceBusExplorer.Api.Tests
[ "$rc" = 0 ] || { echo "FAIL a passing command exits 0, got $rc"; fail=1; }
has "the command is passed through"            " dotnet test src/ServiceBusExplorer.Api.Tests"
has "the repository is mounted at its own path" "-v $ROOT:$ROOT"
has "it runs as the calling user"               "--user $(id -u):$(id -g)"
has "capabilities are dropped"                  "--cap-drop ALL"
has "privilege cannot be gained"                "no-new-privileges"
has "the container sees a bounded number of processors" "--cpuset-cpus 0-"
lacks "the Docker socket is never mounted"      "docker.sock"
lacks "the network is on unless asked"          "--network none"
[ "$(grep -c -- ' -v ' <<<"${last// -v /$'\n' -v }")" = 2 ] || { echo "FAIL exactly two mounts, the home volume and the repository :: $last"; fail=1; }

run env EXPLORER_OFFLINE=1 sh "$SCRIPT" dotnet test --no-restore
has "EXPLORER_OFFLINE gives no network" "--network none"

run env FAKE_EXIT=3 sh "$SCRIPT" dotnet test
[ "$rc" = 3 ] || { echo "FAIL the exit code of the command is passed through, got $rc"; fail=1; }

DIR="$TOOLS" run sh "$SCRIPT" ls
has "a folder inside the repository stays the working folder" "-w $TOOLS"
DIR="$work/none" run sh "$SCRIPT" ls
has "a folder outside the repository becomes the repository root" "-w $ROOT "

run env FAKE_DOWN=1 sh "$SCRIPT" dotnet test
[ "$rc" = 2 ] || { echo "FAIL without Docker the exit code is 2, got $rc"; fail=1; }
[ -z "$last" ] || { echo "FAIL without Docker nothing runs :: $last"; fail=1; }
printf '%s' "$out" | grep -q "nothing was run" || { echo "FAIL without Docker the message says nothing was run :: $out"; fail=1; }

run sh "$SCRIPT"
[ "$rc" = 2 ] || { echo "FAIL no command exits 2, got $rc"; fail=1; }

[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
