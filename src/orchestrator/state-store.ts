import { Octokit } from "@octokit/rest";
import type { OrchestratorState } from "../types/state.js";
import type { GitHubRepo } from "../github/client.js";

const STATE_FILE_PATH = "orchestrator-state.json";
const STATE_BRANCH = "_orchestrator";

export class StateStore {
  private octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  /**
   * Load state from the _orchestrator branch
   */
  async loadState(targetRepo: GitHubRepo): Promise<{ state: OrchestratorState; sha: string }> {
    try {
      const { data: fileData } = await this.octokit.repos.getContent({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        path: STATE_FILE_PATH,
        ref: STATE_BRANCH,
      });

      if (!('content' in fileData) || !fileData.content) {
        throw new Error("State file not found or empty");
      }

      const state: OrchestratorState = JSON.parse(
        Buffer.from(fileData.content, 'base64').toString('utf-8')
      );

      return {
        state,
        sha: fileData.sha as string
      };
    } catch (error: any) {
      if (error.status === 404) {
        throw new Error(`State file not found at ${targetRepo.owner}/${targetRepo.repo}/${STATE_FILE_PATH} on branch ${STATE_BRANCH}`);
      }
      throw error;
    }
  }

  /**
   * Save state to the _orchestrator branch
   */
  async saveState(
    targetRepo: GitHubRepo,
    state: OrchestratorState,
    sha: string
  ): Promise<string> {
    const content = Buffer.from(JSON.stringify(state, null, 2)).toString("base64");

    const response = await this.octokit.repos.createOrUpdateFileContents({
      owner: targetRepo.owner,
      repo: targetRepo.repo,
      path: STATE_FILE_PATH,
      message: `Update state: ${state.current_phase}`,
      content,
      sha,
      branch: STATE_BRANCH,
    });

    return (response.data.content?.sha as string) || sha;
  }

  /**
   * Update the current phase and persist the change
   */
  async updatePhase(
    targetRepo: GitHubRepo,
    newPhase: OrchestratorState["current_phase"],
    currentSha: string
  ): Promise<{ state: OrchestratorState; sha: string }> {
    const { state, sha } = await this.loadState(targetRepo);

    state.current_phase = newPhase;
    state.updated_at = new Date().toISOString();

    const newSha = await this.saveState(targetRepo, state, currentSha);
    return {
      state,
      sha: newSha
    };
  }

  /**
   * Check if the _orchestrator branch exists
   */
  async branchExists(targetRepo: GitHubRepo): Promise<boolean> {
    try {
      await this.octokit.git.getRef({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        ref: `heads/${STATE_BRANCH}`,
      });
      return true;
    } catch (error: any) {
      if (error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Initialize the state file if it doesn't exist
   */
  async initializeState(
    targetRepo: GitHubRepo,
    initialState: OrchestratorState
  ): Promise<void> {
    const content = Buffer.from(JSON.stringify(initialState, null, 2)).toString("base64");

    // Ensure branch exists
    const branchExists = await this.branchExists(targetRepo);
    if (!branchExists) {
      // Get the default branch SHA
      const { data: repoData } = await this.octokit.repos.get({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
      });

      const { data: refData } = await this.octokit.git.getRef({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        ref: `heads/${repoData.default_branch || "main"}`,
      });

      // Create _orchestrator branch
      await this.octokit.git.createRef({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        ref: `refs/heads/${STATE_BRANCH}`,
        sha: refData.object.sha,
      });
    }

    // Create or update state file
    try {
      const { data: existingFile } = await this.octokit.repos.getContent({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        path: STATE_FILE_PATH,
        ref: STATE_BRANCH,
      });

      if ('sha' in existingFile) {
        await this.octokit.repos.createOrUpdateFileContents({
          owner: targetRepo.owner,
          repo: targetRepo.repo,
          path: STATE_FILE_PATH,
          message: "Initialize orchestrator state",
          content,
          sha: existingFile.sha as string,
          branch: STATE_BRANCH,
        });
      }
    } catch {
      await this.octokit.repos.createOrUpdateFileContents({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        path: STATE_FILE_PATH,
        message: "Initialize orchestrator state",
        content,
        branch: STATE_BRANCH,
      });
    }
  }
}
