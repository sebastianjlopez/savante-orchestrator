import type { ToolDefinition } from "../../llm/router-client.js";
import { RepoReader } from "../../github/repo-reader.js";
import { GitHubRepo } from "../../github/client.js";

export function getAnalystTools(repo: GitHubRepo, repoReader: RepoReader): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "read_repo_file",
        description: "Reads a file from the documentation repository",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file in the repository",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_repo_files",
        description: "Lists files in a directory of the repository",
        parameters: {
          type: "object",
          properties: {
            directory: {
              type: "string",
              description: "Directory path (defaults to root)",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_repo",
        description: "Searches for text across the repository files",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query string",
            },
          },
          required: ["query"],
        },
      },
    },
  ];
}

export function getAnalystToolExecutor(repo: GitHubRepo, repoReader: RepoReader) {
  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case "read_repo_file": {
        const path = args["path"] as string;
        const content = await repoReader.readFile(repo.owner, repo.repo, path);
        return content;
      }
      case "list_repo_files": {
        const directory = (args["directory"] as string) || "";
        const files = await repoReader.listFiles(repo.owner, repo.repo, directory);
        return JSON.stringify(files, null, 2);
      }
      case "search_repo": {
        const query = args["query"] as string;
        const results = await repoReader.searchRepo(repo.owner, repo.repo, query);
        return JSON.stringify(results, null, 2);
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}
