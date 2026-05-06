import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export interface ContextData {
  [key: string]: unknown;
}

export class ContextBuilder {
  private messages: ChatCompletionMessageParam[] = [];

  addSystemPrompt(prompt: string): this {
    this.messages.unshift({ role: "system", content: prompt });
    return this;
  }

  addUserMessage(content: string, name?: string): this {
    this.messages.push({ role: "user", content, name } as ChatCompletionMessageParam);
    return this;
  }

  addAssistantMessage(content: string): this {
    this.messages.push({ role: "assistant", content });
    return this;
  }

  addToolResult(toolCallId: string, output: string): this {
    this.messages.push({ role: "tool", tool_call_id: toolCallId, content: output });
    return this;
  }

  fromArray(messages: ChatCompletionMessageParam[]): this {
    this.messages = [...messages];
    return this;
  }

  build(): ChatCompletionMessageParam[] {
    return this.messages;
  }

  static fromTemplate(template: string, data: ContextData): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return String(data[key] ?? "");
    });
  }
}
