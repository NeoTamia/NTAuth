export type PolicyEffect = "Allow" | "Deny";

export interface PolicyStatement {
  sid?: string;
  effect: PolicyEffect;
  actions: string[];
  resources: string[];
  conditions?: Record<string, Record<string, string | boolean | string[]>>;
}

export interface PolicyDocument {
  version: "2026-01-01";
  statements: PolicyStatement[];
}

export * from "./oauth";
