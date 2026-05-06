import chalk from "chalk";
import { GitHubClient, type GitHubRepo } from "../../github/client.js";
import { StateStore } from "../../orchestrator/state-store.js";
import { GateManager } from "../../orchestrator/gate-manager.js";
import type { PhaseType } from "../../types/state.js";

interface StatusOptions {
  target?: string;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  console.log(chalk.bold("\n🚀 Savante Orchestrator - Status\n"));

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
    const { state } = await stateStore.loadState(targetRepo);

    // Display current phase
    console.log(chalk.bold("Current Phase:"), formatPhase(state.current_phase));

    // Display gate statuses
    console.log(chalk.bold("\nGate Statuses:"));
    displayGateStatus("Domain Gate", state.gates.domain);
    displayGateStatus("Architecture Gate", state.gates.architecture);
    displayGateStatus("Code Gate", state.gates.code);
    displayGateStatus("Deploy Gate", state.gates.deploy);

    // Display artifacts
    console.log(chalk.bold("\nArtifacts:"));
    if (state.artifacts.domain_document) {
      console.log(`  Domain Document: ${state.artifacts.domain_document}`);
    }
    if (state.artifacts.architecture_document) {
      console.log(`  Architecture Document: ${state.artifacts.architecture_document}`);
    }
    if (state.artifacts.development_plan) {
      console.log(`  Development Plan: ${state.artifacts.development_plan}`);
    }

    // Display modules
    if (state.modules.length > 0) {
      console.log(chalk.bold("\nModules:"));
      state.modules.forEach((mod) => {
        console.log(`  ${mod.name}: ${formatStatus(mod.status)} (${mod.branch})`);
      });
    }

    // Display decisions log (last 5)
    if (state.decisions_log.length > 0) {
      console.log(chalk.bold("\nRecent Decisions (last 5):"));
      const recent = state.decisions_log.slice(-5);
      recent.forEach((entry) => {
        console.log(`  [${entry.timestamp}] ${entry.phase}: ${entry.decision} (${entry.actor})`);
      });
    }

    console.log(chalk.bold("\nTimestamps:"));
    console.log(`  Created: ${state.created_at}`);
    console.log(`  Updated: ${state.updated_at}`);
    console.log();

  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}

function parseRepo(repoString: string): GitHubRepo {
  const parts = repoString.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid repo format: ${repoString}. Expected: owner/repo`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function formatPhase(phase: PhaseType): string {
  const colors: Record<PhaseType, string> = {
    "INIT": "gray",
    "ANALYZING_DOMAIN": "yellow",
    "AWAITING_DOMAIN_APPROVAL": "cyan",
    "ANALYZING_ARCHITECTURE": "yellow",
    "AWAITING_TECH_APPROVAL": "cyan",
    "PLANNING_DEVELOPMENT": "yellow",
    "DEVELOPING": "yellow",
    "REVIEWING_CODE": "cyan",
    "INTEGRATING": "yellow",
    "AWAITING_CODE_APPROVAL": "cyan",
    "DEPLOYING": "yellow",
    "AWAITING_DEPLOY_APPROVAL": "cyan",
    "COMPLETED": "green",
  };

  const color = colors[phase] || "white";
  return (chalk as any)[color](phase);
}

function formatStatus(status: string): string {
  const statusColors: Record<string, string> = {
    "pending": "yellow",
    "approved": "green",
    "rejected": "red",
    "not_reached": "gray",
    "in_progress": "yellow",
    "completed": "green",
    "blocked": "red",
  };

  const color = statusColors[status] || "white";
  return (chalk as any)[color](status);
}

function displayGateStatus(gateName: string, gate: any): void {
  const status = formatStatus(gate.status);
  console.log(`  ${gateName}: ${status} (attempts: ${gate.attempts})`);

  if (gate.feedback && gate.feedback.length > 0) {
    console.log(`    Feedback: ${gate.feedback.length} message(s)`);
  }
}
