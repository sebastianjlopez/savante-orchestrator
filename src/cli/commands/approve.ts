import chalk from "chalk";
import { GitHubClient, type GitHubRepo } from "../../github/client.js";
import { StateStore } from "../../orchestrator/state-store.js";
import { GateManager } from "../../orchestrator/gate-manager.js";

interface ApproveOptions {
  target?: string;
  gate?: string;
}

export async function approveCommand(options: ApproveOptions): Promise<void> {
  console.log(chalk.bold("\n🚀 Savante Orchestrator - Approve Gate\n"));

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

    const targetRepo = parseRepo(options.target);
    const gateName = validateGateName(options.gate);

    // Load state
    const stateStore = new StateStore(octokit);
    const { state, sha } = await stateStore.loadState(targetRepo);

    // Create gate manager
    const gateManager = new GateManager(stateStore, state, targetRepo);

    // Approve the gate
    console.log(chalk.yellow(`Approving ${gateName} gate...`));
    const nextPhase = await gateManager.approve(gateName);

    console.log(chalk.green(`✓ Gate "${gateName}" approved successfully!`));
    console.log(chalk.cyan(`  Next phase: ${nextPhase}`));

    // Check if process is complete
    if (nextPhase === "COMPLETED") {
      console.log(chalk.green.bold("\n🎉 Process completed successfully!"));
    } else {
      console.log(chalk.yellow("\nNext steps:"));
      console.log("  Run `savante-orch status` to check the current state");
      console.log("  Run `savante-orch resume` to continue the process\n");
    }

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
