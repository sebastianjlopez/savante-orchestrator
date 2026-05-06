import type { PhaseType } from "../types/state.js";

export type TransitionAction =
  | "start_analysis"
  | "domain_complete"
  | "approve_domain"
  | "reject_domain"
  | "architecture_complete"
  | "approve_architecture"
  | "reject_architecture"
  | "planning_complete"
  | "development_complete"
  | "review_complete"
  | "all_approved"
  | "reject_code"
  | "integration_complete"
  | "approve_code"
  | "request_changes"
  | "deploy_complete"
  | "approve_deploy"
  | "resume";

interface Transition {
  from: PhaseType;
  action: TransitionAction;
  to: PhaseType;
}

const TRANSITIONS: Transition[] = [
  // Init to domain analysis
  { from: "INIT", action: "start_analysis", to: "ANALYZING_DOMAIN" },

  // Domain analysis cycle
  { from: "ANALYZING_DOMAIN", action: "domain_complete", to: "AWAITING_DOMAIN_APPROVAL" },
  { from: "AWAITING_DOMAIN_APPROVAL", action: "approve_domain", to: "ANALYZING_ARCHITECTURE" },
  { from: "AWAITING_DOMAIN_APPROVAL", action: "reject_domain", to: "ANALYZING_DOMAIN" },

  // Architecture analysis cycle
  { from: "ANALYZING_ARCHITECTURE", action: "architecture_complete", to: "AWAITING_TECH_APPROVAL" },
  { from: "AWAITING_TECH_APPROVAL", action: "approve_architecture", to: "PLANNING_DEVELOPMENT" },
  { from: "AWAITING_TECH_APPROVAL", action: "reject_architecture", to: "ANALYZING_ARCHITECTURE" },

  // Planning and development
  { from: "PLANNING_DEVELOPMENT", action: "planning_complete", to: "DEVELOPING" },
  { from: "DEVELOPING", action: "development_complete", to: "REVIEWING_CODE" },

  // Code review cycle
  { from: "REVIEWING_CODE", action: "all_approved", to: "INTEGRATING" },
  { from: "REVIEWING_CODE", action: "reject_code", to: "DEVELOPING" },

  // Integration and code approval
  { from: "INTEGRATING", action: "integration_complete", to: "AWAITING_CODE_APPROVAL" },
  { from: "AWAITING_CODE_APPROVAL", action: "approve_code", to: "DEPLOYING" },
  { from: "AWAITING_CODE_APPROVAL", action: "request_changes", to: "INTEGRATING" },

  // Deployment
  { from: "DEPLOYING", action: "deploy_complete", to: "AWAITING_DEPLOY_APPROVAL" },
  { from: "AWAITING_DEPLOY_APPROVAL", action: "approve_deploy", to: "COMPLETED" },

  // Resume (stays in current phase or advances if waiting for approval)
  { from: "AWAITING_DOMAIN_APPROVAL", action: "resume", to: "AWAITING_DOMAIN_APPROVAL" },
  { from: "AWAITING_TECH_APPROVAL", action: "resume", to: "AWAITING_TECH_APPROVAL" },
  { from: "AWAITING_CODE_APPROVAL", action: "resume", to: "AWAITING_CODE_APPROVAL" },
  { from: "AWAITING_DEPLOY_APPROVAL", action: "resume", to: "AWAITING_DEPLOY_APPROVAL" },
];

export class StateMachine {
  /**
   * Get the next phase for a given current phase and action
   */
  static getNextPhase(currentPhase: PhaseType, action: TransitionAction): PhaseType | null {
    const transition = TRANSITIONS.find(
      (t) => t.from === currentPhase && t.action === action
    );
    return transition ? transition.to : null;
  }

  /**
   * Check if a transition is valid
   */
  static canTransition(currentPhase: PhaseType, action: TransitionAction): boolean {
    return this.getNextPhase(currentPhase, action) !== null;
  }

  /**
   * Execute a transition and return the new phase
   * Throws an error if the transition is invalid
   */
  static transition(currentPhase: PhaseType, action: TransitionAction): PhaseType {
    const nextPhase = this.getNextPhase(currentPhase, action);
    if (!nextPhase) {
      throw new Error(
        `Invalid transition from ${currentPhase} with action ${action}`
      );
    }
    return nextPhase;
  }

  /**
   * Get all valid actions for a given phase
   */
  static getValidActions(currentPhase: PhaseType): TransitionAction[] {
    return TRANSITIONS.filter((t) => t.from === currentPhase).map((t) => t.action);
  }

  /**
   * Check if the phase is a waiting/approval phase
   */
  static isApprovalPhase(phase: PhaseType): boolean {
    return [
      "AWAITING_DOMAIN_APPROVAL",
      "AWAITING_TECH_APPROVAL",
      "AWAITING_CODE_APPROVAL",
      "AWAITING_DEPLOY_APPROVAL",
    ].includes(phase);
  }

  /**
   * Check if the process is complete
   */
  static isComplete(phase: PhaseType): boolean {
    return phase === "COMPLETED";
  }
}
