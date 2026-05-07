import { BaseAgent, type BaseAgentOptions } from "../base-agent.js";
import { DEPLOYER_SYSTEM_PROMPT } from "./prompts.js";
import { getDeployerTools, getDeployerToolExecutor, type DeployerToolOptions } from "./tools.js";
import { RepoReader } from "../../github/repo-reader.js";
import { GitHubRepo } from "../../github/client.js";

export interface DeployerAgentOptions {
  targetRepo: GitHubRepo;
  repoReader: RepoReader;
  architectureDocumentPath?: string;
}

export class DeployerAgent extends BaseAgent {
  private targetRepo: GitHubRepo;
  private architectureDocumentPath: string;

  constructor(options: DeployerAgentOptions) {
    const toolOptions: DeployerToolOptions = {
      targetRepo: options.targetRepo,
      repoReader: options.repoReader,
      architectureDocumentPath: options.architectureDocumentPath,
    };

    const tools = getDeployerTools(toolOptions);
    const toolExecutor = getDeployerToolExecutor(toolOptions);

    const baseOptions: BaseAgentOptions = {
      agentName: "deployer",
      systemPrompt: DEPLOYER_SYSTEM_PROMPT,
      tools,
      toolExecutor,
      maxToolIterations: 25, // Deployment may require multiple steps
    };

    super(baseOptions);

    this.targetRepo = options.targetRepo;
    this.architectureDocumentPath = options.architectureDocumentPath || "docs/architecture-analysis.md";
  }

  async run(_context: Record<string, unknown>): Promise<string> {
    this.log("Starting deployment process", `Target: ${this.targetRepo.owner}/${this.targetRepo.repo}`);

    const userMessage = `Please deploy the application to the target environment.

## Your Task
1. Use \`read_architecture_document\` to understand the AWS stack and deployment strategy
2. Based on the architecture document:
   - Identify the deployment tool (CDK, Terraform, etc.)
   - Execute the appropriate deployment commands using \`run_command\`
   - Monitor progress with \`read_deploy_logs\`
3. After deployment, verify with \`check_health\`:
   - Check health endpoints defined in the architecture
   - Verify the application is responding correctly
4. Use \`notify_supervisor\` to report the final status

## Deployment Guidelines
- Use the deployment strategy specified in the architecture document
- For CDK: \`cdk deploy --require-approval never\`
- For Terraform: \`terraform init && terraform apply -auto-approve\`
- Always verify health after deployment
- Report success or failure to supervisor

## Important Notes
- The main branch should have all merged code ready for deployment
- Check the architecture document for specific deployment instructions
- If deployment fails, read logs and report the issue
- Maximum 3 deployment attempts before escalation`;

    const messages = this.buildMessages(userMessage);
    const result = await this.executeWithTools(messages);

    this.log("Deployment process complete", "Status reported to supervisor");
    return result;
  }
}
