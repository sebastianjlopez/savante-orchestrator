import { Octokit } from "@octokit/rest";

export class BranchManager {
  private octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  async createBranch(owner: string, repo: string, branchName: string, baseBranch: string = "main"): Promise<void> {
    // Get the SHA of the base branch
    const { data: baseRef } = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });

    try {
      // Check if branch already exists
      await this.octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${branchName}`,
      });
      // Branch exists, no need to create
      return;
    } catch {
      // Branch doesn't exist, create it
    }

    await this.octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseRef.object.sha,
    });
  }

  async deleteBranch(owner: string, repo: string, branchName: string): Promise<void> {
    await this.octokit.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
    });
  }

  async listBranches(owner: string, repo: string): Promise<string[]> {
    const { data } = await this.octokit.repos.listBranches({
      owner,
      repo,
    });

    return data.map((branch) => branch.name);
  }

  async getBranchSHA(owner: string, repo: string, branch: string): Promise<string> {
    const { data } = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });

    return data.object.sha;
  }
}
