import {z} from 'zod';
export const assistantStepSchema = z
  .object({
    operation: z.string().min(1).max(100),
    arguments: z.string().max(200000),
    clarification: z.string().max(8000),
  })
  .strict();
export type AssistantPlan = z.infer<typeof assistantStepSchema>;
export interface AssistantProvider {
  plan(input: {
    message: string;
    date: string;
    timeZone: string;
    tools: {name: string; title: string; effect: string}[];
    history: unknown[];
  }): Promise<AssistantPlan>;
}
export interface AssistantEvent {
  sequence: number;
  at: string;
  kind:
    'message' | 'step' | 'result' | 'confirmation' | 'answer' | 'error' | 'job';
  text: string;
  operation?: string;
  input?: unknown;
  result?: unknown;
  modelVisible?: boolean;
}
export interface AssistantTurn {
  id: string;
  messageId: string;
  message: string;
  timeZone: string;
  status:
    | 'running'
    | 'confirmation'
    | 'completed'
    | 'failed'
    | 'interrupted'
    | 'cancelled';
  steps: number;
  calls: number;
  pending?: {id: string; operation: string; input: unknown; label: string};
  inFlight?: {operation: string; effect: 'read' | 'change' | 'model'};
  invocation?: {operation: string; input: unknown};
  invocationOriginal?: {operation: string; input: unknown};
  direct?: boolean;
  uncertain?: boolean;
  decisions?: string[];
  events: AssistantEvent[];
}
export interface AssistantSession {
  id: string;
  channel: string;
  conversationId: string;
  updatedAt: string;
  version: number;
  turns: AssistantTurn[];
  jobs: {
    operation: string;
    input: unknown;
    fingerprint: string;
    jobId?: string;
  }[];
}
export interface AssistantSessionStore {
  list(): Promise<AssistantSession[]>;
  read(id: string): Promise<AssistantSession | undefined>;
  save(session: AssistantSession, expectedVersion: number): Promise<void>;
  delete(id: string, expectedVersion: number): Promise<void>;
}
export const sessionIdentitySchema = z
  .object({
    channel: z.string().trim().min(1).max(64).default('web'),
    conversationId: z.string().trim().min(1).max(160),
  })
  .strict();
