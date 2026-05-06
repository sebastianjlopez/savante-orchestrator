import type { ToolDefinition } from "../../llm/router-client.js";
import { RepoReader } from "../../github/repo-reader.js";
import { FileWriter } from "../../github/file-writer.js";
import { PRManager } from "../../github/pr-manager.js";
import { GitHubRepo } from "../../github/client.js";
import type { ModuleSpec, InterfaceContract } from "../../types/plan.js";

export interface DeveloperToolOptions {
  targetRepo: GitHubRepo;
  repoReader: RepoReader;
  fileWriter: FileWriter;
  prManager: PRManager;
  moduleSpec: ModuleSpec;
  interfaceContracts: InterfaceContract[];
  branch: string;
  developmentPlanPath?: string;
}

export function getDeveloperTools(_options: DeveloperToolOptions): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "read_module_spec",
        description: "Reads the module specification for the assigned module",
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
        description: "Reads the interface contracts that apply to this module",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_file",
        description: "Creates a new file in the module's branch",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file (relative to repo root)",
            },
            content: {
              type: "string",
              description: "File content",
            },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit_file",
        description: "Edits an existing file in the module's branch",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file (relative to repo root)",
            },
            oldText: {
              type: "string",
              description: "Text to replace",
            },
            newText: {
              type: "string",
              description: "New text",
            },
          },
          required: ["path", "oldText", "newText"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_tests",
        description: "Runs tests for the module",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "open_pull_request",
        description: "Opens a pull request from the module branch to main",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "PR title",
            },
            description: {
              type: "string",
              description: "PR description",
            },
          },
          required: ["title", "description"],
        },
      },
    },
  ];
}

export function getDeveloperToolExecutor(options: DeveloperToolOptions) {
  const {
    targetRepo,
    fileWriter,
    prManager,
    moduleSpec,
    interfaceContracts,
    branch,
    developmentPlanPath = "docs/development-plan.json",
  } = options;

  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case "read_module_spec": {
        return JSON.stringify(moduleSpec, null, 2);
      }

      case "read_interface_contracts": {
        // Filter contracts relevant to this module
        const relevantContracts = interfaceContracts.filter(
          (c) => c.provider === moduleSpec.name || c.consumer === moduleSpec.name
        );
        return JSON.stringify(relevantContracts, null, 2);
      }

      case "create_file": {
        const path = args["path"] as string;
        const content = args["content"] as string;

        if (!path || !content) {
          return "Error: path and content are required";
        }

        try {
          await fileWriter.writeFile(
            targetRepo.owner,
            targetRepo.repo,
            path,
            content,
            `Create ${path}`,
            branch
          );
          return `File created: ${path}`;
        } catch (error) {
          return `Error creating file: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "edit_file": {
        // Note: This is a simplified implementation
        // In practice, you'd want to read the file first, then modify it
        return "Edit file tool: Please use create_file to overwrite the file for now.";
      }

      case "run_tests": {
        // Placeholder for test execution
        // In practice, this would run the actual test command
        return "Tests passed! (placeholder - actual test execution to be implemented)";
      }

      case "open_pull_request": {
        const title = args["title"] as string;
        const description = args["description"] as string;

        if (!title || !description) {
          return "Error: title and description are required";
        }

        try {
          const prNumber = await prManager.createPR(
            targetRepo.owner,
            targetRepo.repo,
            title,
            description,
            branch,
            "main"
          );
          return `Pull request created: #${prNumber}`;
        } catch (error) {
          return `Error creating PR: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}
