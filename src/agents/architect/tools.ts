import type { ToolDefinition } from "../../llm/router-client.js";
import { RepoReader } from "../../github/repo-reader.js";
import { FileWriter } from "../../github/file-writer.js";
import { GitHubRepo } from "../../github/client.js";
import { AWSPriceClient } from "../../aws/pricing-client.js";

export interface ArchitectToolOptions {
  targetRepo: GitHubRepo;
  repoReader: RepoReader;
  fileWriter: FileWriter;
  pricingClient: AWSPriceClient;
  domainDocumentPath?: string;
  architectureDocumentPath?: string;
}

export function getArchitectTools(_options: ArchitectToolOptions): ToolDefinition[] {
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
        name: "lookup_aws_service",
        description: "Queries AWS service description and pricing via AWS Pricing API. Returns formatted pricing details for cost estimation.",
        parameters: {
          type: "object",
          properties: {
            service_name: {
              type: "string",
              description: "Name of the AWS service (e.g., 'Lambda', 'DynamoDB', 'S3', 'API Gateway', 'EC2')",
            },
          },
          required: ["service_name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_architecture_document",
        description: "Writes the architecture document to the target repository",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The markdown content of the architecture document",
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

export function getArchitectToolExecutor(options: ArchitectToolOptions) {
  const {
    targetRepo,
    repoReader,
    fileWriter,
    pricingClient,
    domainDocumentPath = "docs/domain-analysis.md",
    architectureDocumentPath = "docs/architecture-analysis.md",
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

      case "lookup_aws_service": {
        const serviceName = args["service_name"] as string;
        if (!serviceName) {
          return "Error: service_name is required";
        }
        return await pricingClient.getServicePricing(serviceName);
      }

      case "write_architecture_document": {
        const content = args["content"] as string;
        const branch = (args["branch"] as string) || "main";

        if (!content) {
          return "Error: content is required";
        }

        try {
          await fileWriter.writeFile(
            targetRepo.owner,
            targetRepo.repo,
            architectureDocumentPath,
            content,
            "Add architecture analysis document",
            branch
          );
          return `Architecture document successfully written to ${architectureDocumentPath} on branch ${branch}`;
        } catch (error) {
          return `Error writing architecture document: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}
