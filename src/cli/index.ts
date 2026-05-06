#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { approveCommand } from "./commands/approve.js";
import { rejectCommand } from "./commands/reject.js";
import { resumeCommand } from "./commands/resume.js";

const program = new Command();

program
  .name("savante-orch")
  .description("Savante Multi-Agent Autonomous Development System")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize a new orchestration project")
  .requiredOption("--source <repo>", "Source repository (owner/repo)")
  .requiredOption("--target <repo>", "Target repository (owner/repo)")
  .action(initCommand);

program
  .command("start")
  .description("Start the orchestration process")
  .option("--target <repo>", "Target repository (owner/repo)")
  .action((options) => startCommand(options));

program
  .command("status")
  .description("Check the current state of the orchestration process")
  .requiredOption("--target <repo>", "Target repository (owner/repo)")
  .action((options) => statusCommand(options));

program
  .command("approve")
  .description("Approve a gate")
  .requiredOption("--target <repo>", "Target repository (owner/repo)")
  .requiredOption("--gate <gate>", "Gate to approve (domain|architecture|code|deploy)")
  .action((options) => approveCommand(options));

program
  .command("reject")
  .description("Reject a gate with feedback")
  .requiredOption("--target <repo>", "Target repository (owner/repo)")
  .requiredOption("--gate <gate>", "Gate to reject (domain|architecture|code|deploy)")
  .requiredOption("--feedback <text>", "Feedback message")
  .action((options) => rejectCommand(options));

program
  .command("resume")
  .description("Resume a paused orchestration process")
  .requiredOption("--target <repo>", "Target repository (owner/repo)")
  .action((options) => resumeCommand(options));

program.parse();
