import { BaseAgent, type BaseAgentOptions } from "../base-agent.js";
import { INTEGRATOR_SYSTEM_PROMPT } from "./prompts.js";
import { getIntegratorTools, getIntegratorToolExecutor, type IntegratorToolOptions } from "./tools.js";
import { PRManager } from "../../github/pr-manager.js";
import { RepoReader } from "../../github/repo-reader.js";
import { FileWriter } from "../../github/file-writer.js";
import { GitHubRepo } from "../../github/client.js";
import type { DevelopmentPlan } from "../../types/plan.js";

export interface IntegratorAgentOptions {
  targetRepo: GitHubRepo;
  prManager: PRManager;
  repoReader: RepoReader;
  fileWriter: FileWriter;
  developmentPlanPath?: string;
}

export class IntegratorAgent extends BaseAgent {
  private targetRepo: GitHubRepo;
  private prManager: PRManager;
  private developmentPlanPath: string;

  constructor(options: IntegratorAgentOptions) {
    const toolOptions: IntegratorToolOptions = {
      targetRepo: options.targetRepo,
      prManager: options.prManager,
      repoReader: options.repoReader,
      fileWriter: options.fileWriter,
      developmentPlanPath: options.developmentPlanPath,
    };

    const tools = getIntegratorTools(toolOptions);
    const toolExecutor = getIntegratorToolExecutor(toolOptions);

    const baseOptions: BaseAgentOptions = {
      agentName: "integrator",
      systemPrompt: INTEGRATOR_SYSTEM_PROMPT,
      tools,
      toolExecutor,
      maxToolIterations: 30, // Integration may require multiple iterations for conflict resolution
    };

    super(baseOptions);

    this.targetRepo = options.targetRepo;
    this.prManager = options.prManager;
    this.developmentPlanPath = options.developmentPlanPath || "docs/development-plan.json";
  }

  async run(_context: Record<string, unknown>): Promise<string> {
    this.log("Starting integration process", "Merging approved PRs in dependency order");

    // Get all open PRs from feature/module-* branches
    const prs = await this.prManager.listPRs(this.targetRepo.owner, this.targetRepo.repo, "open");
    const modulePRs = prs.filter(pr => pr.head.ref.startsWith("feature/module-"));

    this.log("Found module PRs", `${modulePRs.length} PRs to integrate`);

    if (modulePRs.length === 0) {
      return "No module PRs found to integrate. Integration complete (nothing to do).";
    }

    // Build PR number to module name mapping
    const prModuleMap: Record<number, string> = {};
    for (const pr of modulePRs) {
      const moduleName = this.extractModuleNameFromPR(pr);
      prModuleMap[pr.number] = moduleName;
      this.log(`PR #${pr.number} mapped to module`, moduleName);
    }

    // Read development plan to get execution order
    const userMessage = `Please integrate all approved module PRs into the main branch.

## Your Task
1. Use \`get_dependency_graph\` to retrieve the execution order
2. For each module in the execution order:
   - Find the corresponding PR (module name -> PR mapping: ${JSON.stringify(prModuleMap)})
   - Use \`check_merge_conflicts\` to verify no conflicts
   - If no conflicts: use \`merge_pr\` to merge it
   - If conflicts exist: try \`resolve_conflict\` for simple cases, or \`escalate_conflict\` for complex ones
3. After all merges, verify the integration is complete

## PRs to Integrate
${modulePRs.map(pr => `- PR #${pr.number}: ${pr.title} (${pr.head.ref})`).join("\n")}

## Important Notes
- Follow the execution order from the dependency graph strictly
- Only merge PRs that are approved (check mergeable status)
- If a PR has conflicts, attempt resolution before escalating
- Log each action for audit trail
- Report the final integration status`;

    const messages = this.buildMessages(userMessage);
    const result = await this.executeWithTools(messages);

    this.log("Integration complete", "All PRs processed");
    return result;
  }

  private extractModuleNameFromPR(pr: any): string {
    // Try to extract from PR title - format: [Module: {name}] Implementation
    const titleMatch = pr.title?.match(/\[Module:\s*(.+?)\]\s*Implementation/i);
    if (titleMatch) {
      return titleMatch[1].trim();
    }
    // Try to infer from branch name - format: feature/module-{name}
    if (pr.head?.ref?.startsWith("feature/module-")) {
      return pr.head.ref.replace("feature/module-", "").replace(/-/g, " ");
    }
    return "unknown";
  }
}
