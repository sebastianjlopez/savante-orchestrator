import { BaseAgent, type BaseAgentOptions } from "../base-agent.js";
import { DEVELOPER_SYSTEM_PROMPT } from "./prompts.js";
import { getDeveloperTools, getDeveloperToolExecutor, type DeveloperToolOptions } from "./tools.js";
import { RepoReader } from "../../github/repo-reader.js";
import { FileWriter } from "../../github/file-writer.js";
import { PRManager } from "../../github/pr-manager.js";
import { GitHubRepo } from "../../github/client.js";
import type { ModuleSpec, InterfaceContract } from "../../types/plan.js";

export interface DeveloperAgentOptions {
  targetRepo: GitHubRepo;
  repoReader: RepoReader;
  fileWriter: FileWriter;
  prManager: PRManager;
  moduleSpec: ModuleSpec;
  interfaceContracts: InterfaceContract[];
  branch: string;
  developmentPlanPath?: string;
}

export class DeveloperAgent extends BaseAgent {
  private targetRepo: GitHubRepo;
  private fileWriter: FileWriter;
  private prManager: PRManager;
  private moduleSpec: ModuleSpec;
  private interfaceContracts: InterfaceContract[];
  private branch: string;

  constructor(options: DeveloperAgentOptions) {
    const toolOptions: DeveloperToolOptions = {
      targetRepo: options.targetRepo,
      repoReader: options.repoReader,
      fileWriter: options.fileWriter,
      prManager: options.prManager,
      moduleSpec: options.moduleSpec,
      interfaceContracts: options.interfaceContracts,
      branch: options.branch,
      developmentPlanPath: options.developmentPlanPath,
    };

    const tools = getDeveloperTools(toolOptions);
    const toolExecutor = getDeveloperToolExecutor(toolOptions);

    const baseOptions: BaseAgentOptions = {
      agentName: `developer-${options.moduleSpec.name}`,
      systemPrompt: DEVELOPER_SYSTEM_PROMPT,
      tools,
      toolExecutor,
      maxToolIterations: 30, // Development may require many iterations
    };

    super(baseOptions);

    this.targetRepo = options.targetRepo;
    this.fileWriter = options.fileWriter;
    this.prManager = options.prManager;
    this.moduleSpec = options.moduleSpec;
    this.interfaceContracts = options.interfaceContracts;
    this.branch = options.branch;
  }

  async run(context: Record<string, unknown>): Promise<string> {
    this.log("Starting development", `Module: ${this.moduleSpec.name}, Branch: ${this.branch}`);

    // Build the initial message for the agent
    const userMessage = `Please implement the module "${this.moduleSpec.name}" based on the provided specification and interface contracts.

## Module Specification

${JSON.stringify(this.moduleSpec, null, 2)}

## Interface Contracts

${JSON.stringify(this.interfaceContracts.filter(c => c.provider === this.moduleSpec.name || c.consumer === this.moduleSpec.name), null, 2)}

---

Please use the available tools to:
1. Read your module spec with \`read_module_spec\`
2. Read interface contracts with \`read_interface_contracts\`
3. Create all necessary files with \`create_file\`
4. Run tests with \`run_tests\`
5. Open a pull request with \`open_pull_request\`

Your implementation should fulfill all responsibilities and acceptance criteria.`;

    const messages = this.buildMessages(userMessage);

    const result = await this.executeWithTools(messages);

    this.log("Development complete", `${result.length} characters`);
    return result;
  }
}
