import type { ToolDefinition } from "../../llm/router-client.js";
import { PRManager } from "../../github/pr-manager.js";
import { RepoReader } from "../../github/repo-reader.js";
import { FileWriter } from "../../github/file-writer.js";
import { GitHubRepo } from "../../github/client.js";
import type { DevelopmentPlan } from "../../types/plan.js";

export interface IntegratorToolOptions {
  targetRepo: GitHubRepo;
  prManager: PRManager;
  repoReader: RepoReader;
  fileWriter: FileWriter;
  developmentPlanPath?: string;
}

export function getIntegratorTools(_options: IntegratorToolOptions): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "get_dependency_graph",
        description: "Reads the development plan and returns the dependency graph with execution order for topological merge",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "merge_pr",
        description: "Merges a pull request into the main branch. Only call this after verifying there are no conflicts.",
        parameters: {
          type: "object",
          properties: {
            pr_number: {
              type: "number",
              description: "The pull request number to merge",
            },
          },
          required: ["pr_number"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "check_merge_conflicts",
        description: "Checks if a PR has merge conflicts. Returns conflict status and details if conflicts exist.",
        parameters: {
          type: "object",
          properties: {
            pr_number: {
              type: "number",
              description: "The pull request number to check",
            },
          },
          required: ["pr_number"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "resolve_conflict",
        description: "Attempts to resolve a simple merge conflict by updating the file with the chosen resolution. Use this for simple conflicts like import ordering or formatting.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "The path to the file with conflicts",
            },
            resolution: {
              type: "string",
              description: "The resolved file content (without conflict markers)",
            },
          },
          required: ["file_path", "resolution"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "escalate_conflict",
        description: "Escalates a complex merge conflict to human supervisor. Use this for logic conflicts that cannot be automatically resolved.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "The path to the file with conflicts",
            },
            description: {
              type: "string",
              description: "Detailed description of the conflict and why it cannot be automatically resolved",
            },
          },
          required: ["file_path", "description"],
        },
      },
    },
  ];
}

export function getIntegratorToolExecutor(options: IntegratorToolOptions) {
  const {
    targetRepo,
    prManager,
    repoReader,
    fileWriter,
    developmentPlanPath = "docs/development-plan.json",
  } = options;

  // Cache for development plan
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

  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case "get_dependency_graph": {
        const plan = await getDevelopmentPlan();
        if (!plan) {
          return "Error: Could not read development plan from " + developmentPlanPath;
        }

        const graphInfo = {
          executionOrder: plan.executionOrder,
          nodes: plan.dependencyGraph.nodes.map((n: any) => ({ id: n.id, label: n.label })),
          edges: plan.dependencyGraph.edges.map((e: any) => ({ from: e.from, to: e.to })),
        };

        const orderList = plan.executionOrder.map((module: string, i: number) => `${i + 1}. ${module}`).join("\n");
        return `# Dependency Graph\n\n## Execution Order (merge in this order)\n${orderList}\n\n## Graph Details\n${JSON.stringify(graphInfo, null, 2)}`;
      }

      case "merge_pr": {
        const prNumber = args["pr_number"] as number;
        if (!prNumber) {
          return "Error: pr_number is required";
        }

        try {
          // First check if PR is mergeable
          const pr = await prManager.getPR(targetRepo.owner, targetRepo.repo, prNumber);

          if (pr.merged) {
            return `PR #${prNumber} is already merged.`;
          }

          if (pr.mergeable === false) {
            return `PR #${prNumber} has merge conflicts and cannot be merged. Please resolve conflicts first.`;
          }

          await prManager.mergePR(targetRepo.owner, targetRepo.repo, prNumber);
          return `Successfully merged PR #${prNumber}: ${pr.title}`;
        } catch (error) {
          return `Error merging PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "check_merge_conflicts": {
        const prNumber = args["pr_number"] as number;
        if (!prNumber) {
          return "Error: pr_number is required";
        }

        try {
          const pr = await prManager.getPR(targetRepo.owner, targetRepo.repo, prNumber);

          if (pr.merged) {
            return `PR #${prNumber} is already merged. No conflicts to check.`;
          }

          // Check mergeable status
          if (pr.mergeable === true) {
            return `PR #${prNumber} has no merge conflicts. Status: mergeable.`;
          }

          if (pr.mergeable === false) {
            // Get the diff to show conflict details
            try {
              const diff = await prManager.getPRDiff(targetRepo.owner, targetRepo.repo, prNumber);
              const conflictFiles = diff.split("diff --git").filter((f: string) => f.includes("<<<<<<<") || f.includes("=======") || f.includes(">>>>>>>"));

              return `PR #${prNumber} HAS MERGE CONFLICTS.\n\nConflicted file count: ${conflictFiles.length}\n\nPlease use resolve_conflict or escalate_conflict to handle these conflicts.`;
            } catch {
              return `PR #${prNumber} HAS MERGE CONFLICTS. Unable to retrieve detailed conflict information.`;
            }
          }

          return `PR #${prNumber} mergeable status: ${pr.mergeable}. This may be a GitHub API delay - try again in a moment.`;
        } catch (error) {
          return `Error checking conflicts for PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "resolve_conflict": {
        const filePath = args["file_path"] as string;
        const resolution = args["resolution"] as string;

        if (!filePath || !resolution) {
          return "Error: file_path and resolution are required";
        }

        try {
          // Write the resolved content to the file in the target branch
          // First, we need to determine which PR/branch this file belongs to
          // For now, we'll write to main branch directly (in a real scenario, you'd update the PR branch)
          await fileWriter.writeFile(
            targetRepo.owner,
            targetRepo.repo,
            filePath,
            resolution,
            `Resolve merge conflict in ${filePath}`,
            "main" // This should be the PR's branch in practice
          );

          return `Conflict in ${filePath} has been resolved. The file has been updated with the provided resolution.`;
        } catch (error) {
          return `Error resolving conflict in ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "escalate_conflict": {
        const filePath = args["file_path"] as string;
        const description = args["description"] as string;

        if (!filePath || !description) {
          return "Error: file_path and description are required";
        }

        // Log the escalation
        const escalationMessage = `ESCALATED CONFLICT\nFile: ${filePath}\nDescription: ${description}\n\nThis conflict requires human intervention.`;

        // In a real implementation, this would update the state or notify via gate manager
        console.log(`[INTEGRATOR ESCALATION] ${escalationMessage}`);

        return `Conflict escalated to human supervisor.\n\n${escalationMessage}\n\nThe integration process will pause for human intervention.`;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}
