#!/usr/bin/env bash
# Publishes a few sample messages to the local RabbitMQ of this folder, one set per tutorial scenario,
# through its management API on loopback. Run it after `docker compose up -d`; running it again adds
# the messages again.
set -euo pipefail

api="http://127.0.0.1:15672/api"
auth="explorer:explorer"

publish() {
  local exchange="$1" key="$2" payload="$3" properties="${4:-{\}}"
  local body
  body=$(printf '{"properties":%s,"routing_key":"%s","payload":"%s","payload_encoding":"string"}' "$properties" "$key" "$payload")
  printf '%-14s %-16s %s  ' "${exchange}" "${key:-(none)}" "$payload"
  curl -sS -u "$auth" -H 'content-type: application/json' -X POST "$api/exchanges/%2F/$exchange/publish" -d "$body"
  echo
}

text='{"content_type":"text/plain","delivery_mode":2}'

# 1. Hello World: one queue, through the default exchange.
publish amq.default hello 'Hello World!' "$text"

# 2. Work Queues: tasks waiting for workers.
for task in 'First task.' 'Second task..' 'Third task...'; do publish amq.default task_queue "$task" "$text"; done

# 3. Publish/Subscribe: a fanout exchange copies each message to every bound queue.
publish logs '' 'info: Hello World!' "$text"
publish logs '' 'info: a second log line' "$text"

# 4. Routing: a direct exchange, bound by severity.
publish direct_logs info 'A message of severity info' "$text"
publish direct_logs warning 'A message of severity warning' "$text"
publish direct_logs error 'A message of severity error' "$text"

# 5. Topics: a topic exchange, bound by pattern.
publish topic_logs kern.critical 'A critical kernel error' "$text"
publish topic_logs kern.info 'A kernel info line' "$text"
publish topic_logs auth.critical 'A critical auth error' "$text"

# 6. RPC: a request that names where the reply goes.
publish amq.default rpc_queue '30' '{"content_type":"text/plain","reply_to":"rpc.replies","correlation_id":"5a1c1a52-0c0e-4f8e-9b1e-3f4d2a7c9e10"}'

# Streams 1 and 2: messages kept in order, read from a position.
for line in 'Hello, stream!' 'second line' 'marker'; do publish amq.default stream.hello "$line" "$text"; done
