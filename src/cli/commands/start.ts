import chalk from "chalk";
import ora from "ora";
import { GitHubClient, type GitHubRepo } from "../../github/client.js";
import { RepoReader } from "../../github/repo-reader.js";
import { AnalystAgent } from "../../agents/analyst/agent.js";
import { StateStore } from "../../orchestrator/state-store.js";
import { GateManager } from "../../orchestrator/gate-manager.js";
import { buildGateReachedPayload, emitGateReached } from "../../notifications/gate-events.js";

interface StartOptions {
  target?: string;
}

export async function startCommand(options: StartOptions): Promise<void> {
  console.log(chalk.bold("\n🚀 Savante Orchestrator - Starting Analysis\n"));

  const spinner = ora("Loading orchestrator state...").start();

  try {
    const github = new GitHubClient();
    const octokit = github.getOctokit();

    let targetRepo: GitHubRepo;
    if (options.target) {
      targetRepo = parseRepo(options.target);
    } else {
      throw new Error("Target repo is required. Use --target owner/repo or set it during init.");
    }

    const stateStore = new StateStore(octokit);
    let { state, sha } = await stateStore.loadState(targetRepo);
    const sourceRepo = parseRepo(state.source_repo);

    spinner.succeed("State loaded");

    const repoReader = new RepoReader(github);

    spinner.start("Analyzing business documentation...");
    console.log(chalk.cyan("\n[Phase 1] Analyzing business documentation..."));

    const analyst = new AnalystAgent({
      sourceRepo,
      repoReader,
    });

    const domainDocument = await analyst.run({});

    spinner.succeed("Domain document generated");

    displayDomainSummary(domainDocument);

    spinner.start("Committing domain document to target repo...");
    await commitDomainDocument(octokit, targetRepo, domainDocument);
    spinner.succeed("Domain document committed");

    ({ state, sha } = await stateStore.loadState(targetRepo));

    const gateManager = new GateManager(stateStore, state, targetRepo, sha);
    await gateManager.requestApproval("domain", "docs/domain-analysis.md");

    try {
      await emitGateReached(
        buildGateReachedPayload(state, targetRepo, "domain", ["docs/domain-analysis.md"])
      );
    } catch (notifyErr) {
      console.warn(
        chalk.yellow(
          `  Gate webhook notification failed: ${notifyErr instanceof Error ? notifyErr.message : notifyErr}`
        )
      );
    }

    console.log(chalk.green("\n✓ Domain analysis complete!\n"));
    console.log(chalk.yellow("─── GATE 1: Domain approval ───"));
    console.log(
      "Review the document at:",
      chalk.cyan(`${targetRepo.owner}/${targetRepo.repo}/docs/domain-analysis.md`)
    );
    console.log("\nNext steps:");
    console.log("  1. Review the domain document");
    console.log("  2. Approve or request changes (Slack or CLI)");
    console.log("  3. Run `savante-orch resume` to continue after CLI approval\n");
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
      sha: "sha" in existingFile ? existingFile.sha : undefined,
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
