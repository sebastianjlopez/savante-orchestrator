export interface ArchitectureDocument {
  productType: string;
  productTypeJustification: string;
  awsStack: AWSStack;
  alternativesConsidered: Alternative[];
  iacStrategy: IaCStrategy;
  cicd: CICDConfig;
  estimatedCost: CostEstimate;
  technicalRisks: TechnicalRisk[];
  metadata: {
    generatedAt: string;
    sourceRepo: string;
    model: string;
  };
}

export interface AWSStack {
  compute: ComputeService[];
  storage: StorageService[];
  database: DatabaseService[];
  networking: NetworkingService[];
  security: SecurityService[];
  monitoring: MonitoringService[];
}

export interface ServiceBase {
  name: string;
  service: string; // AWS service name
  justification: string;
}

export interface ComputeService extends ServiceBase {
  runtime?: string;
  memory?: string;
  timeout?: number;
}

export interface StorageService extends ServiceBase {
  bucketType?: "standard" | "intelligent-tiering" | "glacier";
}

export interface DatabaseService extends ServiceBase {
  engine?: string;
  instanceType?: string;
}

export interface NetworkingService extends ServiceBase {
  // Additional networking-specific fields
}

export interface SecurityService extends ServiceBase {
  // Additional security-specific fields
}

export interface MonitoringService extends ServiceBase {
  // Additional monitoring-specific fields
}

export interface Alternative {
  service: string;
  reasonForRejection: string;
}

export interface IaCStrategy {
  tool: "CDK" | "Terraform" | "CloudFormation";
  justification: string;
  repoStructure: string;
}

export interface CICDConfig {
  provider: string;
  stages: CICDStage[];
}

export interface CICDStage {
  name: string;
  actions: string[];
}

export interface CostEstimate {
  monthlyEstimate: {
    min: number;
    max: number;
    currency: string;
  };
  breakdown: CostBreakdown[];
}

export interface CostBreakdown {
  service: string;
  estimatedMonthlyCost: number;
}

export interface TechnicalRisk {
  risk: string;
  severity: "low" | "medium" | "high";
  mitigation: string;
}
