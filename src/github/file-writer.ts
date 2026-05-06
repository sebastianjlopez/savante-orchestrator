import { Octokit } from "@octokit/rest";
import { Buffer } from "buffer";

export class FileWriter {
  private octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  async writeFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    branch: string = "main"
  ): Promise<void> {
    const encodedContent = Buffer.from(content).toString("base64");

    try {
      // Check if file exists
      const { data: existingFile } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });

      // Update existing file
      await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message,
        content: encodedContent,
        sha: 'sha' in existingFile ? existingFile.sha : undefined,
        branch,
      });
    } catch (error: any) {
      if (error.status === 404) {
        // File doesn't exist, create new
        await this.octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path,
          message,
          content: encodedContent,
          branch,
        });
      } else {
        throw error;
      }
    }
  }

  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    message: string,
    branch: string = "main"
  ): Promise<void> {
    try {
      const { data: existingFile } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });

      await this.octokit.repos.deleteFile({
        owner,
        repo,
        path,
        message,
        sha: 'sha' in existingFile ? existingFile.sha : "",
        branch,
      });
    } catch (error: any) {
      if (error.status !== 404) {
        throw error;
      }
    }
  }

  async readFile(
    owner: string,
    repo: string,
    path: string,
    branch: string = "main"
  ): Promise<string> {
    const { data } = await this.octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if (!('content' in data) || !data.content) {
      throw new Error(`File not found: ${path}`);
    }

    return Buffer.from(data.content, 'base64').toString('utf-8');
  }

  async listFiles(
    owner: string,
    repo: string,
    directory: string = "",
    branch: string = "main"
  ): Promise<string[]> {
    const { data } = await this.octokit.repos.getContent({
      owner,
      repo,
      path: directory,
      ref: branch,
    });

    if (!Array.isArray(data)) {
      return [data.name];
    }

    return data
      .filter((item) => item.type === 'file')
      .map((item) => item.path);
  }
}
