import { Body, Controller, Get, Param, Post, Query, Sse } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, map } from 'rxjs';
import { AgentService } from './agent';
import { LlmService } from './llm';
import { AgentRunDto, ModelTestDto } from './dto';

@Controller('ai')
export class AiController {
  constructor(
    private readonly configService: ConfigService,
    private readonly llmService: LlmService,
    private readonly agentService: AgentService,
  ) {}

  @Post('model/test')
  async testModel(@Body() body: ModelTestDto) {
    const output = await this.llmService.generateText(
      'You are a direct assistant. Keep response concise.',
      body.prompt,
    );

    return {
      model: this.configService.get<string>('LLM_MODEL', 'Qwen3.5-4B'),
      baseUrl: this.configService.get<string>('LLM_BASE_URL', 'http://127.0.0.1:8080/v1'),
      output,
    };
  }

  @Post('agent/run')
  async runAgent(@Body() body: AgentRunDto) {
    const defaultDomain = this.configService.get<string>('AGENT_DEFAULT_DOMAIN', 'general');
    const domain = body.domain ?? defaultDomain;
    return this.agentService.startAgentRun(body.input, domain, body.saveMemory ?? true);
  }

  @Get('agent/runs/:runId')
  async getRunStatus(@Param('runId') runId: string) {
    const status = await this.agentService.getRunStatus(runId);
    if (!status) {
      return {
        runId,
        status: 'not_found',
      };
    }
    return status;
  }

  @Get('agent/runs/:runId/result')
  async getRunResult(@Param('runId') runId: string) {
    const result = await this.agentService.getRunResult(runId);
    if (!result) {
      return {
        runId,
        status: 'not_found',
      };
    }
    return result;
  }

  @Get('agent/runs/:runId/events')
  async getRunEvents(@Param('runId') runId: string) {
    return this.agentService.getRunEvents(runId);
  }

  @Sse('agent/runs/:runId/live')
  runLiveStream(
    @Param('runId') runId: string,
    @Query('replay') replay?: string,
  ): Observable<{ data: unknown }> {
    const stream = this.agentService.getLiveRunStream(runId).pipe(
      map((event) => ({ data: event })),
    );

    if (replay === 'true') {
      return stream;
    }

    return stream;
  }
}
