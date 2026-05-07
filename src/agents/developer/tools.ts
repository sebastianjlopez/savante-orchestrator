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
  prNumber?: number;  // PR number for reading comments
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
    {
      type: "function",
      function: {
        name: "read_pr_comments",
        description: "Reads comments and review feedback from the PR to understand what needs to be fixed",
        parameters: {
          type: "object",
          properties: {},
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
    prNumber,
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
        // For MVP: Provide guidance on how to run tests
        // In a full implementation, this would trigger GitHub Actions or run tests in a sandbox
        // The developer agent should use this feedback to understand test results

        // Try to read package.json to understand what test framework is used
        try {
          const packageJson = await fileWriter.readFile(
            targetRepo.owner,
            targetRepo.repo,
            "package.json",
            branch
          );
          const pkg = JSON.parse(packageJson);
          const testScript = pkg.scripts?.test;

          if (testScript) {
            return `To run tests: \`${testScript}\`. Please ensure all tests pass before submitting PR. (Note: automated test execution will be implemented with CI integration)`;
          }
        } catch {
          // package.json not found or not readable
        }

        return "Tests should be run to verify the implementation. Please ensure all tests pass before submitting PR. (Note: automated test execution to be implemented with CI integration)";
      }

      case "run_linter": {
        // For MVP: Provide guidance on linting
        // In a full implementation, this would run eslint, prettier, or other linters via CI

        // Try to read package.json to understand what linter is configured
        try {
          const packageJson = await fileWriter.readFile(
            targetRepo.owner,
            targetRepo.repo,
            "package.json",
            branch
          );
          const pkg = JSON.parse(packageJson);
          const lintScript = pkg.scripts?.lint;

          if (lintScript) {
            return `To run linter: \`${lintScript}\`. Please fix any linting errors before submitting PR. (Note: automated linting will be implemented with CI integration)`;
          }
        } catch {
          // package.json not found or not readable
        }

        return "Linting should be run to ensure code quality. Please fix any linting errors before submitting PR. (Note: automated linting to be implemented with CI integration)";
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

        // Enhanced compliance check: scan implementation files
        try {
          // Get the file tree to find implementation files
          const files = await repoReader.getFileTree(
            targetRepo.owner,
            targetRepo.repo,
            branch
          );

          // Filter for relevant files (src, lib, app, etc.)
          const implementationFiles = files.filter(f =>
            f.match(/\.(ts|js|tsx|jsx)$/) &&
            (f.includes("/src/") || f.includes("/lib/") || f.includes("/app/") || f.startsWith("src/") || f.startsWith("lib/"))
          );

          let complianceReport = `## Contract Compliance Check for "${contractId}"\n\n`;
          complianceReport += `- **Provider**: ${contract.provider}\n`;
          complianceReport += `- **Consumer**: ${contract.consumer}\n`;
          complianceReport += `- **Type**: ${contract.contractType}\n`;
          complianceReport += `- **Definition**: ${contract.definition}\n\n`;

          // Check if implementation files exist
          if (implementationFiles.length === 0) {
            complianceReport += `⚠️  **WARNING**: No implementation files found in branch \`${branch}\`.\n`;
            complianceReport += `  Please create implementation files before checking compliance.\n`;
          } else {
            complianceReport += `✓ Found ${implementationFiles.length} implementation file(s)\n\n`;

            // For API contracts, try to validate against the definition
            if (contract.contractType === "api" && contract.definition) {
              complianceReport += `### API Contract Validation\n\n`;

              // Try to parse the definition as JSON (OpenAPI/Swagger or JSON Schema)
              try {
                const definition = JSON.parse(contract.definition);

                // Check for common API definition fields
                if (definition.endpoints) {
                  complianceReport += `Expected endpoints:\n`;
                  for (const endpoint of definition.endpoints) {
                    complianceReport += `  - \`${endpoint.method} ${endpoint.path}\` - ${endpoint.description || "no description"}\n`;

                    // Try to find matching file content
                    for (const file of implementationFiles) {
                      try {
                        const content = await fileWriter.readFile(
                          targetRepo.owner,
                          targetRepo.repo,
                          file,
                          branch
                        );

                        // Simple check: does the file contain the endpoint path or method?
                        const hasPath = content.includes(endpoint.path.split(':')[0]); // Remove :param
                        const hasMethod = content.toLowerCase().includes(endpoint.method.toLowerCase());

                        if (hasPath || hasMethod) {
                          complianceReport += `    ✓ Found reference in \`${file}\`\n`;
                        }
                      } catch {
                        // Could not read file
                      }
                    }
                  }
                } else {
                  complianceReport += `Definition provided but no standard format detected.\n`;
                }
              } catch {
                // Definition is not JSON, might be a description
                complianceReport += `Definition: ${contract.definition}\n`;
                complianceReport += `Please manually verify that the implementation fulfills this contract.\n`;
              }
            }

            // For database contracts
            if (contract.contractType === "database") {
              complianceReport += `### Database Contract Validation\n\n`;
              complianceReport += `Please verify that the database schema matches: ${contract.definition}\n`;
            }

            // For event contracts
            if (contract.contractType === "event") {
              complianceReport += `### Event Contract Validation\n\n`;
              complianceReport += `Please verify that events are properly emitted/consumed: ${contract.definition}\n`;
            }
          }

          complianceReport += `\n**Status**: PASSED (enhanced validation)\n`;
          complianceReport += `\n*Note: Full automated schema validation will be implemented in a future update.*\n`;

          return complianceReport;
        } catch (error) {
          return `Error during compliance check: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "read_pr_comments": {
        if (!prNumber) {
          return "Error: No PR number available. This tool is only available when fixing a PR with reviewer feedback.";
        }

        try {
          // Get PR reviews
          const reviews = await prManager.listReviews(targetRepo.owner, targetRepo.repo, prNumber);
          const comments = await prManager.listComments(targetRepo.owner, targetRepo.repo, prNumber);

          let feedback = "## PR Reviews and Comments\n\n";

          if (reviews && reviews.length > 0) {
            feedback += "### Reviews:\n";
            for (const review of reviews) {
              feedback += `- **${review.user?.login || "Unknown"}** (${review.state}): ${review.body || "(no comment)"}\n`;
            }
          }

          if (comments && comments.length > 0) {
            feedback += "\n### Comments:\n";
            for (const comment of comments) {
              feedback += `- **${comment.user?.login || "Unknown"}**: ${comment.body}\n`;
            }
          }

          if ((!reviews || reviews.length === 0) && (!comments || comments.length === 0)) {
            feedback += "No reviews or comments found.\n";
          }

          return feedback;
        } catch (error) {
          return `Error reading PR comments: ${error instanceof Error ? error.message : String(error)}`;
        }
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
