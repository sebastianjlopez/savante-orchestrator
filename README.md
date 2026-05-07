# Savante Orchestrator

**Multi-agent autonomous development CLI** that drives a gated workflow over a **target GitHub repository**: domain understanding → architecture → planning → implementation → review → integration → deploy, with **explicit human approval gates** and durable state stored on GitHub.

This README is written for **engineering leadership**: stack, architecture, boundaries, and how it connects to **Jim Agent** (Slack) for gate notifications.

---

## Technical overview

**Purpose.** Orchestrate long-running, LLM-driven development work against `owner/repo` using specialized agents (analyst, architect, planner, developer, reviewer, integrator, deployer). Enforce quality checkpoints via a **finite-state machine** and persist progress in `orchestrator-state.json` on branch **`_orchestrator`** (not `main`), so state survives CLI sessions and can be audited in Git.

**What it is not.** Not a hosted SaaS: it is a **Node.js CLI** (`savante-orch`) meant to run where developers or automation have `GITHUB_TOKEN`, `OPENROUTER_API_KEY`, and optionally gate webhook settings.

---

## Stack

| Area | Choice |
|------|--------|
| Language | TypeScript **5.x**, **strict** mode |
| Runtime | **Node.js ≥ 18** |
| Module system | **ESM** (`"type": "module"`, `NodeNext` resolution) |
| CLI | **commander** |
| LLM access | **OpenAI SDK** client with **OpenRouter** base URL (`OPENROUTER_API_KEY` required) |
| GitHub | **@octokit/rest** — repos, contents, PRs, branches |
| AWS | **aws-sdk** — **Pricing API** for architecture cost hints (`AWSPriceClient`) |
| UX | **chalk**, **ora**, **@clack/prompts** |
| Validation / typing | **zod** (where used), shared TS types under `src/types/` |
| Tests | **Vitest** (`npm run test` / `test:run`) |

---

## Architecture

### CLI surface

Binary **`savante-orch`** (see `package.json` `bin`). Commands:

| Command | Role |
|---------|------|
| `init` | Bootstrap orchestration metadata for `--source` / `--target` repos |
| `start` | Run / advance the orchestration pipeline |
| `status` | Inspect current phase for `--target` |
| `approve` / `reject` | Human decisions at gates (`domain`, `architecture`, `code`, `deploy`) |
| `resume` | Continue after pause / external approval |

### State machine

Phases include `ANALYZING_DOMAIN`, `AWAITING_DOMAIN_APPROVAL`, `ANALYZING_ARCHITECTURE`, `AWAITING_TECH_APPROVAL`, `PLANNING_DEVELOPMENT`, `DEVELOPING`, `REVIEWING_CODE`, `INTEGRATING`, `AWAITING_CODE_APPROVAL`, `DEPLOYING`, `AWAITING_DEPLOY_APPROVAL`, `COMPLETED`. Valid transitions are centralized in `src/orchestrator/state-machine.ts`.

### Persistence

`StateStore` reads/writes **`orchestrator-state.json`** on branch **`_orchestrator`** via the GitHub Contents API (`src/orchestrator/state-store.ts`). This gives **versioned, branch-isolated** orchestration state without an external database.

### Agents

Each agent extends `BaseAgent` (`src/agents/base-agent.ts`), uses `RouterClient` (`src/llm/router-client.ts`) for OpenRouter chat + optional **tool calling**, and loads **per-agent model defaults** from `src/llm/model-config.ts`. Project-level overrides can be supplied via **`orchestrator-config.json`** in the working directory (`models`, `escalation_chain`).

Agent roles (by folder): **analyst**, **architect** (AWS stack + pricing tools), **planner**, **developer**, **reviewer**, **integrator**, **deployer**.

### Human gates and Slack (Jim)

When the process hits an approval phase, the orchestrator can emit a **`gate_reached`** JSON event over HTTP to a notifier (typically **Jim Agent**).

- **Contract:** `docs/gate-slack-contract.md`
- **Local E2E:** `docs/e2e-gate-slack-testing.md`
- **Env:** `GATE_WEBHOOK_URL` (e.g. `http://127.0.0.1:8765`), `GATE_WEBHOOK_SECRET` (must match Jim)

If `GATE_WEBHOOK_URL` is unset, notifications are skipped (CLI-only approvals).

Payload builder and POST logic: `src/notifications/gate-events.ts`, types in `src/notifications/gate-contract.ts`.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key for all LLM calls |
| `GITHUB_TOKEN` | Yes | GitHub PAT with repo scope for target (and source, for init/workflow) |
| `GATE_WEBHOOK_URL` | No | Base URL for Jim (or mock) gate notifier |
| `GATE_WEBHOOK_SECRET` | No | Shared secret; sent as `X-Gate-Webhook-Secret` |

AWS Pricing usage may require standard AWS credential chain if you enable paths that call `AWSPriceClient` (see `src/aws/pricing-client.ts`).

---

## Build and run

```bash
npm install
npm run build
npm run dev -- --help
# or after build:
node dist/cli/index.js --help
```

Run tests:

```bash
npm run test:run
```

---

## Repository layout (src)

```
src/
├── cli/              # Commander entrypoint and commands
├── orchestrator/     # State machine, gate manager, GitHub-backed state store
├── agents/           # Role-specific agents, prompts, tools
├── llm/              # OpenRouter client, model config, tool registry, context builder
├── github/           # Octokit wrappers (client, branch, PR, file ops)
├── notifications/    # Gate payload + HTTP emit to Jim
├── aws/              # AWS Pricing API helper
└── types/            # Domain, architecture, plan, orchestration state
```

---

## Relationship to Jim Agent

**Jim Agent** is the Slack onboarding bot; it optionally listens for orchestrator gate events and runs the same CLI approve/reject path a human would run locally. For an end-to-end checklist, see **`docs/e2e-gate-slack-testing.md`**.

---

## License

See repository root for license (if present).
