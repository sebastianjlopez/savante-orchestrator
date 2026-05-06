export interface ModelConfig {
  primary: string;
  fallback?: string;
}

interface AgentModelConfig {
  [agentName: string]: ModelConfig;
}

const DEFAULT_AGENT_MODELS: AgentModelConfig = {
  analyst: {
    primary: "moonshotai/kimi-k2.6",
    fallback: "deepseek/deepseek-v4-pro",
  },
  architect: {
    primary: "deepseek/deepseek-v4-pro",
    fallback: "moonshotai/kimi-k2.6",
  },
  developer: {
    primary: "deepseek/deepseek-v3.2",
    fallback: "moonshotai/kimi-k2.5",
  },
  reviewer: {
    primary: "moonshotai/kimi-k2.5",
    fallback: "tencent/hy3-preview",
  },
  integrator: {
    primary: "deepseek/deepseek-v3.2",
    fallback: "moonshotai/kimi-k2.5",
  },
  deployer: {
    primary: "deepseek/deepseek-v3.2",
    fallback: "moonshotai/kimi-k2.5",
  },
  orchestrator: {
    primary: "moonshotai/kimi-k2.6",
    fallback: "deepseek/deepseek-v4-pro",
  },
};

export const ESCALATION_CHAIN = [
  "deepseek/deepseek-v3.2",
  "moonshotai/kimi-k2.5",
  "moonshotai/kimi-k2.6",
  "deepseek/deepseek-v4-pro",
];

export function getModelForAgent(agentName: string): ModelConfig {
  // Try to load project-specific config
  try {
    const config = require(process.cwd() + "/orchestrator-config.json");
    if (config.models && config.models[agentName]) {
      return config.models[agentName];
    }
  } catch {
    // No project config, use defaults
  }

  const config = DEFAULT_AGENT_MODELS[agentName];
  if (!config) {
    // Default to developer model if agent not found
    return DEFAULT_AGENT_MODELS.developer;
  }

  return config;
}

export function getEscalationChain(): string[] {
  try {
    const config = require(process.cwd() + "/orchestrator-config.json");
    if (config.escalation_chain) {
      return config.escalation_chain;
    }
  } catch {
    // Use default
  }

  return ESCALATION_CHAIN;
}
