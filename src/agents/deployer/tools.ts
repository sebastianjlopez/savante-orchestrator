import type { ToolDefinition } from "../../llm/router-client.js";
import { RepoReader } from "../../github/repo-reader.js";
import { GitHubRepo } from "../../github/client.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface DeployerToolOptions {
  targetRepo: GitHubRepo;
  repoReader: RepoReader;
  architectureDocumentPath?: string;
}

export function getDeployerTools(_options: DeployerToolOptions): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "run_command",
        description: "Executes a shell command in a sandboxed environment. Use for deployment commands like 'cdk deploy' or 'terraform apply'.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
            },
            working_directory: {
              type: "string",
              description: "Optional working directory for the command",
            },
          },
          required: ["command"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "check_health",
        description: "Performs an HTTP GET request to verify an endpoint is responding with a 2xx status code.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL to check (e.g., https://api.example.com/health)",
            },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_deploy_logs",
        description: "Reads deployment logs from the target repository or a logs directory.",
        parameters: {
          type: "object",
          properties: {
            log_path: {
              type: "string",
              description: "Optional path to log file (defaults to reading deployment logs from repo)",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "notify_supervisor",
        description: "Sends a notification to the human supervisor about deployment status.",
        parameters: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "The notification message",
            },
            status: {
              type: "string",
              enum: ["success", "failure", "in_progress"],
              description: "The deployment status",
            },
          },
          required: ["message", "status"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_architecture_document",
        description: "Reads the architecture document to understand the AWS stack and deployment strategy.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
  ];
}

export function getDeployerToolExecutor(options: DeployerToolOptions) {
  const {
    targetRepo,
    repoReader,
    architectureDocumentPath = "docs/architecture-analysis.md",
  } = options;

  // Cache for architecture document
  let cachedArchitecture: string | null = null;

  async function getArchitectureDocument(): Promise<string | null> {
    if (cachedArchitecture) {
      return cachedArchitecture;
    }

    try {
      const content = await repoReader.readFile(
        targetRepo.owner,
        targetRepo.repo,
        architectureDocumentPath
      );
      cachedArchitecture = content;
      return content;
    } catch (error) {
      console.error(`Error reading architecture document: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  // Track deployment attempts
  let deploymentAttempts = 0;
  const MAX_ATTEMPTS = 3;

  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case "run_command": {
        const command = args["command"] as string;
        const workingDirectory = args["working_directory"] as string | undefined;

        if (!command) {
          return "Error: command is required";
        }

        // Basic safety check - prevent destructive commands
        const dangerousPatterns = ["rm -rf", "terraform destroy", "cdk destroy", "drop database"];
        const isDangerous = dangerousPatterns.some(pattern => command.toLowerCase().includes(pattern));
        if (isDangerous) {
          return `Error: Potentially dangerous command blocked: ${command}. Use a safer deployment command.`;
        }

        deploymentAttempts++;
        if (deploymentAttempts > MAX_ATTEMPTS) {
          return `Error: Maximum deployment attempts (${MAX_ATTEMPTS}) exceeded. Please check the configuration and try again.`;
        }

        try {
          const options: { cwd?: string } = {};
          if (workingDirectory) {
            options.cwd = workingDirectory;
          }

          console.log(`[Deployer] Executing command (attempt ${deploymentAttempts}): ${command}`);
          const { stdout, stderr } = await execAsync(command, options);

          let result = `Command executed successfully.\n\n`;
          if (stdout) {
            result += `STDOUT:\n${stdout}\n\n`;
          }
          if (stderr) {
            result += `STDERR:\n${stderr}\n\n`;
          }
          return result;
        } catch (error: any) {
          return `Command failed with exit code ${error.code || "unknown"}.\n\nSTDOUT:\n${error.stdout || "(none)"}\n\nSTDERR:\n${error.stderr || error.message}`;
        }
      }

      case "check_health": {
        const url = args["url"] as string;
        if (!url) {
          return "Error: url is required";
        }

        try {
          // Use Node.js fetch (available in Node 18+)
          const response = await fetch(url, { method: "GET" });

          if (response.ok) {
            const body = await response.text();
            return `Health check PASSED for ${url}\nStatus: ${response.status} ${response.statusText}\nResponse length: ${body.length} characters`;
          } else {
            return `Health check FAILED for ${url}\nStatus: ${response.status} ${response.statusText}\nThis indicates the deployment may not be working correctly.`;
          }
        } catch (error) {
          return `Health check ERROR for ${url}\nError: ${error instanceof Error ? error.message : String(error)}\nThis could mean the endpoint is not reachable or the deployment failed.`;
        }
      }

      case "read_deploy_logs": {
        const logPath = args["log_path"] as string | undefined;

        try {
          // Try to read deployment logs from common locations
          const possiblePaths = logPath ? [logPath] : [
            "logs/deploy.log",
            "deploy.log",
            "infrastructure/cdk.out/deploy.log",
            "terraform.log",
          ];

          for (const path of possiblePaths) {
            try {
              const content = await repoReader.readFile(
                targetRepo.owner,
                targetRepo.repo,
                path
              );
              return `# Deployment Logs (${path})\n\n\`\`\`\n${content}\n\`\`\``;
            } catch {
              // Continue to next path
            }
          }

          return "No deployment logs found. Check if the deployment has been run or if logs are stored in a different location.";
        } catch (error) {
          return `Error reading deployment logs: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "notify_supervisor": {
        const message = args["message"] as string;
        const status = args["status"] as string;

        if (!message) {
          return "Error: message is required";
        }

        const statusEmoji = status === "success" ? "✅" : status === "failure" ? "❌" : "⏳";
        const notification = `${statusEmoji} [DEPLOYMENT NOTIFICATION]\nStatus: ${status}\n\n${message}`;

        // Log to console (will be visible in CLI)
        console.log(`\n${"=".repeat(60)}`);
        console.log(notification);
        console.log(`${"=".repeat(60)}\n`);

        return `Supervisor notified with message: ${message}`;
      }

      case "read_architecture_document": {
        const archDoc = await getArchitectureDocument();
        if (!archDoc) {
          return "Error: Could not read architecture document. Make sure it exists at " + architectureDocumentPath;
        }

        return `# Architecture Document\n\n${archDoc}`;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}
