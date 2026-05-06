export interface DomainDocument {
  title: string;
  entities: Entity[];
  userFlows: UserFlow[];
  businessRules: BusinessRule[];
  ambiguities: string[];
  metadata: {
    generatedAt: string;
    sourceRepo: string;
    model: string;
  };
}

export interface Entity {
  name: string;
  description: string;
  attributes: Attribute[];
  relationships: Relationship[];
}

export interface Attribute {
  name: string;
  type: string;
  constraints?: string[];
  description?: string;
}

export interface Relationship {
  targetEntity: string;
  type: "one-to-one" | "one-to-many" | "many-to-many";
  description?: string;
}

export interface UserFlow {
  name: string;
  actor: string;
  description: string;
  steps: FlowStep[];
  decisionPoints?: DecisionPoint[];
}

export interface FlowStep {
  order: number;
  action: string;
  description: string;
}

export interface DecisionPoint {
  step: number;
  condition: string;
  outcomes: string[];
}

export interface BusinessRule {
  id: string;
  description: string;
  type: "validation" | "constraint" | "calculation" | "conditional";
  applicableTo?: string; // Entity or flow name
}
