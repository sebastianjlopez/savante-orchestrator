export interface DevelopmentPlan {
  modules: ModuleSpec[];
  interfaceContracts: InterfaceContract[];
  dependencyGraph: DependencyGraph;
  executionOrder: string[];
  metadata: {
    generatedAt: string;
    sourceRepo: string;
    model: string;
  };
}

export interface ModuleSpec {
  name: string;
  description: string;
  endpoints?: Endpoint[];
  responsibilities: string[];
  dependencies: string[]; // Names of other modules
  acceptanceCriteria: string[];
}

export interface Endpoint {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  description: string;
  requestSchema?: string;
  responseSchema?: string;
}

export interface InterfaceContract {
  provider: string; // Module name
  consumer: string; // Module name
  contractType: "api" | "event" | "database";
  definition: string; // Schema or interface definition
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: "module" | "external";
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface TaskAssignment {
  moduleName: string;
  agentId: string;
  branchName: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  prNumber?: number;
}
