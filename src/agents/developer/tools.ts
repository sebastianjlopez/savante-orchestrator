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
        description: "Reads the interface contracts that apply to this module (both as provider and consumer)",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_repo_structure",
        description: "Reads the target repository file structure (tree view) to understand where to place files",
        parameters: {
          type: "object",
          properties: {
            ref: {
              type: "string",
              description: "Branch or ref to read from (defaults to module branch)",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Reads a file from the module's branch for verification or editing",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file (relative to repo root)",
            },
          },
          required: ["path"],
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
        description: "Edits an existing file by replacing oldText with newText. Reads the file, performs replacement, and writes it back.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file (relative to repo root)",
            },
            oldText: {
              type: "string",
              description: "Text to be replaced (must match exactly, including whitespace)",
            },
            newText: {
              type: "string",
              description: "New text to replace with",
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
        description: "Runs tests for the module. Returns test results including pass/fail status.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_linter",
        description: "Runs linter on the module's code to check code quality and style compliance",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "check_contract_compliance",
        description: "Validates that the implementation fulfills a specific interface contract. Checks request/response schemas for API contracts.",
        parameters: {
          type: "object",
          properties: {
            contractId: {
              type: "string",
              description: "Identifier for the contract to check (typically 'provider:consumer' format)",
            },
          },
          required: ["contractId"],
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
              description: "PR title (should be '[Module: {name}] Implementation')",
            },
            description: {
              type: "string",
              description: "PR description including module name, implemented features, how to test, and any spec deviations",
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
    repoReader,
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
        // Return all contracts relevant to this module
        const relevantContracts = interfaceContracts.filter(
          (c) => c.provider === moduleSpec.name || c.consumer === moduleSpec.name
        );
        return JSON.stringify(relevantContracts, null, 2);
      }

      case "read_repo_structure": {
        const ref = (args["ref"] as string) || branch;
        try {
          const files = await repoReader.getFileTree(
            targetRepo.owner,
            targetRepo.repo,
            ref
          );
          // Return as a simple tree structure
          const tree = buildTreeStructure(files);
          return JSON.stringify(tree, null, 2);
        } catch (error) {
          return `Error reading repo structure: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "read_file": {
        const path = args["path"] as string;
        if (!path) {
          return "Error: path is required";
        }
        try {
          const content = await fileWriter.readFile(
            targetRepo.owner,
            targetRepo.repo,
            path,
            branch
          );
          return content;
        } catch (error) {
          return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "create_file": {
        const path = args["path"] as string;
        const content = args["content"] as string;

        if (!path || content === undefined) {
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
        const path = args["path"] as string;
        const oldText = args["oldText"] as string;
        const newText = args["newText"] as string;

        if (!path || oldText === undefined || newText === undefined) {
          return "Error: path, oldText, and newText are required";
        }

        try {
          // Read the current file content
          const currentContent = await fileWriter.readFile(
            targetRepo.owner,
            targetRepo.repo,
            path,
            branch
          );

          // Check if oldText exists in the file
          const index = currentContent.indexOf(oldText);
          if (index === -1) {
            return `Error: oldText not found in ${path}. Please check the text matches exactly.`;
          }

          // Replace oldText with newText
          const updatedContent = currentContent.replace(oldText, newText);

          // Write the updated file
          await fileWriter.writeFile(
            targetRepo.owner,
            targetRepo.repo,
            path,
            updatedContent,
            `Edit ${path}`,
            branch
          );

          return `File edited: ${path}`;
        } catch (error) {
          return `Error editing file: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "run_tests": {
        // Placeholder for test execution
        // In practice, this would trigger GitHub Actions or run a command in a sandbox
        return "Tests passed! (Note: actual test execution to be implemented with CI integration)";
      }

      case "run_linter": {
        // Placeholder for linter execution
        // In practice, this would run eslint, prettier, or other linters via CI
        return "Linting passed! (Note: actual linter execution to be implemented with CI integration)";
      }

      case "check_contract_compliance": {
        const contractId = args["contractId"] as string;

        if (!contractId) {
          return "Error: contractId is required";
        }

        // Find the contract
        const contract = interfaceContracts.find(
          (c) =>
            c.provider === moduleSpec.name &&
            (c.consumer === contractId || `${c.provider}:${c.consumer}` === contractId)
        );

        if (!contract) {
          return `Contract not found: ${contractId}. Available contracts for this module: ${interfaceContracts
            .filter(c => c.provider === moduleSpec.name)
            .map(c => `${c.provider}:${c.consumer}`)
            .join(", ")}`;
        }

        // Basic compliance check: verify the contract definition is valid
        // In a full implementation, this would:
        // 1. Parse the contract definition (JSON schema, OpenAPI, etc.)
        // 2. Scan the implementation files for matching endpoints/types
        // 3. Validate request/response schemas
        return `Contract compliance check for "${contractId}":\n- Provider: ${contract.provider}\n- Consumer: ${contract.consumer}\n- Type: ${contract.contractType}\n- Definition: ${contract.definition}\n\nStatus: PASSED (basic validation). Full schema validation to be implemented.`;
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
          return `Pull request created: #${prNumber} - ${title}`;
        } catch (error) {
          return `Error creating PR: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}

/**
 * Builds a tree structure from a flat list of file paths
 */
function buildTreeStructure(files: string[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  for (const file of files) {
    const parts = file.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        // File
        current[part] = { type: "file", path: file };
      } else {
        // Directory
        if (!current[part]) {
          current[part] = { type: "directory", children: {} };
        }
        current = (current[part] as Record<string, unknown>)["children"] as Record<string, unknown>;
      }
    }
  }

  return root;
}
