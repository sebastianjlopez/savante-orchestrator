import chalk from "chalk";
import ora from "ora";
import { GitHubClient, type GitHubRepo } from "../../github/client.js";
import { StateStore } from "../../orchestrator/state-store.js";
import { StateMachine, type TransitionAction } from "../../orchestrator/state-machine.js";
import { GateManager } from "../../orchestrator/gate-manager.js";
import type { OrchestratorState } from "../../types/state.js";
import type { GateName } from "../../notifications/gate-contract.js";
import { buildGateReachedPayload, emitGateReached } from "../../notifications/gate-events.js";
import { AnalystAgent } from "../../agents/analyst/agent.js";
import { ArchitectAgent } from "../../agents/architect/agent.js";
import { PlannerAgent } from "../../agents/planner/agent.js";
import { DeveloperAgent } from "../../agents/developer/agent.js";
import { ReviewerAgent } from "../../agents/reviewer/agent.js";
import { IntegratorAgent } from "../../agents/integrator/agent.js";
import { DeployerAgent } from "../../agents/deployer/agent.js";
import { RepoReader } from "../../github/repo-reader.js";
import { FileWriter } from "../../github/file-writer.js";
import { BranchManager } from "../../github/branch-manager.js";
import { PRManager } from "../../github/pr-manager.js";
import { AWSPriceClient } from "../../aws/pricing-client.js";
import type { DevelopmentPlan, ModuleSpec } from "../../types/plan.js";

interface ResumeOptions {
  target?: string;
}

async function emitGateNotificationSafe(
  state: OrchestratorState,
  targetRepo: GitHubRepo,
  gate: GateName,
  paths: string[]
): Promise<void> {
  try {
    await emitGateReached(buildGateReachedPayload(state, targetRepo, gate, paths));
  } catch (e) {
    console.warn(
      chalk.yellow(`  Gate webhook notification failed: ${e instanceof Error ? e.message : e}`)
    );
  }
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
    const gateManager = new GateManager(stateStore, state, targetRepo, sha);

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
      sha = gateManager.getStateSha();
      await emitGateNotificationSafe(state, targetRepo, "domain", ["docs/domain-analysis.md"]);
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
      sha = gateManager.getStateSha();
      await emitGateNotificationSafe(state, targetRepo, "architecture", [
        "docs/architecture-analysis.md",
      ]);
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

      console.log(chalk.cyan(`  Found ${developmentPlan.modules.length} modules in plan`));

      // Filter modules that need work: new modules or ones that need fixes
      const modulesToProcess = developmentPlan.modules.filter((m: ModuleSpec) => {
        const modState = state.modules.find((s: any) => s.name === m.name);
        // Process if: no state yet (new), or status is needs_fix
        return !modState || modState.status === "needs_fix";
      });

      if (modulesToProcess.length === 0) {
        console.log(chalk.yellow("  No modules need work. All modules are completed."));
        return "DEVELOPING";
      }

      console.log(chalk.cyan(`  Processing ${modulesToProcess.length} modules that need work`));

      // Process modules sequentially to avoid race conditions
      for (const moduleSpec of modulesToProcess) {
        const branchName = `feature/module-${moduleSpec.name.toLowerCase().replace(/\s+/g, "-")}`;
        const modState = state.modules.find((s: any) => s.name === moduleSpec.name);

        // Get feedback if module needs fixes
        let feedback: string | undefined;
        if (modState?.status === "needs_fix") {
          feedback = modState.lastFeedback;
          console.log(chalk.yellow(`  Module "${moduleSpec.name}" needs fixes. Feedback: ${feedback || "(none)"}`));
        }

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

        // Get PR number if it exists (for read_pr_comments tool)
        const prNumber = await getPRNumberForBranch(prManager, targetRepo, branchName);

        const developer = new DeveloperAgent({
          targetRepo,
          repoReader,
          fileWriter,
          prManager,
          moduleSpec,
          interfaceContracts: developmentPlan.interfaceContracts,
          branch: branchName,
          developmentPlanPath: "docs/development-plan.json",
          feedback,  // Pass feedback to agent if available
          prNumber,  // Pass PR number for read_pr_comments tool
        });

        try {
          const result = await developer.run({});
          console.log(chalk.green(`  ✓ Developer agent completed for ${moduleSpec.name}`));

          // Update module status
          const existingIndex = state.modules.findIndex((s: any) => s.name === moduleSpec.name);

          if (existingIndex >= 0) {
            state.modules[existingIndex] = {
              ...state.modules[existingIndex],
              status: "completed",
              pr_number: prNumber,
              reviewStatus: prNumber ? "pending" : undefined,
            };
          } else {
            state.modules.push({
              name: moduleSpec.name,
              status: "completed",
              branch: branchName,
              pr_number: prNumber,
              reviewStatus: prNumber ? "pending" : undefined,
              attempts: (modState?.attempts || 0) + 1,
            });
          }
        } catch (error) {
          console.log(chalk.red(`  ✗ Developer agent failed for ${moduleSpec.name}: ${error instanceof Error ? error.message : String(error)}`));

          // Update module status to needs_fix
          const existingIndex = state.modules.findIndex((s: any) => s.name === moduleSpec.name);
          if (existingIndex >= 0) {
            state.modules[existingIndex].status = "needs_fix";
          }
        }
      }

      console.log(chalk.green(`\n✓ Development complete for all modules`));

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

      // Now check the review status for each PR
      const needsFixModules: string[] = [];
      let allApproved = true;
      let pendingReview = false;

      for (const pr of modulePRs) {
        const moduleName = extractModuleNameFromPR(pr);
        console.log(chalk.cyan(`  Checking review status for PR #${pr.number}: ${pr.title}`));

        // Get reviews for this PR
        const reviews = await prManager.listReviews(targetRepo.owner, targetRepo.repo, pr.number);

        // Find the latest review state
        let latestState: string | null = null;
        let latestFeedback: string | undefined;

        if (reviews && reviews.length > 0) {
          // Reviews are returned in chronological order, get the latest
          const latestReview = reviews[reviews.length - 1];
          latestState = latestReview.state;
          latestFeedback = latestReview.body || undefined;
        }

        // Update state for this module
        const moduleIndex = state.modules.findIndex((m: any) => m.name === moduleName);
        if (moduleIndex >= 0) {
          state.modules[moduleIndex].pr_number = pr.number;
          state.modules[moduleIndex].reviewStatus = latestState?.toLowerCase() || "pending";
          state.modules[moduleIndex].reviewCount = (state.modules[moduleIndex].reviewCount || 0) + 1;

          if (latestState === "CHANGES_REQUESTED") {
            state.modules[moduleIndex].status = "needs_fix";
            state.modules[moduleIndex].lastFeedback = latestFeedback;
            needsFixModules.push(moduleName);
            allApproved = false;
            console.log(chalk.yellow(`  ⚠ PR #${pr.number} needs changes: ${latestFeedback || "(no feedback given)"}`));
          } else if (latestState === "APPROVED") {
            state.modules[moduleIndex].status = "completed";
            console.log(chalk.green(`  ✓ PR #${pr.number} is approved`));
          } else {
            allApproved = false;
            pendingReview = true;
            console.log(chalk.yellow(`  ⏳ PR #${pr.number} is pending review`));
          }
        }
      }

      // Save state before transitioning
      state.updated_at = new Date().toISOString();
      await stateStore.saveState(targetRepo, state, sha);

      console.log(chalk.green(`\n✓ Review complete`));

      // If all approved, move to integration
      if (allApproved && needsFixModules.length === 0) {
        console.log(chalk.green("  All PRs approved! Moving to integration phase."));
        state.current_phase = "INTEGRATING";
        await stateStore.saveState(targetRepo, state, sha);
        return "INTEGRATING";
      } else if (needsFixModules.length > 0) {
        // Some PRs need fixes - transition back to DEVELOPING
        console.log(chalk.yellow(`  ${needsFixModules.length} PR(s) need fixes. Transitioning back to development.`));
        state.current_phase = "DEVELOPING";
        await stateStore.saveState(targetRepo, state, sha);
        return "DEVELOPING";
      } else {
        console.log(chalk.yellow("  Some PRs are still pending review. Waiting..."));
        return "REVIEWING_CODE";
      }
    }

    case "INTEGRATING": {
      console.log(chalk.cyan("\n[Phase 6] Integrating modules..."));

      const integrator = new IntegratorAgent({
        targetRepo,
        prManager,
        repoReader,
        fileWriter,
        developmentPlanPath: "docs/development-plan.json",
      });

      try {
        const result = await integrator.run({});
        console.log(chalk.green("\n✓ Integration complete."));
        console.log(result);
      } catch (error) {
        console.log(chalk.red(`\n✗ Integration failed: ${error instanceof Error ? error.message : String(error)}`));
        throw error;
      }

      // Request Gate 3 approval (human review of integrated code)
      await gateManager.requestApproval("code", "main branch after integration");
      sha = gateManager.getStateSha();
      await emitGateNotificationSafe(state, targetRepo, "code", [
        "main branch after integration",
      ]);
      return "AWAITING_CODE_APPROVAL";
    }

    case "DEPLOYING": {
      console.log(chalk.cyan("\n[Phase 7] Deploying application..."));

      const deployer = new DeployerAgent({
        targetRepo,
        repoReader,
        architectureDocumentPath: "docs/architecture-analysis.md",
      });

      try {
        const result = await deployer.run({});
        console.log(chalk.green("\n✓ Deployment process complete."));
        console.log(result);
      } catch (error) {
        console.log(chalk.red(`\n✗ Deployment failed: ${error instanceof Error ? error.message : String(error)}`));
        throw error;
      }

      // Request Gate 4 approval (post-deploy verification)
      await gateManager.requestApproval("deploy", "deployed application");
      sha = gateManager.getStateSha();
      await emitGateNotificationSafe(state, targetRepo, "deploy", ["deployed application"]);
      return "AWAITING_DEPLOY_APPROVAL";
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

    case "AWAITING_CODE_APPROVAL":
      console.log(`  1. Review the integrated code in: ${targetRepo.owner}/${targetRepo.repo} (main branch)`);
      console.log("  2. Approve: `savante-orch approve --gate code --target ...`");
      console.log("  3. Or reject: `savante-orch reject --gate code --feedback '...' --target ...`\n");
      break;

    case "AWAITING_DEPLOY_APPROVAL":
      console.log(`  1. Verify the deployed application is working`);
      console.log("  2. Approve: `savante-orch approve --gate deploy --target ...`");
      console.log("  3. Or reject: `savante-orch reject --gate deploy --feedback '...' --target ...`\n");
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

/**
 * Extract module name from PR title or branch name
 */
function extractModuleNameFromPR(pr: any): string {
  // Try to extract from PR title - format: [Module: {name}] Implementation
  const titleMatch = pr.title?.match(/\[Module:\s*(.+?)\]\s*Implementation/i);
  if (titleMatch) {
    return titleMatch[1].trim();
  }
  // Try to infer from branch name - format: feature/module-{name}
  if (pr.head?.ref?.startsWith("feature/module-")) {
    return pr.head.ref.replace("feature/module-", "").replace(/-/g, " ");
  }
  return pr.head?.ref || "unknown";
}

/**
 * Get PR number for a given branch
 */
async function getPRNumberForBranch(prManager: PRManager, targetRepo: GitHubRepo, branchName: string): Promise<number | undefined> {
  try {
    const prs = await prManager.listPRs(targetRepo.owner, targetRepo.repo, "open");
    const pr = prs.find((p: any) => p.head.ref === branchName);
    return pr?.number;
  } catch {
    return undefined;
  }
}
