import chalk from "chalk";
import ora from "ora";
import { GitHubClient, type GitHubRepo } from "../../github/client.js";
import { StateStore } from "../../orchestrator/state-store.js";
import { StateMachine, type TransitionAction } from "../../orchestrator/state-machine.js";
import { GateManager } from "../../orchestrator/gate-manager.js";
import { AnalystAgent } from "../../agents/analyst/agent.js";
import { ArchitectAgent } from "../../agents/architect/agent.js";
import { PlannerAgent } from "../../agents/planner/agent.js";
import { DeveloperAgent } from "../../agents/developer/agent.js";
import { ReviewerAgent } from "../../agents/reviewer/agent.js";
import { RepoReader } from "../../github/repo-reader.js";
import { FileWriter } from "../../github/file-writer.js";
import { BranchManager } from "../../github/branch-manager.js";
import { PRManager } from "../../github/pr-manager.js";
import { AWSPriceClient } from "../../aws/pricing-client.js";
import type { DevelopmentPlan, ModuleSpec } from "../../types/plan.js";

interface ResumeOptions {
  target?: string;
}

export async function resumeCommand(options: ResumeOptions): Promise<void> {
  console.log(chalk.bold("\nSavante Orchestrator - Resume Process\n"));

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

    // Initialize services
    const repoReader = new RepoReader(github);
    const fileWriter = new FileWriter(octokit);
    const branchManager = new BranchManager(octokit);
    const prManager = new PRManager(octokit);
    const gateManager = new GateManager(stateStore, state, targetRepo);

    // Resume based on current phase
    const nextPhase = await resumePhase(
      state.current_phase,
      github,
      targetRepo,
      state,
      stateStore,
      repoReader,
      fileWriter,
      branchManager,
      prManager,
      gateManager,
      sha
    );

    console.log(chalk.green(`\n✓ Phase complete. Now in: ${nextPhase}`));

    // Show next steps based on new phase
    showNextSteps(nextPhase, targetRepo);

  } catch (error) {
    spinner.fail("Resume failed");
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}

async function resumePhase(
  currentPhase: string,
  github: GitHubClient,
  targetRepo: GitHubRepo,
  state: any,
  stateStore: StateStore,
  repoReader: RepoReader,
  fileWriter: FileWriter,
  branchManager: BranchManager,
  prManager: PRManager,
  gateManager: GateManager,
  sha: string
): Promise<string> {
  const octokit = github.getOctokit();

  switch (currentPhase) {
    case "INIT":
    case "ANALYZING_DOMAIN": {
      console.log(chalk.cyan("\n[Phase 1] Analyzing business documentation..."));
      const sourceRepo = parseRepo(state.source_repo);
      const analyst = new AnalystAgent({
        sourceRepo,
        repoReader,
      });

      const domainDocument = await analyst.run({});
      console.log(chalk.green("\n✓ Domain document generated."));
      displayDomainSummary(domainDocument);

      // Commit to target repo
      console.log(chalk.yellow("\nCommitting domain document..."));
      await commitDocument(octokit, targetRepo, "docs/domain-analysis.md", domainDocument, "Add domain analysis document");

      // Request Gate 1 approval
      await gateManager.requestApproval("domain", "docs/domain-analysis.md");
      return "AWAITING_DOMAIN_APPROVAL";
    }

    case "ANALYZING_ARCHITECTURE": {
      console.log(chalk.cyan("\n[Phase 2] Analyzing architecture..."));

      const pricingClient = new AWSPriceClient();
      const architect = new ArchitectAgent({
        targetRepo,
        repoReader,
        fileWriter,
        pricingClient,
        domainDocumentPath: "docs/domain-analysis.md",
        architectureDocumentPath: "docs/architecture-analysis.md",
      });

      // Read domain document to pass as context
      const domainDocument = await repoReader.readFile(
        targetRepo.owner,
        targetRepo.repo,
        "docs/domain-analysis.md"
      );

      const architectureDocument = await architect.run({ domainDocument });
      console.log(chalk.green("\n✓ Architecture document generated."));
      displayArchitectureSummary(architectureDocument);

      // Commit to target repo
      console.log(chalk.yellow("\nCommitting architecture document..."));
      await commitDocument(octokit, targetRepo, "docs/architecture-analysis.md", architectureDocument, "Add architecture analysis document");

      // Request Gate 2 approval
      await gateManager.requestApproval("architecture", "docs/architecture-analysis.md");
      return "AWAITING_TECH_APPROVAL";
    }

    case "PLANNING_DEVELOPMENT": {
      console.log(chalk.cyan("\n[Phase 3] Creating development plan..."));

      const planner = new PlannerAgent({
        targetRepo,
        repoReader,
        fileWriter,
        domainDocumentPath: "docs/domain-analysis.md",
        architectureDocumentPath: "docs/architecture-analysis.md",
        developmentPlanPath: "docs/development-plan.json",
      });

      // Read documents to pass as context
      const domainDocument = await repoReader.readFile(
        targetRepo.owner,
        targetRepo.repo,
        "docs/domain-analysis.md"
      );
      const architectureDocument = await repoReader.readFile(
        targetRepo.owner,
        targetRepo.repo,
        "docs/architecture-analysis.md"
      );

      const developmentPlan = await planner.run({ domainDocument, architectureDocument });
      console.log(chalk.green("\n✓ Development plan created."));
      displayPlanSummary(developmentPlan);

      // Commit to target repo
      console.log(chalk.yellow("\nCommitting development plan..."));
      await commitDocument(octokit, targetRepo, "docs/development-plan.json", developmentPlan, "Add development plan");

      // Update state with development plan path
      state.artifacts.development_plan = "docs/development-plan.json";
      state.current_phase = "DEVELOPING";
      state.updated_at = new Date().toISOString();
      await stateStore.saveState(targetRepo, state, sha);

      return "DEVELOPING";
    }

    case "DEVELOPING": {
      console.log(chalk.cyan("\n[Phase 4] Running developer agents..."));

      // Read the development plan to get modules
      const planContent = await repoReader.readFile(
        targetRepo.owner,
        targetRepo.repo,
        "docs/development-plan.json"
      );
      const developmentPlan = JSON.parse(planContent) as DevelopmentPlan;

      if (!developmentPlan.modules || developmentPlan.modules.length === 0) {
        throw new Error("No modules found in development plan");
      }

      console.log(chalk.cyan(`  Found ${developmentPlan.modules.length} modules to develop`));

      // Create branches and run developer agents in parallel
      const devPromises = developmentPlan.modules.map(async (moduleSpec: ModuleSpec) => {
        const branchName = `feature/module-${moduleSpec.name.toLowerCase().replace(/\s+/g, "-")}`;

        // Create branch if it doesn't exist
        try {
          await branchManager.createBranch(targetRepo.owner, targetRepo.repo, branchName, "main");
          console.log(chalk.green(`  ✓ Branch created: ${branchName}`));
        } catch (error: any) {
          // Branch might already exist
          if (!error.message?.includes("already exists")) {
            console.log(chalk.yellow(`  ⚠ Could not create branch ${branchName}: ${error.message}`));
          }
        }

        // Run developer agent
        console.log(chalk.cyan(`  Starting developer agent for module: ${moduleSpec.name}`));
        const developer = new DeveloperAgent({
          targetRepo,
          repoReader,
          fileWriter,
          prManager,
          moduleSpec,
          interfaceContracts: developmentPlan.interfaceContracts,
          branch: branchName,
          developmentPlanPath: "docs/development-plan.json",
        });

        try {
          const result = await developer.run({});
          console.log(chalk.green(`  ✓ Developer agent completed for ${moduleSpec.name}`));
          return { module: moduleSpec.name, status: "completed", result, branch: branchName };
        } catch (error) {
          console.log(chalk.red(`  ✗ Developer agent failed for ${moduleSpec.name}: ${error instanceof Error ? error.message : String(error)}`));
          return { module: moduleSpec.name, status: "failed", error, branch: branchName };
        }
      });

      const results = await Promise.allSettled(devPromises);

      // Process results
      const completed = results.filter(r => r.status === "fulfilled" && (r.value as any).status === "completed").length;
      const failed = results.filter(r => r.status === "rejected" || (r.status === "fulfilled" && (r.value as any).status === "failed")).length;

      console.log(chalk.green(`\n✓ Development complete: ${completed} completed, ${failed} failed`));

      // Update state with module statuses
      state.modules = developmentPlan.modules.map((m: ModuleSpec) => {
        const result = results.find(r =>
          r.status === "fulfilled" && (r.value as any).module === m.name
        );
        return {
          name: m.name,
          status: result ? "completed" : "blocked",
          branch: `feature/module-${m.name.toLowerCase().replace(/\s+/g, "-")}`,
        };
      });
      state.current_phase = "REVIEWING_CODE";
      state.updated_at = new Date().toISOString();
      await stateStore.saveState(targetRepo, state, sha);

      return "REVIEWING_CODE";
    }

    case "REVIEWING_CODE": {
      console.log(chalk.cyan("\n[Phase 5] Reviewing pull requests..."));

      // Get all open PRs that are from feature/module-* branches
      const prs = await prManager.listPRs(targetRepo.owner, targetRepo.repo, "open");
      const modulePRs = prs.filter(pr => pr.head.ref.startsWith("feature/module-"));

      if (modulePRs.length === 0) {
        console.log(chalk.yellow("  No module PRs found to review."));
        return "REVIEWING_CODE";
      }

      console.log(chalk.cyan(`  Found ${modulePRs.length} PRs to review`));

      // Run reviewer agents in parallel for each PR
      const reviewPromises = modulePRs.map(async (pr) => {
        console.log(chalk.cyan(`  Starting reviewer agent for PR #${pr.number}: ${pr.title}`));

        const reviewer = new ReviewerAgent({
          targetRepo,
          prManager,
          repoReader,
          prNumber: pr.number,
          developmentPlanPath: "docs/development-plan.json",
        });

        try {
          const result = await reviewer.run({});
          console.log(chalk.green(`  ✓ Reviewer completed for PR #${pr.number}`));
          return { prNumber: pr.number, status: "completed", result };
        } catch (error) {
          console.log(chalk.red(`  ✗ Reviewer failed for PR #${pr.number}: ${error instanceof Error ? error.message : String(error)}`));
          return { prNumber: pr.number, status: "failed", error };
        }
      });

      const reviewResults = await Promise.allSettled(reviewPromises);

      // Check if all PRs are approved
      const approvedPRs = (await Promise.all(
        modulePRs.map(async (pr) => {
          const prDetails = await prManager.getPR(targetRepo.owner, targetRepo.repo, pr.number);
          // PR is approved if it's merged or has an approved review
          return prDetails.merged === true;
        })
      )).filter(Boolean).length;

      console.log(chalk.green(`\n✓ Review complete: ${approvedPRs}/${modulePRs.length} PRs approved`));

      // If all approved, move to integration
      if (approvedPRs === modulePRs.length) {
        console.log(chalk.green("  All PRs approved! Moving to integration phase."));
        state.current_phase = "INTEGRATING";
        state.updated_at = new Date().toISOString();
        await stateStore.saveState(targetRepo, state, sha);
        return "INTEGRATING";
      } else {
        console.log(chalk.yellow("  Some PRs need changes. Process will continue after fixes."));
        return "REVIEWING_CODE";
      }
    }

    case "INTEGRATING": {
      console.log(chalk.cyan("\n[Phase 6] Integrating modules..."));
      console.log(chalk.yellow("  Integrator agent will be implemented in Sprint 5."));
      console.log(chalk.yellow("  This phase handles merging approved PRs in dependency order.\n"));

      // For now, just transition to AWAITING_CODE_APPROVAL
      state.current_phase = "AWAITING_CODE_APPROVAL";
      state.updated_at = new Date().toISOString();
      await stateStore.saveState(targetRepo, state, sha);

      return "AWAITING_CODE_APPROVAL";
    }

    case "DEPLOYING": {
      console.log(chalk.cyan("\n[Phase 7] Deploying application..."));
      console.log(chalk.yellow("  Deployer agent will be implemented in Sprint 5.\n"));
      return "DEPLOYING";
    }

    default: {
      console.log(chalk.yellow(`\nPhase ${currentPhase} resume logic not yet implemented.`));
      console.log("  This phase will be implemented in upcoming sprints.\n");
      return currentPhase;
    }
  }
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

function displayArchitectureSummary(document: string): void {
  const productTypeMatch = document.match(/## Product Type/g);
  const stackMatch = document.match(/## AWS Stack/g);
  const costsMatch = document.match(/## Estimated Costs/g);

  console.log(chalk.green("\n✓ Architecture document generated."));
  if (productTypeMatch) console.log("  Product type defined");
  if (stackMatch) console.log("  AWS stack designed");
  if (costsMatch) console.log("  Cost estimates included");
  console.log(`\n  Document length: ${document.length} characters`);
}

function displayPlanSummary(plan: string): void {
  try {
    const planObj = JSON.parse(plan);
    console.log(chalk.green("\n✓ Development plan created."));
    console.log(`  Modules: ${planObj.modules?.length || 0}`);
    console.log(`  Interface contracts: ${planObj.interfaceContracts?.length || 0}`);
    console.log(`  Execution order: ${planObj.executionOrder?.length || 0} steps`);
  } catch {
    console.log(chalk.green("\n✓ Development plan created."));
    console.log(`  Document length: ${plan.length} characters`);
  }
}

async function commitDocument(
  octokit: any,
  targetRepo: GitHubRepo,
  path: string,
  content: string,
  message: string
): Promise<void> {
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
      message,
      content: encodedContent,
      sha: 'sha' in existingFile ? existingFile.sha : undefined,
      branch: "_orchestrator",
    });
  } catch {
    await octokit.repos.createOrUpdateFileContents({
      owner: targetRepo.owner,
      repo: targetRepo.repo,
      path,
      message,
      content: encodedContent,
      branch: "_orchestrator",
    });
  }
}

function showNextSteps(phase: string, targetRepo: GitHubRepo): void {
  console.log(chalk.yellow("\nNext steps:"));

  switch (phase) {
    case "AWAITING_DOMAIN_APPROVAL":
      console.log(`  1. Review the domain document at: ${targetRepo.owner}/${targetRepo.repo}/docs/domain-analysis.md`);
      console.log("  2. Approve: `savante-orch approve --gate domain --target ...`");
      console.log("  3. Or reject: `savante-orch reject --gate domain --feedback '...' --target ...`\n");
      break;

    case "AWAITING_TECH_APPROVAL":
      console.log(`  1. Review the architecture document at: ${targetRepo.owner}/${targetRepo.repo}/docs/architecture-analysis.md`);
      console.log("  2. Approve: `savante-orch approve --gate architecture --target ...`");
      console.log("  3. Or reject: `savante-orch reject --gate architecture --feedback '...' --target ...`\n");
      break;

    case "DEVELOPING":
      console.log("  1. Developer agents will work on their assigned modules");
      console.log("  2. Run `savante-orch resume --target ...` to continue\n");
      break;

    default:
      console.log("  1. Run `savante-orch status --target ...` to check state");
      console.log("  2. Run `savante-orch resume --target ...` to continue\n");
  }
}
