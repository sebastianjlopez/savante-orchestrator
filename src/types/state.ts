export interface GateStatus {
  status: "pending" | "approved" | "rejected" | "not_reached";
  attempts: number;
  feedback: string[];
}

export interface OrchestratorState {
  version: string;
  project_id: string;
  source_repo: string;
  target_repo: string;
  current_phase: PhaseType;
  gates: {
    domain: GateStatus;
    architecture: GateStatus;
    code: GateStatus;
    deploy: GateStatus;
  };
  artifacts: {
    domain_document: string | null;
    architecture_document: string | null;
    development_plan: string | null;
  };
  modules: ModuleStatus[];
  decisions_log: DecisionLogEntry[];
  created_at: string;
  updated_at: string;
}

export type PhaseType =
  | "INIT"
  | "ANALYZING_DOMAIN"
  | "AWAITING_DOMAIN_APPROVAL"
  | "ANALYZING_ARCHITECTURE"
  | "AWAITING_TECH_APPROVAL"
  | "PLANNING_DEVELOPMENT"
  | "DEVELOPING"
  | "REVIEWING_CODE"
  | "INTEGRATING"
  | "AWAITING_CODE_APPROVAL"
  | "DEPLOYING"
  | "AWAITING_DEPLOY_APPROVAL"
  | "COMPLETED";

export interface ModuleStatus {
  name: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  branch: string;
  pr_number?: number;
  attempts: number;
}

export interface DecisionLogEntry {
  timestamp: string;
  phase: PhaseType;
  decision: string;
  actor: "agent" | "human";
  details?: string;
}
