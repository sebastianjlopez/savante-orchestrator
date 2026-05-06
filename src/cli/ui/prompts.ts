import { select, text, confirm, isCancel } from "@clack/prompts";
import chalk from "chalk";

export async function promptApproveOrReject(): Promise<"approve" | "reject" | "view"> {
  const response = await select({
    message: "Review the document and decide:",
    options: [
      { value: "approve", label: "Approve" },
      { value: "reject", label: "Request changes (you'll be able to write feedback)" },
      { value: "view", label: "View document here in the console" },
    ],
  });

  if (isCancel(response)) {
    process.exit(0);
  }

  return response as "approve" | "reject" | "view";
}

export async function promptFeedback(): Promise<string> {
  const response = await text({
    message: "Write your feedback:",
    placeholder: "Describe what needs to be changed...",
    validate(value) {
      if (!value || value.trim().length === 0) {
        return "Feedback cannot be empty";
      }
      return;
    },
  });

  if (isCancel(response)) {
    process.exit(0);
  }

  return response as string;
}

export async function promptConfirmation(message: string): Promise<boolean> {
  const response = await confirm({
    message,
  });

  if (isCancel(response)) {
    process.exit(0);
  }

  return response as boolean;
}

export function displayDocument(content: string, maxLines: number = 50): void {
  const lines = content.split("\n");
  const displayLines = lines.slice(0, maxLines);

  console.log(chalk.cyan("\n─── Document Preview ───\n"));
  console.log(displayLines.join("\n"));

  if (lines.length > maxLines) {
    console.log(chalk.yellow(`\n... (${lines.length - maxLines} more lines)`));
    console.log(chalk.yellow("Full document available in the repository\n"));
  }
}
