import { BaseAgent, type BaseAgentOptions } from "../base-agent.js";
import { ARCHITECT_SYSTEM_PROMPT } from "./prompts.js";
import { getArchitectTools, getArchitectToolExecutor, type ArchitectToolOptions } from "./tools.js";
import { RepoReader } from "../../github/repo-reader.js";
import { FileWriter } from "../../github/file-writer.js";
import { GitHubRepo } from "../../github/client.js";
import { AWSPriceClient } from "../../aws/pricing-client.js";

export interface ArchitectAgentOptions {
  targetRepo: GitHubRepo;
  repoReader: RepoReader;
  fileWriter: FileWriter;
  pricingClient: AWSPriceClient;
  domainDocumentPath?: string;
  architectureDocumentPath?: string;
}

export class ArchitectAgent extends BaseAgent {
  private targetRepo: GitHubRepo;
  private repoReader: RepoReader;
  private fileWriter: FileWriter;
  private pricingClient: AWSPriceClient;
  private domainDocumentPath: string;
  private architectureDocumentPath: string;

  constructor(options: ArchitectAgentOptions) {
    const toolOptions: ArchitectToolOptions = {
      targetRepo: options.targetRepo,
      repoReader: options.repoReader,
      fileWriter: options.fileWriter,
      pricingClient: options.pricingClient,
      domainDocumentPath: options.domainDocumentPath,
      architectureDocumentPath: options.architectureDocumentPath,
    };

    const tools = getArchitectTools(toolOptions);
    const toolExecutor = getArchitectToolExecutor(toolOptions);

    const baseOptions: BaseAgentOptions = {
      agentName: "architect",
      systemPrompt: ARCHITECT_SYSTEM_PROMPT,
      tools,
      toolExecutor,
      maxToolIterations: 15, // Architecture analysis may require more tool iterations
    };

    super(baseOptions);

    this.targetRepo = options.targetRepo;
    this.repoReader = options.repoReader;
    this.fileWriter = options.fileWriter;
    this.pricingClient = options.pricingClient;
    this.domainDocumentPath = options.domainDocumentPath || "docs/domain-analysis.md";
    this.architectureDocumentPath = options.architectureDocumentPath || "docs/architecture-analysis.md";
  }

  async run(context: Record<string, unknown>): Promise<string> {
    this.log("Starting architecture analysis", `${this.targetRepo.owner}/${this.targetRepo.repo}`);

    // Get the domain document content from context or read from repo
    let domainDocument = context["domainDocument"] as string | undefined;

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

    this.log("Domain document loaded", `${domainDocument.length} characters`);

    // Build the initial message for the agent
    const userMessage = `Please analyze the following domain document and produce a comprehensive architecture analysis.

## Domain Document

${domainDocument}

---

Please use the available tools to:
1. Look up AWS service pricing with \`lookup_aws_service\` for cost estimation
2. Read any additional context if needed with \`read_domain_document\`
3. Write the final architecture document with \`write_architecture_document\`

Your output should be a complete, well-structured architecture analysis document.`;

    const messages = this.buildMessages(userMessage);

    const result = await this.executeWithTools(messages);

    this.log("Architecture analysis complete", `${result.length} characters`);
    return result;
  }
}
