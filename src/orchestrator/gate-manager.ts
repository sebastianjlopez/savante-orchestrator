import type { OrchestratorState, GateStatus, PhaseType } from "../types/state.js";
import type { TransitionAction } from "./state-machine.js";
import { StateMachine } from "./state-machine.js";
import { StateStore } from "./state-store.js";
import type { GitHubRepo } from "../github/client.js";

type GateName = "domain" | "architecture" | "code" | "deploy";

export class GateManager {
  private stateStore: StateStore;
  private state: OrchestratorState;
  private targetRepo: GitHubRepo;

  constructor(stateStore: StateStore, state: OrchestratorState, targetRepo: GitHubRepo) {
    this.stateStore = stateStore;
    this.state = state;
    this.targetRepo = targetRepo;
  }

  /**
   * Request approval for a gate
   * Moves the state to the corresponding AWAITING_ approval phase
   */
  async requestApproval(gateName: GateName, artifactPath: string): Promise<void> {
    const gate = this.state.gates[gateName];
    if (!gate) {
      throw new Error(`Invalid gate name: ${gateName}`);
    }

    // Update gate status
    gate.status = "pending";

    // Update artifact path
    if (gateName === "domain") {
      this.state.artifacts.domain_document = artifactPath;
    } else if (gateName === "architecture") {
      this.state.artifacts.architecture_document = artifactPath;
    } else if (gateName === "code") {
      this.state.artifacts.development_plan = artifactPath;
    }

    // Move to awaiting approval phase
    const awaitingPhase = this.getAwaitingPhaseForGate(gateName);
    this.state.current_phase = awaitingPhase;
    this.state.updated_at = new Date().toISOString();

    // Save state
    await this.saveState();
  }

  /**
   * Approve a gate and advance to the next phase
   */
  async approve(gateName: GateName): Promise<PhaseType> {
    const gate = this.state.gates[gateName];
    if (!gate) {
      throw new Error(`Invalid gate name: ${gateName}`);
    }

    if (gate.status !== "pending") {
      throw new Error(`Gate ${gateName} is not awaiting approval (current status: ${gate.status})`);
    }

    // Update gate status
    gate.status = "approved";

    // Transition to next phase
    const action = this.getApproveActionForGate(gateName);
    const nextPhase = StateMachine.transition(this.state.current_phase, action);

    this.state.current_phase = nextPhase;
    this.state.updated_at = new Date().toISOString();

    // Save state
    await this.saveState();

    return nextPhase;
  }

  /**
   * Reject a gate with feedback
   */
  async reject(gateName: GateName, feedback: string): Promise<PhaseType> {
    const gate = this.state.gates[gateName];
    if (!gate) {
      throw new Error(`Invalid gate name: ${gateName}`);
    }

    if (gate.status !== "pending") {
      throw new Error(`Gate ${gateName} is not awaiting approval (current status: ${gate.status})`);
    }

    // Update gate status and add feedback
    gate.status = "rejected";
    gate.attempts += 1;
    gate.feedback.push(feedback);

    // Transition back to the analysis phase
    const action = this.getRejectActionForGate(gateName);
    const nextPhase = StateMachine.transition(this.state.current_phase, action);

    this.state.current_phase = nextPhase;
    this.state.updated_at = new Date().toISOString();

    // Save state
    await this.saveState();

    return nextPhase;
  }

  /**
   * Get the status of a gate
   */
  getGateStatus(gateName: GateName): GateStatus {
    const gate = this.state.gates[gateName];
    if (!gate) {
      throw new Error(`Invalid gate name: ${gateName}`);
    }
    return gate;
  }

  /**
   * Get all gates status
   */
  getAllGatesStatus(): Record<GateName, GateStatus> {
    return this.state.gates as Record<GateName, GateStatus>;
  }

  /**
   * Check if a gate is approved
   */
  isGateApproved(gateName: GateName): boolean {
    return this.state.gates[gateName]?.status === "approved";
  }

  /**
   * Check if a gate is pending
   */
  isGatePending(gateName: GateName): boolean {
    return this.state.gates[gateName]?.status === "pending";
  }

  private getAwaitingPhaseForGate(gateName: GateName): PhaseType {
    switch (gateName) {
      case "domain": return "AWAITING_DOMAIN_APPROVAL";
      case "architecture": return "AWAITING_TECH_APPROVAL";
      case "code": return "AWAITING_CODE_APPROVAL";
      case "deploy": return "AWAITING_DEPLOY_APPROVAL";
    }
  }

  private getApproveActionForGate(gateName: GateName): TransitionAction {
    switch (gateName) {
      case "domain": return "approve_domain";
      case "architecture": return "approve_architecture";
      case "code": return "approve_code";
      case "deploy": return "approve_deploy";
      default: return "approve_domain"; // fallback
    }
  }

  private getRejectActionForGate(gateName: GateName): TransitionAction {
    switch (gateName) {
      case "domain": return "reject_domain";
      case "architecture": return "reject_architecture";
      case "code": return "request_changes";
      case "deploy": return "request_changes";
      default: return "reject_domain"; // fallback
    }
  }

  private async saveState(): Promise<void> {
    // For now, we'll use a simple implementation
    // In production, this would get the sha from the state store
    const content = Buffer.from(JSON.stringify(this.state, null, 2)).toString("base64");

    await this.stateStore.saveState(
      this.targetRepo,
      this.state,
      "" // This should be the actual sha from the state file
    );
  }
}
