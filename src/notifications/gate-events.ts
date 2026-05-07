import type { GitHubRepo } from "../github/client.js";
import type { OrchestratorState } from "../types/state.js";
import {
  GATE_CONTRACT_VERSION,
  type GateName,
  type GateReachedEvent,
} from "./gate-contract.js";

const ORCH_BRANCH = "_orchestrator";

function githubBlobUrl(owner: string, repo: string, path: string): string {
  const enc = path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `https://github.com/${owner}/${repo}/blob/${ORCH_BRANCH}/${enc}`;
}

function resolveArtifactUrl(owner: string, repo: string, path: string): string {
  const repoRoot = `https://github.com/${owner}/${repo}`;
  const p = path.trim();
  if (
    !p ||
    p.includes(" ") ||
    /^(main branch|deployed application)/i.test(p)
  ) {
    return repoRoot;
  }
  if (p.startsWith("docs/") || /\.[a-z0-9]+$/i.test(p)) {
    return githubBlobUrl(owner, repo, p);
  }
  return repoRoot;
}

export function buildGateReachedPayload(
  state: OrchestratorState,
  targetRepo: GitHubRepo,
  gate: GateName,
  artifactPaths: string[]
): GateReachedEvent {
  const { owner, repo } = targetRepo;
  const target_repo = `${owner}/${repo}`;

  const artifact_urls = artifactPaths.map((p) => resolveArtifactUrl(owner, repo, p));

  return {
    type: "gate_reached",
    schema_version: GATE_CONTRACT_VERSION,
    project_id: state.project_id,
    target_repo,
    gate,
    phase: state.current_phase,
    artifact_paths: artifactPaths,
    artifact_urls,
    slack_delivery_channel_id: state.slack_delivery_channel_id ?? null,
    slack_thread_ts: state.slack_delivery_thread_ts ?? null,
  };
}

/**
 * POST gate_reached to Jim. No-op if GATE_WEBHOOK_URL is unset.
 */
export async function emitGateReached(payload: GateReachedEvent): Promise<void> {
  const baseUrl = process.env.GATE_WEBHOOK_URL?.trim();
  if (!baseUrl) {
    return;
  }

  const url = new URL("/internal/gate-reached", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const secret = process.env.GATE_WEBHOOK_SECRET?.trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret) {
    headers["X-Gate-Webhook-Secret"] = secret;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`gate webhook failed: ${res.status} ${text}`);
  }
}
