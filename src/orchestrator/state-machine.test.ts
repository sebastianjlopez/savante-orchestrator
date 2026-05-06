import { describe, it, expect } from "vitest";
import { StateMachine } from "../../src/orchestrator/state-machine.js";

describe("StateMachine", () => {
  it("should transition from INIT to ANALYZING_DOMAIN on start_analysis", () => {
    const nextPhase = StateMachine.getNextPhase("INIT", "start_analysis");
    expect(nextPhase).toBe("ANALYZING_DOMAIN");
  });

  it("should transition from ANALYZING_DOMAIN to AWAITING_DOMAIN_APPROVAL on domain_complete", () => {
    const nextPhase = StateMachine.getNextPhase("ANALYZING_DOMAIN", "domain_complete");
    expect(nextPhase).toBe("AWAITING_DOMAIN_APPROVAL");
  });

  it("should transition from AWAITING_DOMAIN_APPROVAL to ANALYZING_ARCHITECTURE on approve_domain", () => {
    const nextPhase = StateMachine.getNextPhase("AWAITING_DOMAIN_APPROVAL", "approve_domain");
    expect(nextPhase).toBe("ANALYZING_ARCHITECTURE");
  });

  it("should transition from AWAITING_DOMAIN_APPROVAL to ANALYZING_DOMAIN on reject_domain", () => {
    const nextPhase = StateMachine.getNextPhase("AWAITING_DOMAIN_APPROVAL", "reject_domain");
    expect(nextPhase).toBe("ANALYZING_DOMAIN");
  });

  it("should return null for invalid transitions", () => {
    const nextPhase = StateMachine.getNextPhase("INIT", "approve_domain");
    expect(nextPhase).toBeNull();
  });

  it("should correctly identify approval phases", () => {
    expect(StateMachine.isApprovalPhase("AWAITING_DOMAIN_APPROVAL")).toBe(true);
    expect(StateMachine.isApprovalPhase("AWAITING_TECH_APPROVAL")).toBe(true);
    expect(StateMachine.isApprovalPhase("ANALYZING_DOMAIN")).toBe(false);
  });

  it("should correctly identify complete phase", () => {
    expect(StateMachine.isComplete("COMPLETED")).toBe(true);
    expect(StateMachine.isComplete("INIT")).toBe(false);
  });

  it("should throw error for invalid transition in transition()", () => {
    expect(() => {
      StateMachine.transition("INIT", "approve_domain");
    }).toThrow();
  });

  it("should not throw error for valid transition in transition()", () => {
    expect(() => {
      StateMachine.transition("INIT", "start_analysis");
    }).not.toThrow();
  });
});
