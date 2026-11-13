#!/usr/bin/env bash
# Opens Claude Code for this repo with only what the work needs switched on.
#
#   tools/dev/claude-session.sh [worker|ui] [arguments for claude...]
#
#   worker (default)   the .NET worker: the Rider server
#   ui                 the web app as well: Rider, WebStorm and the Angular CLI's server
#
# Both keep the memory server of the claude-mem plugin when that plugin is installed, and both
# switch off, for this session only, the plugins this repo has no use for. Nothing in the user's
# own configuration is changed: the servers are read from ~/.claude.json by name, written to a
# temporary file that is removed when the session ends, and every server not named here is left
# out of this session.
#
# Measured in an empty folder: a session opens with 40,700 tokens with everything on, 36,400
# with the worker profile and 37,400 with the ui profile.

set -u
PROFILE=worker
case "${1:-}" in worker|ui) PROFILE=$1; shift ;; esac
case "$PROFILE" in
  worker) SERVERS='["rider"]' ;;
  ui)     SERVERS='["rider","webstorm"]' ;;
esac
UNUSED='{"enabledPlugins":{"aws-agents@claude-plugins-official":false,"dotnet-blazor@dotnet-agent-skills":false,"dotnet-maui@dotnet-agent-skills":false,"product-management@knowledge-work-plugins":false,"typesafe@typesafe-ai":false}}'

for tool in claude jq; do command -v "$tool" >/dev/null || { echo "claude-session: $tool is required" >&2; exit 2; }; done
USER_CONFIG="${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json"
[ -f "$USER_CONFIG" ] || USER_CONFIG="$HOME/.claude.json"
CONFIG=$(mktemp) || exit 2
chmod 600 "$CONFIG"; trap 'rm -f "$CONFIG"' EXIT

jq --argjson names "$SERVERS" '{mcpServers: ((.mcpServers // {}) | with_entries(select(.key as $k | $names | index($k))))}' "$USER_CONFIG" > "$CONFIG" 2>/dev/null \
  || echo '{"mcpServers":{}}' > "$CONFIG"

# The memory server belongs to a plugin, and a session limited to named servers drops it, so it is
# added back from the plugin's own definition.
PLUGINS="$HOME/.claude/plugins/installed_plugins.json"
MEM=$(jq -r '.plugins["claude-mem@thedotmack"][0].installPath // empty' "$PLUGINS" 2>/dev/null)
if [ -n "$MEM" ] && [ -f "$MEM/.mcp.json" ]; then
  jq --arg root "$MEM" --slurpfile mem "$MEM/.mcp.json" \
    '.mcpServers += ($mem[0].mcpServers | with_entries(.value |= (tostring | gsub("\\$\\{CLAUDE_PLUGIN_ROOT\\}"; $root) | fromjson)))' \
    "$CONFIG" > "$CONFIG.new" && mv "$CONFIG.new" "$CONFIG"
fi

# The ui profile adds the servers the repository itself declares, such as the Angular CLI's.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PROJECT_SERVERS="$ROOT/.mcp.json"
if [ "$PROFILE" = ui ] && [ -f "$PROJECT_SERVERS" ]; then
  jq --slurpfile project "$PROJECT_SERVERS" '.mcpServers += ($project[0].mcpServers // {})' "$CONFIG" > "$CONFIG.new" && mv "$CONFIG.new" "$CONFIG"
fi

missing=$(jq -r --argjson names "$SERVERS" '$names - (.mcpServers | keys) | join(", ")' "$CONFIG")
[ -z "$missing" ] || echo "claude-session: not configured on this machine, left out: $missing" >&2

claude --strict-mcp-config --mcp-config "$CONFIG" --settings "$UNUSED" "$@"
