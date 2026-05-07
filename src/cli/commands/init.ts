import chalk from "chalk";
import ora from "ora";
import { GitHubClient, type GitHubRepo } from "../../github/client.js";

interface InitOptions {
  source: string;
  target: string;
}

export async function initCommand(options: InitOptions): Promise<void> {
  console.log(chalk.bold("\n🚀 Savante Orchestrator - Initialization\n"));

  const spinner = ora("Connecting to GitHub...").start();

  try {
    const github = new GitHubClient();

    // Parse repos
    const sourceRepo = parseRepo(options.source);
    const targetRepo = parseRepo(options.target);

    // Test connection
    const connected = await github.testConnection();
    if (!connected) {
      spinner.fail("Failed to connect to GitHub");
      console.error(chalk.red("  Please check your GITHUB_TOKEN environment variable"));
      process.exit(1);
    }
    spinner.succeed("Connected to GitHub");

    // Check source repo
    spinner.start("Checking source repository...");
    const sourceExists = await github.repoExists(sourceRepo.owner, sourceRepo.repo);
    if (!sourceExists) {
      spinner.fail(`Source repository not found: ${options.source}`);
      process.exit(1);
    }
    spinner.succeed(`Source repo accessible: ${options.source}`);

    // Check/create target repo
    spinner.start("Checking target repository...");
    const targetExists = await github.repoExists(targetRepo.owner, targetRepo.repo);
    if (!targetExists) {
      spinner.text = "Creating target repository...";
      await github.createRepo(targetRepo.repo);
      spinner.succeed(`Target repo created: ${options.target}`);
    } else {
      spinner.succeed(`Target repo exists: ${options.target}`);
    }

    // Initialize orchestrator state
    spinner.start("Initializing orchestrator state...");
    await initializeState(github, targetRepo);
    spinner.succeed("Orchestrator state initialized on _orchestrator branch");

    console.log(chalk.green("\n✓ Project initialized successfully!\n"));
    console.log("Run the following command to start analysis:");
    console.log(chalk.cyan("  savante-orch start\n"));
  } catch (error) {
    spinner.fail("Initialization failed");
    console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}

function parseRepo(repoString: string): GitHubRepo {
  const parts = repoString.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid repo format: ${repoString}. Expected format: owner/repo`);
  }
  return { owner: parts[0], repo: parts[1] };
}

async function initializeState(github: GitHubClient, targetRepo: GitHubRepo): Promise<void> {
  const octokit = github.getOctokit();

  const initialState = {
    version: "1.0",
    project_id: crypto.randomUUID(),
    source_repo: `${targetRepo.owner}/${targetRepo.repo}`,
    target_repo: `${targetRepo.owner}/${targetRepo.repo}`,
    slack_delivery_channel_id: null as string | null,
    slack_delivery_thread_ts: null as string | null,
    current_phase: "INIT",
    gates: {
      domain: { status: "pending", attempts: 0, feedback: [] },
      architecture: { status: "not_reached", attempts: 0, feedback: [] },
      code: { status: "not_reached", attempts: 0, feedback: [] },
      deploy: { status: "not_reached", attempts: 0, feedback: [] },
    },
    artifacts: {
      domain_document: null,
      architecture_document: null,
      development_plan: null,
    },
    modules: [],
    decisions_log: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const content = Buffer.from(JSON.stringify(initialState, null, 2)).toString("base64");

  try {
    // Check if _orchestrator branch exists
    let refExists = false;
    try {
      await octokit.git.getRef({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        ref: "heads/_orchestrator",
      });
      refExists = true;
    } catch {
      // Branch doesn't exist, we'll create it
    }

    if (!refExists) {
      // Get the main branch SHA
      const { data: repoData } = await octokit.repos.get({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
      });

      const mainRef = await octokit.git.getRef({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        ref: `heads/${repoData.default_branch || "main"}`,
      });

      // Create _orchestrator branch
      await octokit.git.createRef({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        ref: "refs/heads/_orchestrator",
        sha: mainRef.data.object.sha,
      });
    }

    // Create or update the state file
    try {
      const { data: existingFile } = await octokit.repos.getContent({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        path: "orchestrator-state.json",
        ref: "_orchestrator",
      });

      if ('sha' in existingFile) {
        await octokit.repos.createOrUpdateFileContents({
          owner: targetRepo.owner,
          repo: targetRepo.repo,
          path: "orchestrator-state.json",
          message: "Initialize orchestrator state",
          content,
          sha: existingFile.sha,
          branch: "_orchestrator",
        });
      }
    } catch {
      await octokit.repos.createOrUpdateFileContents({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        path: "orchestrator-state.json",
        message: "Initialize orchestrator state",
        content,
        branch: "_orchestrator",
      });
    }
  } catch (error) {
    throw new Error(`Failed to initialize state: ${error instanceof Error ? error.message : error}`);
  }
}
