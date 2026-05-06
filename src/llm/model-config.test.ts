import { describe, it, expect } from "vitest";
import { getModelForAgent, getEscalationChain } from "../../src/llm/model-config.js";

describe("model-config", () => {
  it("should return correct model for analyst", () => {
    const config = getModelForAgent("analyst");
    expect(config).toBeDefined();
    expect(config.primary).toBe("moonshotai/kimi-k2.6");
    expect(config.fallback).toBe("deepseek/deepseek-v4-pro");
  });

  it("should return correct model for architect", () => {
    const config = getModelForAgent("architect");
    expect(config.primary).toBe("deepseek/deepseek-v4-pro");
    expect(config.fallback).toBe("moonshotai/kimi-k2.6");
  });

  it("should return developer model as default for unknown agent", () => {
    const config = getModelForAgent("unknown-agent");
    expect(config.primary).toBe("deepseek/deepseek-v3.2");
  });

  it("should return the correct escalation chain", () => {
    const chain = getEscalationChain();
    expect(chain).toBeDefined();
    expect(chain.length).toBe(4);
    expect(chain[0]).toBe("deepseek/deepseek-v3.2");
    expect(chain[3]).toBe("deepseek/deepseek-v4-pro");
  });
});
