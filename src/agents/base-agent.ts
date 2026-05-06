import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { RouterClient, type ToolDefinition, type ToolExecutor } from "../llm/router-client.js";
import { ContextBuilder } from "../llm/context-builder.js";

export interface BaseAgentOptions {
  agentName: string;
  systemPrompt: string;
  tools?: ToolDefinition[];
  toolExecutor?: ToolExecutor;
  maxToolIterations?: number;
}

export abstract class BaseAgent {
  protected agentName: string;
  protected systemPrompt: string;
  protected client: RouterClient;
  protected contextBuilder: ContextBuilder;

  constructor(options: BaseAgentOptions) {
    this.agentName = options.agentName;
    this.systemPrompt = options.systemPrompt;
    this.contextBuilder = new ContextBuilder();

    this.client = new RouterClient({
      agentName: options.agentName,
      systemPrompt: options.systemPrompt,
      tools: options.tools,
      toolExecutor: options.toolExecutor,
      maxToolIterations: options.maxToolIterations,
    });
  }

  abstract run(context: Record<string, unknown>): Promise<string>;

  protected async executeWithTools(
    messages: ChatCompletionMessageParam[]
  ): Promise<string> {
    console.log(`[${this.agentName}] Processing...`);

    try {
      const response = await this.client.run(messages);
      console.log(`[${this.agentName}] Completed using model: ${response.model}`);
      return response.content;
    } catch (error) {
      console.error(`[${this.agentName}] Error:`, error);
      throw error;
    }
  }

  protected buildMessages(userMessage: string): ChatCompletionMessageParam[] {
    return [
      { role: "user", content: userMessage },
    ];
  }

  protected log(step: string, details?: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${this.agentName}] ${step}${details ? `: ${details}` : ""}`);
  }
}
