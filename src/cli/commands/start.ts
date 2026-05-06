import chalk from "chalk";
import ora from "ora";
import { GitHubClient, type GitHubRepo } from "../../github/client.js";
import { RepoReader } from "../../github/repo-reader.js";
import { AnalystAgent } from "../../agents/analyst/agent.js";

interface StartOptions {
  target?: string;
}

export async function startCommand(options: StartOptions): Promise<void> {
  console.log(chalk.bold("\n🚀 Savante Orchestrator - Starting Analysis\n"));

  const spinner = ora("Loading orchestrator state...").start();

  try {
    const github = new GitHubClient();
    const octokit = github.getOctokit();

    // Parse target repo from options or use state
    let targetRepo: GitHubRepo;
    if (options.target) {
      targetRepo = parseRepo(options.target);
    } else {
      throw new Error("Target repo is required. Use --target owner/repo or set it during init.");
    }

    // Read state from _orchestrator branch
    const { data: stateFile } = await octokit.repos.getContent({
      owner: targetRepo.owner,
      repo: targetRepo.repo,
      path: "orchestrator-state.json",
      ref: "_orchestrator",
    });

    if (!('content' in stateFile)) {
      throw new Error("State file not found");
    }

    const state = JSON.parse(Buffer.from(stateFile.content, 'base64').toString());
    const sourceRepo = parseRepo(state.source_repo);
    // targetRepo already defined above from options

    spinner.succeed("State loaded");

    // Initialize services
    const repoReader = new RepoReader(github);

    // Phase 1: Domain Analysis
    spinner.start("Analyzing business documentation...");
    console.log(chalk.cyan("\n[Phase 1] Analyzing business documentation..."));

    const analyst = new AnalystAgent({
      sourceRepo,
      repoReader,
    });

    const domainDocument = await analyst.run({});

    spinner.succeed("Domain document generated");

    // Display summary
    displayDomainSummary(domainDocument);

    // Commit to target repo
    spinner.start("Committing domain document to target repo...");
    await commitDomainDocument(octokit, targetRepo, domainDocument);
    spinner.succeed("Domain document committed");

    // Update state
    state.current_phase = "AWAITING_DOMAIN_APPROVAL";
    state.artifacts.domain_document = "docs/domain-analysis.md";
    state.updated_at = new Date().toISOString();

    await updateState(octokit, targetRepo, state, stateFile.sha);

    console.log(chalk.green("\n✓ Domain analysis complete!\n"));
    console.log(chalk.yellow("─── GATE 1: Domain approval ───"));
    console.log("Review the document at:", chalk.cyan(`${targetRepo.owner}/${targetRepo.repo}/docs/domain-analysis.md`));
    console.log("\nNext steps:");
    console.log("  1. Review the domain document");
    console.log("  2. Approve or request changes");
    console.log("  3. Run `savante-orch resume` to continue\n");
  } catch (error) {
    spinner.fail("Start failed");
    console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}

function parseRepo(repoString: string): GitHubRepo {
  const parts = repoString.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid repo format: ${repoString}`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function displayDomainSummary(document: string): void {
  // Extract entities count
  const entitiesMatch = document.match(/## Entities/g);
  const flowsMatch = document.match(/## User Flows/g);
  const rulesMatch = document.match(/## Business Rules/g);
  const ambiguitiesMatch = document.match(/## Ambiguities/g);

  console.log(chalk.green("\n✓ Domain document generated."));
  console.log(`  Entities found: ${entitiesMatch ? entitiesMatch.length : 0}`);
  console.log(`  User flows: ${flowsMatch ? flowsMatch.length : 0}`);
  console.log(`  Business rules: ${rulesMatch ? rulesMatch.length : 0}`);
  console.log(`  Ambiguities: ${ambiguitiesMatch ? ambiguitiesMatch.length : 0}`);
  console.log(`\nDocument length: ${document.length} characters`);
}

async function commitDomainDocument(octokit: any, targetRepo: GitHubRepo, content: string): Promise<void> {
  const path = "docs/domain-analysis.md";
  const encodedContent = Buffer.from(content).toString("base64");

  try {
    const { data: existingFile } = await octokit.repos.getContent({
      owner: targetRepo.owner,
      repo: targetRepo.repo,
      path,
      ref: "_orchestrator",
    });

    await octokit.repos.createOrUpdateFileContents({
      owner: targetRepo.owner,
      repo: targetRepo.repo,
      path,
      message: "Add domain analysis document",
      content: encodedContent,
      sha: 'sha' in existingFile ? existingFile.sha : undefined,
      branch: "_orchestrator",
    });
  } catch {
    await octokit.repos.createOrUpdateFileContents({
      owner: targetRepo.owner,
      repo: targetRepo.repo,
      path,
      message: "Add domain analysis document",
      content: encodedContent,
      branch: "_orchestrator",
    });
  }
}

async function updateState(octokit: any, targetRepo: GitHubRepo, state: any, sha: string): Promise<void> {
  const content = Buffer.from(JSON.stringify(state, null, 2)).toString("base64");

  await octokit.repos.createOrUpdateFileContents({
    owner: targetRepo.owner,
    repo: targetRepo.repo,
    path: "orchestrator-state.json",
    message: "Update state: Phase 1 complete",
    content,
    sha,
    branch: "_orchestrator",
  });
}
