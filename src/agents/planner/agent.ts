import { BaseAgent, type BaseAgentOptions } from "../base-agent.js";
import { PLANNER_SYSTEM_PROMPT } from "./prompts.js";
import { getPlannerTools, getPlannerToolExecutor, type PlannerToolOptions } from "./tools.js";
import { RepoReader } from "../../github/repo-reader.js";
import { FileWriter } from "../../github/file-writer.js";
import { GitHubRepo } from "../../github/client.js";

export interface PlannerAgentOptions {
  targetRepo: GitHubRepo;
  repoReader: RepoReader;
  fileWriter: FileWriter;
  domainDocumentPath?: string;
  architectureDocumentPath?: string;
  developmentPlanPath?: string;
}

export class PlannerAgent extends BaseAgent {
  private targetRepo: GitHubRepo;
  private repoReader: RepoReader;
  private fileWriter: FileWriter;
  private domainDocumentPath: string;
  private architectureDocumentPath: string;
  private developmentPlanPath: string;

  constructor(options: PlannerAgentOptions) {
    const toolOptions: PlannerToolOptions = {
      targetRepo: options.targetRepo,
      repoReader: options.repoReader,
      fileWriter: options.fileWriter,
      domainDocumentPath: options.domainDocumentPath,
      architectureDocumentPath: options.architectureDocumentPath,
      developmentPlanPath: options.developmentPlanPath,
    };

    const tools = getPlannerTools(toolOptions);
    const toolExecutor = getPlannerToolExecutor(toolOptions);

    const baseOptions: BaseAgentOptions = {
      agentName: "planner",
      systemPrompt: PLANNER_SYSTEM_PROMPT,
      tools,
      toolExecutor,
      maxToolIterations: 20, // Planning may require more iterations
    };

    super(baseOptions);

    this.targetRepo = options.targetRepo;
    this.repoReader = options.repoReader;
    this.fileWriter = options.fileWriter;
    this.domainDocumentPath = options.domainDocumentPath || "docs/domain-analysis.md";
    this.architectureDocumentPath = options.architectureDocumentPath || "docs/architecture-analysis.md";
    this.developmentPlanPath = options.developmentPlanPath || "docs/development-plan.json";
  }

  async run(context: Record<string, unknown>): Promise<string> {
    this.log("Starting development planning", `${this.targetRepo.owner}/${this.targetRepo.repo}`);

    // Get documents from context or read from repo
    let domainDocument = context["domainDocument"] as string | undefined;
    let architectureDocument = context["architectureDocument"] as string | undefined;

    if (!domainDocument) {
      this.log("Reading domain document from repo", this.domainDocumentPath);
      try {
        domainDocument = await this.repoReader.readFile(
          this.targetRepo.owner,
          this.targetRepo.repo,
          this.domainDocumentPath
        );
      } catch (error) {
        this.log("Failed to read domain document", error instanceof Error ? error.message : String(error));
        throw new Error(`Cannot proceed without domain document: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!architectureDocument) {
      this.log("Reading architecture document from repo", this.architectureDocumentPath);
      try {
        architectureDocument = await this.repoReader.readFile(
          this.targetRepo.owner,
          this.targetRepo.repo,
          this.architectureDocumentPath
        );
      } catch (error) {
        this.log("Failed to read architecture document", error instanceof Error ? error.message : String(error));
        throw new Error(`Cannot proceed without architecture document: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.log("Documents loaded", `Domain: ${domainDocument.length} chars, Architecture: ${architectureDocument.length} chars`);

    // Build the initial message for the agent
    const userMessage = `Please analyze the following documents and produce a comprehensive development plan with module decomposition and interface contracts.

## Domain Document

${domainDocument}

---

## Architecture Document

${architectureDocument}

---

Please use the available tools to:
1. Read the documents if needed with \`read_domain_document\` and \`read_architecture_document\`
2. Create a detailed development plan with module decomposition
3. Define interface contracts between modules
4. Create a dependency graph and execution order
5. Write the final plan as JSON with \`write_development_plan\`

Your output should be a complete, well-structured development plan in JSON format.`;

    const messages = this.buildMessages(userMessage);

    const result = await this.executeWithTools(messages);

    this.log("Development planning complete", `${result.length} characters`);
    return result;
  }
}
