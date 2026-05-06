# Architecture Plan — Multi-Agent Autonomous Development System

## 1. Technology Stack Decision

### Runtime and language
**TypeScript on Node.js.** The `openai` SDK (used for OpenRouter) is native TS, GitHub integration via Octokit is native, and all CLI tooling in Node is solid. Python remains an option for specific agents if libraries justify it, but the orchestrator and CLI are in TS.

### LLM backend
**OpenRouter as unified gateway.** Used exclusively with open-weight models optimized for code and agents. The priority is mass code production with the best quality/cost ratio. Uses the `openai` SDK (OpenRouter-compatible) pointing to `https://openrouter.ai/api/v1`.

**Model arsenal — exact OpenRouter IDs:**

| Model | OpenRouter ID | Input/M | Output/M | Context | Profile |
|-------|--------------|---------|----------|---------|---------|
| Kimi K2.6 | `moonshotai/kimi-k2.6` | $0.74 | $3.49 | 262K | Agent-first: multi-agent orchestration, robust tool use, 300 parallel sub-agents |
| DeepSeek V4 Pro | `deepseek/deepseek-v4-pro` | $1.74 | $3.48 | 1M | Coding-first: most accurate for code, massive 1M token context |
| Tencent Hy3 Preview | `tencent/hy3-preview` | free* | free* | 262K | Wildcard: strong in coding agents, configurable reasoning (disabled/low/high) |
| Kimi K2.5 | `moonshotai/kimi-k2.5` | $0.44 | $2.00 | 262K | Cheap workhorse: visual coding, solid tool-calling, K2.6 predecessor |
| DeepSeek V3.2 | `deepseek/deepseek-v3.2` | $0.25 | $0.38 | 131K | Ultra-cheap: most economical, good coding with optional reasoning |

*Hy3 Preview has free access for a limited time on OpenRouter. Final pricing TBD, estimated ~1/10 of GPT-4.

**Recommended model assignment per agent:**

| Agent | Primary model | Fallback | Rationale |
|-------|--------------|----------|-----------|
| Analyst | `moonshotai/kimi-k2.6` | `deepseek/deepseek-v4-pro` | K2.6 excels at tool use and reading long documentation. V4 Pro as fallback for its 1M context |
| AWS Architect | `deepseek/deepseek-v4-pro` | `moonshotai/kimi-k2.6` | V4 Pro has the broadest knowledge and largest context for deep technical analysis |
| Developers | `deepseek/deepseek-v3.2` | `moonshotai/kimi-k2.5` | V3.2 at $0.25/$0.38 per million for mass code production. K2.5 as upgrade if quality falls short |
| Reviewer | `moonshotai/kimi-k2.5` | `tencent/hy3-preview` | K2.5 is sufficient for evaluating against specs. Hy3 as free alternative |
| Integrator | `deepseek/deepseek-v3.2` | `moonshotai/kimi-k2.5` | Scoped task, doesn't justify an expensive model |
| Deployer | `deepseek/deepseek-v3.2` | `moonshotai/kimi-k2.5` | Predictable command execution |
| Orchestrator | `moonshotai/kimi-k2.6` | `deepseek/deepseek-v4-pro` | The orchestrator needs the best tool use — K2.6 was designed exactly for this |

**Model escalation logic:** if an agent fails 2 consecutive times with its primary model (invalid output, malformed tool call, or unacceptable quality on review), the system automatically escalates to the next model in the chain. The default chain is: V3.2 → K2.5 → K2.6 → V4 Pro. Every escalation is logged in the orchestrator state.

This assignment is configurable per project. OpenRouter supports automatic fallback with `route: "fallback"` — if a model is down, it routes to the next one without intervention.

### GitHub interaction
`@octokit/rest` for all programmatic interaction: cloning repos, reading files, creating branches, opening PRs, merging, reading comments. The GitHub repo is the source of truth — no parallel database.

### Process state
An `orchestrator-state.json` file in the target repo root (on a dedicated `_orchestrator` branch) that tracks the current phase, pending gates, decisions made, and approval history. Git commit history as audit trail.

### CLI
A console application built with `commander` + `inquirer` (or `@clack/prompts` for a more modern UX). The human supervisor interacts exclusively through this CLI.

### OpenRouter integration — technical details

**Basic connection.** Uses the `openai` npm SDK, changing only the `baseURL`:

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
```

**Tool use.** Uses the standard OpenAI function calling format. OpenRouter passes it transparently to the model that supports it. The tool definition is the same regardless of model:

```typescript
const response = await client.chat.completions.create({
  model: "moonshotai/kimi-k2.6",  // or any of the 5 models
  messages: [...],
  tools: [
    {
      type: "function",
      function: {
        name: "read_repo_file",
        description: "Reads a file from the repository",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
      }
    }
  ]
});
```

**Per-project configuration.** The project configuration file defines which model each agent uses:

```json
{
  "models": {
    "analyst": { "primary": "moonshotai/kimi-k2.6", "fallback": "deepseek/deepseek-v4-pro" },
    "architect": { "primary": "deepseek/deepseek-v4-pro", "fallback": "moonshotai/kimi-k2.6" },
    "developer": { "primary": "deepseek/deepseek-v3.2", "fallback": "moonshotai/kimi-k2.5" },
    "reviewer": { "primary": "moonshotai/kimi-k2.5", "fallback": "tencent/hy3-preview" },
    "integrator": { "primary": "deepseek/deepseek-v3.2", "fallback": "moonshotai/kimi-k2.5" },
    "deployer": { "primary": "deepseek/deepseek-v3.2", "fallback": "moonshotai/kimi-k2.5" },
    "orchestrator": { "primary": "moonshotai/kimi-k2.6", "fallback": "deepseek/deepseek-v4-pro" }
  },
  "escalation_chain": ["deepseek/deepseek-v3.2", "moonshotai/kimi-k2.5", "moonshotai/kimi-k2.6", "deepseek/deepseek-v4-pro"],
  "max_retries_before_escalation": 2
}
```

**Recommended headers.** OpenRouter allows passing useful metadata for tracking:

```typescript
headers: {
  "HTTP-Referer": "https://savante.dev",
  "X-Title": "savante-orchestrator"
}
```

---

## 2. Project Structure

```
savante-orchestrator/
├── src/
│   ├── cli/                    # Console interface
│   │   ├── index.ts            # Entry point, command parsing
│   │   ├── commands/
│   │   │   ├── init.ts         # Initialize project from repo
│   │   │   ├── status.ts       # View current process state
│   │   │   ├── approve.ts      # Approve a gate
│   │   │   ├── reject.ts       # Reject with feedback
│   │   │   └── resume.ts       # Resume paused process
│   │   └── ui/
│   │       ├── prompts.ts      # Interactive prompts
│   │       └── display.ts      # Console output formatting
│   │
│   ├── orchestrator/           # System brain
│   │   ├── orchestrator.ts     # Main orchestration loop
│   │   ├── state-machine.ts    # Process state machine
│   │   ├── state-store.ts      # State read/write to Git
│   │   └── gate-manager.ts     # Gate and approval logic
│   │
│   ├── agents/                 # Each agent as a module
│   │   ├── base-agent.ts       # Base class: model call + tools
│   │   ├── analyst/
│   │   │   ├── agent.ts        # Analyst agent
│   │   │   ├── prompts.ts      # Analyst system prompt
│   │   │   └── tools.ts        # Tools: read repo files
│   │   ├── architect/
│   │   │   ├── agent.ts        # AWS architect agent
│   │   │   ├── prompts.ts      # Architect system prompt
│   │   │   └── tools.ts        # Tools: query AWS pricing, etc.
│   │   ├── developer/
│   │   │   ├── agent.ts        # Development agent
│   │   │   ├── prompts.ts      # Developer system prompt
│   │   │   └── tools.ts        # Tools: write code, create files
│   │   ├── reviewer/
│   │   │   ├── agent.ts        # Code reviewer agent
│   │   │   ├── prompts.ts      # Reviewer system prompt
│   │   │   └── tools.ts        # Tools: read diffs, comment on PRs
│   │   ├── integrator/
│   │   │   ├── agent.ts        # Integrator agent
│   │   │   ├── prompts.ts
│   │   │   └── tools.ts        # Tools: merge, resolve conflicts
│   │   └── deployer/
│   │       ├── agent.ts        # Deployment agent
│   │       ├── prompts.ts
│   │       └── tools.ts        # Tools: run CDK/Terraform
│   │
│   ├── github/                 # GitHub abstraction layer
│   │   ├── client.ts           # Octokit wrapper
│   │   ├── repo-reader.ts      # Read repo contents
│   │   ├── branch-manager.ts   # Create/manage branches
│   │   ├── pr-manager.ts       # Create/review/merge PRs
│   │   └── file-writer.ts      # Commit files to repo
│   │
│   ├── llm/                    # OpenRouter abstraction layer
│   │   ├── router-client.ts    # OpenAI SDK wrapper pointing to OpenRouter
│   │   ├── model-config.ts     # Agent → model map (configurable per project)
│   │   ├── tool-registry.ts    # Global tool registry (OpenAI function calling format)
│   │   └── context-builder.ts  # Per-agent context construction
│   │
│   └── types/                  # Shared types
│       ├── domain.ts           # Domain document types
│       ├── architecture.ts     # Architecture analysis types
│       ├── plan.ts             # Development plan types
│       └── state.ts            # Orchestrator state types
│
├── templates/                  # System prompt templates
│   ├── analyst.md
│   ├── architect.md
│   ├── developer.md
│   ├── reviewer.md
│   ├── integrator.md
│   └── deployer.md
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## 3. Orchestrator State Machine

The complete process is modeled as a finite state machine. Each transition requires either an agent action or a human approval.

```
INIT
  │
  ▼
ANALYZING_DOMAIN ──► AWAITING_DOMAIN_APPROVAL (Gate 1)
  ▲                        │
  └── feedback ────────────┘
                           │ approved
                           ▼
              ANALYZING_ARCHITECTURE ──► AWAITING_TECH_APPROVAL (Gate 2)
                ▲                              │
                └── feedback ──────────────────┘
                                               │ approved
                                               ▼
                                    PLANNING_DEVELOPMENT
                                               │
                                               ▼
                                    DEVELOPING (N parallel branches)
                                               │
                                               ▼
                                    REVIEWING_CODE (per PR)
                                     ▲         │
                                     └─ reject ┘
                                               │ all approved
                                               ▼
                                    INTEGRATING
                                               │
                                               ▼
                                    AWAITING_CODE_APPROVAL (Gate 3)
                                     ▲         │
                                     └─ changes┘
                                               │ approved
                                               ▼
                                    DEPLOYING
                                               │
                                               ▼
                                    AWAITING_DEPLOY_APPROVAL (Gate 4)
                                               │
                                               ▼
                                    COMPLETED
```

### State format persisted in Git

```json
{
  "version": "1.0",
  "project_id": "uuid",
  "source_repo": "owner/repo-docs",
  "target_repo": "owner/repo-code",
  "current_phase": "ANALYZING_DOMAIN",
  "gates": {
    "domain": { "status": "pending", "attempts": 0, "feedback": [] },
    "architecture": { "status": "not_reached", "attempts": 0, "feedback": [] },
    "code": { "status": "not_reached", "attempts": 0, "feedback": [] },
    "deploy": { "status": "not_reached", "attempts": 0, "feedback": [] }
  },
  "artifacts": {
    "domain_document": null,
    "architecture_document": null,
    "development_plan": null
  },
  "modules": [],
  "decisions_log": [],
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

---

## 4. Agent Design

### Common pattern: BaseAgent

All agents inherit from a base class that encapsulates:

1. The call to the assigned model via OpenRouter with its specific system prompt.
2. A set of tools (functions) in OpenAI function calling format — compatible with all models that support tool use on OpenRouter.
3. A tool use loop that allows the agent to execute multiple actions before giving its final response.
4. Structured logging of each step for auditing.
5. The model to use, read from `model-config.ts` — can be changed without touching agent logic.

The loop works as follows: the prompt is sent to the model via OpenRouter → the model can respond with text or with a tool invocation → if it invokes a tool, it's executed and the result is returned as `tool_result` → the model continues reasoning → until it responds with text only (final response).

**Important consideration about tool use:** the 5 selected models all support function calling, but with differences. K2.6 was explicitly designed for massive tool use (4,000+ tool calls, 300 sub-agents). V4 Pro and V3.2 have solid tool use. K2.5 also works well. Hy3 Preview is the newest and Tencent acknowledges limitations in tool call error recovery. `base-agent.ts` must handle this: if a model doesn't return a valid tool call, it retries with a reformulated prompt or escalates to the next model in the configured chain.

### Analyst Agent

**Input:** URL of the repo with documentation.
**Output:** Domain document in markdown format, committed to the target repo.

**Available tools:**
- `read_repo_file(path)` — reads a file from the docs repo.
- `list_repo_files(directory)` — lists files in a directory.
- `search_repo(query)` — text search across the repo.

**System prompt (directive summary):**
- Read all available documentation before producing the analysis.
- Identify business entities, their attributes, and relationships.
- Map complete user flows from start to finish.
- Extract explicit and implicit business rules.
- List ambiguities: things that cannot be determined from the documentation alone.
- The output is a structured domain document, not code.

### AWS Architect Agent

**Input:** Approved domain document.
**Output:** Complete technical analysis with AWS stack, committed to the target repo.

**Available tools:**
- `read_domain_document()` — reads the approved domain document.
- `lookup_aws_service(service_name)` — queries description and pricing of an AWS service.
- `write_architecture_document(content)` — writes the architecture document.

**System prompt (directive summary):**
- Classify the product type (chatbot, dashboard, API, pipeline, etc.) and justify.
- Design the complete AWS stack per layer, with justification for each service.
- Document alternatives considered and why they were discarded.
- Define the IaC strategy (CDK vs Terraform), CI/CD, and repo structure.
- Estimate monthly operational costs of the proposed stack.
- Identify technical risks and mitigations.

### Development Agents (N instances)

**Input:** Assigned module spec + interface contracts + repository structure context.
**Output:** Working code in an isolated branch, with an open PR ready for review.

**Available tools:**
- `read_module_spec(module_name)` — reads the assigned module specification (ModuleSpec type from `types/plan.ts`).
- `read_interface_contracts()` — reads all interface contracts to understand dependencies.
- `read_repo_structure()` — reads the target repo folder structure to know where to place files.
- `create_file(path, content)` — creates a new file in the agent's isolated branch.
- `edit_file(path, old_snippet, new_snippet)` — edits an existing file using snippet replacement.
- `read_file(path)` — reads a file from the agent's branch for verification.
- `run_tests(module_name)` — runs the module's test suite.
- `run_linter(module_name)` — runs linter on the module's code.
- `check_contract_compliance(contract_id)` — validates that the implementation fulfills a specific interface contract.
- `open_pull_request(title, description)` — opens a PR from the agent's branch to main.

**System prompt (directive summary):**
- You are a Senior Developer Agent specialized in implementing a specific module based on its specification and interface contracts.
- You work in isolation — you only see your module spec, contracts, and repo structure. You never see other modules' code.
- Before writing code, read and fully understand: (1) your ModuleSpec, (2) all InterfaceContracts where you are the consumer, (3) the repo structure.
- Follow the established code style and patterns in the repository. If the repo is empty, create clean, idiomatic code.
- Implement ALL endpoints, functions, and logic defined in your ModuleSpec responsibilities.
- Ensure your implementation fulfills ALL InterfaceContracts where you are the provider.
- Write code with proper error handling, input validation, and logging.
- After writing code, run tests and linter. Fix any issues before opening the PR.
- Your PR description must include: module name, list of implemented endpoints/features, how to test, and any deviations from the spec.
- Output format: your final action is to open a PR. The PR title should be `[Module: {name}] Implementation`.

**Key constraints:**
1. **Isolation:** each developer agent only has access to its branch and interface contracts. It cannot read other modules' code.
2. **Branch naming:** `feature/module-{kebab-case-name}` — consistent naming for tracking.
3. **Contract-first:** implementations must satisfy the InterfaceContract definitions. The `check_contract_compliance` tool validates this.
4. **Test-driven where possible:** run tests after each significant code change.

**Parallel execution model:**
- The orchestrator spawns N developer agents in parallel using `Promise.allSettled()`.
- Each agent runs in its own branch — no conflicts possible during development.
- Agents have no inter-agent communication — they only interact through the shared interface contracts.
- The orchestrator monitors all agents and collects results (success/failure/blocked).

**Handling failures:**
- If tests fail: agent retries up to 3 times with increasing context about the failure.
- If contracts not met: agent revises implementation and re-checks compliance.
- If agent is blocked (missing info, unclear spec): it escalates to the orchestrator with a specific question.
- After 2 consecutive failures with V3.2, the agent escalates to K2.5 (configured in model-config.ts).

### Code Reviewer Agent

**Input:** PR opened by a developer agent.
**Output:** Approval, change request, or rejection.

**Available tools:**
- `read_pr_diff(pr_number)` — reads the PR diff.
- `read_module_spec(module_name)` — reads the spec it evaluates against.
- `read_interface_contracts()` — reads the contracts it must fulfill.
- `comment_on_pr(pr_number, body)` — comments on the PR.
- `approve_pr(pr_number)` — approves the PR.
- `request_changes(pr_number, body)` — requests changes.

### Integrator Agent

**Input:** All approved PRs + dependency graph.
**Output:** `main` branch with everything merged.

**Available tools:**
- `get_dependency_graph()` — gets the topological merge order.
- `merge_pr(pr_number)` — merges a PR.
- `check_merge_conflicts(pr_number)` — checks for conflicts.
- `resolve_conflict(file, resolution)` — resolves a simple conflict.
- `escalate_conflict(file, description)` — escalates logic conflicts.

### Deployment Agent

**Input:** Merged code in `main` + environment configuration.
**Output:** Provisioned infrastructure and deployed application.

**Available tools:**
- `run_command(command)` — executes a command in a sandboxed environment.
- `check_health(url)` — verifies that an endpoint responds.
- `read_deploy_logs()` — reads deployment process logs.
- `notify_supervisor(message)` — sends notification to the supervisor.

---

## 5. CLI Flow — Typical Session

### Initialization

```
$ savante-orch init --source owner/business-docs --target owner/product-code

✓ Connected to GitHub
✓ Source repo accessible: owner/business-docs (14 files)
✓ Target repo created: owner/product-code
✓ _orchestrator branch initialized with state

Project initialized. Run 'savante-orch start' to begin analysis.
```

### Phase 1: Domain analysis

```
$ savante-orch start

[Phase 1] Analyzing business documentation...
  ├ Reading README.md
  ├ Reading docs/product.md
  ├ Reading docs/user-flows.md
  └ Reading docs/business-rules.md

[Analyst Agent] Processing... (this may take 1-2 minutes)

✓ Domain document generated.
  Entities found: 8
  User flows: 5
  Business rules: 12
  Ambiguities: 3

Document committed at: owner/product-code/docs/domain-analysis.md

─── GATE 1: Domain approval ───
? Review the document and decide:
  ❯ Approve
    Request changes (you'll be able to write feedback)
    View document here in the console
```

### If changes are requested

```
? Write your feedback:
> The "Order" entity has a "status" attribute you didn't mention.
  Possible states are: draft, submitted, approved, rejected.

[Analyst Agent] Incorporating feedback...

✓ Document updated. Review the new version.

─── GATE 1: Domain approval (attempt 2) ───
? Review the document and decide: Approve

✓ Domain approved. Advancing to Phase 2.
```

### The pattern repeats for each phase

Gates 2, 3, and 4 follow the same mechanics: the system produces an artifact, presents it, and waits for the human's decision. The CLI does not advance without explicit approval.

---

## 6. Implementation Plan — Build Order

### Sprint 1: Base infrastructure (1-2 weeks)

**Goal:** be able to execute an agent that reads a GitHub repo and produces output via OpenRouter.

Concrete tasks:
1. Set up the TS project with `tsx` for execution, `vitest` for tests.
2. Implement `router-client.ts` — wrapper over the `openai` SDK pointing to `https://openrouter.ai/api/v1`, with tool use loop support and per-agent model configuration.
3. Implement `model-config.ts` — configurable agent → model map (with fallback).
4. Implement `github/client.ts` + `repo-reader.ts` — clone and read repos.
5. Implement `base-agent.ts` with the generic tools loop.
6. Implement the complete analyst agent (prompt + tools + output).
7. Minimal CLI: only `init` and `start` commands that run the analyst.

**Validation deliverable:** run `savante-orch init --source my-repo` and get a domain document generated by the configured model from the repo documentation. All visible in the console. Bonus: test the same flow with two different models and compare quality.

### Sprint 2: State machine + gates (1 week)

**Goal:** the process can be paused, resumed, and has real gates.

Concrete tasks:
1. Implement `state-machine.ts` with the transitions defined above.
2. Implement `state-store.ts` — persist state in Git (`_orchestrator` branch).
3. Implement `gate-manager.ts` — gate logic with approval/rejection.
4. CLI: `status`, `approve`, `reject`, `resume` commands.
5. Connect the analyst agent to the gate cycle (approve/feedback loop).

**Validation deliverable:** you can start the analysis, close the console, reopen it, see the state, approve or reject the domain, and the process resumes correctly.

### Sprint 3: Architect + planning (1-2 weeks)

**Goal:** phases 2 and 3 work end-to-end.

Concrete tasks:
1. Implement the AWS architect agent with its tools and prompt.
2. Gate 2 with its feedback cycle.
3. Implement the module decomposition logic (can be part of the orchestrator or a sub-agent).
4. Interface contract generation between modules.
5. Module assignment to developer agents.

**Validation deliverable:** given an approved domain, the system produces a credible AWS architecture analysis and a development plan with modules, contracts, and execution order.

### Sprint 4: Parallel development + review (2-3 weeks)

**Goal:** developer agents produce code and the reviewer evaluates them.

Concrete tasks:
1. Implement `branch-manager.ts` and `pr-manager.ts` in the GitHub layer.
2. Implement the developer agent with its code writing tools.
3. Implement parallel execution of N developer agents (Promise.allSettled).
4. Implement the reviewer agent with evaluation against specs and contracts.
5. PR cycle: review → approve/request changes → fix → re-review.

**Validation deliverable:** given a development plan, agents create branches, write code, open PRs, and the reviewer evaluates them. You can see the actual PRs on GitHub.

### Sprint 5: Integration + deploy (1-2 weeks)

**Goal:** code gets merged and deployed.

Concrete tasks:
1. Implement the integrator agent with topological merge.
2. Implement gate 3 (human review of integrated code).
3. Implement the deployer agent (CDK deploy in a sandbox environment).
4. Gate 4 (post-deploy verification).

**Validation deliverable:** the complete flow works from init to deploy in a controlled test case.

---

## 7. Context Management and API Costs

This is the most critical aspect of the system from a practical standpoint. Each model call has a token cost, and OpenRouter charges a minimal markup over the original provider's prices.

### Minimum context strategy

Each agent receives only what is strictly necessary:
- The analyst receives repo files, but processed: if a file is too long, it gets a summary first and then accesses detail via tools.
- Developers only see their module spec and interface contracts. Never other modules' code.
- The reviewer sees the PR diff + the module spec. Not the entire repo.

### Cost estimation per complete execution

For a medium-complexity project (8 doc files, 5 development modules), using the 5 assigned models:

| Agent | Model | Estimated tokens | Approx. cost |
|-------|-------|-----------------|-------------|
| Orchestrator | Kimi K2.6 | ~30K | ~$0.13 |
| Analyst | Kimi K2.6 | ~55K | ~$0.23 |
| Architect | DeepSeek V4 Pro | ~40K | ~$0.21 |
| Developers (5) | DeepSeek V3.2 | ~150K | ~$0.10 |
| Reviewer (5 PRs) | Kimi K2.5 | ~100K | ~$0.24 |
| Integrator | DeepSeek V3.2 | ~20K | ~$0.01 |
| Deployer | DeepSeek V3.2 | ~30K | ~$0.02 |

**Estimated total: USD $0.90-1.50 per complete execution.** That's 3-4x cheaper than with closed models. If Hy3 Preview remains free, it can be used as reviewer to lower costs further.

**Pessimistic scenario** (rejected gates, 3 iterations on average): ~$3-4. Still very economical.

**Escalation scenario** (developers need to upgrade to K2.5): ~$2-2.50. Still viable.

### MVP optimization

- **V3.2 for everything predictable.** At $0.25/$0.38 per million, developers, integrator, and deployer run at near-zero cost. It's the system's workhorse.
- **K2.6 for what needs orchestration and tool use.** Literally designed for multi-agent with its agent swarm architecture. The orchestrator and analyst benefit directly.
- **V4 Pro only for the architect.** The 1M token context allows fitting the entire domain documentation + AWS references without truncation. It's the most expensive model but only used 1-2 times.
- **K2.5 as intermediate upgrade.** If V3.2 doesn't cut it for a given agent, K2.5 at $0.44/$2 is the natural step-up before going to K2.6 or V4 Pro.
- **Hy3 Preview as free wildcard.** While the free tier lasts, using it for the reviewer or as a general fallback reduces costs to practically zero for that agent.
- **On feedback iterations** (gate rejections), don't resend full context; only the previous document + the feedback.

---

## 8. Error Handling and Edge Cases

### API errors (OpenRouter / models)
- Retry with exponential backoff (3 attempts).
- If a specific model fails, OpenRouter allows configuring automatic fallback to another model.
- If it fails persistently, pause the process and notify the supervisor via CLI.
- Never lose state: before each model call, state is persisted in Git.
- Monitor OpenRouter rate limit headers (`X-RateLimit-*`).

### GitHub errors
- Rate limiting: respect `X-RateLimit-Remaining` headers.
- Merge conflicts requiring logic decisions: the integrator escalates to the orchestrator, which pauses and requests human input.
- PRs that can't be merged: the orchestrator marks the module as blocked and notifies.

### Agent producing invalid output
- Schema validation on every agent output (zod for runtime type validation).
- If an agent produces a domain document that doesn't meet the expected schema, the orchestrator retries once with more explicit instructions. If it fails again, it escalates to the supervisor.

### Interrupted process
- The state in Git guarantees it can be resumed at any point.
- The `savante-orch resume` command reads the state and continues from where it left off.

---

## 9. Recommended First Test Case

To validate the system end-to-end, the ideal case is:

**A simple backend API** — for example, an appointment management system or a CRUD with clear business rules. This because:
- The product type is unambiguous (REST API).
- The AWS architecture is predictable (Lambda + API Gateway + DynamoDB or RDS).
- Module decomposition is natural (endpoints = modules).
- Interface contracts are explicit (request/response schemas).
- Deployment is simple (CDK with Lambda).

Prepare a repo with 3-4 business documents describing the system, and run the complete flow. The goal is not for the generated code to be perfect — it's to validate that the gates work, that the agents coordinate, and that the human has real control over the process.

---

## 10. Key Project Dependencies

```
openai                  → OpenRouter-compatible SDK (points to openrouter.ai/api/v1)
@octokit/rest           → GitHub API
commander               → CLI command parsing
@clack/prompts          → Interactive console UI
zod                     → Schema validation
tsx                     → Direct TypeScript execution
vitest                  → Testing
chalk                   → Console colors
ora                     → Spinners for long operations
```

---

## 11. Main Risks and Mitigations

**Code quality from developer agents.** The code models generate may not be production-ready, and quality varies between models. Mitigation: the reviewer is strict, and gate 3 (human review) is the final filter. In the MVP, it's accepted that the human will need to make adjustments. If a model consistently produces bad code, it's changed in the config without touching code.

**API costs in iterations.** If a gate is rejected many times, costs multiply. Mitigation: configurable attempt limit per gate (default: 3). After that, the system pauses and suggests direct intervention. OpenRouter gives you a real-time cost dashboard to monitor.

**Tool use compatibility between models.** K2.6 and V4 Pro have robust, native tool use. K2.5 and V3.2 also support function calling well, but Hy3 Preview has known limitations — Tencent acknowledges "weak error recovery during tool calls". Mitigation: `base-agent.ts` validates the response format with zod. If a tool call comes malformed, it retries once. If it fails again, it escalates to the next model in the chain (V3.2 → K2.5 → K2.6 → V4 Pro). Hy3 is only used in roles where tool calls are simple (reviewer).

**Insufficient context for agents.** If the input documentation is poor, agents produce vague analyses. Mitigation: the analyst has an explicit ambiguities section that forces the conversation at gate 1 before advancing.

**Merge complexity in integration.** Modules that seem independent may have subtle conflicts. Mitigation: interface contracts are the source of truth. The integrator only merges, it doesn't rewrite logic. Logic conflicts escalate to the human.

---

## 12. Implementation Status (as of 2026-05-06)

### Completed
- [x] **Sprint 1**: Base infrastructure (TypeScript project, router-client, model-config, github layer, base-agent, analyst agent, minimal CLI)
- [x] **Sprint 2**: State machine + gates (state-machine, state-store, gate-manager, CLI status/approve/reject/resume commands)
- [x] **Sprint 3**: Architect + planner agents (architect agent with tools, planner agent with development plan generation)
- [x] **Sprint 4 - Partial**: 
  - [x] Code reviewer agent (prompts, tools, agent class)
  - [x] Integration of reviewer agent into orchestrator (DEVELOPING and REVIEWING_CODE phases)
  - [ ] Developer agents (code exists but integration pending)
  - [ ] Parallel execution of developer agents
  - [ ] Full PR review cycle (approve → request changes → fix → re-review)

### Pending (Sprint 4 - remaining)
- [ ] Complete developer agent integration in `resume.ts` (currently placeholder)
- [ ] Implement `INTEGRATING` phase (merge PRs in dependency order)
- [ ] Implement `AWAITING_CODE_APPROVAL` gate logic
- [ ] Implement `DEPLOYING` phase (deployer agent)
- [ ] Implement `AWAITING_DEPLOY_APPROVAL` gate logic

### Pending (Sprint 5)
- [ ] **Integrator Agent**: Implement `src/agents/integrator/agent.ts` with tools:
  - `get_dependency_graph()` - get topological merge order
  - `merge_pr()` - merge a PR
  - `check_merge_conflicts()` - check for conflicts
  - `resolve_conflict()` - resolve simple conflicts
  - `escalate_conflict()` - escalate logic conflicts
- [ ] **Deployer Agent**: Implement `src/agents/deployer/agent.ts` with tools:
  - `run_command()` - execute command in sandbox
  - `check_health()` - verify endpoint responds
  - `read_deploy_logs()` - read deployment logs
  - `notify_supervisor()` - send notification
- [ ] Complete integration of integrator and deployer in `resume.ts`
- [ ] End-to-end testing with a simple backend API test case

### Known Issues to Fix
- [ ] Developer agent `tools.ts` references `fileWriter.readFile()` but method may not exist in `FileWriter`
- [ ] `repo-reader.ts` has syntax errors (missing commas in function calls like line 65, 74, 85)
- [ ] State persistence in `gate-manager.ts` needs proper SHA handling
- [ ] Need to implement actual test/linter execution in developer agent tools (currently placeholders)
