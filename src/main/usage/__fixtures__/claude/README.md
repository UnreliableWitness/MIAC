# Recorded Claude Code OTLP fixtures

Real OTLP/HTTP JSON request bodies from one `claude -p "Reply with the single word OK"` run,
captured with `tools/telemetry/record-otlp.mjs`.

- Claude Code version: 2.1.299
- Date: 2026-10-14
- Env used: `CLAUDE_CODE_ENABLE_TELEMETRY=1 OTEL_LOGS_EXPORTER=otlp OTEL_METRICS_EXPORTER=otlp
  OTEL_EXPORTER_OTLP_PROTOCOL=http/json OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4399
  OTEL_LOGS_EXPORT_INTERVAL=1000 OTEL_METRIC_EXPORT_INTERVAL=1000
  OTEL_RESOURCE_ATTRIBUTES=miac.task.id=00000000-0000-4000-8000-000000000001`

## Files

- `api-request-logs.json`: the `/v1/logs` body (resourceLogs) that holds `claude_code.api_request`
  (plus an `assistant_response`, hook and mcp events in the same batch).
- `metrics.json`: a `/v1/metrics` body (`claude_code.cost.usage`, `claude_code.token.usage`,
  `claude_code.active_time.total`).

## Findings

- Event name: in the log record `body.stringValue`, prefixed (`claude_code.api_request`). The
  `event.name` attribute holds the unprefixed name (`api_request`).
- Integers: `{"intValue": <JSON number>}` (not a string) for logs, e.g. `input_tokens`.
  Doubles use `doubleValue` (`cost_usd`). Metric data points use `asDouble` even for token counts (e.g. `"asDouble": 10584`).
- `miac.task.id`: present both as a resource attribute and as a log record / metric data point
  attribute.
- Attribute keys on `claude_code.api_request`: miac.task.id, user.id, session.id, organization.id,
  user.email, user.account_uuid, user.account_id, terminal.type, event.name, event.timestamp,
  event.sequence, prompt.id, model, input_tokens, output_tokens, cache_read_tokens,
  cache_creation_tokens, cost_usd, cost_usd_micros, duration_ms, ttft_ms, request_id,
  client_request_id, speed, query_source, effort.
- Redacted (values set to `redacted`, keys kept): user.id, user.email, user.account_uuid,
  user.account_id, organization.id.
- Prompt text appears only on `claude_code.user_prompt` (not in these fixtures); the
  `assistant_response` `response` attribute is `<REDACTED>` by default.
