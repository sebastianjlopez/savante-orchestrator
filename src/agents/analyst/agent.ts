import { BaseAgent, type BaseAgentOptions } from "../base-agent.js";
import { ANALYST_SYSTEM_PROMPT } from "./prompts.js";
import { getAnalystTools, getAnalystToolExecutor } from "./tools.js";
import { RepoReader } from "../../github/repo-reader.js";
import { GitHubRepo } from "../../github/client.js";

export interface AnalystAgentOptions {
  sourceRepo: GitHubRepo;
  repoReader: RepoReader;
}

export class AnalystAgent extends BaseAgent {
  private sourceRepo: GitHubRepo;
  private repoReader: RepoReader;

  constructor(options: AnalystAgentOptions) {
    const tools = getAnalystTools(options.sourceRepo, options.repoReader);
    const toolExecutor = getAnalystToolExecutor(options.sourceRepo, options.repoReader);

    const baseOptions: BaseAgentOptions = {
      agentName: "analyst",
      systemPrompt: ANALYST_SYSTEM_PROMPT,
      tools,
      toolExecutor,
    };

    super(baseOptions);

    this.sourceRepo = options.sourceRepo;
    this.repoReader = options.repoReader;
  }

  async run(_context: Record<string, unknown>): Promise<string> {
    this.log("Starting domain analysis", `${this.sourceRepo.owner}/${this.sourceRepo.repo}`);

    // First, list all files in the repo
    const files = await this.repoReader.listAllFiles(
      this.sourceRepo.owner,
      this.sourceRepo.repo
    );

    this.log("Found files", `${files.length} files`);

    // Build the initial message for the agent
    const userMessage = `Please analyze the documentation repository at ${this.sourceRepo.owner}/${this.sourceRepo.repo}.

Available files (use read_repo_file to read them):
${files.map((f) => `- ${f}`).join("\n")}

Please read all documentation files and produce a comprehensive domain document. Use the tools provided to read each file.`;

    const messages = this.buildMessages(userMessage);

    const result = await this.executeWithTools(messages);

    this.log("Domain analysis complete", `${result.length} characters`);
    return result;
  }
}
