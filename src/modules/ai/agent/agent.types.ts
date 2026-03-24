export type AgentEventType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'final_response'
  | 'error';

export interface AgentEvent {
  type: AgentEventType;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface AgentToolCall {
  name: string;
  input: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  output: string | Record<string, unknown> | unknown[];
  metadata?: Record<string, unknown>;
}

export interface AgentDecision {
  thought: string;
  action: 'tool' | 'final';
  toolName?: string;
  toolInput?: string;
  finalAnswer?: string;
}

export interface AgentRunResult {
  runId: string;
  domain: string;
  finalAnswer: string;
  events: AgentEvent[];
}

export interface AgentRunAccepted {
  runId: string;
  domain: string;
  status: 'running';
}
