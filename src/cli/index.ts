#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";

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
  .action(startCommand);

program.parse();
