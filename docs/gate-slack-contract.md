# Gate ↔ Slack integration contract

For step-by-step local verification (orchestrator + Jim + Slack), see [e2e-gate-slack-testing.md](./e2e-gate-slack-testing.md).

## Overview

When the orchestrator reaches a human gate (`AWAITING_*_APPROVAL`), it emits a **`gate_reached`** JSON event to Jim (or another notifier) over HTTP. Jim posts a Block Kit message with Approve / Reject actions. Human decisions run the same path as the CLI: `savante-orch approve|reject` followed by `savante-orch resume`.

## Transport: orchestrator → Jim

- **Method:** `POST`
- **Path:** `/internal/gate-reached` (Jim’s HTTP listener)
- **Header:** `X-Gate-Webhook-Secret: <shared secret>` — required when `GATE_WEBHOOK_SECRET` is set on both sides
- **Body:** JSON `GateReachedEvent` (see TypeScript `src/notifications/gate-contract.ts`)

If `GATE_WEBHOOK_URL` is unset, the orchestrator skips notification (CLI-only workflow).

## Payload: `gate_reached`

| Field | Type | Description |
|--------|------|-------------|
| `type` | `"gate_reached"` | Discriminator |
| `schema_version` | `"1.0"` | Contract version |
| `project_id` | string | From `orchestrator-state.json` |
| `target_repo` | string | `owner/repo` |
| `gate` | string | `domain` \| `architecture` \| `code` \| `deploy` |
| `phase` | string | Current phase (e.g. `AWAITING_DOMAIN_APPROVAL`) |
| `artifact_paths` | string[] | Repo-relative paths |
| `artifact_urls` | string[] | GitHub blob URLs on `_orchestrator` |
| `slack_delivery_channel_id` | string? | Optional; from state or resolved by Jim |
| `slack_thread_ts` | string? | Optional threading |

## Payload: `gate_decision` (informational)

Reserved for logging or a future inbound API. Primary flow uses Slack interactive actions → subprocess CLI.

## Environment variables

### Orchestrator

| Variable | Description |
|----------|-------------|
| `GATE_WEBHOOK_URL` | Base URL for Jim (e.g. `http://127.0.0.1:8765`) |
| `GATE_WEBHOOK_SECRET` | Shared secret for `X-Gate-Webhook-Secret` |

### Jim

| Variable | Description |
|----------|-------------|
| `GATE_WEBHOOK_SECRET` | Must match orchestrator |
| `JIM_GATE_HTTP_HOST` | Bind host (default `127.0.0.1`) |
| `JIM_GATE_HTTP_PORT` | Port (default `8765`) |
| `SLACK_SIGNING_SECRET` | For validating Slack-request payloads if using HTTP interactivity |
| `SAVANTE_ORCH_BIN` | Path to `savante-orch` if not on `PATH` |
