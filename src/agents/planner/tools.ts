import type { ToolDefinition } from "../../llm/router-client.js";
import { RepoReader } from "../../github/repo-reader.js";
import { FileWriter } from "../../github/file-writer.js";
import { GitHubRepo } from "../../github/client.js";

export interface PlannerToolOptions {
  targetRepo: GitHubRepo;
  repoReader: RepoReader;
  fileWriter: FileWriter;
  domainDocumentPath?: string;
  architectureDocumentPath?: string;
  developmentPlanPath?: string;
}

export function getPlannerTools(_options: PlannerToolOptions): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "read_domain_document",
        description: "Reads the approved domain document from the target repository",
        parameters: {
          type: "object",
          properties: {
            branch: {
              type: "string",
              description: "Branch to read from (defaults to main)",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_architecture_document",
        description: "Reads the approved architecture document from the target repository",
        parameters: {
          type: "object",
          properties: {
            branch: {
              type: "string",
              description: "Branch to read from (defaults to main)",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_development_plan",
        description: "Writes the development plan JSON to the target repository",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The JSON content of the development plan",
            },
            branch: {
              type: "string",
              description: "Branch to write to (defaults to main)",
            },
          },
          required: ["content"],
        },
      },
    },
  ];
}

export function getPlannerToolExecutor(options: PlannerToolOptions) {
  const {
    targetRepo,
    repoReader,
    fileWriter,
    domainDocumentPath = "docs/domain-analysis.md",
    architectureDocumentPath = "docs/architecture-analysis.md",
    developmentPlanPath = "docs/development-plan.json",
  } = options;

  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case "read_domain_document": {
        const branch = (args["branch"] as string) || "main";
        try {
          const content = await repoReader.readFile(
            targetRepo.owner,
            targetRepo.repo,
            domainDocumentPath
          );
          return content;
        } catch (error) {
          return `Error reading domain document: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "read_architecture_document": {
        const branch = (args["branch"] as string) || "main";
        try {
          const content = await repoReader.readFile(
            targetRepo.owner,
            targetRepo.repo,
            architectureDocumentPath
          );
          return content;
        } catch (error) {
          return `Error reading architecture document: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "write_development_plan": {
        const content = args["content"] as string;
        const branch = (args["branch"] as string) || "main";

        if (!content) {
          return "Error: content is required";
        }

        try {
          await fileWriter.writeFile(
            targetRepo.owner,
            targetRepo.repo,
            developmentPlanPath,
            content,
            "Add development plan",
            branch
          );
          return `Development plan successfully written to ${developmentPlanPath} on branch ${branch}`;
        } catch (error) {
          return `Error writing development plan: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}
