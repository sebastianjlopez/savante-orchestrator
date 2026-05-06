import { Octokit } from "@octokit/rest";

export interface GitHubRepo {
  owner: string;
  repo: string;
}

export class GitHubClient {
  private octokit: Octokit;

  constructor() {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }

    this.octokit = new Octokit({ auth: token });
  }

  getOctokit(): Octokit {
    return this.octokit;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.octokit.users.getAuthenticated();
      return true;
    } catch {
      return false;
    }
  }

  async repoExists(owner: string, repo: string): Promise<boolean> {
    try {
      await this.octokit.repos.get({ owner, repo });
      return true;
    } catch (error: any) {
      if (error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  async createRepo(repo: string, isPrivate: boolean = true): Promise<GitHubRepo> {
    const response = await this.octokit.repos.createForAuthenticatedUser({
      name: repo,
      private: isPrivate,
      auto_init: true,
    });

    return {
      owner: response.data.owner.login,
      repo: response.data.name,
    };
  }

  async getRepoInfo(owner: string, repo: string) {
    const response = await this.octokit.repos.get({ owner, repo });
    return response.data;
  }
}
