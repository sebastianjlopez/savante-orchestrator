import chalk from "chalk";

export function displayHeader(title: string): void {
  console.log(chalk.bold(`\n🚀 ${title}\n`));
}

export function displaySuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

export function displayError(message: string): void {
  console.log(chalk.red(`✗ ${message}`));
}

export function displayInfo(label: string, value: string): void {
  console.log(`  ${chalk.bold(label)}: ${value}`);
}

export function displayList(items: string[]): void {
  items.forEach(item => {
    console.log(`  - ${item}`);
  });
}

export function displaySeparator(char: string = "─"): void {
  console.log(char.repeat(50));
}

export function displayTable(headers: string[], rows: string[][]): void {
  // Simple table display
  console.log(headers.join(" | "));
  console.log(headers.map(() => "---").join(" | "));
  rows.forEach(row => {
    console.log(row.join(" | "));
  });
}
