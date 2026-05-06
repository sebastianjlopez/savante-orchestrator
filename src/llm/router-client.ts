import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getModelForAgent, getEscalationChain, type ModelConfig } from "./model-config.js";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ToolCallResult {
  tool_call_id: string;
  output: string;
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

export interface RouterClientOptions {
  agentName: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  toolExecutor?: ToolExecutor;
  maxToolIterations?: number;
}

export interface RouterClientResponse {
  content: string;
  model: string;
  usage?: OpenAI.Completions.CompletionUsage;
}

const DEFAULT_HEADERS = {
  "HTTP-Referer": "https://savante.dev",
  "X-Title": "savante-orchestrator",
};

export class RouterClient {
  private client: OpenAI;
  private agentName: string;
  private systemPrompt?: string;
  private tools?: ToolDefinition[];
  private toolExecutor?: ToolExecutor;
  private maxToolIterations: number;
  private modelConfig: ModelConfig;

  constructor(options: RouterClientOptions) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY environment variable is required");
    }

    this.agentName = options.agentName;
    this.systemPrompt = options.systemPrompt;
    this.tools = options.tools;
    this.toolExecutor = options.toolExecutor;
    this.maxToolIterations = options.maxToolIterations ?? 10;
    this.modelConfig = getModelForAgent(options.agentName);

    this.client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey,
      defaultHeaders: DEFAULT_HEADERS,
    });
  }

  async run(messages: ChatCompletionMessageParam[]): Promise<RouterClientResponse> {
    return this.runWithModel(messages, this.modelConfig.primary);
  }

  private async runWithModel(
    messages: ChatCompletionMessageParam[],
    model: string,
    escalationDepth: number = 0
  ): Promise<RouterClientResponse> {
    const allMessages: ChatCompletionMessageParam[] = this.systemPrompt
      ? [{ role: "system", content: this.systemPrompt }, ...messages]
      : messages;

    try {
      let iterations = 0;

      while (iterations < this.maxToolIterations) {
        const completion = await this.client.chat.completions.create({
          model,
          messages: allMessages,
          tools: this.tools as any,
        });

        const message = completion.choices[0]?.message;
        if (!message) {
          throw new Error("No response from model");
        }

        // If no tool calls, return the content
        if (!message.tool_calls || message.tool_calls.length === 0) {
          return {
            content: message.content || "",
            model,
            usage: completion.usage,
          };
        }

        // Add the assistant message with tool calls
        allMessages.push({
          role: "assistant",
          content: message.content,
          tool_calls: message.tool_calls,
        });

        // Execute tool calls
        if (this.toolExecutor) {
          for (const toolCall of message.tool_calls) {
            const args = JSON.parse(toolCall.function.arguments);
            const output = await this.toolExecutor(toolCall.function.name, args);

            allMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: output,
            });
          }
        }

        iterations++;
      }

      throw new Error(`Exceeded maximum tool iterations (${this.maxToolIterations})`);
    } catch (error) {
      // Try fallback model if available
      if (this.modelConfig.fallback && escalationDepth === 0) {
        console.warn(`Model ${model} failed, trying fallback: ${this.modelConfig.fallback}`);
        return this.runWithModel(messages, this.modelConfig.fallback, escalationDepth + 1);
      }

      // Try escalation chain
      const chain = getEscalationChain();
      if (escalationDepth < chain.length) {
        const escalatedModel = chain[escalationDepth];
        console.warn(`Model ${model} failed, escalating to: ${escalatedModel}`);
        return this.runWithModel(messages, escalatedModel, escalationDepth + 1);
      }

      throw error;
    }
  }
}
