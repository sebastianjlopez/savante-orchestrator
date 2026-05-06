import chalk from "chalk";
import ora from "ora";
import { GitHubClient, type GitHubRepo } from "../../github/client.js";
import { StateStore } from "../../orchestrator/state-store.js";
import { StateMachine } from "../../orchestrator/state-machine.js";
import { AnalystAgent } from "../../agents/analyst/agent.js";
import { RepoReader } from "../../github/repo-reader.js";

interface ResumeOptions {
  target?: string;
}

export async function resumeCommand(options: ResumeOptions): Promise<void> {
  console.log(chalk.bold("\n🚀 Savante Orchestrator - Resume Process\n"));

  const spinner = ora("Loading orchestrator state...").start();

  try {
    const github = new GitHubClient();
    const octokit = github.getOctokit();

    // Parse target repo
    if (!options.target) {
      throw new Error("Target repo is required. Use --target owner/repo");
    }
    const targetRepo = parseRepo(options.target);

    // Load state
    const stateStore = new StateStore(octokit);
    const { state, sha } = await stateStore.loadState(targetRepo);

    spinner.succeed(`State loaded. Current phase: ${state.current_phase}`);

    // Check if we're in an approval phase
    if (StateMachine.isApprovalPhase(state.current_phase)) {
      console.log(chalk.yellow("\n⏸  Process is waiting for approval."));
      console.log("  Use `savante-orch approve` or `savante-orch reject` to make a decision.");
      console.log("  Use `savante-orch status` to see full details.\n");
      return;
    }

    // Check if process is complete
    if (StateMachine.isComplete(state.current_phase)) {
      console.log(chalk.green.bold("\n🎉 Process is already completed!"));
      return;
    }

    // Resume based on current phase
    if (state.current_phase === "INIT") {
      console.log(chalk.cyan("\n[Phase 1] Resuming domain analysis..."));
      await resumeDomainAnalysis(github, targetRepo, state, stateStore, sha);
    } else if (state.current_phase === "ANALYZING_DOMAIN") {
      console.log(chalk.cyan("\n[Phase 1] Resuming domain analysis..."));
      await resumeDomainAnalysis(github, targetRepo, state, stateStore, sha);
    } else {
      console.log(chalk.yellow(`\nPhase ${state.current_phase} resume logic not yet implemented.`));
      console.log("  This phase will be implemented in upcoming sprints.\n");
    }

  } catch (error) {
    spinner.fail("Resume failed");
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}

async function resumeDomainAnalysis(
  github: GitHubClient,
  targetRepo: GitHubRepo,
  state: any,
  stateStore: StateStore,
  sha: string
): Promise<void> {
  const octokit = github.getOctokit();
  const repoReader = new RepoReader(github);
  const sourceRepo = parseRepo(state.source_repo);

  console.log(chalk.cyan(`  Reading from: ${sourceRepo.owner}/${sourceRepo.repo}`));

  const analyst = new AnalystAgent({
    sourceRepo,
    repoReader,
  });

  const domainDocument = await analyst.run({});

  console.log(chalk.green("\n✓ Domain document generated."));
  displayDomainSummary(domainDocument);

  // Commit to target repo
  console.log(chalk.yellow("\nCommitting domain document..."));
  await commitDomainDocument(octokit, targetRepo, domainDocument);

  // Update state
  state.current_phase = "AWAITING_DOMAIN_APPROVAL";
  state.artifacts.domain_document = "docs/domain-analysis.md";
  state.updated_at = new Date().toISOString();

  await stateStore.saveState(targetRepo, state, sha);

  console.log(chalk.green("\n✓ Domain analysis complete!\n"));
  console.log(chalk.yellow("─── GATE 1: Domain approval ───"));
  console.log(`Review the document at: ${targetRepo.owner}/${targetRepo.repo}/docs/domain-analysis.md`);
  console.log("\nNext steps:");
  console.log("  1. Review the domain document");
  console.log("  2. Run `savante-orch approve --gate domain` to approve");
  console.log("  3. Or run `savante-orch reject --gate domain --feedback '...'` to reject\n");
}

function parseRepo(repoString: string): GitHubRepo {
  const parts = repoString.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid repo format: ${repoString}. Expected: owner/repo`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function displayDomainSummary(document: string): void {
  const entitiesMatch = document.match(/## Entities/g);
  const flowsMatch = document.match(/## User Flows/g);
  const rulesMatch = document.match(/## Business Rules/g);
  const ambiguitiesMatch = document.match(/## Ambiguities/g);

  console.log(chalk.green("\n✓ Domain document generated."));
  console.log(`  Entities found: ${entitiesMatch ? entitiesMatch.length : 0}`);
  console.log(`  User flows: ${flowsMatch ? flowsMatch.length : 0}`);
  console.log(`  Business rules: ${rulesMatch ? rulesMatch.length : 0}`);
  console.log(`  Ambiguities: ${ambiguitiesMatch ? ambiguitiesMatch.length : 0}`);
  console.log(`\n  Document length: ${document.length} characters`);
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
