import { BaseAgent, type BaseAgentOptions } from "../base-agent.js";
import { REVIEWER_SYSTEM_PROMPT } from "./prompts.js";
import { getReviewerTools, getReviewerToolExecutor, type ReviewerToolOptions } from "./tools.js";
import { PRManager } from "../../github/pr-manager.js";
import { RepoReader } from "../../github/repo-reader.js";
import { GitHubRepo } from "../../github/client.js";

export interface ReviewerAgentOptions {
  targetRepo: GitHubRepo;
  prManager: PRManager;
  repoReader: RepoReader;
  prNumber: number;
  developmentPlanPath?: string;
}

export class ReviewerAgent extends BaseAgent {
  private targetRepo: GitHubRepo;
  private prManager: PRManager;
  private prNumber: number;

  constructor(options: ReviewerAgentOptions) {
    const toolOptions: ReviewerToolOptions = {
      targetRepo: options.targetRepo,
      prManager: options.prManager,
      repoReader: options.repoReader,
      prNumber: options.prNumber,
      developmentPlanPath: options.developmentPlanPath,
    };

    const tools = getReviewerTools(toolOptions);
    const toolExecutor = getReviewerToolExecutor(toolOptions);

    const baseOptions: BaseAgentOptions = {
      agentName: `reviewer-pr-${options.prNumber}`,
      systemPrompt: REVIEWER_SYSTEM_PROMPT,
      tools,
      toolExecutor,
      maxToolIterations: 15, // Reviewing may require reading multiple pieces of context
    };

    super(baseOptions);

    this.targetRepo = options.targetRepo;
    this.prManager = options.prManager;
    this.prNumber = options.prNumber;
  }

  async run(_context: Record<string, unknown>): Promise<string> {
    this.log("Starting PR review", `PR #${this.prNumber}`);

    // Get PR details for logging
    try {
      const pr = await this.prManager.getPR(this.targetRepo.owner, this.targetRepo.repo, this.prNumber);
      this.log("Reviewing PR", `#${this.prNumber}: ${pr.title}`);
      this.log("PR Author", pr.user?.login || "unknown");
      this.log("PR Branch", pr.head.ref);
    } catch (error) {
      this.log("Warning: Could not fetch PR details", error instanceof Error ? error.message : String(error));
    }

    // Build the initial message for the agent
    const userMessage = `Please review pull request #${this.prNumber} in the repository ${this.targetRepo.owner}/${this.targetRepo.repo}.

## Your Task
1. Use \`read_pr_diff\` to examine the code changes
2. Use \`read_module_spec\` to understand what was supposed to be implemented
3. Use \`read_interface_contracts\` to verify contract compliance
4. Evaluate the PR against all criteria (code quality, spec compliance, contract compliance)
5. Make a decision: approve, request changes, or reject

## Important Notes
- The module name will be automatically extracted from the PR title (format: [Module: {name}] Implementation)
- If the PR title doesn't match the expected format, check the branch name (feature/module-{name})
- Be thorough in your review - check ALL acceptance criteria
- Verify ALL interface contracts where this module is the provider
- Provide constructive, specific feedback when requesting changes

Please start by reading the PR diff and module specification.`;

    const messages = this.buildMessages(userMessage);

    const result = await this.executeWithTools(messages);

    this.log("Review complete", `PR #${this.prNumber} reviewed`);
    return result;
  }
}
