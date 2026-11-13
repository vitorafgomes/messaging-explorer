#!/bin/sh
# Runs a command inside the project's container instead of on this machine.
#
#   scripts/in-docker.sh <command> [arguments...]
#   scripts/in-docker.sh dotnet test src/ServiceBusExplorer.Core.Tests
#   EXPLORER_OFFLINE=1 scripts/in-docker.sh dotnet test --no-restore src/ServiceBusExplorer.Core.Tests
#
# The container sees one folder of this machine, the repository, at the same path it has here, so
# a path in an error message is the path on disk. Everything else it writes (the package caches,
# its home folder) lives in a Docker volume. It runs as the calling user with every Linux
# capability dropped. EXPLORER_OFFLINE=1 gives it no network at all. EXPLORER_CPUS sets how many
# processors it sees (8 unless set).
#
# There is no fallback: when Docker does not answer, the command does not run and the exit code
# is 2. The exit code of the command is passed through otherwise.

ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ $# -gt 0 ] || { echo "in-docker: give the command to run, for example: dotnet test src/ServiceBusExplorer.Api.Tests" >&2; exit 2; }
docker version --format '{{.Server.Version}}' >/dev/null 2>&1 \
  || { echo "in-docker: Docker does not answer, so nothing was run. Start Docker and try again." >&2; exit 2; }

DOCKERFILE="$ROOT/scripts/docker/Dockerfile"
IMAGE="explorer-dev:$(cksum < "$DOCKERFILE" | cut -d' ' -f1)"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "in-docker: building $IMAGE (first run, or the Dockerfile changed)" >&2
  docker build -q -t "$IMAGE" -f "$DOCKERFILE" "$(dirname "$DOCKERFILE")" >/dev/null || { echo "in-docker: the image did not build" >&2; exit 2; }
fi

# The home volume starts owned by root; hand it to the calling user once. The marker file keeps
# the volume from being empty: Docker resets the owner of an empty volume when it is first mounted.
VOLUME=explorer-dev-home
if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  docker volume create "$VOLUME" >/dev/null
  docker run --rm -u 0 -v "$VOLUME:/h" "$IMAGE" sh -c 'touch /h/.explorer-dev && chown "$1" /h /h/.explorer-dev' sh "$(id -u):$(id -g)" || exit 2
fi

case "$PWD/" in "$ROOT"/*) WORK=$PWD ;; *) WORK=$ROOT ;; esac

# Test runners start one worker per processor they see. With every processor of the machine and
# the memory Docker has, the desktop renderer suite is killed for lack of memory, so the container
# sees EXPLORER_CPUS processors: 8 unless set, never more than the machine has.
CPUS=${EXPLORER_CPUS:-8}; HOST_CPUS=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)
[ "$CPUS" -gt "$HOST_CPUS" ] && CPUS=$HOST_CPUS
[ -n "$EXPLORER_OFFLINE" ] && set -- --network none "$IMAGE" "$@" || set -- "$IMAGE" "$@"
[ -t 0 ] && [ -t 1 ] && set -- -t "$@"

exec docker run --rm --init -i \
  --user "$(id -u):$(id -g)" \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 4096 \
  --cpuset-cpus "0-$((CPUS - 1))" \
  -e HOME="$HOME" \
  -v "$VOLUME:$HOME" \
  -v "$ROOT:$ROOT" \
  -w "$WORK" \
  "$@"
