import { Injectable } from '@nestjs/common';
import { AgentTool } from './tool.types';
import { ToolExecutionResult } from '../agent';
import { MemoryService } from '../memory';

@Injectable()
export class MemoryLookupTool implements AgentTool {
  readonly name = 'memory_lookup';
  readonly description = 'Search persisted memory and summaries for a domain.';

  constructor(private readonly memoryService: MemoryService) {}

  async execute(input: string, domain: string): Promise<ToolExecutionResult> {
    const context = await this.memoryService.findRelevantContext(domain, input, 5);
    return {
      ok: true,
      output: context || 'No relevant memory found.',
    };
  }
}
