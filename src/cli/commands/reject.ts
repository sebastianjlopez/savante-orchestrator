import chalk from "chalk";
import { GitHubClient, type GitHubRepo } from "../../github/client.js";
import { StateStore } from "../../orchestrator/state-store.js";
import { GateManager } from "../../orchestrator/gate-manager.js";

interface RejectOptions {
  target?: string;
  gate?: string;
  feedback?: string;
}

export async function rejectCommand(options: RejectOptions): Promise<void> {
  console.log(chalk.bold("\n🚀 Savante Orchestrator - Reject Gate\n"));

  try {
    const github = new GitHubClient();
    const octokit = github.getOctokit();

    // Parse options
    if (!options.target) {
      throw new Error("Target repo is required. Use --target owner/repo");
    }
    if (!options.gate) {
      throw new Error("Gate name is required. Use --gate domain|architecture|code|deploy");
    }
    if (!options.feedback) {
      throw new Error("Feedback is required. Use --feedback 'Your feedback message'");
    }

    const targetRepo = parseRepo(options.target);
    const gateName = validateGateName(options.gate);

    // Load state
    const stateStore = new StateStore(octokit);
    const { state } = await stateStore.loadState(targetRepo);

    // Create gate manager
    const gateManager = new GateManager(stateStore, state, targetRepo);

    // Reject the gate
    console.log(chalk.yellow(`Rejecting ${gateName} gate...`));
    console.log(chalk.gray(`  Feedback: ${options.feedback}`));

    const nextPhase = await gateManager.reject(gateName, options.feedback);

    console.log(chalk.red(`✗ Gate "${gateName}" rejected.`));
    console.log(chalk.cyan(`  Returning to phase: ${nextPhase}`));
    console.log(chalk.yellow(`  Attempt #${state.gates[gateName].attempts}`));

    // Show next steps
    console.log(chalk.yellow("\nNext steps:"));
    console.log("  1. Review the feedback in the gate");
    console.log("  2. Make necessary changes to the artifact");
    console.log("  3. Run `savante-orch resume` to restart the analysis\n");

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

function validateGateName(gate: string): "domain" | "architecture" | "code" | "deploy" {
  const validGates = ["domain", "architecture", "code", "deploy"];
  if (!validGates.includes(gate)) {
    throw new Error(`Invalid gate name: ${gate}. Valid gates: ${validGates.join(", ")}`);
  }
  return gate as "domain" | "architecture" | "code" | "deploy";
}
