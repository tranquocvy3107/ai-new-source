import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AgentEventEntity,
  AgentRunEntity,
  DomainMemoryEntity,
  MemoryChunkEntity,
} from '../../database/entities';
import { AiController } from './ai.controller';
import { AgentGraphService, AgentService } from './agent';
import { LlmService } from './llm';
import { MemoryService } from './memory';
import { ChunkService, RagService, VectorService } from './rag';
import { AgentStreamService } from './stream';
import {
  CheckConnectTool,
  MemoryLookupTool,
  SemrushTrafficTool,
  UrlSearchTool,
  WebScrapeTool,
} from './tools';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentRunEntity,
      AgentEventEntity,
      DomainMemoryEntity,
      MemoryChunkEntity,
    ]),
  ],
  controllers: [AiController],
  providers: [
    LlmService,
    AgentStreamService,
    ChunkService,
    VectorService,
    RagService,
    MemoryService,
    UrlSearchTool,
    WebScrapeTool,
    CheckConnectTool,
    SemrushTrafficTool,
    MemoryLookupTool,
    AgentGraphService,
    AgentService,
  ],
  exports: [AgentService],
})
export class AiModule {}
