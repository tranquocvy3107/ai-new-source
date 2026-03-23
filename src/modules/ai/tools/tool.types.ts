import { ToolExecutionResult } from '../agent';

export interface AgentTool {
  name: string;
  description: string;
  execute(input: string, domain: string): Promise<ToolExecutionResult>;
}
