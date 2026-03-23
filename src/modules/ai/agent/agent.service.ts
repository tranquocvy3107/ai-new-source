import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentEventEntity, AgentRunEntity } from '../../../database/entities';
import { MemoryService } from '../memory';
import { AgentStreamService } from '../stream';
import {
  MemoryLookupTool,
  SemrushTrafficTool,
  UrlSearchTool,
  WebScrapeTool,
} from '../tools';
import { AgentGraphService } from './agent.graph';
import { AgentEvent, AgentRunResult } from './agent.types';

@Injectable()
export class AgentService {
  constructor(
    private readonly configService: ConfigService,
    private readonly graphService: AgentGraphService,
    private readonly memoryService: MemoryService,
    private readonly streamService: AgentStreamService,
    private readonly urlSearchTool: UrlSearchTool,
    private readonly webScrapeTool: WebScrapeTool,
    // private readonly checkConnectTool: CheckConnectTool,
    private readonly semrushTrafficTool: SemrushTrafficTool,
    private readonly memoryLookupTool: MemoryLookupTool,
    @InjectRepository(AgentRunEntity)
    private readonly runRepo: Repository<AgentRunEntity>,
    @InjectRepository(AgentEventEntity)
    private readonly eventRepo: Repository<AgentEventEntity>,
  ) {}

  async runAgent(input: string, domain: string, saveMemory = true): Promise<AgentRunResult> {
    const maxSteps = this.configService.get<number>('AGENT_MAX_STEPS', 8);
    const run = await this.runRepo.save(
      this.runRepo.create({
        domain,
        userInput: input,
        status: 'running',
      }),
    );

    const events: AgentEvent[] = [];
    const pushEvent = async (event: AgentEvent): Promise<void> => {
      events.push(event);
      this.streamService.emit(run.id, event);
      await this.eventRepo.save(
        this.eventRepo.create({
          runId: run.id,
          type: event.type,
          payload: event.payload,
        }),
      );
    };

    try {
      const execution = await this.graphService.run({
        input,
        domain,
        maxSteps,
        tools: [
          this.urlSearchTool,
          // this.checkConnectTool,
          this.webScrapeTool,
          this.semrushTrafficTool,
          this.memoryLookupTool,
        ],
        onThinking: async (thought, step) =>
          pushEvent({
            type: 'thinking',
            payload: { step, thought },
            timestamp: new Date().toISOString(),
          }),
        onToolCall: async (name, toolInput, step) =>
          pushEvent({
            type: 'tool_call',
            payload: { step, name, input: toolInput },
            timestamp: new Date().toISOString(),
          }),
        onToolResult: async (name, result, step) =>
          pushEvent({
            type: 'tool_result',
            payload: { step, name, result },
            timestamp: new Date().toISOString(),
          }),
      });

      if (saveMemory) {
        await this.memoryService.updateDomainSummary(domain, execution.summarySuggestion, []);
        await this.memoryService.saveEvidence(domain, `run:${run.id}`, execution.scratchpad.join('\n'));
      }

      await pushEvent({
        type: 'final_response',
        payload: { answer: execution.finalAnswer },
        timestamp: new Date().toISOString(),
      });

      run.finalAnswer = execution.finalAnswer;
      run.status = 'completed';
      run.metadata = {
        thoughts: execution.thoughts.length,
        scratchpadItems: execution.scratchpad.length,
      };
      await this.runRepo.save(run);
      this.streamService.complete(run.id);

      return {
        runId: run.id,
        domain,
        finalAnswer: execution.finalAnswer,
        events,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown agent error';
      await pushEvent({
        type: 'error',
        payload: { message },
        timestamp: new Date().toISOString(),
      });

      run.status = 'failed';
      run.finalAnswer = message;
      await this.runRepo.save(run);
      this.streamService.complete(run.id);

      return {
        runId: run.id,
        domain,
        finalAnswer: `Agent failed: ${message}`,
        events,
      };
    }
  }

  async getRunEvents(runId: string): Promise<AgentEventEntity[]> {
    return this.eventRepo.find({
      where: { runId },
      order: { createdAt: 'ASC' },
    });
  }

  getLiveRunStream(runId: string) {
    return this.streamService.getRunStream(runId).asObservable();
  }
}
