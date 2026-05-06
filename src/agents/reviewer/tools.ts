import type { ToolDefinition } from "../../llm/router-client.js";
import { PRManager } from "../../github/pr-manager.js";
import { RepoReader } from "../../github/repo-reader.js";
import { GitHubRepo } from "../../github/client.js";
import type { ModuleSpec, InterfaceContract } from "../../types/plan.js";
import type { DevelopmentPlan } from "../../types/plan.js";

export interface ReviewerToolOptions {
  targetRepo: GitHubRepo;
  prManager: PRManager;
  repoReader: RepoReader;
  prNumber: number;
  developmentPlanPath?: string;
}

export function getReviewerTools(_options: ReviewerToolOptions): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "read_pr_diff",
        description: "Reads the diff of a pull request to see what code was changed",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_module_spec",
        description: "Reads the module specification that the PR should implement. This is the source of truth for what should be built.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_interface_contracts",
        description: "Reads the interface contracts that the module must fulfill (both as provider and consumer)",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "comment_on_pr",
        description: "Posts a comment on the pull request. Use this for general feedback or questions.",
        parameters: {
          type: "object",
          properties: {
            body: {
              type: "string",
              description: "Comment body (supports markdown)",
            },
          },
          required: ["body"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "approve_pr",
        description: "Approves the pull request. Use this when the PR meets all requirements and is ready to merge.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "request_changes",
        description: "Requests changes on the pull request. Use this when there are issues that must be fixed before merging. Provide detailed feedback in the body.",
        parameters: {
          type: "object",
          properties: {
            body: {
              type: "string",
              description: "Detailed explanation of what needs to be changed, including specific issues and how to fix them",
            },
          },
          required: ["body"],
        },
      },
    },
  ];
}

export function getReviewerToolExecutor(options: ReviewerToolOptions) {
  const {
    targetRepo,
    prManager,
    repoReader,
    prNumber,
    developmentPlanPath = "docs/development-plan.json",
  } = options;

  // Cache for development plan to avoid multiple reads
  let cachedPlan: DevelopmentPlan | null = null;

  async function getDevelopmentPlan(): Promise<DevelopmentPlan | null> {
    if (cachedPlan) {
      return cachedPlan;
    }

      try {
        const content = await repoReader.readFile(
          targetRepo.owner,
          targetRepo.repo,
          developmentPlanPath
        );
      cachedPlan = JSON.parse(content) as DevelopmentPlan;
      return cachedPlan;
    } catch (error) {
      console.error(`Error reading development plan: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async function getModuleName(): Promise<string | null> {
    try {
      const pr = await prManager.getPR(targetRepo.owner, targetRepo.repo, prNumber);
      // Extract module name from PR title - format: [Module: {name}] Implementation
      const titleMatch = pr.title.match(/\[Module:\s*(.+?)\]\s*Implementation/i);
      if (titleMatch) {
        return titleMatch[1].trim();
      }
      // Try to infer from branch name - format: feature/module-{name}
      if (pr.head.ref.startsWith("feature/module-")) {
        return pr.head.ref.replace("feature/module-", "").replace(/-/g, " ");
      }
      return null;
    } catch {
      return null;
    }
  }

  async function getModuleSpec(moduleName: string): Promise<ModuleSpec | null> {
    const plan = await getDevelopmentPlan();
    if (!plan) {
      return null;
    }

    const moduleSpec = plan.modules.find(
      (m) => m.name.toLowerCase() === moduleName.toLowerCase()
    );

    return moduleSpec || null;
  }

  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case "read_pr_diff": {
        try {
          const diff = await prManager.getPRDiff(
            targetRepo.owner,
            targetRepo.repo,
            prNumber
          );
          return `## PR Diff for #${prNumber}\n\n\`\`\`diff\n${diff}\n\`\`\``;
        } catch (error) {
          return `Error reading PR diff: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "read_module_spec": {
        const moduleName = await getModuleName();
        if (!moduleName) {
          return "Could not determine module name from PR title or branch. Please check the PR title format.";
        }

        const moduleSpec = await getModuleSpec(moduleName);
        if (!moduleSpec) {
          return `Module spec not found for module: ${moduleName}. Available modules: ${(await getDevelopmentPlan())?.modules.map(m => m.name).join(", ")}`;
        }

        return `# Module Specification: ${moduleSpec.name}\n\n${JSON.stringify(moduleSpec, null, 2)}`;
      }

      case "read_interface_contracts": {
        const moduleName = await getModuleName();
        if (!moduleName) {
          return "Could not determine module name from PR. Interface contracts cannot be retrieved without knowing the module.";
        }

        const plan = await getDevelopmentPlan();
        if (!plan) {
          return "Development plan not found. Cannot retrieve interface contracts.";
        }

        // Get contracts relevant to this module (both as provider and consumer)
        const relevantContracts = plan.interfaceContracts.filter(
          (c) => c.provider.toLowerCase() === moduleName.toLowerCase() ||
                  c.consumer.toLowerCase() === moduleName.toLowerCase()
        );

        if (relevantContracts.length === 0) {
          return `No interface contracts found for module: ${moduleName}`;
        }

        return `# Interface Contracts for ${moduleName}\n\n${JSON.stringify(relevantContracts, null, 2)}`;
      }

      case "comment_on_pr": {
        const body = args["body"] as string;
        if (!body) {
          return "Error: body is required for PR comment";
        }

        try {
          await prManager.commentOnPR(targetRepo.owner, targetRepo.repo, prNumber, body);
          return `Comment posted on PR #${prNumber}`;
        } catch (error) {
          return `Error posting comment: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "approve_pr": {
        try {
          await prManager.approvePR(targetRepo.owner, targetRepo.repo, prNumber);
          return `PR #${prNumber} has been approved!`;
        } catch (error) {
          return `Error approving PR: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "request_changes": {
        const body = args["body"] as string;
        if (!body) {
          return "Error: body is required when requesting changes";
        }

        try {
          await prManager.requestChanges(targetRepo.owner, targetRepo.repo, prNumber, body);
          return `Changes requested on PR #${prNumber}. The developer has been notified.`;
        } catch (error) {
          return `Error requesting changes: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}
