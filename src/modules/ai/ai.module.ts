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
  DomainClassifyTool,
  MemoryLookupTool,
  SemrushTrafficTool,
  UrlSearchTool,
  WebScrapeTool,
} from './tools';
import { DomainModule } from './domain/domain.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentRunEntity,
      AgentEventEntity,
      DomainMemoryEntity,
      MemoryChunkEntity,
    ]),
    DomainModule,
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
    SemrushTrafficTool,
    MemoryLookupTool,
    CheckConnectTool,
    DomainClassifyTool,
    AgentGraphService,
    AgentService,
  ],
  exports: [AgentService],
})
export class AiModule {}
