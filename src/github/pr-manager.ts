import { Octokit } from "@octokit/rest";

export class PRManager {
  private octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  async createPR(
    owner: string,
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string = "main"
  ): Promise<number> {
    const { data } = await this.octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
    });

    return data.number;
  }

  async getPR(owner: string, repo: string, prNumber: number) {
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    return data;
  }

  async listPRs(owner: string, repo: string, state: "open" | "closed" | "all" = "open") {
    const { data } = await this.octokit.pulls.list({
      owner,
      repo,
      state,
    });

    return data;
  }

  async approvePR(owner: string, repo: string, prNumber: number): Promise<void> {
    const { data: pr } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: pr.head.sha,
      event: "APPROVE",
    });
  }

  async requestChanges(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
    const { data: pr } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: pr.head.sha,
      event: "REQUEST_CHANGES",
      body,
    });
  }

  async mergePR(owner: string, repo: string, prNumber: number): Promise<void> {
    await this.octokit.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
    });
  }

  async commentOnPR(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }

  async getPRDiff(owner: string, repo: string, prNumber: number): Promise<string> {
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: {
        format: "diff",
      },
    });

    return data as unknown as string;
  }

  async listReviews(owner: string, repo: string, prNumber: number) {
    const { data } = await this.octokit.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });

    return data;
  }

  async listComments(owner: string, repo: string, prNumber: number) {
    const { data } = await this.octokit.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    return data;
  }
}
