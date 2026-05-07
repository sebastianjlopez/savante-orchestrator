import { Octokit } from "@octokit/rest";
import { GitHubClient } from "./client.js";

export class RepoReader {
  private octokit: Octokit;

  constructor(githubClient: GitHubClient) {
    this.octokit = githubClient.getOctokit();
  }

  async readFile(owner: string, repo: string, path: string): Promise<string> {
    try {
      const response = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      if (!('content' in response.data) || !response.data.content) {
        throw new Error(`File not found: ${path}`);
      }

      return Buffer.from(response.data.content, 'base64').toString('utf-8');
    } catch (error: any) {
      if (error.status === 404) {
        throw new Error(`File not found: ${path}`);
      }
      throw error;
    }
  }

  async listFiles(owner: string, repo: string, directory: string = ""): Promise<string[]> {
    const response = await this.octokit.repos.getContent({
      owner,
      repo,
      path: directory,
    });

    if (!Array.isArray(response.data)) {
      return [response.data.name];
    }

    return response.data
      .filter(item => item.type === 'file')
      .map(item => item.path);
  }

  async listAllFiles(owner: string, repo: string, directory: string = ""): Promise<string[]> {
    const response = await this.octokit.repos.getContent({
      owner,
      repo,
      path: directory,
    });

    if (!Array.isArray(response.data)) {
      return [response.data.path];
    }

    let allFiles: string[] = [];

    for (const item of response.data) {
      if (item.type === 'file') {
        allFiles.push(item.path);
      } else if (item.type === 'dir') {
        const subFiles = await this.listAllFiles(owner, repo, item.path);
        allFiles = allFiles.concat(subFiles);
      }
    }

    return allFiles;
  }

  async searchRepo(owner: string, repo: string, query: string): Promise<string[]> {
    const q = `${query} repo:${owner}/${repo}`;
    const response = await this.octokit.search.code({ q });

    return response.data.items.map(item => item.path);
  }

  async getFileTree(owner: string, repo: string, ref: string = "main"): Promise<string[]> {
    const response = await this.octokit.git.getTree({
      owner,
      repo,
      tree_sha: ref,
      recursive: 'true' as any,  // API expects string "true"
    });

    if (!('data' in response) || !response.data.tree) {
      return [];
    }

    return response.data.tree
      .filter(item => item.type === 'blob')
      .map(item => item.path || "");
  }
}
