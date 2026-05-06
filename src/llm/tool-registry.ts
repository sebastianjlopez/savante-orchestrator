import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ToolDefinition } from "./router-client.js";

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private executors: Map<string, (args: Record<string, unknown>) => Promise<string>> = new Map();

  register(tool: ToolDefinition, executor: (args: Record<string, unknown>) => Promise<string>): void {
    this.tools.set(tool.function.name, tool);
    this.executors.set(tool.function.name, executor);
  }

  getTools(): ChatCompletionTool[] {
    return Array.from(this.tools.values()) as ChatCompletionTool[];
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const executor = this.executors.get(name);
    if (!executor) {
      throw new Error(`No executor registered for tool: ${name}`);
    }
    return executor(args);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }
}
