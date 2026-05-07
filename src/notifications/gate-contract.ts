/**
 * Slack–orchestrator gate integration contract (versioned payloads).
 * See docs/gate-slack-contract.md for transport and auth.
 */

import type { PhaseType } from "../types/state.js";

export const GATE_CONTRACT_VERSION = "1.0" as const;

export type GateName = "domain" | "architecture" | "code" | "deploy";

/** Emitted by savante-orchestrator when a human approval gate is reached. */
export interface GateReachedEvent {
  type: "gate_reached";
  schema_version: typeof GATE_CONTRACT_VERSION;
  project_id: string;
  target_repo: string;
  /** owner/repo */
  gate: GateName;
  phase: PhaseType;
  artifact_paths: string[];
  /** GitHub web URLs for artifacts on branch `_orchestrator` where applicable */
  artifact_urls: string[];
  slack_delivery_channel_id?: string | null;
  slack_thread_ts?: string | null;
}

/** Optional future use: Jim → orchestrator explicit decision log (Slack already drives CLI). */
export interface GateDecisionEvent {
  type: "gate_decision";
  schema_version: typeof GATE_CONTRACT_VERSION;
  project_id: string;
  target_repo: string;
  gate: GateName;
  decision: "approve" | "reject";
  feedback?: string;
  acting_slack_user_id?: string;
}

export type GateIntegrationEvent = GateReachedEvent | GateDecisionEvent;
