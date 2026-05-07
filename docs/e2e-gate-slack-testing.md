# End-to-end test: Savante orchestrator ↔ Jim (Slack gates)

This guide verifies the full loop: orchestrator reaches a gate → Jim receives `gate_reached` → Slack shows Approve / Reject → Jim runs `savante-orch approve|reject` + `resume` like the CLI.

## Prerequisites

- Two clones side by side (or two machines reachable over HTTP): **`savante-orchestrator`** and **`jim-agent`**.
- **GitHub**: personal access token with repo scope for your org/user used by both tools.
- **Slack app**: Socket Mode enabled; **Interactivity** enabled (required for Block Kit buttons and modals). Bot token scopes must include at least `chat:write`; for modals you typically need the app to open views (ensure Interactivity is on in the Slack app settings).
- **Python 3.10+** and **Node 18+**.

## 1. Build and install

```bash
# Orchestrator
cd savante-orchestrator
npm install
npm run build
```

Install the CLI globally or note the path to `dist/cli/index.js`:

```bash
npm link
# or: node dist/cli/index.js …
```

```bash
# Jim
cd ../jim-agent
pip install -r requirements.txt
```

## 2. Align environment variables

Use the **same shared secret** on both sides so arbitrary clients cannot POST fake gate events to Jim.

### Jim (`jim-agent/.env`)

| Variable | Purpose |
|----------|---------|
| `SLACK_BOT_USER_OAUTH_TOKEN` | Bot OAuth token (`xoxb-…`) |
| `SLACK_APP_TOKEN` | App-level token for Socket Mode (`xapp-…`) |
| `GITHUB_TOKEN` | Same capability as orchestrator (approve/resume updates GitHub state) |
| `GATE_WEBHOOK_SECRET` | Shared secret; Jim validates `X-Gate-Webhook-Secret` on incoming POSTs |
| `JIM_GATE_HTTP_HOST` | Bind address (default `127.0.0.1`) |
| `JIM_GATE_HTTP_PORT` | Default `8765` |
| `DEFAULT_GATE_CHANNEL_ID` | Slack channel **ID** (e.g. `C0123456789`) where gate messages post if CRM/state do not supply a channel |
| `SAVANTE_ORCH_BIN` | Optional full path to `savante-orch` if not on `PATH` |

### Orchestrator (shell env when running `savante-orch`)

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | Required for state + commits |
| `GATE_WEBHOOK_URL` | Base URL of Jim’s listener, e.g. `http://127.0.0.1:8765` |
| `GATE_WEBHOOK_SECRET` | Must match Jim’s `GATE_WEBHOOK_SECRET` |

Optional on orchestrator state (`orchestrator-state.json`): `slack_delivery_channel_id` — otherwise Jim falls back to CRM (`delivery_slack_channel_id` + `github_repo_full_name` in Supabase notes from onboarding) or `DEFAULT_GATE_CHANNEL_ID`.

## 3. Invite the bot

Invite the Slack app to the channel you use for **DEFAULT_GATE_CHANNEL_ID** (or the client delivery channel). The bot must be able to post messages there.

## 4. Start Jim (listener + Socket Mode)

```bash
cd jim-agent
python app.py
```

Confirm in logs that the gate webhook is up, for example:

`Gate webhook listening on http://127.0.0.1:8765/internal/gate-reached`

Leave this process running.

## 5. Smoke test: webhook only (no LLM)

Send a minimal `gate_reached` payload **without** running analysis:

```bash
# PowerShell: set secret to match .env
$secret = "your-shared-secret"
$body = @{
  type = "gate_reached"
  schema_version = "1.0"
  project_id = "test-project"
  target_repo = "YOUR_ORG/YOUR_REPO"
  gate = "domain"
  phase = "AWAITING_DOMAIN_APPROVAL"
  artifact_paths = @("docs/domain-analysis.md")
  artifact_urls = @("https://github.com/YOUR_ORG/YOUR_REPO/blob/_orchestrator/docs/domain-analysis.md")
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://127.0.0.1:8765/internal/gate-reached" `
  -Method POST `
  -Headers @{ "X-Gate-Webhook-Secret" = $secret; "Content-Type" = "application/json" } `
  -Body $body
```

Expected:

- HTTP **200** with `{"ok":true}`.
- A message appears in Slack with **Approve** and **Reject**.

If you get **202** with `skipped: no_channel`, set `DEFAULT_GATE_CHANNEL_ID` or add channel mapping (see contract doc).

```bash
# bash equivalent
curl -sS -X POST "http://127.0.0.1:8765/internal/gate-reached" \
  -H "Content-Type: application/json" \
  -H "X-Gate-Webhook-Secret: your-shared-secret" \
  -d '{"type":"gate_reached","schema_version":"1.0","project_id":"p","target_repo":"ORG/REPO","gate":"domain","phase":"AWAITING_DOMAIN_APPROVAL","artifact_paths":["docs/domain-analysis.md"],"artifact_urls":["https://github.com/ORG/REPO/blob/_orchestrator/docs/domain-analysis.md"]}'
```

## 6. Test Slack buttons → CLI

Use the smoke message from step 5 (or a real gate from step 7).

1. Click **Approve**.
2. Jim should run `savante-orch approve --target ORG/REPO --gate domain` then `savante-orch resume --target ORG/REPO`.
3. A thread reply should show CLI output or an error string.

**Reject**: opens a modal; submit feedback. Jim runs `reject` with `--feedback` then `resume`.

If clicking does nothing, confirm Socket Mode receives **interactive** payloads and Interactivity is enabled in the Slack app dashboard.

## 7. Full orchestrator path (optional, uses LLM APIs)

Requires valid `GITHUB_TOKEN`, target repo, and configured agents (e.g. OpenRouter for analyst if applicable).

```bash
cd savante-orchestrator
$env:GITHUB_TOKEN="ghp_..."
$env:GATE_WEBHOOK_URL="http://127.0.0.1:8765"
$env:GATE_WEBHOOK_SECRET="your-shared-secret"

savante-orch init --source owner/template --target owner/my-target-repo
savante-orch start --target owner/my-target-repo
```

After domain analysis completes, the orchestrator persists state and emits `gate_reached`. You should see the same style of Slack message as in step 5.

Then approve via Slack or CLI:

```bash
savante-orch approve --target owner/my-target-repo --gate domain
savante-orch resume --target owner/my-target-repo
```

## 8. Onboarding → CRM channel mapping (optional)

If the client repo was created via Jim onboarding, Supabase **client notes** should contain `github_repo_full_name` and `delivery_slack_channel_id`. Jim can resolve the Slack channel from `target_repo` without `DEFAULT_GATE_CHANNEL_ID`. Ensure Supabase credentials in Jim’s `.env` are correct when testing that path.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Orchestrator never notifies | `GATE_WEBHOOK_URL` set? Firewall? Jim listening? |
| 401 from Jim | `GATE_WEBHOOK_SECRET` matches on POST header and Jim `.env` |
| 202 no_channel | `DEFAULT_GATE_CHANNEL_ID`, state `slack_delivery_channel_id`, or CRM mapping |
| Buttons appear but CLI fails | `GITHUB_TOKEN`; `savante-orch` on PATH or `SAVANTE_ORCH_BIN`; repo exists and `_orchestrator` branch has state |
| Modal / buttons dead | Slack app Interactivity + Socket Mode; bot scopes |

## Related docs

- [Gate ↔ Slack contract](./gate-slack-contract.md) — payload shape and headers.
